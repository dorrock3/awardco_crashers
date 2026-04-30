# Art Pipeline — Awardco Crashers

Single source of truth for visual consistency. Lock these values; do not improvise per asset.

## 1. Locked palette (use these exact hex values)

| Role | Hex | Notes |
|---|---|---|
| Hero Red (P1) | `#ff5a4e` | Awardco logo red |
| Hero Blue (P2) | `#4ea7ff` | |
| Hero Green (P3) | `#5ed16a` | "happy employee" green also |
| Hero Yellow (P4) | `#ffc94e` | |
| Outline (all chars) | `#0a0a14` | 2-3 px black-ish outline, never pure black |
| Sad employee | `#6b4f8a` muted purple body, `#a89cc4` shirt | desaturated to read as "drained" |
| Boss minion | `#8a4a4a` muted brick | reads as angrier sibling of sad employee |
| Attrition (boss) | `#3a1f4a` deep violet body, `#1a0d24` smoke | with `#ff4040` glowing eyes |
| Office bg sky | `#a0c4d8` | flat |
| Office mid (cubicles) | `#4a6175` | |
| Office floor | `#6b5a48` | |
| Boardroom bg | `#1d1b3a` | dimmer for boss arena |
| Boardroom floor | `#3a2f3f` | |

## 2. Locked AI prompt template

Use **the same template for every character**. Only change the bracketed `{{CHARACTER}}` block. The style is described generically — image generators refuse prompts that name specific copyrighted properties or studios.

```
A 2D hand-drawn cartoon character for an indie beat-em-up video game.
Style: thick uniform black outlines roughly 3 pixels wide, flat cel-shaded
coloring with exactly one shadow tone and one highlight tone per area, no
gradients. Bold and chunky shapes with exaggerated cartoon proportions
(oversized head, short stubby limbs). Simple expressive face with large
round eyes and a clear mouth. Full body shown front-facing in a relaxed
T-pose: arms held slightly out from the body, legs shoulder-width apart,
feet flat. Plain solid white background. No drop shadow on the ground.
Character is centered with about 10% padding on all sides. Do not include
any text, words, letters, watermarks, logos, props, weapons, or extra
characters.

CHARACTER: {{CHARACTER}}

PALETTE: use only colors from this set -- {{COLORS}}.
AVOID: photorealism, 3D rendering, anime style, manga, watercolor, sketchy
or rough lines, multiple characters, props, weapons, text, watermark,
signature, gradients, blur, depth-of-field.
```

### `{{CHARACTER}}` snippets (locked roster)

The hero is a generic mascot shape — an anthropomorphic letter "A" — not any real company's logo.

| Asset | CHARACTER block | COLORS |
|---|---|---|
| Hero Red | `A friendly cartoon mascot shaped like a thick rounded capital letter "A". The "A" itself is the body, colored bright red. It has two large round white eyes with small black pupils set into the upper part of the A, a wide smiling mouth in the middle, two stubby cartoon arms with white-gloved hands extending from the sides, and two short legs with simple rounded shoes at the bottom. Confident heroic pose. No real-world logo or brand.` | `#ff5a4e #ffffff #0a0a14` |
| Hero Blue | (same as Hero Red, replace "bright red" with "bright blue") | `#4ea7ff #ffffff #0a0a14` |
| Hero Green | (same, "bright green") | `#5ed16a #ffffff #0a0a14` |
| Hero Yellow | (same, "bright yellow") | `#ffc94e #ffffff #0a0a14` |
| Sad Employee | `A cartoon office worker enemy. Slumped tired posture, dark circles under sleepy eyes, frowning mouth, a wrinkled untucked button-down shirt in muted purple-grey, a loose necktie hanging crooked, plain dark slacks. Holding a small coffee mug in one hand. Overall color palette is desaturated and muted to convey burnout. No text, no real-world logos.` | `#6b4f8a #a89cc4 #2d2535 #0a0a14` |
| Boss Minion | `A cartoon office worker enemy who is visibly angry. Hunched aggressive stance, gritted teeth, furrowed angry brow, rolled-up sleeves on a muted reddish-brown shirt, askew necktie, fists clenched at the sides. No text, no real-world logos.` | `#8a4a4a #6b3838 #2d1818 #0a0a14` |
| Attrition (Boss) | `A massive cartoon villain. A towering humanoid figure made of dark swirling smoke and shadow, vaguely shaped like an office worker in a suit silhouette, with two glowing angular red eyes and a jagged crooked mouth. Long tattered necktie trailing in the wind. Looming menacing pose. Roughly twice the size of a normal character. No text, no real-world logos.` | `#3a1f4a #1a0d24 #ff4040 #0a0a14` |

### Recommended generators (any one — pick and stick with it for consistency)

- **GitHub Copilot Chat** in VS Code — free with a Copilot subscription, uses GPT-image-1 / DALL·E 3 quality. See "Copilot Chat workflow" below.
- **ChatGPT (DALL·E 3)** — easy web UI, paid plan required for image gen.
- **Midjourney v6+** — best style consistency, paid Discord-based service.
- **Stable Diffusion XL** — free if run locally; needs a GPU.

**Consistency rule:** image generators cannot lock a "seed" through Copilot Chat or ChatGPT, so you will not get pixel-identical reruns. To keep the four hero color variants looking like the same character, generate Hero Red FIRST, then for the other three either (a) ask the generator "regenerate the previous image with the body color changed to blue/green/yellow, keep everything else identical" in the same chat, or (b) generate one hero and color-swap in Photoshop/Photopea using Hue/Saturation on the body layer only.

## 2a. Copilot Chat step-by-step workflow

This is the path with the fewest moving parts. Cost: covered by your existing Copilot subscription.

1. **Open Copilot Chat.** In VS Code, press `Ctrl+Alt+I` (or click the chat icon in the activity bar). Make sure you are in a fresh chat — clutter from prior turns reduces image quality.
2. **Copy the locked template above** (section 2 code block) into the chat input.
3. **Replace `{{CHARACTER}}`** with the snippet from the roster table for the asset you want.
4. **Replace `{{COLORS}}`** with the matching color list from the same row.
5. **Add this line at the very top:** `Please generate this image:` — Copilot Chat needs an explicit image-generation request, otherwise it will just describe the prompt back to you.
6. **Send.** Wait for the image to render in the chat panel.
7. **Save the image.** Right-click the generated image → "Save Image As..." → navigate to:
   - Characters: `c:\Users\DakotaOrrock\code\playdate_with_ai\public\assets\sprites\<char-id>\full.png`
   - Backgrounds: `c:\Users\DakotaOrrock\code\playdate_with_ai\public\assets\backgrounds\<bg-id>.png`
   - Use the exact `<char-id>` from the asset table (e.g. `hero-red`, `sad-employee`, `attrition`). Create the folder if it does not exist.
8. **If the result is wrong**, reply in the same chat with a small correction (e.g. "make the outline thicker", "remove the shadow on the ground", "make the body more rounded") and re-save. Do not start a new chat — the model loses context.
9. **Repeat** for each of the 7 characters and 6 backgrounds.
10. **For the 3 remaining hero colors**, paste this in the same chat after generating Hero Red: `Regenerate the previous hero image with the body color changed from red to blue. Keep the pose, eyes, mouth, gloves, and shoes exactly the same.` Save as `public\assets\sprites\hero-blue\full.png`. Repeat for green and yellow.

**Quality troubleshooting:**
- If Copilot Chat refuses ("I can't generate images"): try rewording "Please generate this image:" as "Please create an illustration of:" and resend.
- If the result has unwanted text or letters in the image: add `The character must not contain any letters, numbers, or written text anywhere on its body or clothing.` to the prompt (note: this is hard for image generators — the "letter A body" prompt may still produce stray letters elsewhere).
- If proportions look off: add `The head should be roughly 40% of the total body height.`
- If colors drift: lower expectations. Image generators interpret hex codes loosely. The runtime can still tint sprites at draw time if needed.

**After saving an image**, see Section 4 for cutting it into rigged parts.

## 3. Background generation prompts

```
A 2D side-scrolling cartoon background illustration for an indie video
game. Style: thick uniform black outlines, flat cel-shaded coloring with
no gradients, bold and chunky shapes with exaggerated cartoon proportions.
Wide horizontal banner aspect ratio. A flat horizontal ground line sits
at the lower third of the image. The composition is empty -- no people,
no characters, no animals. Do not include any text, words, letters, or
watermarks anywhere in the image.

LAYER: {{LAYER}}
SCENE: {{SCENE}}

AVOID: photorealism, 3D rendering, anime, characters of any kind, text,
watermark, signature, blur, depth-of-field, lens flare.
```

| Asset | LAYER | SCENE | Output size |
|---|---|---|---|
| Office sky | far background | bright office ceiling with fluorescent lights, soft blue-grey walls, completely empty | 1792x1024 (crop later) |
| Office mid | mid distance | rows of grey cubicle walls with computer monitors, a water cooler in the distance, completely empty | 1792x1024 |
| Office fg | foreground props | scattered office props on a plain solid white background: an office chair, a potted plant, a tall stack of paper, completely empty otherwise | 1024x1024 |
| Boardroom sky | far background | dim corporate boardroom with floor-to-ceiling windows showing a stormy night sky outside, no people, completely empty | 1792x1024 |
| Boardroom mid | mid distance | a long polished conference table with executive chairs, a projector screen on the wall showing a downward-pointing red arrow chart, completely empty | 1792x1024 |
| Boardroom fg | foreground props | scattered crumpled paper balls and empty coffee cups on a plain solid white background, completely empty otherwise | 1024x1024 |

**For Copilot Chat:** save backgrounds as `public\assets\backgrounds\<asset-id>.png` using the IDs `office-sky`, `office-mid`, `office-fg`, `boardroom-sky`, `boardroom-mid`, `boardroom-fg`. The "fg" props will need their white backgrounds removed in Photopea / Photoshop using the magic wand tool before they can layer over the others.
|---|---|---|---|
| Office sky | far background | bright office ceiling with fluorescent lights, soft blue-grey walls, completely empty | 1792x1024 (crop later) |
| Office mid | mid distance | rows of grey cubicle walls with computer monitors, a water cooler in the distance, completely empty | 1792x1024 |
| Office fg | foreground props | scattered office props on a plain solid white background: an office chair, a potted plant, a tall stack of paper, completely empty otherwise | 1024x1024 |
| Boardroom sky | far background | dim corporate boardroom with floor-to-ceiling windows showing a stormy night sky outside, no people, completely empty | 1792x1024 |
| Boardroom mid | mid distance | a long polished conference table with executive chairs, a projector screen on the wall showing a downward-pointing red arrow chart, completely empty | 1792x1024 |
| Boardroom fg | foreground props | scattered crumpled paper balls and empty coffee cups on a plain solid white background, completely empty otherwise | 1024x1024 |

**For Copilot Chat:** save backgrounds as `public\assets\backgrounds\<asset-id>.png` using the IDs `office-sky`, `office-mid`, `office-fg`, `boardroom-sky`, `boardroom-mid`, `boardroom-fg`. The "fg" props will need their white backgrounds removed in Photopea / Photoshop using the magic wand tool before they can layer over the others.

## 4. Asset cutting & rigging — the runtime contract

We do **not** depend on DragonBones at runtime. Authoring tool is your choice; export per the spec below.

### Per character: produce these PNG files

Cut the AI-generated full-body image into named parts. Each part is a transparent PNG. Place into `assets/sprites/<char-id>/`:

```
torso.png
head.png
arm_l.png       (rear arm)
arm_r.png       (front arm)
hand_l.png
hand_r.png
leg_l.png       (rear leg)
leg_r.png       (front leg)
foot_l.png
foot_r.png
```

For the boss, also: `eye_glow.png`, `smoke_tendril.png`.

**Cutting tips:**
- Use Photoshop / Krita / Photopea (free).
- Layer order matches z-order: rear arm/leg under torso, front arm/leg over torso, head on top.
- Each part should have its **pivot at the natural joint** (shoulder, hip, neck). Trim transparent pixels to the bounding box of the part — pivot is then declared as a normalized (px, py) in the rig JSON below.
- Keep all parts at original resolution. The runtime scales.

### Per character: produce a rig JSON at `assets/sprites/<char-id>/rig.json`

```json
{
  "id": "hero-red",
  "scale": 0.6,
  "parts": {
    "torso":  { "tex": "torso.png",  "pivot": [0.5, 0.2] },
    "head":   { "tex": "head.png",   "pivot": [0.5, 0.9] },
    "arm_l":  { "tex": "arm_l.png",  "pivot": [0.5, 0.1] },
    "arm_r":  { "tex": "arm_r.png",  "pivot": [0.5, 0.1] },
    "leg_l":  { "tex": "leg_l.png",  "pivot": [0.5, 0.1] },
    "leg_r":  { "tex": "leg_r.png",  "pivot": [0.5, 0.1] }
  },
  "skeleton": [
    { "name": "root",   "pos": [0, 0] },
    { "name": "torso",  "parent": "root",  "pos": [0, -20], "z": 0 },
    { "name": "head",   "parent": "torso", "pos": [0, -28], "z": 2 },
    { "name": "arm_l",  "parent": "torso", "pos": [-10, -18], "z": -1 },
    { "name": "arm_r",  "parent": "torso", "pos": [10, -18],  "z": 1 },
    { "name": "leg_l",  "parent": "root",  "pos": [-6, 0],   "z": -1 },
    { "name": "leg_r",  "parent": "root",  "pos": [6, 0],    "z": 1 }
  ],
  "animations": {
    "idle": {
      "loop": true, "durationMs": 1200,
      "tracks": {
        "torso": [{ "t": 0, "y": 0 }, { "t": 600, "y": -2 }, { "t": 1200, "y": 0 }],
        "head":  [{ "t": 0, "rot": 0 }, { "t": 600, "rot": -2 }, { "t": 1200, "rot": 0 }]
      }
    },
    "walk": {
      "loop": true, "durationMs": 500,
      "tracks": {
        "leg_l": [{ "t": 0, "rot": -25 }, { "t": 250, "rot": 25 }, { "t": 500, "rot": -25 }],
        "leg_r": [{ "t": 0, "rot": 25 }, { "t": 250, "rot": -25 }, { "t": 500, "rot": 25 }],
        "arm_l": [{ "t": 0, "rot": 20 }, { "t": 250, "rot": -20 }, { "t": 500, "rot": 20 }],
        "arm_r": [{ "t": 0, "rot": -20 }, { "t": 250, "rot": 20 }, { "t": 500, "rot": -20 }]
      }
    },
    "light": {
      "loop": false, "durationMs": 260,
      "tracks": {
        "arm_r": [{ "t": 0, "rot": -10 }, { "t": 60, "rot": -90 }, { "t": 150, "rot": 30 }, { "t": 260, "rot": -10 }],
        "torso": [{ "t": 0, "rot": 0 }, { "t": 80, "rot": 8 }, { "t": 260, "rot": 0 }]
      }
    },
    "heavy": {
      "loop": false, "durationMs": 560,
      "tracks": {
        "arm_r": [{ "t": 0, "rot": -10 }, { "t": 180, "rot": -130 }, { "t": 320, "rot": 60 }, { "t": 560, "rot": -10 }],
        "torso": [{ "t": 0, "rot": 0 }, { "t": 200, "rot": 18 }, { "t": 560, "rot": 0 }]
      }
    },
    "special": {
      "loop": false, "durationMs": 760,
      "tracks": {
        "arm_l": [{ "t": 0, "rot": 20 }, { "t": 220, "rot": -110 }, { "t": 760, "rot": 20 }],
        "arm_r": [{ "t": 0, "rot": -20 }, { "t": 220, "rot": 110 }, { "t": 760, "rot": -20 }]
      }
    },
    "hit":   { "loop": false, "durationMs": 220, "tracks": { "torso": [{ "t": 0, "rot": 0 }, { "t": 80, "rot": -25 }, { "t": 220, "rot": 0 }] } },
    "jump":  { "loop": false, "durationMs": 400, "tracks": { "leg_l": [{ "t": 0, "rot": 0 }, { "t": 200, "rot": 30 }, { "t": 400, "rot": 0 }], "leg_r": [{ "t": 0, "rot": 0 }, { "t": 200, "rot": -30 }, { "t": 400, "rot": 0 }] } },
    "block": { "loop": true,  "durationMs": 600, "tracks": { "arm_l": [{ "t": 0, "rot": 90 }], "arm_r": [{ "t": 0, "rot": -90 }] } },
    "defeat":{ "loop": false, "durationMs": 600, "tracks": { "torso": [{ "t": 0, "rot": 0 }, { "t": 600, "rot": 90 }] } }
  }
}
```

**Track field meaning:**
- `t` — milliseconds from animation start
- `rot` — degrees, additive on top of the bone's resting orientation
- `x`, `y` — pixel offset, additive on top of bone's resting position
- `sx`, `sy` — scale multiplier (default 1)

The runtime linearly interpolates between adjacent keyframes per channel. Missing channels use the bone's rest pose. Missing bones use the previous animation's pose (cross-fade not implemented in MVP).

## 5. Pipeline (per character)

1. Generate canonical T-pose with the locked prompt + locked seed.
2. Open in image editor → cut into named parts on separate layers → export each layer as transparent PNG to `assets/sprites/<char-id>/`.
3. Author or copy `rig.json` (start from the template above; tweak pivot offsets so the head sits on the neck and limbs sit on torso joints).
4. Drop into the assets folder. Restart the dev server (or just reload the page — Vite HMR will pick it up).
5. The boot scene auto-detects the rig and uses it; otherwise the placeholder rectangle remains.

## 6. UI / SFX assets (out of scope for this doc)

Tracked separately under `assets/ui/` and `assets/sfx/`. UI is a small fixed set: health-bar frame, room-code panel, win/lose backdrops. SFX sources from freesound.org (CC0 only).
