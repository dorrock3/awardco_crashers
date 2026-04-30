/**
 * Lightweight paper-doll skeletal renderer.
 *
 * Why not DragonBones at runtime? The community Phaser 3 DragonBones plugin
 * is unmaintained as of 2026. This runtime consumes a simple JSON format
 * (see docs/art-pipeline.md) that any DCC tool can export to: layered PNGs
 * + a bone hierarchy + keyframe tracks. Authoring tool is decoupled from
 * runtime.
 *
 * Bones form a tree. Each bone has a rest position relative to its parent.
 * Animations are per-bone, per-channel keyframe tracks (rot/x/y/sx/sy)
 * with linear interpolation. Bone "z" decides draw order within the rig.
 */

import Phaser from 'phaser';

export interface RigBone {
  name: string;
  parent?: string;
  pos: [number, number];
  rot?: number;       // rest rotation in degrees
  z?: number;         // draw order within the rig (higher = on top)
}

export interface RigPart {
  tex: string;        // texture key (registered at boot)
  pivot: [number, number]; // normalized pivot (0..1) within the texture
}

export interface RigKeyframe {
  t: number;
  rot?: number;
  x?: number;
  y?: number;
  sx?: number;
  sy?: number;
}

export interface RigAnimation {
  loop: boolean;
  durationMs: number;
  tracks: Record<string, RigKeyframe[]>;
}

export interface RigDefinition {
  id: string;
  scale?: number;
  parts: Record<string, RigPart>;
  skeleton: RigBone[];
  animations: Record<string, RigAnimation>;
}

interface RuntimeBone {
  def: RigBone;
  parent?: RuntimeBone;
  image?: Phaser.GameObjects.Image;     // null if no part bound to this bone
  // Local transform (may be modified by current animation)
  localX: number; localY: number; localRot: number; localSX: number; localSY: number;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Sample a track at time t (ms). Returns null if no keys. */
function sampleTrack(track: RigKeyframe[], t: number, channel: keyof RigKeyframe): number | null {
  if (track.length === 0) return null;
  // Find surrounding keyframes that have this channel
  const keys = track.filter((k) => k[channel] !== undefined);
  if (keys.length === 0) return null;
  if (t <= keys[0].t) return keys[0][channel] as number;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1][channel] as number;
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      const span = keys[i + 1].t - keys[i].t;
      const a = keys[i][channel] as number;
      const b = keys[i + 1][channel] as number;
      return span === 0 ? b : lerp(a, b, (t - keys[i].t) / span);
    }
  }
  return keys[keys.length - 1][channel] as number;
}

export class RiggedSprite {
  private readonly bones: Map<string, RuntimeBone> = new Map();
  private readonly orderedBones: RuntimeBone[]; // draw order (by z)
  readonly container: Phaser.GameObjects.Container;
  private currentAnim: RigAnimation | null = null;
  private currentName: string = '';
  private animTimeMs = 0;
  private facing: 1 | -1 = 1;

  constructor(
    scene: Phaser.Scene,
    private readonly def: RigDefinition,
    partTextureKey: (partName: string) => string
  ) {
    this.container = scene.add.container(0, 0);
    if (def.scale) this.container.setScale(def.scale);

    // Build bone runtime objects
    for (const b of def.skeleton) {
      this.bones.set(b.name, {
        def: b,
        localX: b.pos[0],
        localY: b.pos[1],
        localRot: b.rot ?? 0,
        localSX: 1,
        localSY: 1
      });
    }
    // Wire parents
    for (const rb of this.bones.values()) {
      if (rb.def.parent) rb.parent = this.bones.get(rb.def.parent);
    }

    // Order bones by z (default 0). Stable sort ensures consistent layering.
    this.orderedBones = [...this.bones.values()].sort(
      (a, b) => (a.def.z ?? 0) - (b.def.z ?? 0)
    );

    // Create images for bones that have a part of the same name
    for (const rb of this.orderedBones) {
      const part = def.parts[rb.def.name];
      if (!part) continue;
      const key = partTextureKey(rb.def.name);
      if (!scene.textures.exists(key)) continue;
      const img = scene.add.image(0, 0, key);
      img.setOrigin(part.pivot[0], part.pivot[1]);
      rb.image = img;
      this.container.add(img);
    }

    // Default to idle if it exists
    if (def.animations.idle) this.play('idle');
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setFacing(f: 1 | -1): void {
    if (this.facing === f) return;
    this.facing = f;
    this.container.setScale(f * (this.def.scale ?? 1), this.def.scale ?? 1);
  }

  setVisible(v: boolean): void { this.container.setVisible(v); }
  setAlpha(a: number): void { this.container.setAlpha(a); }
  destroy(): void { this.container.destroy(); }

  get currentAnimation(): string { return this.currentName; }

  play(name: string, restartIfSame = false): void {
    const anim = this.def.animations[name];
    if (!anim) return;
    if (this.currentName === name && !restartIfSame) return;
    this.currentName = name;
    this.currentAnim = anim;
    this.animTimeMs = 0;
  }

  /** Advance the animation. Call from sim tick. */
  tick(dtMs: number): void {
    if (!this.currentAnim) return;
    this.animTimeMs += dtMs;
    const dur = this.currentAnim.durationMs;
    let t = this.animTimeMs;
    if (this.currentAnim.loop) {
      t = t % dur;
    } else if (t > dur) {
      t = dur;
    }

    // Reset to rest pose, then apply current animation tracks on top
    for (const rb of this.bones.values()) {
      rb.localX = rb.def.pos[0];
      rb.localY = rb.def.pos[1];
      rb.localRot = rb.def.rot ?? 0;
      rb.localSX = 1;
      rb.localSY = 1;
      const track = this.currentAnim.tracks[rb.def.name];
      if (!track) continue;
      const dx = sampleTrack(track, t, 'x'); if (dx !== null) rb.localX += dx;
      const dy = sampleTrack(track, t, 'y'); if (dy !== null) rb.localY += dy;
      const dr = sampleTrack(track, t, 'rot'); if (dr !== null) rb.localRot += dr;
      const sx = sampleTrack(track, t, 'sx'); if (sx !== null) rb.localSX *= sx;
      const sy = sampleTrack(track, t, 'sy'); if (sy !== null) rb.localSY *= sy;
    }

    // Compose world transforms by walking the tree (parents already updated
    // since orderedBones doesn't guarantee parent-first order, do an explicit pass).
    this.composeAndApply();
  }

  private composeAndApply(): void {
    // Each bone's image position/rotation/scale is set in the container's local
    // space (since the container itself handles facing/world position). We compute
    // each bone's transform relative to the container origin by composing through
    // its parent chain. With shallow rigs (~7 bones) this is cheap.
    for (const rb of this.orderedBones) {
      let x = rb.localX;
      let y = rb.localY;
      let rotDeg = rb.localRot;
      let sx = rb.localSX;
      let sy = rb.localSY;

      let p = rb.parent;
      while (p) {
        // Rotate child offset by parent rotation, then add parent position
        const cos = Math.cos(p.localRot * Math.PI / 180);
        const sin = Math.sin(p.localRot * Math.PI / 180);
        const rx = x * cos - y * sin;
        const ry = x * sin + y * cos;
        x = rx * p.localSX + p.localX;
        y = ry * p.localSY + p.localY;
        rotDeg += p.localRot;
        sx *= p.localSX;
        sy *= p.localSY;
        p = p.parent;
      }

      if (rb.image) {
        rb.image.setPosition(x, y);
        rb.image.setRotation(rotDeg * Math.PI / 180);
        rb.image.setScale(sx, sy);
      }
    }
  }
}
