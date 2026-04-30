/**
 * Centralized juice/effects helpers. Owned by GameScene and accessed via
 * scene.registry.get('effects'). Stateless from the entity's perspective:
 * an entity that takes damage calls effects.onHit(...) and we handle the
 * damage number, screen shake, hit-stop, and rig flash.
 *
 * Hit-stop is implemented by exposing a `freezeMs` field that GameScene
 * checks before stepping its FixedTimestep. Visual updates (rig.tick,
 * tweens) continue running so animations don't visibly stutter.
 */

import Phaser from 'phaser';
import type { RiggedSprite } from '../render/RiggedSprite';

export type HitKind = 'light' | 'medium' | 'heavy';

export class Effects {
  /** Sim-freeze remaining (ms). GameScene polls this each frame. */
  freezeMs = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Trigger all juice for a single hit. */
  onHit(opts: {
    x: number;
    y: number;
    damage: number;
    kind: HitKind;
    rig?: RiggedSprite;
    fallbackSprite?: Phaser.GameObjects.Rectangle;
    fatal?: boolean;
  }): void {
    this.damageNumber(opts.x, opts.y, opts.damage, opts.fatal ? 'crit' : opts.kind);
    this.flashHit(opts.rig, opts.fallbackSprite);
    const intensity = opts.kind === 'heavy' || opts.fatal ? 0.012 : opts.kind === 'medium' ? 0.006 : 0.003;
    const dur = opts.kind === 'heavy' || opts.fatal ? 220 : opts.kind === 'medium' ? 120 : 70;
    this.shake(intensity, dur);
    if (opts.kind === 'heavy' || opts.fatal) {
      this.requestHitStop(opts.fatal ? 110 : 70);
    }
  }

  /** Pop a floating damage number. */
  damageNumber(x: number, y: number, amount: number, kind: HitKind | 'crit' | 'heal'): void {
    const colorMap: Record<string, string> = {
      light:  '#ffffff',
      medium: '#ffe7a3',
      heavy:  '#ff8a3d',
      crit:   '#ff3838',
      heal:   '#5ed16a'
    };
    const sizeMap: Record<string, string> = {
      light:  '14px',
      medium: '16px',
      heavy:  '20px',
      crit:   '24px',
      heal:   '14px'
    };
    const text = (kind === 'heal' ? '+' : '-') + Math.round(Math.abs(amount));
    const t = this.scene.add.text(x + (Math.random() - 0.5) * 14, y - 20, text, {
      fontFamily: 'monospace',
      fontSize: sizeMap[kind],
      color: colorMap[kind],
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: kind === 'crit' || kind === 'heavy' ? 'bold' : 'normal'
    }).setOrigin(0.5).setDepth(900);
    // Pop + drift up
    t.setScale(0.4);
    this.scene.tweens.add({
      targets: t, scale: 1.0, duration: 90, ease: 'Back.Out'
    });
    this.scene.tweens.add({
      targets: t, y: t.y - 32, alpha: 0, delay: 280, duration: 480, ease: 'Cubic.In',
      onComplete: () => t.destroy()
    });
  }

  /** Brief white silhouette flash on a rig (or rectangle fallback). */
  flashHit(rig?: RiggedSprite, fallback?: Phaser.GameObjects.Rectangle): void {
    if (rig) {
      const images = rig.container.list.filter(
        (o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image
      );
      for (const img of images) {
        img.setTintFill(0xffffff);
      }
      this.scene.time.delayedCall(80, () => {
        for (const img of images) {
          if (img.active) img.clearTint();
        }
      });
    } else if (fallback) {
      const orig = fallback.fillColor;
      fallback.setFillStyle(0xffffff);
      this.scene.time.delayedCall(80, () => { if (fallback.active) fallback.setFillStyle(orig); });
    }
  }

  /** Camera screen shake. Intensity is fraction of viewport (0.005..0.02 typical). */
  shake(intensity: number, durationMs: number): void {
    this.scene.cameras.main.shake(durationMs, intensity, false);
  }

  /** Pause sim ticks for `ms`. Caller (GameScene) honors this in update(). */
  requestHitStop(ms: number): void {
    if (ms > this.freezeMs) this.freezeMs = ms;
  }

  /** Called by GameScene each frame to drain the freeze timer. */
  consumeFreeze(dtMs: number): boolean {
    if (this.freezeMs <= 0) return false;
    this.freezeMs = Math.max(0, this.freezeMs - dtMs);
    return true;
  }
}
