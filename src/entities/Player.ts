import Phaser from 'phaser';
import { CombatSystem, Hitbox, Hurtbox } from '../combat/CombatSystem';
import {
  GRAVITY, HEAVY_DAMAGE, HERO_COLORS, HeroColorIndex, HIT_STUN_MS, JUMP_VELOCITY,
  KNOCKBACK_FRICTION, LIGHT_DAMAGE, PLAYER_MAX_HP, PLAYER_MOVE_SPEED, PLAY_FIELD_BOTTOM,
  PLAY_FIELD_TOP, SPECIAL_DAMAGE
} from '../core/constants';
import { EMPTY_INPUT, InputEdge, InputFrame, InputSource } from '../core/Input';
import { StateMachine } from '../core/StateMachine';
import { RiggedSprite } from '../render/RiggedSprite';

export interface PlayerEvents {
  onDamaged(player: Player, damage: number): void;
  onDefeated(player: Player): void;
  onScored(amount: number): void;
  /** Called by the player when its 'light' (ranged) attack fires. Scene
   *  is expected to construct + own a Projectile. Optional so existing
   *  callers don't break. */
  onSpawnProjectile?(player: Player, opts: { x: number; y: number; facing: 1 | -1; damage: number; knockback: number }): void;
}

interface AttackDef {
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  damage: number;
  knockback: number;
  reach: number;
  width: number;
  hitOnce: boolean;
  /** If true, this attack spawns a projectile instead of a melee hitbox. */
  ranged?: boolean;
}

const ATTACKS: Record<'light' | 'heavy' | 'special', AttackDef> = {
  // 'light' is now the RANGED Recognition attack — fires a speech-bubble projectile.
  light:   { windupMs: 120, activeMs:  60, recoveryMs: 220, damage: LIGHT_DAMAGE,   knockback: 140, reach: 30, width: 32, hitOnce: true, ranged: true },
  heavy:   { windupMs: 180, activeMs: 140, recoveryMs: 240, damage: HEAVY_DAMAGE,   knockback: 280, reach: 56, width: 40, hitOnce: true },
  special: { windupMs: 220, activeMs: 220, recoveryMs: 320, damage: SPECIAL_DAMAGE, knockback: 360, reach: 80, width: 80, hitOnce: false }
};

type PlayerCtx = {
  player: Player;
  attack?: { kind: 'light' | 'heavy' | 'special'; phaseTimer: number; phase: 'windup' | 'active' | 'recovery'; spawned: boolean };
  hitStunTimer: number;
};

export class Player implements Hurtbox {
  // Identity
  readonly ownerId: number;
  readonly team = 'hero' as const;
  readonly colorIndex: HeroColorIndex;

  // Position (ground plane + jump z)
  x: number;
  groundY: number;
  z = 0;          // height above ground
  vz = 0;         // vertical velocity
  facing: 1 | -1 = 1;

  // Knockback velocity (decays exponentially)
  kbx = 0;

  // Hurtbox shape (Hurtbox interface)
  get y(): number { return this.groundY - this.z; }
  w = 36;
  h = 60;
  zMin = 0;
  zMax = 60;

  // Stats
  hp = PLAYER_MAX_HP;
  lives: number;

  private readonly fsm: StateMachine<PlayerCtx>;
  private readonly edge = new InputEdge();
  private input: InputFrame = EMPTY_INPUT;
  private readonly ctx: PlayerCtx;
  readonly sprite: Phaser.GameObjects.Rectangle;
  private readonly indicator: Phaser.GameObjects.Triangle;
  private readonly rig?: RiggedSprite;

  constructor(
    scene: Phaser.Scene,
    private readonly combat: CombatSystem,
    private readonly inputSource: InputSource,
    private readonly events: PlayerEvents,
    opts: { ownerId: number; colorIndex: HeroColorIndex; x: number; y: number; lives: number; rig?: RiggedSprite }
  ) {
    this.ownerId = opts.ownerId;
    this.colorIndex = opts.colorIndex;
    this.x = opts.x;
    this.groundY = opts.y;
    this.lives = opts.lives;

    const color = HERO_COLORS[opts.colorIndex];
    this.sprite = scene.add.rectangle(this.x, this.y, this.w, this.h, color).setStrokeStyle(2, 0x000000);
    this.indicator = scene.add.triangle(this.x, this.y - this.h / 2 - 8, 0, 8, 8, -4, -8, -4, color).setStrokeStyle(1, 0x000000);
    this.rig = opts.rig;
    if (this.rig) this.sprite.setAlpha(0); // rig owns the visual

    this.ctx = { player: this, hitStunTimer: 0 };
    this.fsm = new StateMachine<PlayerCtx>(this.ctx, {
      idle: {
        update: (c) => c.player.handleGrounded(c)
      },
      attacking: {
        enter: (c) => { c.attack!.phaseTimer = 0; c.attack!.phase = 'windup'; c.attack!.spawned = false; },
        update: (c, dt) => c.player.tickAttack(c, dt)
      },
      hitstun: {
        enter: (c) => { c.hitStunTimer = HIT_STUN_MS; },
        update: (c, dt) => {
          c.hitStunTimer -= dt;
          if (c.hitStunTimer <= 0) return 'idle';
        }
      },
      dead: {
        enter: (c) => { c.player.sprite.setAlpha(0.25); c.player.indicator.setVisible(false); }
      }
    }, 'idle');

    combat.registerHurtbox(this);
  }

  isAlive(): boolean { return this.hp > 0 || this.lives > 0; }

  /** Snapshot accessor: current FSM state name. */
  getStateName(): string { return this.fsm.state; }
  isBlocking(): boolean { return this.input.block && this.fsm.is('idle') && this.z === 0; }

  setInputOverride(frame: InputFrame | null): void {
    // Hook for netcode (Phase 3): host can override local poll with networked input.
    if (frame) this.input = frame;
  }

  tick(dtMs: number): void {
    if (this.fsm.is('dead')) return;

    this.input = this.inputSource.poll();

    // Vertical (jump) physics — independent of FSM so airborne players still fall.
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= GRAVITY * (dtMs / 1000);
      this.z += this.vz * (dtMs / 1000);
      if (this.z <= 0) { this.z = 0; this.vz = 0; }
    }

    // Knockback decay
    if (this.kbx !== 0) {
      this.x += this.kbx * (dtMs / 1000);
      this.kbx *= Math.max(0, 1 - KNOCKBACK_FRICTION * (dtMs / 1000));
      if (Math.abs(this.kbx) < 5) this.kbx = 0;
    }

    this.fsm.update(dtMs);

    // Sync render
    this.sprite.setPosition(this.x, this.y);
    this.sprite.setScale(this.facing, 1);
    this.indicator.setPosition(this.x, this.y - this.h / 2 - 8);
    if (this.rig) {
      this.rig.setPosition(this.x, this.y + this.h / 2);
      this.rig.setFacing(this.facing);
      this.rig.play(this.pickAnimation());
      this.rig.tick(dtMs);
    }
  }

  private pickAnimation(): string {
    if (this.fsm.is('dead')) return 'defeat';
    if (this.fsm.is('hitstun')) return 'hit';
    if (this.fsm.is('attacking')) return this.ctx.attack?.kind ?? 'idle';
    if (this.z > 0) return 'jump';
    if (this.input.block) return 'block';
    if (this.input.moveX !== 0 || this.input.moveY !== 0) return 'walk';
    return 'idle';
  }

  private handleGrounded(c: PlayerCtx): string | void {
    const edge = this.edge.consume(this.input);

    // Jump
    if (edge.jump && this.z === 0) {
      this.vz = JUMP_VELOCITY;
      this.z = 1;
    }

    // Attacks (only when grounded for MVP simplicity)
    if (this.z === 0) {
      if (edge.heavy)   { c.attack = { kind: 'heavy',   phaseTimer: 0, phase: 'windup', spawned: false }; return 'attacking'; }
      if (edge.special) { c.attack = { kind: 'special', phaseTimer: 0, phase: 'windup', spawned: false }; return 'attacking'; }
      if (edge.light)   { c.attack = { kind: 'light',   phaseTimer: 0, phase: 'windup', spawned: false }; return 'attacking'; }
    }

    // Movement
    const speed = this.input.block ? PLAYER_MOVE_SPEED * 0.4 : PLAYER_MOVE_SPEED;
    const dt = 1 / 60;
    if (this.input.moveX !== 0) {
      this.x += this.input.moveX * speed * dt;
      this.facing = this.input.moveX > 0 ? 1 : -1;
    }
    if (this.input.moveY !== 0 && this.z === 0) {
      this.groundY = Phaser.Math.Clamp(
        this.groundY + this.input.moveY * speed * dt,
        PLAY_FIELD_TOP,
        PLAY_FIELD_BOTTOM
      );
    }
  }

  private tickAttack(c: PlayerCtx, dt: number): string | void {
    const a = c.attack!;
    const def = ATTACKS[a.kind];
    a.phaseTimer += dt;

    if (a.phase === 'windup' && a.phaseTimer >= def.windupMs) {
      a.phase = 'active';
      a.phaseTimer = 0;
      if (def.ranged) {
        // Hand off to the scene to construct + own the projectile. The
        // projectile registers its own hitboxes each sim tick.
        this.events.onSpawnProjectile?.(this, {
          x: this.x + this.facing * def.reach,
          y: this.y - 6,
          facing: this.facing,
          damage: def.damage,
          knockback: def.knockback
        });
      } else {
        // Melee: spawn a normal AABB hitbox
        const reach = def.reach;
        const hb: Hitbox = {
          x: this.x + this.facing * reach,
          y: this.y,
          groundY: this.groundY,
          w: def.width,
          h: 50,
          zMin: 0,
          zMax: 60,
          ownerId: this.ownerId,
          team: 'hero',
          damage: def.damage,
          knockback: def.knockback,
          knockbackDirX: this.facing,
          ttlMs: def.activeMs,
          hitOnce: def.hitOnce,
          alreadyHit: new Set()
        };
        this.combat.spawnHitbox(hb);
      }
      a.spawned = true;
    } else if (a.phase === 'active' && a.phaseTimer >= def.activeMs) {
      a.phase = 'recovery';
      a.phaseTimer = 0;
    } else if (a.phase === 'recovery' && a.phaseTimer >= def.recoveryMs) {
      c.attack = undefined;
      return 'idle';
    }
  }

  onHit(damage: number, knockbackX: number, _knockbackY: number, _src: Hitbox): void {
    if (!this.isAlive() || this.fsm.is('dead')) return;
    this.hp -= damage;
    this.kbx = knockbackX;
    const lethal = this.hp <= 0 && this.lives <= 1;
    const kind: 'light' | 'medium' | 'heavy' =
      damage >= 20 ? 'heavy' : damage >= 12 ? 'medium' : 'light';
    const fx = (this.sprite.scene.game.registry.get('effects') as import('../effects/Effects').Effects | undefined);
    fx?.onHit({ x: this.x, y: this.y - this.h / 2, damage, kind, rig: this.rig, fallbackSprite: this.sprite, fatal: lethal });
    this.events.onDamaged(this, damage);
    if (this.hp <= 0) {
      this.lives -= 1;
      if (this.lives > 0) {
        this.hp = PLAYER_MAX_HP;
        // Brief invulnerability via hitstun is fine for MVP
        this.fsm.change('hitstun');
      } else {
        this.hp = 0;
        this.fsm.change('dead');
        this.events.onDefeated(this);
      }
    } else {
      this.fsm.change('hitstun');
    }
  }

  destroy(): void {
    this.combat.unregisterHurtbox(this);
    this.sprite.destroy();
    this.indicator.destroy();
    this.rig?.destroy();
  }
}
