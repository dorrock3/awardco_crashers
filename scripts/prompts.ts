/**
 * Locked prompts for image generation. Mirrors docs/art-pipeline.md.
 * Edit prompts here, NOT inline in the script.
 *
 * IMPORTANT: prompts must NOT name copyrighted properties (game titles,
 * studio names) or real-world trademarks (company logos). Image
 * generators will refuse such requests. The hero is described as a
 * generic mascot shaped like a letter "A", not any real company logo.
 */

export const STYLE_PREFIX = `A 2D hand-drawn cartoon character for an indie beat-em-up video game. Style: thick uniform black outlines roughly 3 pixels wide, flat cel-shaded coloring with exactly one shadow tone and one highlight tone per area, no gradients. Bold and chunky shapes with exaggerated cartoon proportions (oversized head, short stubby limbs). Simple expressive face with large round eyes and a clear mouth. Full body shown front-facing in a relaxed T-pose: arms held slightly out from the body, legs shoulder-width apart, feet flat. Plain solid white background. No drop shadow on the ground. Character is centered with about 10% padding on all sides. Do not include any text, words, letters, watermarks, logos, props, weapons, or extra characters.`;

export const NEGATIVE = `AVOID: photorealism, 3D rendering, anime style, manga, watercolor, sketchy or rough lines, multiple characters, props, weapons, text, watermark, signature, gradients, blur, depth-of-field.`;

export interface CharacterPrompt {
  id: string;
  character: string;
  colors: string;
}

const HERO_BASE = (color: string) =>
  `A friendly cartoon mascot shaped like a thick rounded capital letter "A". The "A" itself is the body, colored bright ${color}. It has two large round white eyes with small black pupils set into the upper part of the A, a wide smiling mouth in the middle, two stubby cartoon arms with white-gloved hands extending from the sides, and two short legs with simple rounded shoes at the bottom. Confident heroic pose. No real-world logo or brand.`;

export const CHARACTERS: CharacterPrompt[] = [
  { id: 'hero-red',    character: HERO_BASE('red'),    colors: '#ff5a4e #ffffff #0a0a14' },
  { id: 'hero-blue',   character: HERO_BASE('blue'),   colors: '#4ea7ff #ffffff #0a0a14' },
  { id: 'hero-green',  character: HERO_BASE('green'),  colors: '#5ed16a #ffffff #0a0a14' },
  { id: 'hero-yellow', character: HERO_BASE('yellow'), colors: '#ffc94e #ffffff #0a0a14' },
  {
    id: 'sad-employee',
    character: 'A cartoon office worker enemy. Slumped tired posture, dark circles under sleepy eyes, frowning mouth, a wrinkled untucked button-down shirt in muted purple-grey, a loose necktie hanging crooked, plain dark slacks. Holding a small coffee mug in one hand. Overall color palette is desaturated and muted to convey burnout. No text, no real-world logos.',
    colors: '#6b4f8a #a89cc4 #2d2535 #0a0a14'
  },
  {
    id: 'boss-minion',
    character: 'A cartoon office worker enemy who is visibly angry. Hunched aggressive stance, gritted teeth, furrowed angry brow, rolled-up sleeves on a muted reddish-brown shirt, askew necktie, fists clenched at the sides. No text, no real-world logos.',
    colors: '#8a4a4a #6b3838 #2d1818 #0a0a14'
  },
  {
    id: 'attrition',
    character: 'A massive cartoon villain. A towering humanoid figure made of dark swirling smoke and shadow, vaguely shaped like an office worker in a suit silhouette, with two glowing angular red eyes and a jagged crooked mouth. Long tattered necktie trailing in the wind. Looming menacing pose. Roughly twice the size of a normal character. No text, no real-world logos.',
    colors: '#3a1f4a #1a0d24 #ff4040 #0a0a14'
  }
];

export interface BackgroundPrompt {
  id: string;
  layer: string;
  scene: string;
}

export const BG_STYLE_PREFIX = `A 2D side-scrolling cartoon background illustration for an indie video game. Style: thick uniform black outlines, flat cel-shaded coloring with no gradients, bold and chunky shapes with exaggerated cartoon proportions. Wide horizontal banner aspect ratio. A flat horizontal ground line sits at the lower third of the image. The composition is empty -- no people, no characters, no animals. Do not include any text, words, letters, or watermarks anywhere in the image.`;

export const BG_NEGATIVE = `AVOID: photorealism, 3D rendering, anime, characters of any kind, text, watermark, signature, blur, depth-of-field, lens flare.`;

export const BACKGROUNDS: BackgroundPrompt[] = [
  { id: 'office-sky',    layer: 'far background', scene: 'bright office ceiling with fluorescent lights, soft blue-grey walls, completely empty' },
  { id: 'office-mid',    layer: 'mid distance',   scene: 'rows of grey cubicle walls with computer monitors, a water cooler in the distance, completely empty' },
  { id: 'office-fg',     layer: 'foreground props', scene: 'scattered office props on a plain solid white background: an office chair, a potted plant, a tall stack of paper, completely empty otherwise' },
  { id: 'boardroom-sky', layer: 'far background', scene: 'dim corporate boardroom with floor-to-ceiling windows showing a stormy night sky outside, no people, completely empty' },
  { id: 'boardroom-mid', layer: 'mid distance',   scene: 'a long polished conference table with executive chairs, a projector screen on the wall showing a downward-pointing red arrow chart, completely empty' },
  { id: 'boardroom-fg',  layer: 'foreground props', scene: 'scattered crumpled paper balls and empty coffee cups on a plain solid white background, completely empty otherwise' }
];

export function buildCharacterPrompt(c: CharacterPrompt): string {
  return `${STYLE_PREFIX}\n\nCHARACTER: ${c.character}\n\nPALETTE: use only colors from this set -- ${c.colors}.\n\n${NEGATIVE}`;
}

export function buildBackgroundPrompt(b: BackgroundPrompt): string {
  return `${BG_STYLE_PREFIX}\n\nLAYER: ${b.layer}\nSCENE: ${b.scene}\n\n${BG_NEGATIVE}`;
}
