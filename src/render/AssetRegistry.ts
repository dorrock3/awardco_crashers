/**
 * Asset loading & registry. Tries to fetch real PNG/JSON assets from
 * /assets/sprites/<id>/. If a rig folder is missing, generates procedural
 * placeholder textures so the rig system still runs end-to-end.
 *
 * Add a new character:
 *   1. Drop assets into public/assets/sprites/<id>/ (see docs/art-pipeline.md)
 *   2. Add it to CHARACTER_IDS below.
 *   3. Add a placeholder fallback in registerPlaceholderRig() so the game
 *      still renders something if assets are missing.
 */

import Phaser from 'phaser';
import type { RigDefinition } from './RiggedSprite';

/**
 * Probe a URL to see if a real asset exists. Vite's dev server will SPA-
 * fallback some paths to index.html, so a 200 alone isn't enough — we also
 * verify the response Content-Type matches what we expect (image/* or
 * application/json). Body is drained to free the connection.
 */
async function probe(url: string, expect: 'image' | 'json'): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!r.ok) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const ok = expect === 'image' ? ct.startsWith('image/') : ct.includes('json');
    try { await r.blob(); } catch { /* ignore */ }
    return ok;
  } catch {
    return false;
  }
}

export const CHARACTER_IDS = [
  'hero-red', 'hero-blue', 'hero-green', 'hero-yellow',
  'sad-employee', 'sad-employee-1', 'sad-employee-2', 'sad-employee-3',
  'boss-minion', 'boss-minion-1', 'boss-minion-2', 'boss-minion-3',
  'attrition'
] as const;
export type CharacterId = typeof CHARACTER_IDS[number];

/** Random pick among the variant IDs that exist in the registry. Falls
 *  back to the base ID when no variants loaded. */
export function pickEnemyVariant(
  registry: AssetRegistry,
  base: 'sad-employee' | 'boss-minion'
): CharacterId {
  const variants: CharacterId[] = [
    `${base}-1`, `${base}-2`, `${base}-3`
  ] as CharacterId[];
  const ok = variants.filter((v) => registry.hasRig(v));
  if (ok.length === 0) return base;
  return ok[Math.floor(Math.random() * ok.length)];
}

const HERO_COLORS_BY_ID: Record<string, number> = {
  'hero-red': 0xff5a4e,
  'hero-blue': 0x4ea7ff,
  'hero-green': 0x5ed16a,
  'hero-yellow': 0xffc94e
};

export class AssetRegistry {
  private readonly rigs = new Map<CharacterId, RigDefinition>();

  /** Texture key naming: "<charId>:<partName>". Stable across real & placeholder paths. */
  static partKey(charId: string, partName: string): string {
    return `${charId}:${partName}`;
  }

  hasRig(id: CharacterId): boolean { return this.rigs.has(id); }
  getRig(id: CharacterId): RigDefinition | undefined { return this.rigs.get(id); }

  /**
   * Attempt to load real assets for every known character. Failures fall
   * through to the procedural placeholder. Resolves once all attempts
   * settle (success or fail).
   */
  async loadAll(scene: Phaser.Scene): Promise<void> {
    await Promise.all(CHARACTER_IDS.map((id) => this.loadOne(scene, id)));
  }

  private async loadOne(scene: Phaser.Scene, id: CharacterId): Promise<void> {
    const base = import.meta.env.BASE_URL;

    // Tier 1: full rig.json + named parts (animatable). Only commit to this
    // path if rig.json parses AND every referenced part PNG actually exists.
    try {
      const rigUrl = `${base}assets/sprites/${id}/rig.json`;
      if (!(await probe(rigUrl, 'json'))) throw new Error('no rig.json');
      const resp = await fetch(rigUrl);
      const def = (await resp.json()) as RigDefinition;
      const partUrls = Object.values(def.parts).map(
        (p) => `${base}assets/sprites/${id}/${p.tex}`
      );
      const partsOk = await Promise.all(partUrls.map((u) => probe(u, 'image')));
      if (!partsOk.every(Boolean)) throw new Error('rig parts incomplete');
      await this.loadRigTextures(scene, id, def);
      this.rigs.set(id, def);
      return;
    } catch {
      /* fall through */
    }

    // Tier 2: single full.png (static body w/ idle bob, no real anims)
    try {
      const fullUrl = `${base}assets/sprites/${id}/full.png`;
      if (!(await probe(fullUrl, 'image'))) throw new Error('no full.png');
      await this.loadSingleSprite(scene, id, fullUrl);
      this.rigs.set(id, singleSpriteRigDef(id));
      return;
    } catch {
      /* fall through */
    }

    // Tier 3: procedural placeholder
    const def = this.registerPlaceholderRig(scene, id);
    this.rigs.set(id, def);
  }

  private loadSingleSprite(scene: Phaser.Scene, id: CharacterId, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = AssetRegistry.partKey(id, 'body');
      if (scene.textures.exists(key)) { resolve(); return; }
      scene.load.image(key, url);
      scene.load.once('complete', () => resolve());
      scene.load.once('loaderror', () => reject(new Error('full.png load failed')));
      scene.load.start();
    });
  }

  private loadRigTextures(scene: Phaser.Scene, id: CharacterId, def: RigDefinition): Promise<void> {
    return new Promise((resolve, reject) => {
      let pending = 0;
      for (const [partName, part] of Object.entries(def.parts)) {
        const key = AssetRegistry.partKey(id, partName);
        if (scene.textures.exists(key)) continue;
        scene.load.image(key, `${import.meta.env.BASE_URL}assets/sprites/${id}/${part.tex}`);
        pending++;
      }
      if (pending === 0) { resolve(); return; }
      scene.load.once('complete', () => resolve());
      scene.load.once('loaderror', () => reject(new Error('image load failed')));
      scene.load.start();
    });
  }

  /**
   * Build a procedural placeholder rig out of programmatic textures so the
   * rig runtime is exercised even without real art. This is what runs today.
   */
  private registerPlaceholderRig(scene: Phaser.Scene, id: CharacterId): RigDefinition {
    const isHero = id.startsWith('hero-');
    const isBoss = id === 'attrition';
    const isMinion = id === 'boss-minion';
    const isSad = id === 'sad-employee';

    const bodyColor = isHero ? HERO_COLORS_BY_ID[id]
      : isBoss ? 0x3a1f4a
      : isMinion ? 0x8a4a4a
      : isSad ? 0x6b4f8a
      : 0x888888;
    const skinColor = isHero ? 0xffffff : 0xc8b9aa;
    const limbColor = isHero ? bodyColor : 0x3a3340;

    const sizeMul = isBoss ? 1.6 : 1.0;
    const torsoW = Math.round(28 * sizeMul);
    const torsoH = Math.round(36 * sizeMul);
    const headR  = Math.round(16 * sizeMul);
    const limbW  = Math.round(10 * sizeMul);
    const limbH  = Math.round(22 * sizeMul);

    const ensure = (key: string, draw: (g: Phaser.GameObjects.Graphics) => { w: number; h: number }) => {
      if (scene.textures.exists(key)) return;
      const g = scene.add.graphics();
      const { w, h } = draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };

    const outline = 0x0a0a14;

    ensure(AssetRegistry.partKey(id, 'torso'), (g) => {
      g.fillStyle(bodyColor).fillRoundedRect(0, 0, torsoW, torsoH, 4);
      g.lineStyle(2, outline).strokeRoundedRect(1, 1, torsoW - 2, torsoH - 2, 4);
      return { w: torsoW, h: torsoH };
    });
    ensure(AssetRegistry.partKey(id, 'head'), (g) => {
      const d = headR * 2;
      g.fillStyle(bodyColor).fillCircle(headR, headR, headR - 1);
      g.lineStyle(2, outline).strokeCircle(headR, headR, headR - 2);
      // Eyes
      const eyeY = isBoss ? headR : headR - 2;
      g.fillStyle(skinColor).fillCircle(headR - 5, eyeY, 3).fillCircle(headR + 5, eyeY, 3);
      g.fillStyle(isBoss ? 0xff4040 : 0x000000).fillCircle(headR - 5, eyeY, 1.5).fillCircle(headR + 5, eyeY, 1.5);
      return { w: d, h: d };
    });
    ensure(AssetRegistry.partKey(id, 'arm_l'), (g) => {
      g.fillStyle(limbColor).fillRoundedRect(0, 0, limbW, limbH, 3);
      g.lineStyle(2, outline).strokeRoundedRect(1, 1, limbW - 2, limbH - 2, 3);
      return { w: limbW, h: limbH };
    });
    ensure(AssetRegistry.partKey(id, 'arm_r'), (g) => {
      g.fillStyle(limbColor).fillRoundedRect(0, 0, limbW, limbH, 3);
      g.lineStyle(2, outline).strokeRoundedRect(1, 1, limbW - 2, limbH - 2, 3);
      return { w: limbW, h: limbH };
    });
    ensure(AssetRegistry.partKey(id, 'leg_l'), (g) => {
      g.fillStyle(limbColor).fillRoundedRect(0, 0, limbW, limbH, 3);
      g.lineStyle(2, outline).strokeRoundedRect(1, 1, limbW - 2, limbH - 2, 3);
      return { w: limbW, h: limbH };
    });
    ensure(AssetRegistry.partKey(id, 'leg_r'), (g) => {
      g.fillStyle(limbColor).fillRoundedRect(0, 0, limbW, limbH, 3);
      g.lineStyle(2, outline).strokeRoundedRect(1, 1, limbW - 2, limbH - 2, 3);
      return { w: limbW, h: limbH };
    });

    return defaultBipedRigDef(id, sizeMul);
  }
}

/**
 * The "stock" biped rig used for placeholders and as a starting template
 * for real rigs. Pivots place the joint at the natural connection point.
 */
function defaultBipedRigDef(id: string, sizeMul: number): RigDefinition {
  return {
    id,
    scale: sizeMul === 1.6 ? 0.9 : 0.8,
    parts: {
      torso: { tex: 'torso', pivot: [0.5, 0.15] },
      head:  { tex: 'head',  pivot: [0.5, 0.85] },
      arm_l: { tex: 'arm_l', pivot: [0.5, 0.1] },
      arm_r: { tex: 'arm_r', pivot: [0.5, 0.1] },
      leg_l: { tex: 'leg_l', pivot: [0.5, 0.1] },
      leg_r: { tex: 'leg_r', pivot: [0.5, 0.1] }
    },
    skeleton: [
      { name: 'root',  pos: [0, 0] },
      { name: 'torso', parent: 'root',  pos: [0, -22 * sizeMul], z: 0 },
      { name: 'head',  parent: 'torso', pos: [0, -10 * sizeMul], z: 2 },
      { name: 'arm_l', parent: 'torso', pos: [-10 * sizeMul, -14 * sizeMul], z: -1 },
      { name: 'arm_r', parent: 'torso', pos: [10 * sizeMul, -14 * sizeMul], z: 1 },
      { name: 'leg_l', parent: 'root',  pos: [-6 * sizeMul, -2], z: -1 },
      { name: 'leg_r', parent: 'root',  pos: [6 * sizeMul, -2], z: 1 }
    ],
    animations: {
      idle: {
        loop: true, durationMs: 1400,
        tracks: {
          torso: [{ t: 0, y: 0 }, { t: 700, y: -2 }, { t: 1400, y: 0 }],
          head:  [{ t: 0, rot: 0 }, { t: 700, rot: -3 }, { t: 1400, rot: 0 }]
        }
      },
      walk: {
        loop: true, durationMs: 480,
        tracks: {
          leg_l: [{ t: 0, rot: -28 }, { t: 240, rot: 28 }, { t: 480, rot: -28 }],
          leg_r: [{ t: 0, rot: 28 }, { t: 240, rot: -28 }, { t: 480, rot: 28 }],
          arm_l: [{ t: 0, rot: 22 }, { t: 240, rot: -22 }, { t: 480, rot: 22 }],
          arm_r: [{ t: 0, rot: -22 }, { t: 240, rot: 22 }, { t: 480, rot: -22 }],
          torso: [{ t: 0, y: 0 }, { t: 120, y: -2 }, { t: 240, y: 0 }, { t: 360, y: -2 }, { t: 480, y: 0 }]
        }
      },
      light: {
        loop: false, durationMs: 260,
        tracks: {
          arm_r: [{ t: 0, rot: -10 }, { t: 60, rot: -100 }, { t: 150, rot: 50 }, { t: 260, rot: -10 }],
          torso: [{ t: 0, rot: 0 }, { t: 80, rot: 10 }, { t: 260, rot: 0 }]
        }
      },
      heavy: {
        loop: false, durationMs: 560,
        tracks: {
          arm_r: [{ t: 0, rot: -10 }, { t: 180, rot: -140 }, { t: 320, rot: 80 }, { t: 560, rot: -10 }],
          arm_l: [{ t: 0, rot: 10 }, { t: 180, rot: 100 }, { t: 320, rot: -50 }, { t: 560, rot: 10 }],
          torso: [{ t: 0, rot: 0 }, { t: 200, rot: 22 }, { t: 560, rot: 0 }]
        }
      },
      special: {
        loop: false, durationMs: 760,
        tracks: {
          arm_l: [{ t: 0, rot: 20 }, { t: 220, rot: -120 }, { t: 760, rot: 20 }],
          arm_r: [{ t: 0, rot: -20 }, { t: 220, rot: 120 }, { t: 760, rot: -20 }],
          torso: [{ t: 0, y: 0 }, { t: 220, y: -6 }, { t: 760, y: 0 }]
        }
      },
      hit: {
        loop: false, durationMs: 220,
        tracks: { torso: [{ t: 0, rot: 0 }, { t: 80, rot: -25 }, { t: 220, rot: 0 }] }
      },
      jump: {
        loop: false, durationMs: 400,
        tracks: {
          leg_l: [{ t: 0, rot: 0 }, { t: 200, rot: 30 }, { t: 400, rot: 0 }],
          leg_r: [{ t: 0, rot: 0 }, { t: 200, rot: -30 }, { t: 400, rot: 0 }]
        }
      },
      block: {
        loop: true, durationMs: 600,
        tracks: { arm_l: [{ t: 0, rot: 90 }], arm_r: [{ t: 0, rot: -90 }] }
      },
      defeat: {
        loop: false, durationMs: 600,
        tracks: { torso: [{ t: 0, rot: 0 }, { t: 600, rot: 90 }] }
      }
    }
  };
}

/**
 * Single-image rig: one bone "body" bound to <id>:body texture (loaded from
 * full.png). Provides the same animation names entities expect, but expressed
 * as transforms on the single body sprite (bob, lean, hop) so the character
 * still has visible feedback even without cut-up parts.
 *
 * Pivot is bottom-center so the feet sit on the ground plane. Scale is tuned
 * per character so AI-generated 1024px PNGs fit the ~170px playfield strip.
 */
function singleSpriteRigDef(id: string): RigDefinition {
  // Heroes are a bit smaller than enemies to read as more agile;
  // boss is roughly 2x normal.
  const scale =
    id === 'attrition'   ? 0.30 :
    id.startsWith('hero-') ? 0.14 :
                           0.16;
  return {
    id,
    scale,
    parts: {
      body: { tex: 'body', pivot: [0.5, 1.0] }
    },
    skeleton: [
      { name: 'root', pos: [0, 0] },
      { name: 'body', parent: 'root', pos: [0, 0], z: 0 }
    ],
    animations: {
      idle: {
        loop: true, durationMs: 1400,
        tracks: { body: [{ t: 0, y: 0 }, { t: 700, y: -3 }, { t: 1400, y: 0 }] }
      },
      walk: {
        loop: true, durationMs: 480,
        tracks: {
          body: [
            { t: 0, y: 0, rot: -2 },
            { t: 120, y: -4, rot: 2 },
            { t: 240, y: 0, rot: -2 },
            { t: 360, y: -4, rot: 2 },
            { t: 480, y: 0, rot: -2 }
          ]
        }
      },
      light: {
        loop: false, durationMs: 260,
        tracks: { body: [{ t: 0, x: 0, rot: 0 }, { t: 80, x: 6, rot: 8 }, { t: 260, x: 0, rot: 0 }] }
      },
      heavy: {
        loop: false, durationMs: 560,
        tracks: { body: [{ t: 0, x: 0, rot: 0 }, { t: 200, x: 10, rot: 18 }, { t: 560, x: 0, rot: 0 }] }
      },
      special: {
        loop: false, durationMs: 760,
        tracks: { body: [{ t: 0, y: 0, sx: 1, sy: 1 }, { t: 220, y: -10, sx: 1.15, sy: 1.15 }, { t: 760, y: 0, sx: 1, sy: 1 }] }
      },
      hit: {
        loop: false, durationMs: 220,
        tracks: { body: [{ t: 0, x: 0, rot: 0 }, { t: 80, x: -6, rot: -15 }, { t: 220, x: 0, rot: 0 }] }
      },
      jump: {
        loop: false, durationMs: 400,
        tracks: { body: [{ t: 0, y: 0 }, { t: 200, y: -18 }, { t: 400, y: 0 }] }
      },
      block: {
        loop: true, durationMs: 600,
        tracks: { body: [{ t: 0, sx: 0.95, sy: 0.95 }] }
      },
      defeat: {
        loop: false, durationMs: 600,
        tracks: { body: [{ t: 0, rot: 0, y: 0 }, { t: 600, rot: 90, y: -8 }] }
      }
    }
  };
}
