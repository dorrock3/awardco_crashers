import Phaser from 'phaser';
import { CombatSystem, Hitbox } from '../combat/CombatSystem';

/**
 * A travelling speech-bubble projectile (the Recognition attack). Owns its
 * own sprite + position; spawns a one-tick hitbox at its current location
 * each sim tick. Despawns on first connect or after `lifeMs` / max range.
 *
 * Why not have CombatSystem move it? Hitboxes are intentionally short-lived
 * and immutable in the resolver. Spawning a fresh hitbox per tick keeps the
 * resolver simple and lets the projectile own all its mutable state.
 */
export class Projectile {
  static nextId = 1;
  readonly id: number;
  /** Texture key chosen at spawn (so net-mirrored projectiles use the same image). */
  kind = '';
  x: number;
  readonly y: number;
  readonly vx: number;
  readonly ownerId: number;
  readonly damage: number;
  readonly knockback: number;
  readonly facing: 1 | -1;
  private lifeMs: number;
  private alreadyHit = new Set<number>();
  private alive = true;
  private readonly img: Phaser.GameObjects.Image;
  private readonly shadow?: Phaser.GameObjects.Image;
  private readonly glow?: Phaser.GameObjects.Image;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly combat: CombatSystem,
    opts: {
      ownerId: number;
      x: number;
      y: number;
      facing: 1 | -1;
      speed?: number;
      damage?: number;
      knockback?: number;
      lifeMs?: number;
      texturePrefix?: string;
      frameCount?: number;
    }
  ) {
    this.id = Projectile.nextId++;
    this.ownerId = opts.ownerId;
    this.x = opts.x;
    this.y = opts.y;
    this.facing = opts.facing;
    this.vx = (opts.speed ?? 520) * opts.facing;
    this.damage = opts.damage ?? 10;
    this.knockback = opts.knockback ?? 140;
    this.lifeMs = opts.lifeMs ?? 1000;

    const prefix = opts.texturePrefix ?? 'proj:recognition';
    const frameCount = opts.frameCount ?? 4;
    // Each speech bubble is a different message — pick ONE at spawn and
    // keep it for the projectile's lifetime (no per-frame cycling).
    const available: string[] = [];
    for (let i = 1; i <= frameCount; i++) {
      const k = `${prefix}:${i}`;
      if (this.scene.textures.exists(k)) available.push(k);
    }
    const chosenKey = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : null;
    this.kind = chosenKey ?? '';

    const SCALE = 0.16;

    if (chosenKey) {
      // Soft yellow glow halo behind the bubble — pops against white walls.
      const glowKey = '__projGlow';
      if (!scene.textures.exists(glowKey)) {
        const g = scene.add.graphics();
        // Layered translucent circles for a fake radial gradient
        for (let r = 60; r > 0; r -= 6) {
          g.fillStyle(0xffd34a, 0.06).fillCircle(64, 64, r);
        }
        g.generateTexture(glowKey, 128, 128);
        g.destroy();
      }
      this.glow = scene.add.image(this.x, this.y, glowKey).setDepth(48).setBlendMode(Phaser.BlendModes.ADD);

      // Dark drop-shadow copy of the bubble for outline/contrast vs white bg.
      this.shadow = scene.add.image(this.x + 3, this.y + 4, chosenKey).setDepth(49);
      this.shadow.setScale(SCALE * 1.05);
      this.shadow.setTint(0x000000);
      this.shadow.setAlpha(0.55);
      this.shadow.setFlipX(this.facing < 0);

      this.img = scene.add.image(this.x, this.y, chosenKey).setDepth(50);
      this.img.setScale(SCALE);
      this.img.setFlipX(this.facing < 0);
    } else {
      // Fallback: a yellow rounded rect texture, generated once.
      const fbKey = '__projFallback';
      if (!scene.textures.exists(fbKey)) {
        const g = scene.add.graphics();
        g.fillStyle(0xffe7a3, 1).fillRoundedRect(0, 0, 36, 22, 6);
        g.lineStyle(2, 0x000000, 1).strokeRoundedRect(0, 0, 36, 22, 6);
        g.generateTexture(fbKey, 36, 22);
        g.destroy();
      }
      this.img = scene.add.image(this.x, this.y, fbKey).setDepth(50);
      this.img.setFlipX(this.facing < 0);
    }
  }

  isAlive(): boolean { return this.alive; }

  tick(dtMs: number): void {
    if (!this.alive) return;
    const sec = dtMs / 1000;
    this.x += this.vx * sec;
    this.lifeMs -= dtMs;

    // Slight wobble for personality
    const wobble = Math.sin((1000 - this.lifeMs) * 0.02) * 3;
    this.img.setPosition(this.x, this.y + wobble);
    this.shadow?.setPosition(this.x + 3, this.y + wobble + 4);
    if (this.glow) {
      // Pulse the glow so it reads on bright backgrounds
      const pulse = 1 + Math.sin(this.scene.time.now * 0.012) * 0.15;
      this.glow.setPosition(this.x, this.y + wobble);
      this.glow.setScale(pulse);
      this.glow.setAlpha(0.7);
    }

    // Spawn a one-tick hitbox at our current position. On hit, kill self.
    const hb: Hitbox = {
      x: this.x,
      y: this.y,
      groundY: this.y, // we approximate; the projectile lives in the player's plane
      w: 70,
      h: 52,
      zMin: 0,
      zMax: 80,
      ownerId: this.ownerId,
      team: 'hero',
      damage: this.damage,
      knockback: this.knockback,
      knockbackDirX: this.facing,
      ttlMs: dtMs + 1, // valid for this tick only
      hitOnce: true,
      alreadyHit: this.alreadyHit
    };
    this.combat.spawnHitbox(hb);

    if (this.lifeMs <= 0 || this.alreadyHit.size > 0) {
      this.die();
    }
  }

  private die(): void {
    if (!this.alive) return;
    this.alive = false;
    // Pop fade-out
    const targets: Phaser.GameObjects.Image[] = [this.img];
    if (this.shadow) targets.push(this.shadow);
    if (this.glow) targets.push(this.glow);
    this.scene.tweens.add({
      targets, alpha: 0, scaleX: this.img.scaleX * 1.6, scaleY: this.img.scaleY * 1.6, duration: 140,
      onComplete: () => { this.img.destroy(); this.shadow?.destroy(); this.glow?.destroy(); }
    });
  }
}
