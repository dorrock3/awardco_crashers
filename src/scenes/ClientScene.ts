import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PLAY_FIELD_BOTTOM } from '../core/constants';
import { ParallaxBackdrop } from '../level/ParallaxBackdrop';
import { AssetRegistry, CharacterId, CHARACTER_IDS } from '../render/AssetRegistry';
import { RiggedSprite } from '../render/RiggedSprite';
import { KeyboardInputSource } from '../core/Input';
import { Effects } from '../effects/Effects';
import { getNet, NetMessage, SnapshotPayload } from '../net/NetTransport';

const HERO_COLORS = [0xff5a4e, 0x4ea0ff, 0x5ed16a, 0xffc94e];
const WORLD_WIDTH = GAME_WIDTH * 4;

interface Ghost {
  rig?: RiggedSprite;
  rect: Phaser.GameObjects.Rectangle;
  hpBar?: Phaser.GameObjects.Graphics;
  lastSeenTick: number;
  lastAnim?: string;
}

/**
 * Client-side rendering scene. Receives SnapshotPayload from host ~30Hz and
 * mirrors entities. Does NOT run gameplay sim. Sends a periodic input frame
 * (currently unused server-side; reserved for future input-driven control).
 */
export class ClientScene extends Phaser.Scene {
  private assets!: AssetRegistry;
  private backdrop!: ParallaxBackdrop;
  private offNet?: () => void;
  private latestSnap: SnapshotPayload | null = null;

  private playerGhosts = new Map<number, Ghost>();
  private enemyGhosts = new Map<number, Ghost>();
  private projGhosts = new Map<number, Phaser.GameObjects.Image>();
  private bossGhost?: Ghost;
  private currentTick = 0;

  // HUD
  private hud!: Phaser.GameObjects.Container;
  private hudText!: Phaser.GameObjects.Text;
  private hudPlayerBars: Phaser.GameObjects.Graphics[] = [];
  private bossBarG?: Phaser.GameObjects.Graphics;

  private keyboard!: KeyboardInputSource;
  private inputTick = 0;
  private inputAccumMs = 0;
  private effects!: Effects;

  constructor() { super('Client'); }

  create(): void {
    this.assets = this.game.registry.get('assetRegistry') as AssetRegistry;
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, this.scale.height);
    this.backdrop = new ParallaxBackdrop(this, 'office', WORLD_WIDTH);

    this.buildHud();
    this.keyboard = new KeyboardInputSource(this);
    this.effects = new Effects(this);
    this.game.registry.set('effects', this.effects);

    // Subscribe to snapshots
    const net = getNet();
    this.offNet = net.on((msg) => this.handleNet(msg));

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.offNet?.());
  }

  private buildHud(): void {
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(2000);
    const bg = this.add.rectangle(0, 0, GAME_WIDTH, 56, 0x0a0e1a, 0.7).setOrigin(0).setScrollFactor(0);
    this.hud.add(bg);
    this.hudText = this.add.text(GAME_WIDTH - 12, 8, '', {
      fontFamily: 'Impact', fontSize: '18px', color: '#ffd34a', stroke: '#000', strokeThickness: 3
    }).setOrigin(1, 0).setScrollFactor(0);
    this.hud.add(this.hudText);
    for (let i = 0; i < 4; i++) {
      const g = this.add.graphics().setScrollFactor(0).setDepth(2001);
      this.hudPlayerBars.push(g);
      this.hud.add(g);
    }
  }

  private handleNet(msg: NetMessage): void {
    if (msg.t === 'snap') {
      this.latestSnap = msg.data;
      this.currentTick = msg.tick;
    } else if (msg.t === 'event' && msg.kind === 'hit') {
      const p = msg.payload as { x: number; y: number; damage: number; kind: 'light' | 'medium' | 'heavy'; fatal?: boolean };
      // Replay juice locally: damage number + screen shake + (light) hit-stop
      this.effects.damageNumber(p.x, p.y, p.damage, p.fatal ? 'crit' : p.kind);
      const intensity = p.kind === 'heavy' || p.fatal ? 0.012 : p.kind === 'medium' ? 0.006 : 0.003;
      const dur = p.kind === 'heavy' || p.fatal ? 220 : p.kind === 'medium' ? 120 : 70;
      this.effects.shake(intensity, dur);
    }
  }

  override update(_t: number, dt: number): void {
    // Send our input to the host ~30Hz (every other frame).
    this.inputAccumMs += dt;
    if (this.inputAccumMs >= 33) {
      this.inputAccumMs = 0;
      const frame = this.keyboard.poll();
      getNet().sendInput(frame, this.inputTick++);
    }

    if (!this.latestSnap) return;
    const s = this.latestSnap;

    // Camera follow host
    this.cameras.main.scrollX = s.cameraX;
    this.backdrop.update(this.cameras.main.scrollX);

    // Players
    for (const ps of s.players) {
      let g = this.playerGhosts.get(ps.slot);
      if (!g) {
        const picks = (this.game.registry.get('netPicks') as Record<number, number>) ?? {};
        const ci = picks[ps.slot] ?? ((ps.slot - 1) % 4);
        const colorName = ['red', 'blue', 'green', 'yellow'][ci] ?? 'red';
        const colorId = (`hero-${colorName}`) as CharacterId;
        g = this.makeGhost(ps.x, ps.y, HERO_COLORS[ci % 4], CHARACTER_IDS.includes(colorId) ? colorId : undefined);
        this.playerGhosts.set(ps.slot, g);
      }
      g.lastSeenTick = this.currentTick;
      this.applyGhost(g, ps.x, ps.y, ps.facing, ps.anim);
      g.rect.setAlpha(ps.hp <= 0 ? 0.25 : 1);
    }

    // Enemies
    const seenEnemies = new Set<number>();
    for (const e of s.enemies) {
      seenEnemies.add(e.id);
      let g = this.enemyGhosts.get(e.id);
      if (!g) {
        const cid = (CHARACTER_IDS as readonly string[]).includes(e.kind) ? (e.kind as CharacterId) : undefined;
        g = this.makeGhost(e.x, e.y, 0x6b4f8a, cid);
        g.hpBar = this.add.graphics().setDepth(800);
        this.enemyGhosts.set(e.id, g);
      }
      g.lastSeenTick = this.currentTick;
      this.applyGhost(g, e.x, e.y, e.facing, e.anim);
      this.drawEnemyHp(g, e.x, e.y, e.hp, e.maxHp);
      if (e.state === 'dead' || e.hp <= 0) {
        g.rect.setAlpha(0.15);
        g.rig && (g.rig as { setAlpha?: (a: number) => void }).setAlpha?.(0.15);
      }
    }
    // Cull stale enemies (host stopped reporting them, e.g., wave reset)
    for (const [id, g] of this.enemyGhosts) {
      if (!seenEnemies.has(id) && this.currentTick - g.lastSeenTick > 15) {
        this.destroyGhost(g);
        this.enemyGhosts.delete(id);
      }
    }

    // Projectiles
    const seenProj = new Set<number>();
    for (const p of s.projectiles) {
      seenProj.add(p.id);
      let img = this.projGhosts.get(p.id);
      if (!img) {
        const key = this.textures.exists(p.kind) ? p.kind : 'proj:recognition:1';
        if (!this.textures.exists(key)) continue;
        img = this.add.image(p.x, p.y, key).setDepth(50).setScale(0.16);
        this.projGhosts.set(p.id, img);
      }
      img.setPosition(p.x, p.y);
      img.setFlipX(p.facing < 0);
    }
    for (const [id, img] of this.projGhosts) {
      if (!seenProj.has(id)) { img.destroy(); this.projGhosts.delete(id); }
    }

    // Boss
    if (s.boss) {
      if (!this.bossGhost) {
        this.bossGhost = this.makeGhost(s.boss.x, s.boss.y, 0x3a1f4a, 'attrition');
        this.bossBarG = this.add.graphics().setScrollFactor(0).setDepth(2001);
      }
      this.applyGhost(this.bossGhost, s.boss.x, s.boss.y, s.boss.facing, s.boss.anim);
      this.drawBossBar(s.boss.hp, s.boss.maxHp);
    }

    // HUD text
    this.hudText.setText(`SCORE ${s.score}    WAVE ${Math.max(1, s.wave + 1)}/${s.totalWaves}`);

    // Per-player HP bars (top-left corner)
    for (let i = 0; i < this.hudPlayerBars.length; i++) {
      const g = this.hudPlayerBars[i];
      g.clear();
      const ps = s.players[i];
      if (!ps) continue;
      const x = 10 + i * 130;
      const y = 12;
      g.fillStyle(0x000000, 0.6).fillRect(x - 2, y - 2, 124, 14);
      g.fillStyle(HERO_COLORS[i], 1).fillRect(x, y, 4, 10);
      const pct = Math.max(0, ps.hp) / 100;
      const color = pct > 0.6 ? 0x5ed16a : pct > 0.3 ? 0xffc94e : 0xff5a4e;
      g.fillStyle(color, 1).fillRect(x + 6, y, 114 * pct, 10);
      // lives
      for (let l = 0; l < ps.lives; l++) {
        g.fillStyle(0xff5a4e, 1).fillCircle(x + 8 + l * 10, y + 22, 3);
      }
    }
  }

  private makeGhost(x: number, y: number, color: number, kind?: CharacterId): Ghost {
    const rect = this.add.rectangle(x, y, 36, 60, color).setStrokeStyle(2, 0x000000);
    let rig: RiggedSprite | undefined;
    if (kind) {
      const def = this.assets.getRig(kind);
      if (def) {
        rig = new RiggedSprite(this, def, (partName) => AssetRegistry.partKey(kind, partName));
        rect.setAlpha(0);
      }
    }
    return { rect, rig, lastSeenTick: this.currentTick };
  }

  private applyGhost(g: Ghost, x: number, y: number, facing: 1 | -1, anim?: string): void {
    g.rect.setPosition(x, y);
    g.rect.setScale(facing, 1);
    if (g.rig) {
      g.rig.setPosition(x, y + 30);
      g.rig.setFacing(facing);
      if (anim && anim !== g.lastAnim) {
        g.rig.play(anim);
        g.lastAnim = anim;
      }
      g.rig.tick(16);
    }
  }

  private drawEnemyHp(g: Ghost, x: number, y: number, hp: number, maxHp: number): void {
    if (!g.hpBar) return;
    g.hpBar.clear();
    if (hp >= maxHp || hp <= 0) return;
    const w = 36, h = 4;
    const bx = x - w / 2;
    const by = y - 38;
    const pct = Math.max(0, hp) / maxHp;
    const color = pct > 0.6 ? 0x5ed16a : pct > 0.3 ? 0xffc94e : 0xff5a4e;
    g.hpBar.fillStyle(0x000000, 0.7).fillRect(bx - 1, by - 1, w + 2, h + 2);
    g.hpBar.fillStyle(color, 1).fillRect(bx, by, w * pct, h);
  }

  private drawBossBar(hp: number, maxHp: number): void {
    if (!this.bossBarG) return;
    this.bossBarG.clear();
    const w = GAME_WIDTH - 80;
    const x = 40;
    const y = GAME_HEIGHT - 28;
    this.bossBarG.fillStyle(0x000000, 0.7).fillRect(x - 2, y - 2, w + 4, 16);
    const pct = Math.max(0, hp) / maxHp;
    this.bossBarG.fillStyle(0x8b1538, 1).fillRect(x, y, w * pct, 12);
  }

  private destroyGhost(g: Ghost): void {
    g.rect.destroy();
    g.rig?.destroy();
    g.hpBar?.destroy();
  }
}

// Helper: PLAY_FIELD_BOTTOM kept here so the import is referenced; otherwise tsc complains.
const _ref = PLAY_FIELD_BOTTOM;
void _ref;
