/**
 * Per-frame input snapshot. This is the unit of network transmission for
 * multiplayer (Phase 3): clients send InputFrame, host applies it.
 */
export interface InputFrame {
  moveX: number; // -1, 0, 1
  moveY: number; // -1, 0, 1
  light: boolean;
  heavy: boolean;
  special: boolean;
  jump: boolean;
  block: boolean;
}

export const EMPTY_INPUT: InputFrame = Object.freeze({
  moveX: 0,
  moveY: 0,
  light: false,
  heavy: false,
  special: false,
  jump: false,
  block: false
});

export interface InputSource {
  /** Returns the current frame's intent. Edge-detection (just-pressed) is the
   *  consumer's responsibility; this returns held state. */
  poll(): InputFrame;
}

/**
 * Keyboard input source for local Player 1. Phase 3 will add a NetInputSource.
 */
export class KeyboardInputSource implements InputSource {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard plugin missing');
    this.keys = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      light: kb.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      heavy: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      special: kb.addKey(Phaser.Input.Keyboard.KeyCodes.L),
      jump: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      block: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)
    };
  }

  poll(): InputFrame {
    return {
      moveX: (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0),
      moveY: (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0),
      light: this.keys.light.isDown,
      heavy: this.keys.heavy.isDown,
      special: this.keys.special.isDown,
      jump: this.keys.jump.isDown,
      block: this.keys.block.isDown
    };
  }
}

/**
 * Tracks just-pressed transitions across frames. Combat actions need
 * edge detection so holding a key doesn't spam attacks.
 */
export class InputEdge {
  private prev: InputFrame = EMPTY_INPUT;

  consume(curr: InputFrame): {
    light: boolean;
    heavy: boolean;
    special: boolean;
    jump: boolean;
  } {
    const edge = {
      light: curr.light && !this.prev.light,
      heavy: curr.heavy && !this.prev.heavy,
      special: curr.special && !this.prev.special,
      jump: curr.jump && !this.prev.jump
    };
    this.prev = curr;
    return edge;
  }
}

/**
 * Input source for a remote player. The host calls `setFrame()` whenever
 * a fresh InputFrame arrives over the wire; `poll()` returns the latest
 * known frame (defaulting to EMPTY_INPUT until the first packet).
 *
 * No interpolation: missed packets just hold the last frame, which is the
 * desired behavior for held-button states (move, block).
 */
export class RemoteInputSource implements InputSource {
  private current: InputFrame = EMPTY_INPUT;
  setFrame(f: InputFrame): void { this.current = f; }
  poll(): InputFrame { return this.current; }
}

/**
 * Captive input source for clients: returns EMPTY_INPUT, since the host
 * is the source of truth and the local player on a client is driven by
 * snapshots, not by their own ticks.
 */
export class NoopInputSource implements InputSource {
  poll(): InputFrame { return EMPTY_INPUT; }
}
