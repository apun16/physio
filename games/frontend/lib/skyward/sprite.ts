export type Anchor = "bottom" | "center" | "topleft" | "bottomleft";

export type Sprite = {
  canvas: HTMLCanvasElement;
  /** Uniform scale applied to both axes. */
  scale: number;
};

export type DrawRect = { x: number; y: number; w: number; h: number };

export type SpriteSource = Sprite | HTMLCanvasElement;

function canvasOf(sprite: SpriteSource) {
  return sprite instanceof HTMLCanvasElement ? sprite : sprite.canvas;
}

function scaleOf(sprite: SpriteSource, fallback = 1) {
  return sprite instanceof HTMLCanvasElement ? fallback : sprite.scale;
}

export function asSprite(canvas: HTMLCanvasElement, scale: number): Sprite {
  return { canvas, scale };
}

export function getScaledDimensions(
  sprite: SpriteSource,
  opts: { scale?: number; height?: number; maxHeight?: number; maxWidth?: number } = {}
) {
  const image = canvasOf(sprite);
  const sw = Math.max(1, image.width);
  const sh = Math.max(1, image.height);
  let scale = opts.scale ?? scaleOf(sprite);
  if (opts.height != null) scale = opts.height / sh;
  if (opts.maxHeight != null) scale = Math.min(scale, opts.maxHeight / sh);
  if (opts.maxWidth != null) scale = Math.min(scale, opts.maxWidth / sw);
  return {
    w: Math.max(1, Math.round(sw * scale)),
    h: Math.max(1, Math.round(sh * scale)),
    scale
  };
}

function blit(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, x: number, y: number, w: number, h: number): DrawRect {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, w, h);
  return { x, y, w, h };
}

export function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteSource,
  x: number,
  y: number,
  opts: { scale?: number; height?: number; maxHeight?: number; maxWidth?: number; anchor?: Anchor } = {}
): DrawRect {
  const image = canvasOf(sprite);
  const size = getScaledDimensions(sprite, opts);
  const anchor = opts.anchor ?? "topleft";
  const dx = anchor === "topleft" || anchor === "bottomleft" ? x : x - size.w / 2;
  const dy = anchor === "bottom" || anchor === "bottomleft" ? y - size.h : anchor === "center" ? y - size.h / 2 : y;
  return blit(ctx, image, Math.round(dx), Math.round(dy), size.w, size.h);
}

/** Draw a sprite with its feet / base on a world ground line. */
export function drawSpriteBottomAnchored(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteSource,
  x: number,
  groundY: number,
  scale = scaleOf(sprite)
): DrawRect {
  return drawSpriteFrame(ctx, sprite, x, groundY, { scale, anchor: "bottom" });
}

/** Fit a sprite inside a box without distorting aspect ratio. */
export function drawSpriteContain(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteSource,
  box: { x: number; y: number; w: number; h: number },
  anchor: Anchor = "center"
): DrawRect {
  const size = getScaledDimensions(sprite, { maxWidth: box.w, maxHeight: box.h, scale: 99 });
  let dx = box.x;
  let dy = box.y;
  if (anchor === "center" || anchor === "bottom") dx = box.x + (box.w - size.w) / 2;
  if (anchor === "center") dy = box.y + (box.h - size.h) / 2;
  else if (anchor === "bottom") dy = box.y + box.h - size.h;
  return blit(ctx, canvasOf(sprite), Math.round(dx), Math.round(dy), size.w, size.h);
}

export function tileSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteSource,
  startX: number,
  groundY: number,
  untilX: number,
  scale = scaleOf(sprite)
) {
  const size = getScaledDimensions(sprite, { scale });
  let x = Math.floor(startX / size.w) * size.w;
  while (x < untilX + size.w) {
    drawSpriteFrame(ctx, sprite, x, groundY, { scale, anchor: "bottomleft" });
    x += size.w;
  }
  return size;
}
