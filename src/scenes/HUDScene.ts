import Phaser from 'phaser';
import {
  BOSS_MAX_HP, GAME_HEIGHT, GAME_WIDTH,
  HERO_COLORS, HERO_SPECIAL_NAMES, PLAYER_MAX_HP
} from '../core/constants';
import { Player } from '../entities/Player';
import type { GameScene } from './GameScene';

interface InitData {
  game: GameScene;
  players: Player[];
}

interface PlayerWidgets {
  panelG: Phaser.GameObjects.Graphics;
  swatch: Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  specialText: Phaser.GameObjects.Text;
  hpBarG: Phaser.GameObjects.Graphics;
  hpFlashG: Phaser.GameObjects.Graphics;
  livesG: Phaser.GameObjects.Graphics;
  downText: Phaser.GameObjects.Text;
  // local damage-flash state
  lastHp: number;
  flashUntil: number; // ms-from-now
}

const TOP_BAR_H = 64;
const PANEL_GAP = 8;
const PANEL_W = 220;
const PANEL_H = TOP_BAR_H - 12;
const PANEL_X0 = 12;
const PANEL_Y = 6;

export class HUDScene extends Phaser.Scene {
  private gameRef!: GameScene;
  private players: Player[] = [];
  private widgets: PlayerWidgets[] = [];

  private topBar!: Phaser.GameObjects.Graphics;
  private waveText!: Phaser.GameObjects.Text;
  private waveDots!: Phaser.GameObjects.Graphics;
  private enemyCountText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private scoreShadow!: Phaser.GameObjects.Text;
  private displayedScore = 0;
  private bossPanel?: {
    g: Phaser.GameObjects.Graphics;
    nameText: Phaser.GameObjects.Text;
    pctText: Phaser.GameObjects.Text;
    lastHp: number;
    shakeUntil: number;
  };
  private toastText?: Phaser.GameObjects.Text;

  constructor() { super('HUD'); }

  init(data: InitData): void {
    this.gameRef = data.game;
    this.players = data.players;
  }

  create(): void {
    // ---- Top bar background ----
    this.topBar = this.add.graphics();
    this.topBar.fillStyle(0x000000, 0.55).fillRect(0, 0, GAME_WIDTH, TOP_BAR_H);
    this.topBar.lineStyle(2, 0xffffff, 0.15).strokeRect(0, TOP_BAR_H, GAME_WIDTH, 0);

    // ---- Per-player cards ----
    this.players.forEach((p, i) => this.widgets.push(this.buildPlayerWidgets(p, i)));

    // ---- Wave indicator (top-center) ----
    const waves = this.gameRef.getWaves();
    this.waveText = this.add.text(GAME_WIDTH / 2, 10, `WAVE 1 / ${waves.totalWaves}`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffe7a3', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5, 0);
    this.waveDots = this.add.graphics();
    this.enemyCountText = this.add.text(GAME_WIDTH / 2, 44, '', {
      fontFamily: 'monospace', fontSize: '11px', color: '#cccccc', stroke: '#000', strokeThickness: 2
    }).setOrigin(0.5, 0);

    // ---- Score (top-right) ----
    this.scoreShadow = this.add.text(GAME_WIDTH - 27, 11, '0', {
      fontFamily: 'monospace', fontSize: '24px', color: '#000000'
    }).setOrigin(1, 0).setAlpha(0.6);
    this.scoreText = this.add.text(GAME_WIDTH - 28, 10, '0', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffe7a3'
    }).setOrigin(1, 0);
    this.add.text(GAME_WIDTH - 28, 36, 'SCORE', {
      fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa'
    }).setOrigin(1, 0);

    // ---- Wire game events ----
    this.gameRef.events.on('hud:update', () => this.flagDamage());
    this.gameRef.events.on('hud:bossSpawned', () => this.onBossSpawned());
    this.gameRef.events.on('hud:waveStart', (n: number) => this.toast(`WAVE ${n}`, 0xffe7a3));
    this.gameRef.events.on('hud:waveCleared', (n: number) => this.toast(`WAVE ${n} CLEARED!`, 0x5ed16a));
    this.gameRef.events.on('shutdown', () => this.cleanup());
  }

  private buildPlayerWidgets(p: Player, i: number): PlayerWidgets {
    const baseX = PANEL_X0 + i * (PANEL_W + PANEL_GAP);
    const color = HERO_COLORS[p.colorIndex];

    // Card background
    const panelG = this.add.graphics();
    panelG.fillStyle(0x1a1a26, 0.7).fillRoundedRect(baseX, PANEL_Y, PANEL_W, PANEL_H, 6);
    panelG.lineStyle(2, color, 0.9).strokeRoundedRect(baseX, PANEL_Y, PANEL_W, PANEL_H, 6);

    // Color swatch (portrait stand-in)
    const swatch = this.add.graphics();
    swatch.fillStyle(color, 1).fillRoundedRect(baseX + 6, PANEL_Y + 6, 38, PANEL_H - 12, 4);
    swatch.lineStyle(1, 0x000000, 0.8).strokeRoundedRect(baseX + 6, PANEL_Y + 6, 38, PANEL_H - 12, 4);

    // P# label inside swatch
    this.add.text(baseX + 25, PANEL_Y + PANEL_H / 2, `P${i + 1}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5, 0.5);

    // Special move name
    const specialText = this.add.text(baseX + 50, PANEL_Y + 8, HERO_SPECIAL_NAMES[p.colorIndex].toUpperCase(), {
      fontFamily: 'monospace', fontSize: '11px', color: '#cccccc'
    });

    // Player name (P# + special); kept simple for now
    const nameText = this.add.text(baseX + 50, PANEL_Y + 22, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888'
    });

    // HP bar (with damage-flash overlay)
    const hpFlashG = this.add.graphics();
    const hpBarG = this.add.graphics();

    // Lives indicator (heart dots)
    const livesG = this.add.graphics();

    // DOWN overlay (hidden until life lost)
    const downText = this.add.text(baseX + PANEL_W / 2, PANEL_Y + PANEL_H / 2, 'DOWN', {
      fontFamily: 'monospace', fontSize: '18px', color: '#ff5a4e', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setVisible(false);

    return {
      panelG, swatch, nameText, specialText, hpBarG, hpFlashG, livesG, downText,
      lastHp: p.hp, flashUntil: 0
    };
  }

  private onBossSpawned(): void {
    const w = 540;
    const x = (GAME_WIDTH - w) / 2;
    const y = TOP_BAR_H + 10;
    const g = this.add.graphics();
    const nameText = this.add.text(GAME_WIDTH / 2, y - 2, 'ATTRITION', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ff8888', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5, 1);
    const pctText = this.add.text(GAME_WIDTH / 2, y + 9, '100%', {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5, 0.5);
    void x;
    this.bossPanel = {
      g, nameText, pctText,
      lastHp: BOSS_MAX_HP, shakeUntil: 0
    };
    this.toast('BOSS APPROACHES', 0xff5a4e);
  }

  private toast(message: string, colorHex: number): void {
    if (this.toastText) this.toastText.destroy();
    const colorStr = '#' + colorHex.toString(16).padStart(6, '0');
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, message, {
      fontFamily: 'monospace', fontSize: '32px', color: colorStr, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setAlpha(0).setScale(0.6);
    this.toastText = t;
    this.tweens.add({
      targets: t, alpha: 1, scale: 1, duration: 220, ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({
          targets: t, alpha: 0, y: t.y - 20, delay: 900, duration: 350, ease: 'Cubic.In',
          onComplete: () => { t.destroy(); if (this.toastText === t) this.toastText = undefined; }
        });
      }
    });
  }

  /** Trigger HP damage flashes when an event hints HP may have changed. */
  private flagDamage(): void {
    const now = this.time.now;
    this.players.forEach((p, i) => {
      const w = this.widgets[i];
      if (!w) return;
      if (p.hp < w.lastHp) {
        w.flashUntil = now + 220;
      }
      w.lastHp = p.hp;
    });
    if (this.bossPanel) {
      const boss = this.gameRef.getBoss();
      if (boss && boss.hp < this.bossPanel.lastHp) {
        this.bossPanel.shakeUntil = now + 180;
      }
      this.bossPanel.lastHp = boss?.hp ?? this.bossPanel.lastHp;
    }
  }

  override update(): void {
    const now = this.time.now;

    // ---- Player cards ----
    this.players.forEach((p, i) => {
      const w = this.widgets[i];
      if (!w) return;
      const baseX = PANEL_X0 + i * (PANEL_W + PANEL_GAP);
      const hpBarX = baseX + 50;
      const hpBarY = PANEL_Y + 38;
      const hpBarW = PANEL_W - 60;
      const hpBarH = 10;

      // Detect damage even if no event arrived (defensive)
      if (p.hp < w.lastHp) w.flashUntil = now + 220;
      w.lastHp = p.hp;

      // HP flash (yellow ghost behind the bar)
      w.hpFlashG.clear();
      if (now < w.flashUntil) {
        const a = (w.flashUntil - now) / 220;
        w.hpFlashG.fillStyle(0xffffff, 0.55 * a)
          .fillRoundedRect(hpBarX - 2, hpBarY - 2, hpBarW + 4, hpBarH + 4, 3);
      }

      // HP bar
      w.hpBarG.clear();
      const pct = Math.max(0, p.hp) / PLAYER_MAX_HP;
      const hpColor = p.hp > 60 ? 0x5ed16a : p.hp > 25 ? 0xffc94e : 0xff5a4e;
      w.hpBarG.fillStyle(0x000000, 0.55).fillRoundedRect(hpBarX, hpBarY, hpBarW, hpBarH, 3);
      w.hpBarG.fillStyle(hpColor, 1).fillRoundedRect(hpBarX, hpBarY, hpBarW * pct, hpBarH, 3);
      w.hpBarG.lineStyle(1, 0xffffff, 0.6).strokeRoundedRect(hpBarX, hpBarY, hpBarW, hpBarH, 3);
      // Tick marks at quarters
      w.hpBarG.lineStyle(1, 0x000000, 0.45);
      for (let q = 1; q <= 3; q++) {
        const tx = hpBarX + (hpBarW * q) / 4;
        w.hpBarG.lineBetween(tx, hpBarY + 2, tx, hpBarY + hpBarH - 2);
      }

      // Lives as heart icons
      w.livesG.clear();
      const heartY = PANEL_Y + 22;
      const heartSize = 8;
      const startX = hpBarX + hpBarW - 4;
      for (let h = 0; h < 3; h++) {
        const cx = startX - h * (heartSize + 4);
        const filled = h < p.lives;
        if (filled) {
          drawHeart(w.livesG, cx, heartY, heartSize, 0xff5a4e, 0x000000);
        } else {
          drawHeart(w.livesG, cx, heartY, heartSize, 0x000000, 0x666666, true);
        }
      }

      // DOWN overlay when out of HP and lives
      const isDown = !p.isAlive();
      w.downText.setVisible(isDown);
      if (isDown) {
        w.swatch.setAlpha(0.35);
        w.specialText.setAlpha(0.35);
      }

      // suppress unused
      void w.nameText;
    });

    // ---- Wave indicator ----
    const waves = this.gameRef.getWaves();
    const inBossPhase = this.gameRef.isBossPhase();
    const waveNum = inBossPhase ? waves.totalWaves : Math.max(1, waves.currentIndex + 1);
    if (inBossPhase) {
      this.waveText.setText('BOSS BATTLE');
      this.waveText.setColor('#ff8888');
      this.enemyCountText.setText('');
    } else {
      this.waveText.setText(`WAVE ${waveNum} / ${waves.totalWaves}`);
      this.waveText.setColor('#ffe7a3');
      const remaining = waves.remainingEnemies;
      this.enemyCountText.setText(remaining > 0 ? `${remaining} enemies remaining` : 'walk right →');
    }

    // Wave dots (under the wave text)
    this.waveDots.clear();
    const dotSize = 6;
    const totalW = waves.totalWaves * (dotSize * 2 + 4) - 4;
    const startX = GAME_WIDTH / 2 - totalW / 2;
    for (let k = 0; k < waves.totalWaves; k++) {
      const cx = startX + k * (dotSize * 2 + 4) + dotSize;
      const cy = 30;
      if (k < waves.currentIndex || (k === waves.currentIndex && inBossPhase)) {
        this.waveDots.fillStyle(0x5ed16a, 1).fillCircle(cx, cy, dotSize);
      } else if (k === waves.currentIndex) {
        this.waveDots.fillStyle(0xffe7a3, 1).fillCircle(cx, cy, dotSize);
      } else {
        this.waveDots.fillStyle(0xffffff, 0.25).fillCircle(cx, cy, dotSize);
      }
      this.waveDots.lineStyle(1, 0x000000, 0.6).strokeCircle(cx, cy, dotSize);
    }

    // ---- Score (animated tick-up) ----
    const targetScore = this.gameRef.getState().score;
    if (this.displayedScore !== targetScore) {
      const diff = targetScore - this.displayedScore;
      const step = Math.max(1, Math.ceil(Math.abs(diff) * 0.15));
      this.displayedScore += Math.sign(diff) * Math.min(step, Math.abs(diff));
      const text = this.displayedScore.toLocaleString();
      this.scoreText.setText(text);
      this.scoreShadow.setText(text);
    }

    // ---- Boss bar ----
    if (this.bossPanel) {
      const boss = this.gameRef.getBoss();
      if (boss) {
        // Detect damage even if event missed
        if (boss.hp < this.bossPanel.lastHp) this.bossPanel.shakeUntil = now + 180;
        this.bossPanel.lastHp = boss.hp;

        const w = 540;
        let x = (GAME_WIDTH - w) / 2;
        const y = TOP_BAR_H + 10;
        if (now < this.bossPanel.shakeUntil) {
          x += (Math.random() - 0.5) * 6;
        }
        const pct = Math.max(0, boss.hp) / BOSS_MAX_HP;
        const g = this.bossPanel.g;
        g.clear();
        g.fillStyle(0x000000, 0.6).fillRoundedRect(x, y, w, 16, 4);
        g.fillStyle(0xff4040, 1).fillRoundedRect(x, y, w * pct, 16, 4);
        // Phase tick marks at 66% and 33%
        g.lineStyle(1, 0xffffff, 0.7);
        g.lineBetween(x + w * 0.66, y + 2, x + w * 0.66, y + 14);
        g.lineBetween(x + w * 0.33, y + 2, x + w * 0.33, y + 14);
        g.lineStyle(2, 0xffffff, 0.7).strokeRoundedRect(x, y, w, 16, 4);
        this.bossPanel.pctText.setText(`${Math.ceil(pct * 100)}%`);
        this.bossPanel.pctText.setX(GAME_WIDTH / 2);
        this.bossPanel.nameText.setX(GAME_WIDTH / 2);
      }
    }
  }

  private cleanup(): void {
    this.gameRef.events.off('hud:update');
    this.gameRef.events.off('hud:bossSpawned');
    this.gameRef.events.off('hud:waveStart');
    this.gameRef.events.off('hud:waveCleared');
  }
}

/** Cheap heart-icon primitive. */
function drawHeart(
  g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number,
  fill: number, stroke: number, hollow = false
): void {
  // Two circles + a triangle = heart silhouette
  const r = size * 0.4;
  if (!hollow) {
    g.fillStyle(fill, 1);
    g.fillCircle(cx - r * 0.7, cy - r * 0.2, r);
    g.fillCircle(cx + r * 0.7, cy - r * 0.2, r);
    g.fillTriangle(
      cx - size * 0.7, cy + r * 0.1,
      cx + size * 0.7, cy + r * 0.1,
      cx, cy + size * 0.7
    );
  }
  g.lineStyle(1, stroke, 1);
  g.strokeCircle(cx - r * 0.7, cy - r * 0.2, r);
  g.strokeCircle(cx + r * 0.7, cy - r * 0.2, r);
  g.lineBetween(cx - size * 0.7, cy + r * 0.1, cx, cy + size * 0.7);
  g.lineBetween(cx + size * 0.7, cy + r * 0.1, cx, cy + size * 0.7);
}
