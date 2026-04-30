import Phaser from 'phaser';
import { CombatSystem } from '../combat/CombatSystem';
import { Enemy, EnemyEvents } from '../entities/Enemy';
import { PLAY_FIELD_BOTTOM, PLAY_FIELD_TOP } from '../core/constants';
import { RiggedSprite } from '../render/RiggedSprite';

export interface WaveDef {
  /** Number of enemies to spawn in this wave. */
  count: number;
  /** Camera will lock to this x position until the wave is cleared. */
  cameraLockX: number;
  /** X coordinates (world) where enemies spawn. Cycles if count > spawnXs.length. */
  spawnXs: number[];
}

export class WaveSystem {
  private readonly waves: WaveDef[];
  private waveIdx = -1;
  private active = false;
  private readonly enemies: Enemy[] = [];
  private nextEnemyId: number;
  private waveCleared: () => void = () => {};
  private allClearedResolve: (() => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly combat: CombatSystem,
    private readonly enemyEvents: EnemyEvents,
    waves: WaveDef[],
    startEnemyId = 1000,
    private readonly makeRig?: () => { rig?: RiggedSprite; kind: string }
  ) {
    this.waves = waves;
    this.nextEnemyId = startEnemyId;
  }

  get currentWave(): WaveDef | null {
    return this.waveIdx >= 0 && this.waveIdx < this.waves.length ? this.waves[this.waveIdx] : null;
  }

  get totalWaves(): number { return this.waves.length; }
  get currentIndex(): number { return this.waveIdx; }
  get remainingEnemies(): number { return this.livingEnemies().length; }

  get isActive(): boolean { return this.active; }

  livingEnemies(): Enemy[] {
    return this.enemies.filter((e) => e.isAlive());
  }

  /** All enemies (living + dead). Used by host to enumerate for snapshots. */
  allEnemies(): ReadonlyArray<Enemy> { return this.enemies; }

  /** Start wave at the given camera lock position. Returns when this wave is cleared. */
  startNextWave(): Promise<void> {
    this.waveIdx += 1;
    const wave = this.currentWave;
    if (!wave) return Promise.resolve();

    this.active = true;
    for (let i = 0; i < wave.count; i++) {
      const sx = wave.spawnXs[i % wave.spawnXs.length];
      const sy = Phaser.Math.Between(PLAY_FIELD_TOP + 10, PLAY_FIELD_BOTTOM - 10);
      const made = this.makeRig?.();
      const e = new Enemy(this.scene, this.combat, {
        onDefeated: (en) => {
          this.enemyEvents.onDefeated(en);
          this.checkClear();
        }
      }, { ownerId: this.nextEnemyId++, x: sx, y: sy, rig: made?.rig, kind: made?.kind });
      this.enemies.push(e);
    }

    return new Promise<void>((resolve) => { this.waveCleared = resolve; });
  }

  /** Run all remaining waves sequentially. */
  async runAll(): Promise<void> {
    while (this.waveIdx + 1 < this.waves.length) {
      await this.startNextWave();
    }
    this.allClearedResolve?.();
  }

  private checkClear(): void {
    if (this.livingEnemies().length === 0) {
      this.active = false;
      const fn = this.waveCleared;
      this.waveCleared = () => {};
      fn();
    }
  }

  tick(_dtMs: number, targets: ReadonlyArray<{ x: number; groundY: number; isAlive(): boolean }>): void {
    for (const e of this.enemies) {
      if (e.isAlive()) e.setTargets(targets);
      e.tick(_dtMs);
    }
  }
}
