import Phaser from 'phaser';
import { CombatSystem } from '../combat/CombatSystem';
import { FixedTimestep } from '../core/FixedTimestep';
import { KeyboardInputSource, RemoteInputSource } from '../core/Input';
import { GAME_WIDTH, PLAY_FIELD_BOTTOM, STARTING_LIVES, BOSS_MAX_HP } from '../core/constants';
import { AttritionBoss } from '../entities/AttritionBoss';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { ParallaxBackdrop } from '../level/ParallaxBackdrop';
import { WaveSystem } from '../level/WaveSystem';
import { AssetRegistry, CharacterId, pickEnemyVariant } from '../render/AssetRegistry';
import { RiggedSprite } from '../render/RiggedSprite';
import { Effects } from '../effects/Effects';
import { Projectile } from '../entities/Projectile';
import { getNet, NetRole, SnapshotPayload } from '../net/NetTransport';

const WORLD_WIDTH = GAME_WIDTH * 4; // long enough for two scrolling segments

interface SharedState {
  score: number;
  enemiesDefeated: number;
}

export class GameScene extends Phaser.Scene {
  private fixed!: FixedTimestep;
  private combat!: CombatSystem;
  private players: Player[] = [];
  private waves!: WaveSystem;
  private boss?: AttritionBoss;
  private bossMinions: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private nextMinionId = 5000;
  private backdrop!: ParallaxBackdrop;
  private bossArenaX = WORLD_WIDTH - GAME_WIDTH;
  private state: SharedState = { score: 0, enemiesDefeated: 0 };
  private debugGfx?: Phaser.GameObjects.Graphics;
  private cameraLockedX: number | null = null;
  private bossArenaEntered = false;
  private finished = false;
  private assets!: AssetRegistry;
  private effects!: Effects;
  private netRole: NetRole = 'solo';
  private snapTick = 0;
  private snapAccumMs = 0;
  /** Host-only: input source per remote slot, keyed by slot number. */
  private remoteInputs = new Map<number, RemoteInputSource>();
  private offNet?: () => void;

  constructor() { super('Game'); }

  create(): void {
    this.combat = new CombatSystem();
    this.assets = this.game.registry.get('assetRegistry') as AssetRegistry;
    this.effects = new Effects(this);
    this.game.registry.set('effects', this.effects);
    this.netRole = (this.game.registry.get('netRole') as NetRole) ?? 'solo';
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, this.scale.height);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, this.scale.height);

    this.backdrop = new ParallaxBackdrop(this, 'office', WORLD_WIDTH);

    // Spawn local player (P1 — always slot 1, keyboard).
    const p1 = new Player(this, this.combat, new KeyboardInputSource(this), this.makePlayerEvents(), {
      ownerId: 1, colorIndex: 0, x: 100, y: PLAY_FIELD_BOTTOM - 20, lives: STARTING_LIVES,
      rig: this.makeRig('hero-red')
    });
    this.players.push(p1);

    // Host: spawn one Player per connected peer, each with a RemoteInputSource
    // that the host fills from network 'input' messages.
    if (this.netRole === 'host') {
      const peers = (this.game.registry.get('netPeers') as Array<{ playerSlot: number; name: string }>) ?? [];
      const heroIds: CharacterId[] = ['hero-red', 'hero-blue', 'hero-green', 'hero-yellow'];
      for (const peer of peers) {
        if (peer.playerSlot === 1) continue; // skip host (already spawned)
        const idx = (peer.playerSlot - 1) % 4;
        const remote = new RemoteInputSource();
        this.remoteInputs.set(peer.playerSlot, remote);
        const ply = new Player(this, this.combat, remote, this.makePlayerEvents(), {
          ownerId: peer.playerSlot, colorIndex: idx as 0 | 1 | 2 | 3,
          x: 100 + (peer.playerSlot - 1) * 40, y: PLAY_FIELD_BOTTOM - 20, lives: STARTING_LIVES,
          rig: this.makeRig(heroIds[idx])
        });
        this.players.push(ply);
      }
      // Subscribe to inputs from clients
      this.offNet = getNet().on((msg, fromSlot) => {
        if (msg.t === 'input') {
          const src = this.remoteInputs.get(fromSlot);
          if (src) src.setFrame(msg.frame);
        }
      });
      this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.offNet?.());
    }

    // Build waves: 3 combat waves, lock camera at progressively further x.
    this.waves = new WaveSystem(this, this.combat, {
      onDefeated: () => {
        this.state.enemiesDefeated += 1;
        this.state.score += 10;
        this.events.emit('hud:update');
      }
    }, [
      { count: 3, cameraLockX: 200,  spawnXs: [GAME_WIDTH * 0.9, GAME_WIDTH * 1.0, GAME_WIDTH * 0.7] },
      { count: 4, cameraLockX: GAME_WIDTH * 1.2, spawnXs: [GAME_WIDTH * 2.1, GAME_WIDTH * 2.0, GAME_WIDTH * 1.7, GAME_WIDTH * 1.9] },
      { count: 5, cameraLockX: GAME_WIDTH * 2.2, spawnXs: [GAME_WIDTH * 3.0, GAME_WIDTH * 2.9, GAME_WIDTH * 2.7, GAME_WIDTH * 3.1, GAME_WIDTH * 2.8] }
    ], 1000, () => {
      const kind = pickEnemyVariant(this.assets, 'sad-employee');
      return { rig: this.makeRig(kind), kind };
    });

    // Launch HUD overlay
    this.scene.launch('HUD', { game: this, players: this.players });

    // Kick off the level loop (async, drives camera locks via cameraLockedX)
    void this.runLevel();

    // Fixed-timestep loop
    this.fixed = new FixedTimestep((dt) => this.simTick(dt));

    // Optional debug overlay (toggle with backtick)
    this.input.keyboard?.on('keydown-BACKTICK', () => {
      if (!this.debugGfx) this.debugGfx = this.add.graphics().setDepth(1000).setScrollFactor(1);
      else { this.debugGfx.destroy(); this.debugGfx = undefined; }
    });
  }

  private async runLevel(): Promise<void> {
    // Wave 1
    this.cameraLockedX = 0;
    this.events.emit('hud:waveStart', 1);
    await this.waves.startNextWave();
    this.events.emit('hud:waveCleared', 1);
    this.cameraLockedX = null;

    // Wave 2 — wait until any player crosses lock x
    await this.waitForPlayerX(GAME_WIDTH * 1.2);
    this.cameraLockedX = GAME_WIDTH * 1.2 - GAME_WIDTH / 2;
    this.events.emit('hud:waveStart', 2);
    await this.waves.startNextWave();
    this.events.emit('hud:waveCleared', 2);
    this.cameraLockedX = null;

    // Wave 3
    await this.waitForPlayerX(GAME_WIDTH * 2.2);
    this.cameraLockedX = GAME_WIDTH * 2.2 - GAME_WIDTH / 2;
    this.events.emit('hud:waveStart', 3);
    await this.waves.startNextWave();
    this.events.emit('hud:waveCleared', 3);
    this.cameraLockedX = null;

    // Walk to boss arena
    await this.waitForPlayerX(this.bossArenaX);
    this.bossArenaEntered = true;
    this.cameraLockedX = this.bossArenaX - GAME_WIDTH / 2;

    // Spawn boss
    this.boss = new AttritionBoss(this, this.combat, {
      onDefeated: () => this.onBossDefeated(),
      spawnMinion: (x, y) => this.spawnBossMinion(x, y)
    }, { ownerId: 2000, x: this.bossArenaX + GAME_WIDTH * 0.7, y: PLAY_FIELD_BOTTOM - 20, rig: this.makeRig('attrition') });
    this.events.emit('hud:bossSpawned');
  }

  private waitForPlayerX(x: number): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.players.some((p) => p.isAlive() && p.x >= x)) resolve();
        else this.time.delayedCall(80, check);
      };
      check();
    });
  }

  private spawnBossMinion(x: number, y: number): Enemy {
    const kind = pickEnemyVariant(this.assets, 'boss-minion');
    const e = new Enemy(this, this.combat, {
      onDefeated: () => {
        this.state.enemiesDefeated += 1;
        this.state.score += 5;
        this.events.emit('hud:update');
      }
    }, { ownerId: this.nextMinionId++, x, y, tint: 0x8a4a4a, hp: 18, kind, rig: this.makeRig(kind) });
    this.bossMinions.push(e);
    return e;
  }

  private onBossDefeated(): void {
    if (this.finished) return;
    this.finished = true;
    this.state.score += 500;
    this.time.delayedCall(1200, () => {
      this.scene.stop('HUD');
      this.scene.start('Win', { score: this.state.score, defeated: this.state.enemiesDefeated });
    });
  }

  private checkAllDefeated(): void {
    if (this.finished) return;
    if (this.players.every((p) => !p.isAlive())) {
      this.finished = true;
      this.time.delayedCall(800, () => {
        this.scene.stop('HUD');
        this.scene.start('GameOver', { score: this.state.score });
      });
    }
  }

  override update(_t: number, dt: number): void {
    // Hit-stop: skip sim ticks while frozen, but keep render/HUD live.
    if (this.effects.consumeFreeze(dt)) return;
    this.fixed.step(dt);
  }

  private simTick(dtMs: number): void {
    // Update player physics + input
    for (const p of this.players) p.tick(dtMs);

    // Targets for enemy AI = living players
    const targets = this.players;

    // Wave enemies
    this.waves.tick(dtMs, targets);

    // Boss minions
    for (const m of this.bossMinions) {
      if (m.isAlive()) m.setTargets(targets);
      m.tick(dtMs);
    }

    // Boss
    if (this.boss) {
      if (this.boss.isAlive()) this.boss.setTargets(targets);
      this.boss.tick(dtMs);
    }

    // Projectiles (must run BEFORE combat.tick so their hitboxes register this frame)
    for (const p of this.projectiles) p.tick(dtMs);
    this.projectiles = this.projectiles.filter((p) => p.isAlive());

    // Combat resolution
    this.combat.tick(dtMs);

    // Camera follow / lock
    this.updateCamera();

    // Parallax
    this.backdrop.update(this.cameras.main.scrollX);

    // Debug
    if (this.debugGfx) this.combat.debugDraw(this.debugGfx);

    // Net: host broadcasts snapshots ~30Hz (every 2 sim ticks @ 60Hz)
    if (this.netRole === 'host') {
      this.snapAccumMs += dtMs;
      if (this.snapAccumMs >= 33) {
        this.snapAccumMs = 0;
        this.broadcastSnapshot();
      }
    }
  }

  private broadcastSnapshot(): void {
    const cam = this.cameras.main;
    const snap: SnapshotPayload = {
      players: this.players.map((p, i) => ({
        slot: i + 1,
        x: p.x, y: p.y, facing: p.facing,
        hp: p.hp, lives: p.lives,
        state: p.getStateName()
      })),
      enemies: [
        ...this.waves.allEnemies(),
        ...this.bossMinions
      ].map((e) => ({
        id: e.ownerId, kind: e.kind,
        x: e.x, y: e.y, facing: e.facing,
        hp: e.hp, maxHp: e.getMaxHp(),
        state: e.getStateName()
      })),
      projectiles: this.projectiles.filter((p) => p.isAlive()).map((p) => ({
        id: p.id, x: p.x, y: p.y, facing: p.facing, kind: p.kind
      })),
      boss: this.boss ? {
        x: this.boss.x, y: this.boss.y, facing: this.boss.facing,
        hp: this.boss.hp, maxHp: BOSS_MAX_HP, state: this.boss.getStateName()
      } : undefined,
      score: this.state.score,
      wave: this.waves.currentIndex,
      remainingEnemies: this.waves.remainingEnemies,
      totalWaves: this.waves.totalWaves,
      bossPhase: this.bossArenaEntered,
      cameraX: cam.scrollX
    };
    getNet().sendSnapshot(this.snapTick++, snap);
  }

  private updateCamera(): void {
    const cam = this.cameras.main;
    const livingX = this.players.filter((p) => p.isAlive()).map((p) => p.x);
    if (livingX.length === 0) return;
    const avgX = livingX.reduce((a, b) => a + b, 0) / livingX.length;
    let target = avgX - GAME_WIDTH / 2;

    if (this.cameraLockedX !== null) {
      // Hard lock: don't scroll past lock x
      target = Math.min(target, this.cameraLockedX);
      target = Math.max(target, this.cameraLockedX - 20); // soft floor
    }
    if (this.bossArenaEntered && this.boss?.isAlive()) {
      // Lock to boss arena
      target = this.bossArenaX - 40;
    }

    target = Phaser.Math.Clamp(target, 0, WORLD_WIDTH - GAME_WIDTH);
    cam.scrollX += (target - cam.scrollX) * 0.1;
  }

  getState(): Readonly<SharedState> { return this.state; }
  getPlayers(): ReadonlyArray<Player> { return this.players; }
  getBoss(): AttritionBoss | undefined { return this.boss; }
  getWaves(): WaveSystem { return this.waves; }
  isBossPhase(): boolean { return this.bossArenaEntered; }

  /** Build the PlayerEvents callbacks for any new player (local or remote). */
  private makePlayerEvents() {
    return {
      onDamaged: () => { this.events.emit('hud:update'); },
      onDefeated: () => { this.events.emit('hud:update'); this.checkAllDefeated(); },
      onScored: (amt: number) => { this.state.score += amt; this.events.emit('hud:update'); },
      onSpawnProjectile: (pl: Player, o: { x: number; y: number; facing: 1 | -1; damage: number; knockback: number }) => {
        this.projectiles.push(new Projectile(this, this.combat, {
          ownerId: pl.ownerId,
          x: o.x, y: o.y, facing: o.facing,
          damage: o.damage, knockback: o.knockback
        }));
      }
    };
  }

  /** Build a fresh RiggedSprite for the given character. Returns undefined if
   *  no rig is registered (entity will fall back to its rectangle). */
  private makeRig(id: CharacterId): RiggedSprite | undefined {
    const def = this.assets?.getRig(id);
    if (!def) return undefined;
    return new RiggedSprite(this, def, (partName) => AssetRegistry.partKey(id, partName));
  }
}
