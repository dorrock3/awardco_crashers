import Phaser from 'phaser';
import { CombatSystem, Hitbox, Hurtbox } from '../combat/CombatSystem';
import { BOSS_MAX_HP, KNOCKBACK_FRICTION, PLAY_FIELD_BOTTOM, PLAY_FIELD_TOP } from '../core/constants';
import { StateMachine } from '../core/StateMachine';
import { Enemy } from './Enemy';
import { RiggedSprite } from '../render/RiggedSprite';

export interface BossEvents {
  onDefeated(boss: AttritionBoss): void;
  spawnMinion(x: number, y: number): Enemy;
}

type BossCtx = {
  boss: AttritionBoss;
  patternTimer: number;
  pattern: 'idle' | 'slam' | 'sweep' | 'summon';
  patternPhase: 'windup' | 'active' | 'recovery';
};

/** Returns the current phase index (0,1,2) based on HP thresholds (66/33%). */
function phaseFromHp(hp: number): 0 | 1 | 2 {
  const pct = hp / BOSS_MAX_HP;
  if (pct > 0.66) return 0;
  if (pct > 0.33) return 1;
  return 2;
}

const PATTERN_GAP_MS = [1400, 1000, 700];
const SUMMON_COUNT = [2, 3, 4];

export class AttritionBoss implements Hurtbox {
  readonly ownerId: number;
  readonly team = 'enemy' as const;

  x: number;
  groundY: number;
  z = 0;
  facing: 1 | -1 = -1;
  kbx = 0;

  get y(): number { return this.groundY - this.z; }
  w = 80;
  h = 110;
  zMin = 0;
  zMax = 110;

  hp = BOSS_MAX_HP;

  private readonly fsm: StateMachine<BossCtx>;
  private readonly ctx: BossCtx;
  readonly sprite: Phaser.GameObjects.Rectangle;
  private target: { x: number; groundY: number; isAlive(): boolean } | null = null;
  private gapTimer = 1500;
  private readonly rig?: RiggedSprite;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly combat: CombatSystem,
    private readonly events: BossEvents,
    opts: { ownerId: number; x: number; y: number; rig?: RiggedSprite }
  ) {
    this.ownerId = opts.ownerId;
    this.x = opts.x;
    this.groundY = opts.y;

    this.sprite = scene.add.rectangle(this.x, this.y, this.w, this.h, 0x3a1f4a).setStrokeStyle(3, 0x000000);
    this.rig = opts.rig;
    if (this.rig) this.sprite.setAlpha(0);

    this.ctx = { boss: this, patternTimer: 0, pattern: 'idle', patternPhase: 'windup' };
    this.fsm = new StateMachine<BossCtx>(this.ctx, {
      idle:   { update: (c, dt) => c.boss.thinkIdle(c, dt) },
      slam:   { enter: (c) => { c.patternTimer = 0; c.patternPhase = 'windup'; }, update: (c, dt) => c.boss.thinkSlam(c, dt) },
      sweep:  { enter: (c) => { c.patternTimer = 0; c.patternPhase = 'windup'; }, update: (c, dt) => c.boss.thinkSweep(c, dt) },
      summon: { enter: (c) => { c.patternTimer = 0; c.patternPhase = 'windup'; }, update: (c, dt) => c.boss.thinkSummon(c, dt) },
      dead:   { enter: (c) => c.boss.onDeath() }
    }, 'idle');

    combat.registerHurtbox(this);
  }

  isAlive(): boolean { return this.hp > 0 && !this.fsm.is('dead'); }

  getStateName(): string { return this.fsm.state; }
  isBlocking(): boolean { return false; }

  setTargets(targets: ReadonlyArray<{ x: number; groundY: number; isAlive(): boolean }>): void {
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
      this.x += this.kbx * 0.3 * (dtMs / 1000); // boss has heavy resistance
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
  }

  getAnimName(): string { return this.pickAnimation(); }

  private pickAnimation(): string {
    if (this.fsm.is('dead')) return 'defeat';
    if (this.fsm.is('slam')) return 'heavy';
    if (this.fsm.is('sweep')) return 'special';
    if (this.fsm.is('summon')) return 'special';
    return 'idle';
  }

  private thinkIdle(_c: BossCtx, dt: number): string | void {
    this.gapTimer -= dt;

    // Drift toward target slowly so fight stays engaging
    if (this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.groundY - this.groundY;
      const sec = dt / 1000;
      if (Math.abs(dx) > 8) { this.x += Math.sign(dx) * 40 * sec; this.facing = dx > 0 ? 1 : -1; }
      if (Math.abs(dy) > 8) {
        this.groundY = Phaser.Math.Clamp(this.groundY + Math.sign(dy) * 30 * sec, PLAY_FIELD_TOP, PLAY_FIELD_BOTTOM);
      }
    }

    if (this.gapTimer <= 0) {
      const phase = phaseFromHp(this.hp);
      this.gapTimer = PATTERN_GAP_MS[phase];
      // Pattern selection: phase 0 = slam/summon; phase 1 adds sweep; phase 2 prefers summon.
      const choice = Math.random();
      if (phase === 0)      return choice < 0.5 ? 'slam' : 'summon';
      else if (phase === 1) return choice < 0.34 ? 'slam' : choice < 0.67 ? 'sweep' : 'summon';
      else                  return choice < 0.25 ? 'slam' : choice < 0.45 ? 'sweep' : 'summon';
    }
  }

  private thinkSlam(c: BossCtx, dt: number): string | void {
    c.patternTimer += dt;
    if (c.patternPhase === 'windup' && c.patternTimer >= 600) {
      c.patternPhase = 'active'; c.patternTimer = 0;
      const hb: Hitbox = {
        x: this.x + this.facing * 60, y: this.y, groundY: this.groundY,
        w: 100, h: 80, zMin: 0, zMax: 80,
        ownerId: this.ownerId, team: 'enemy',
        damage: 22, knockback: 280, knockbackDirX: this.facing,
        ttlMs: 200, hitOnce: true, alreadyHit: new Set()
      };
      this.combat.spawnHitbox(hb);
      this.scene.cameras.main.shake(180, 0.008);
    } else if (c.patternPhase === 'active' && c.patternTimer >= 200) {
      c.patternPhase = 'recovery'; c.patternTimer = 0;
    } else if (c.patternPhase === 'recovery' && c.patternTimer >= 500) {
      return 'idle';
    }
  }

  private thinkSweep(c: BossCtx, dt: number): string | void {
    c.patternTimer += dt;
    if (c.patternPhase === 'windup' && c.patternTimer >= 500) {
      c.patternPhase = 'active'; c.patternTimer = 0;
      const hb: Hitbox = {
        x: this.x, y: this.y, groundY: this.groundY,
        w: 220, h: 60, zMin: 0, zMax: 40,
        ownerId: this.ownerId, team: 'enemy',
        damage: 14, knockback: 220, knockbackDirX: this.facing,
        ttlMs: 320, hitOnce: false, alreadyHit: new Set()
      };
      this.combat.spawnHitbox(hb);
    } else if (c.patternPhase === 'active' && c.patternTimer >= 320) {
      c.patternPhase = 'recovery'; c.patternTimer = 0;
    } else if (c.patternPhase === 'recovery' && c.patternTimer >= 400) {
      return 'idle';
    }
  }

  private thinkSummon(c: BossCtx, dt: number): string | void {
    c.patternTimer += dt;
    if (c.patternPhase === 'windup' && c.patternTimer >= 400) {
      c.patternPhase = 'active'; c.patternTimer = 0;
      const phase = phaseFromHp(this.hp);
      const count = SUMMON_COUNT[phase];
      for (let i = 0; i < count; i++) {
        const x = this.x + (i - count / 2) * 50;
        const y = Phaser.Math.Between(PLAY_FIELD_TOP + 20, PLAY_FIELD_BOTTOM - 20);
        this.events.spawnMinion(x, y);
      }
    } else if (c.patternPhase === 'active' && c.patternTimer >= 100) {
      c.patternPhase = 'recovery'; c.patternTimer = 0;
    } else if (c.patternPhase === 'recovery' && c.patternTimer >= 600) {
      return 'idle';
    }
  }

  onHit(damage: number, knockbackX: number, _knockbackY: number, _src: Hitbox): void {
    if (!this.isAlive()) return;
    this.hp -= damage;
    this.kbx = knockbackX;
    const fatal = this.hp <= 0;
    const kind: 'light' | 'medium' | 'heavy' =
      damage >= 20 ? 'heavy' : damage >= 12 ? 'medium' : 'light';
    const fx = (this.scene.game.registry.get('effects') as import('../effects/Effects').Effects | undefined);
    fx?.onHit({ x: this.x, y: this.y - this.h / 2, damage, kind, rig: this.rig, fallbackSprite: this.sprite, fatal });
    if (fatal) {
      this.hp = 0;
      this.fsm.change('dead');
    }
  }

  private onDeath(): void {
    this.sprite.setFillStyle(0x5ed16a);
    this.scene.tweens.add({
      targets: this.sprite, alpha: 0, duration: 800,
      onComplete: () => this.destroy()
    });
    this.events.onDefeated(this);
  }

  destroy(): void {
    this.combat.unregisterHurtbox(this);
    this.sprite.destroy();
    this.rig?.destroy();
  }
}
