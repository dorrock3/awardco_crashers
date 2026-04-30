// Logical game resolution. Phaser's FIT scale mode upscales to the window.
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

// Fixed-timestep simulation rate. Update logic runs at this rate; render runs at display rate.
export const SIM_HZ = 60;
export const SIM_DT_MS = 1000 / SIM_HZ;

// Ground plane (depth) bounds — the playfield is a 2.5D strip.
export const PLAY_FIELD_TOP = 340;
export const PLAY_FIELD_BOTTOM = 510;

// Gameplay tuning
export const PLAYER_MOVE_SPEED = 180; // px/sec on the ground plane
export const ENEMY_MOVE_SPEED = 90;
export const JUMP_VELOCITY = 380;     // initial vertical velocity (px/sec)
export const GRAVITY = 1100;          // px/sec^2
export const KNOCKBACK_FRICTION = 6;  // exponential decay per second

export const PLAYER_MAX_HP = 100;
export const ENEMY_MAX_HP = 30;
export const BOSS_MAX_HP = 600;
export const STARTING_LIVES = 3;

// Combat tuning
export const LIGHT_DAMAGE = 8;
export const HEAVY_DAMAGE = 18;
export const SPECIAL_DAMAGE = 25;
export const HIT_STUN_MS = 220;

// Hero color palette (Awardco-logo color variants for 4 players)
export const HERO_COLORS = [0xff5a4e, 0x4ea7ff, 0x5ed16a, 0xffc94e] as const;
export type HeroColorIndex = 0 | 1 | 2 | 3;

export const HERO_SPECIAL_NAMES = ['Bonus', 'Shoutout', 'Points', 'Badge'] as const;
