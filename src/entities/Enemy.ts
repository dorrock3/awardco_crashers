import Phaser from 'phaser';
import { CombatSystem, Hitbox, Hurtbox } from '../combat/CombatSystem';
import {
  ENEMY_MAX_HP, ENEMY_MOVE_SPEED, HIT_STUN_MS, KNOCKBACK_FRICTION,
  PLAY_FIELD_BOTTOM, PLAY_FIELD_TOP
} from '../core/constants';
import { StateMachine } from '../core/StateMachine';
import { RiggedSprite } from '../render/RiggedSprite';

export interface EnemyEvents {
  onDefeated(enemy: Enemy): void;
}

type EnemyCtx = {
  enemy: Enemy;
  hitStunTimer: number;
  attackTimer: number;
  attackPhase: 'windup' | 'active' | 'recovery';
};

const ATTACK_RANGE = 60;
const ATTACK_WINDUP = 280;
const ATTACK_ACTIVE = 100;
const ATTACK_RECOVERY = 360;
const ATTACK_DAMAGE = 8;

export class Enemy implements Hurtbox {
  readonly ownerId: number;
  readonly team = 'enemy' as const;

  x: number;
  groundY: number;
  z = 0;
  facing: 1 | -1 = -1;
  kbx = 0;

  get y(): number { return this.groundY - this.z; }
  w = 32;
  h = 56;
  zMin = 0;
  zMax = 56;

  hp = ENEMY_MAX_HP;
  private maxHp: number;
  /** Character variant id (e.g. 'sad-employee-2'). Used by net snapshots
   *  so clients pick the matching sprite. */
  readonly kind: string;

  private readonly fsm: StateMachine<EnemyCtx>;
  private readonly ctx: EnemyCtx;
  readonly sprite: Phaser.GameObjects.Rectangle;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private hpBarVisibleUntil = 0;
  private target: { x: number; groundY: number; isAlive(): boolean } | null = null;
  private readonly rig?: RiggedSprite;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly combat: CombatSystem,
    private readonly events: EnemyEvents,
    opts: { ownerId: number; x: number; y: number; tint?: number; hp?: number; rig?: RiggedSprite; kind?: string }
  ) {
    this.ownerId = opts.ownerId;
    this.x = opts.x;
    this.groundY = opts.y;
    if (opts.hp) this.hp = opts.hp;
    this.maxHp = this.hp;
    this.kind = opts.kind ?? 'sad-employee';

    this.sprite = scene.add.rectangle(this.x, this.y, this.w, this.h, opts.tint ?? 0x6b4f8a)
      .setStrokeStyle(2, 0x000000);
    this.rig = opts.rig;
    if (this.rig) this.sprite.setAlpha(0);

    this.hpBar = scene.add.graphics().setDepth(800);

    this.ctx = { enemy: this, hitStunTimer: 0, attackTimer: 0, attackPhase: 'windup' };
    this.fsm = new StateMachine<EnemyCtx>(this.ctx, {
      idle:    { update: (c) => c.enemy.thinkIdle(c) },
      chase:   { update: (c, dt) => c.enemy.thinkChase(c, dt) },
      attack:  {
        enter: (c) => { c.attackTimer = 0; c.attackPhase = 'windup'; },
        update: (c, dt) => c.enemy.thinkAttack(c, dt)
      },
      hitstun: {
        enter: (c) => { c.hitStunTimer = HIT_STUN_MS; },
        update: (c, dt) => { c.hitStunTimer -= dt; if (c.hitStunTimer <= 0) return 'chase'; }
      },
      dead: { enter: (c) => c.enemy.onDeath() }
    }, 'idle');

    combat.registerHurtbox(this);
  }

  isAlive(): boolean { return this.hp > 0 && !this.fsm.is('dead'); }

  getStateName(): string { return this.fsm.state; }
  getMaxHp(): number { return this.maxHp; }
  isBlocking(): boolean { return false; }

  setTargets(targets: ReadonlyArray<{ x: number; groundY: number; isAlive(): boolean }>): void {
    // Pick nearest living target each tick is overkill; we re-evaluate periodically via thinkIdle/thinkChase.
    let best: typeof this.target = null;
    let bestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive()) continue;
      const d = Math.hypot(t.x - this.x, t.groundY - this.groundY);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    this.target = best;
  }

  tick(dtMs: number): void {
    if (this.fsm.is('dead')) return;

    if (this.kbx !== 0) {
      this.x += this.kbx * (dtMs / 1000);
      this.kbx *= Math.max(0, 1 - KNOCKBACK_FRICTION * (dtMs / 1000));
      if (Math.abs(this.kbx) < 5) this.kbx = 0;
    }

    this.fsm.update(dtMs);

    this.sprite.setPosition(this.x, this.y);
    this.sprite.setScale(this.facing, 1);
    if (this.rig) {
      this.rig.setPosition(this.x, this.y + this.h / 2);
      this.rig.setFacing(this.facing);
      this.rig.play(this.pickAnimation());
      this.rig.tick(dtMs);
    }
    this.drawHpBar();
  }

  private drawHpBar(): void {
    // Hide bar at full HP, after a few seconds of no damage, and on death.
    const showAlways = this.hp < this.maxHp && this.hp > 0;
    const recently = this.scene.time.now < this.hpBarVisibleUntil;
    if (!showAlways || !recently) {
      // fade-out: still draw if recently damaged
      if (!recently || this.hp <= 0) {
        this.hpBar.clear();
        return;
      }
    }
    const w = 36;
    const h = 4;
    const x = this.x - w / 2;
    const y = this.y - this.h / 2 - 10;
    const pct = Math.max(0, this.hp) / this.maxHp;
    const color = pct > 0.6 ? 0x5ed16a : pct > 0.3 ? 0xffc94e : 0xff5a4e;
    this.hpBar.clear();
    this.hpBar.fillStyle(0x000000, 0.7).fillRect(x - 1, y - 1, w + 2, h + 2);
    this.hpBar.fillStyle(color, 1).fillRect(x, y, w * pct, h);
  }

  getAnimName(): string { return this.pickAnimation(); }

  private pickAnimation(): string {
    if (this.fsm.is('dead')) return 'defeat';
    if (this.fsm.is('hitstun')) return 'hit';
    if (this.fsm.is('attack')) return 'light';
    if (this.fsm.is('chase')) return 'walk';
    return 'idle';
  }

  private thinkIdle(_c: EnemyCtx): string | void {
    if (this.target) return 'chase';
  }

  private thinkChase(_c: EnemyCtx, dt: number): string | void {
    if (!this.target || !this.target.isAlive()) return 'idle';
    const dx = this.target.x - this.x;
    const dy = this.target.groundY - this.groundY;
    const dist = Math.hypot(dx, dy);
    if (dist < ATTACK_RANGE && Math.abs(dy) < 20) return 'attack';

    const sec = dt / 1000;
    if (Math.abs(dx) > 4) {
      this.x += Math.sign(dx) * ENEMY_MOVE_SPEED * sec;
      this.facing = dx > 0 ? 1 : -1;
    }
    if (Math.abs(dy) > 4) {
      this.groundY = Phaser.Math.Clamp(
        this.groundY + Math.sign(dy) * ENEMY_MOVE_SPEED * sec,
        PLAY_FIELD_TOP,
        PLAY_FIELD_BOTTOM
      );
    }
  }

  private thinkAttack(c: EnemyCtx, dt: number): string | void {
    c.attackTimer += dt;
    if (c.attackPhase === 'windup' && c.attackTimer >= ATTACK_WINDUP) {
      c.attackPhase = 'active';
      c.attackTimer = 0;
      const hb: Hitbox = {
        x: this.x + this.facing * 36,
        y: this.y,
        groundY: this.groundY,
        w: 40,
        h: 40,
        zMin: 0,
        zMax: 60,
        ownerId: this.ownerId,
        team: 'enemy',
        damage: ATTACK_DAMAGE,
        knockback: 160,
        knockbackDirX: this.facing,
        ttlMs: ATTACK_ACTIVE,
        hitOnce: true,
        alreadyHit: new Set()
      };
      this.combat.spawnHitbox(hb);
    } else if (c.attackPhase === 'active' && c.attackTimer >= ATTACK_ACTIVE) {
      c.attackPhase = 'recovery';
      c.attackTimer = 0;
    } else if (c.attackPhase === 'recovery' && c.attackTimer >= ATTACK_RECOVERY) {
      return 'chase';
    }
  }

  onHit(damage: number, knockbackX: number, _knockbackY: number, _src: Hitbox): void {
    if (!this.isAlive()) return;
    this.hp -= damage;
    this.kbx = knockbackX;
    this.hpBarVisibleUntil = this.scene.time.now + 2500;
    const fatal = this.hp <= 0;
    const kind: 'light' | 'medium' | 'heavy' =
      damage >= 20 ? 'heavy' : damage >= 12 ? 'medium' : 'light';
    const fx = (this.scene.game.registry.get('effects') as import('../effects/Effects').Effects | undefined);
    fx?.onHit({ x: this.x, y: this.y - this.h / 2, damage, kind, rig: this.rig, fallbackSprite: this.sprite, fatal });
    if (fatal) {
      this.hp = 0;
      this.fsm.change('dead');
    } else {
      this.fsm.change('hitstun');
    }
  }

  private onDeath(): void {
    // Sad employee turns happy: brief green flash, then fade out.
    this.sprite.setFillStyle(0x5ed16a);
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      duration: 400,
      onComplete: () => this.destroy()
    });
    this.events.onDefeated(this);
  }

  destroy(): void {
    this.combat.unregisterHurtbox(this);
    this.sprite.destroy();
    this.hpBar.destroy();
    this.rig?.destroy();
  }
}
