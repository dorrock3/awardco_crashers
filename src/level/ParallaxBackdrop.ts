import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PLAY_FIELD_BOTTOM, PLAY_FIELD_TOP } from '../core/constants';

/**
 * Three-layer parallax. Uses real background PNGs when present
 * (preloaded by BootScene with keys "bg:<id>"), otherwise falls back to
 * solid-color placeholders.
 */
export class ParallaxBackdrop {
  private readonly layers: Array<{ container: Phaser.GameObjects.Container; factor: number }> = [];

  constructor(scene: Phaser.Scene, theme: 'office' | 'boardroom', worldWidth: number) {
    const isOffice = theme === 'office';
    const skyKey = `bg:${theme}-sky`;
    const midKey = `bg:${theme}-mid`;
    const fgKey  = `bg:${theme}-fg`;

    // Sky (factor 0): screen-locked, stretched to viewport
    if (scene.textures.exists(skyKey)) {
      const img = scene.add.image(0, 0, skyKey).setOrigin(0).setScrollFactor(0).setDepth(-100);
      const tex = scene.textures.get(skyKey).getSourceImage();
      const sx = GAME_WIDTH / (tex.width || 1);
      const sy = GAME_HEIGHT / (tex.height || 1);
      img.setScale(Math.max(sx, sy));
    } else {
      scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, isOffice ? 0xa0c4d8 : 0x1d1b3a)
        .setOrigin(0).setScrollFactor(0).setDepth(-100);
    }

    // Midground (factor 0.4)
    const mid = scene.add.container(0, 0).setDepth(-50);
    if (scene.textures.exists(midKey)) {
      const tex = scene.textures.get(midKey).getSourceImage();
      const targetH = PLAY_FIELD_BOTTOM + 20;
      const scale = targetH / (tex.height || 1);
      const tileW = (tex.width || 1) * scale;
      for (let x = 0; x < worldWidth + tileW; x += tileW) {
        const img = scene.add.image(x, 0, midKey).setOrigin(0, 0).setScale(scale);
        mid.add(img);
      }
    } else {
      const tileW = 200;
      const midColor = isOffice ? 0x4a6175 : 0x352e5a;
      for (let x = 0; x < worldWidth + tileW; x += tileW) {
        const r = scene.add.rectangle(x, 240, tileW - 20, 180, midColor)
          .setOrigin(0).setStrokeStyle(2, 0x000000);
        mid.add(r);
      }
    }
    this.layers.push({ container: mid, factor: 0.4 });

    // Foreground props (factor 0.8): anchored on ground line
    const fg = scene.add.container(0, 0).setDepth(-25);
    if (scene.textures.exists(fgKey)) {
      const tex = scene.textures.get(fgKey).getSourceImage();
      // Scale FG so a single prop is roughly half the playfield height.
      const targetH = (PLAY_FIELD_BOTTOM - PLAY_FIELD_TOP) * 0.55;
      const scale = targetH / (tex.height || 1);
      const tileW = (tex.width || 1) * scale;
      // Wider spacing so props feel scattered, not tiled.
      const step = tileW * 2.2;
      for (let x = step * 0.3; x < worldWidth + tileW; x += step) {
        const img = scene.add.image(x, PLAY_FIELD_BOTTOM + 18, fgKey).setOrigin(0.5, 1).setScale(scale);
        fg.add(img);
      }
    } else {
      const fgColor = isOffice ? 0x2c3e50 : 0x1a1530;
      for (let x = 80; x < worldWidth; x += 320) {
        const r = scene.add.rectangle(x, PLAY_FIELD_BOTTOM - 8, 60, 24, fgColor)
          .setOrigin(0.5, 1).setStrokeStyle(1, 0x000000);
        fg.add(r);
      }
    }
    this.layers.push({ container: fg, factor: 0.8 });

    // Ground band (always solid for sprite contrast)
    const groundColor = isOffice ? 0x6b5a48 : 0x3a2f3f;
    scene.add.rectangle(0, PLAY_FIELD_BOTTOM + 18, worldWidth, GAME_HEIGHT - PLAY_FIELD_BOTTOM, groundColor)
      .setOrigin(0).setDepth(-30);

    scene.add.rectangle(0, PLAY_FIELD_TOP - 2, worldWidth, 2, 0x000000, 0.2)
      .setOrigin(0).setDepth(-30);
  }

  update(cameraScrollX: number): void {
    for (const layer of this.layers) {
      layer.container.setX(-cameraScrollX * (1 - layer.factor));
    }
  }
}
