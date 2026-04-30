import Phaser from 'phaser';

/**
 * Axis-aligned hitbox/hurtbox in world space. Hitboxes are short-lived
 * (spawned during attack frames) and check against all hurtboxes each tick.
 */
export interface Box {
  x: number;        // world center x
  y: number;        // world center y (rendered, includes jump z)
  groundY: number;  // ground-plane y (for depth checks; ignores z)
  w: number;
  h: number;
  zMin: number;     // vertical reach (jump-height range)
  zMax: number;
}

export interface Hurtbox extends Box {
  ownerId: number;
  team: 'hero' | 'enemy';
  onHit(damage: number, knockbackX: number, knockbackY: number, source: Hitbox): void;
  isAlive(): boolean;
  isBlocking(): boolean;
}

export interface Hitbox extends Box {
  ownerId: number;
  team: 'hero' | 'enemy';
  damage: number;
  knockback: number;       // px/sec
  knockbackDirX: number;   // -1 / 1, applied with `knockback`
  ttlMs: number;           // remaining lifetime
  hitOnce: boolean;        // if true, despawns after first connect
  alreadyHit: Set<number>; // owner IDs already struck (for multi-hit boxes)
}

function overlap(a: Box, b: Box): boolean {
  return (
    Math.abs(a.groundY - b.groundY) <= (a.h + b.h) / 2 &&
    Math.abs(a.x - b.x) <= (a.w + b.w) / 2 &&
    a.zMax >= b.zMin && b.zMax >= a.zMin
  );
}

/**
 * Resolves all active hitboxes against all hurtboxes for one sim tick.
 * Friendly-fire ignored: same-team hitboxes do not damage their team.
 */
export class CombatSystem {
  private readonly hitboxes: Hitbox[] = [];
  private readonly hurtboxes: Set<Hurtbox> = new Set();

  registerHurtbox(h: Hurtbox): void { this.hurtboxes.add(h); }
  unregisterHurtbox(h: Hurtbox): void { this.hurtboxes.delete(h); }

  spawnHitbox(h: Hitbox): void { this.hitboxes.push(h); }

  tick(dtMs: number): void {
    for (let i = this.hitboxes.length - 1; i >= 0; i--) {
      const hit = this.hitboxes[i];
      hit.ttlMs -= dtMs;

      for (const hurt of this.hurtboxes) {
        if (hurt.team === hit.team) continue;
        if (!hurt.isAlive()) continue;
        if (hit.alreadyHit.has(hurt.ownerId)) continue;
        if (!overlap(hit, hurt)) continue;

        const dmg = hurt.isBlocking() ? Math.max(1, Math.floor(hit.damage * 0.2)) : hit.damage;
        hurt.onHit(dmg, hit.knockback * hit.knockbackDirX, 0, hit);
        hit.alreadyHit.add(hurt.ownerId);

        if (hit.hitOnce) {
          hit.ttlMs = 0;
          break;
        }
      }

      if (hit.ttlMs <= 0) {
        this.hitboxes.splice(i, 1);
      }
    }
  }

  /** Debug overlay: render hit/hurt boxes. Off by default. */
  debugDraw(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    g.lineStyle(1, 0xff3030, 1);
    for (const h of this.hitboxes) {
      g.strokeRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h);
    }
    g.lineStyle(1, 0x30ff30, 1);
    for (const h of this.hurtboxes) {
      g.strokeRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h);
    }
  }
}
