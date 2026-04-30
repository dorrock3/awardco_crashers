import { SIM_DT_MS } from './constants';

/**
 * Drives gameplay logic at a fixed rate (default 60Hz) regardless of render FPS.
 * Caller invokes `step(dtRealMs)` from Phaser's update; we accumulate and call
 * `tick(dtFixedMs)` zero-or-more times. This separation is what lets us add
 * deterministic netcode in Phase 3 without rewriting gameplay.
 */
export class FixedTimestep {
  private accumulator = 0;
  private readonly maxAccum = SIM_DT_MS * 5; // avoid spiral-of-death after a long pause

  constructor(private readonly tick: (dtMs: number) => void) {}

  step(dtRealMs: number): void {
    this.accumulator = Math.min(this.accumulator + dtRealMs, this.maxAccum);
    while (this.accumulator >= SIM_DT_MS) {
      this.tick(SIM_DT_MS);
      this.accumulator -= SIM_DT_MS;
    }
  }

  reset(): void {
    this.accumulator = 0;
  }
}
