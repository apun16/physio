export const WIDTH = 1280;
export const HEIGHT = 720;
export const FONT = '"Determination Mono", monospace';

/** Single world ground plane. Every grounded sprite is bottom-anchored here. */
export const GROUND_Y = 548;

/** On-screen hat-to-feet height for Link's standing poses (idle, walk, compact combat). */
export const HERO_STAND_HEIGHT = 240;

/**
 * Uniform category scales. Width and height always share the same factor.
 * Pixel-art pack sprites use integer scales so nearest-neighbor stays crisp.
 */
export const SCALE = {
  pixel: 2,
  pixelSmall: 3,
  grass: 1,
  cloud: 3,
  bird: 2,
  hud: 1
} as const;

export const PARALLAX = {
  factors: [0.12, 0.22, 0.34, 0.48, 0.62],
  band: 430
} as const;

export const CAMERA_LEAD = 300;
export const CAMPFIRE_X = 480;
export const WALK_BOB = 3;

export function pixelScaleFor(height: number) {
  return height <= 24 ? SCALE.pixelSmall : SCALE.pixel;
}
