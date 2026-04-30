import Phaser from 'phaser';
import { AssetRegistry } from '../render/AssetRegistry';

/**
 * Loads character rigs from /assets/sprites/<id>/rig.json. Falls back to
 * procedural placeholder rigs when assets are missing, so the game runs
 * with zero asset files. Real assets dropped into public/assets/sprites/
 * are picked up on next reload.
 */
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload(): void {
    const g = this.add.graphics();
    g.fillStyle(0x2d3a4f, 1).fillRect(0, 0, 64, 64);
    g.lineStyle(1, 0x1a2333, 1).strokeRect(0, 0, 64, 64);
    g.generateTexture('ground-tile', 64, 64);
    g.destroy();

    // Backgrounds. Missing files just fall back to placeholder rects in ParallaxBackdrop.
    const base = import.meta.env.BASE_URL;
    const bgs = ['office-sky', 'office-mid', 'office-fg', 'boardroom-sky', 'boardroom-mid', 'boardroom-fg'];
    for (const id of bgs) {
      this.load.image(`bg:${id}`, `${base}assets/backgrounds/${id}.png`);
    }
    // Projectile (recognition speech-bubble) frames
    for (let i = 1; i <= 4; i++) {
      this.load.image(`proj:recognition:${i}`, `${base}assets/attacks/Recognition_attack_${i}.png`);
    }
    // Suppress noisy 404 console errors when a bg is missing
    this.load.on('loaderror', () => { /* tolerated */ });
  }

  async create(): Promise<void> {
    const registry = new AssetRegistry();
    await registry.loadAll(this);
    // Stash on the game registry for downstream scenes
    this.game.registry.set('assetRegistry', registry);
    this.scene.start('Title');
  }
}
