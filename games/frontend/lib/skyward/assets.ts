import { HERO_STAND_HEIGHT, SCALE, pixelScaleFor } from "./layout";
import { asSprite, type Sprite } from "./sprite";

export type { Sprite };

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = encodeURI(src);
  });
  return image;
}

function canvasFrom(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2d context missing");
  return { canvas, context };
}

function drawImage(image: CanvasImageSource, width?: number, height?: number) {
  const w = width ?? (image as HTMLImageElement).naturalWidth ?? (image as HTMLImageElement).width;
  const h = height ?? (image as HTMLImageElement).naturalHeight ?? (image as HTMLImageElement).height;
  const { canvas, context } = canvasFrom(w, h);
  context.drawImage(image, 0, 0, w, h);
  return { canvas, context };
}

function keyBy(canvas: HTMLCanvasElement, test: (r: number, g: number, b: number, a: number) => boolean) {
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (test(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])) pixels[i + 3] = 0;
  }
  context.putImageData(data, 0, 0);
  return canvas;
}

function keyBlack(canvas: HTMLCanvasElement) {
  return keyBy(canvas, (r, g, b, a) => a > 0 && r < 18 && g < 18 && b < 18);
}

function isPaper(r: number, g: number, b: number, a: number) {
  if (a < 8) return true;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const bright = (r + g + b) / 3;
  return (r >= 220 && g >= 220 && b >= 220) || (chroma <= 36 && bright >= 178);
}

function isInk(r: number, g: number, b: number, a: number) {
  return a < 8 || (r < 14 && g < 14 && b < 14);
}

function floodKey(canvas: HTMLCanvasElement, test: (r: number, g: number, b: number, a: number) => boolean) {
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height);
  const pixels = data.data;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index]) return;
    const o = index * 4;
    if (!test(pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3])) return;
    seen[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (stack.length) {
    const index = stack.pop() as number;
    pixels[index * 4 + 3] = 0;
    const x = index % width;
    const y = (index / width) | 0;
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
  context.putImageData(data, 0, 0);
  return canvas;
}

function cropAlpha(source: HTMLCanvasElement, pad = 2): HTMLCanvasElement {
  const context = source.getContext("2d");
  if (!context) return source;
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  const rowCounts = new Uint16Array(height);
  const colCounts = new Uint16Array(width);
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] <= 28) continue;
    const index = (i - 3) / 4;
    const x = index % width;
    const y = (index / width) | 0;
    rowCounts[y] += 1;
    colCounts[x] += 1;
  }
  let minY = 0;
  let maxY = height - 1;
  let minX = 0;
  let maxX = width - 1;
  while (minY < height && rowCounts[minY] < 4) minY += 1;
  while (maxY > minY && rowCounts[maxY] < 4) maxY -= 1;
  while (minX < width && colCounts[minX] < 4) minX += 1;
  while (maxX > minX && colCounts[maxX] < 4) maxX -= 1;
  if (maxX < minX || maxY < minY) return source;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const cropped = canvasFrom(maxX - minX + 1, maxY - minY + 1);
  cropped.context.drawImage(source, minX, minY, cropped.canvas.width, cropped.canvas.height, 0, 0, cropped.canvas.width, cropped.canvas.height);
  return cropped.canvas;
}

function trimFill(layer: HTMLCanvasElement) {
  const context = layer.getContext("2d");
  if (!context) return layer;
  const { width, height } = layer;
  const pixels = context.getImageData(0, 0, width, height).data;
  let cutoff = height;
  for (let y = height - 1; y > height / 3; y -= 1) {
    const tones = new Set<string>();
    let opaque = 0;
    for (let x = 0; x < width; x += 32) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (!a || (r < 8 && g < 8 && b < 8)) continue;
      opaque += 1;
      tones.add(`${r},${g},${b}`);
    }
    if (opaque > 4 && tones.size <= 3) cutoff = y;
    else break;
  }
  cutoff = Math.max(Math.floor(height * 0.55), Math.min(height, cutoff + 8));
  const trimmed = canvasFrom(width, cutoff);
  trimmed.context.drawImage(layer, 0, 0);
  return trimmed.canvas;
}

function extractBlobs(source: HTMLCanvasElement, minArea = 700) {
  const context = source.getContext("2d");
  if (!context) return [];
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  const seen = new Uint8Array(width * height);
  const blobs: { sprite: HTMLCanvasElement; x: number; y: number; w: number; h: number; area: number }[] = [];
  const opaque = (index: number) => pixels[index * 4 + 3] > 28;

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || !opaque(start)) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    while (stack.length) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index / width) | 0;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      const neighbors = [index + 1, index - 1, index + width, index - width];
      for (const next of neighbors) {
        if (next < 0 || next >= width * height || seen[next] || !opaque(next)) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (area < minArea) continue;
    const cropped = canvasFrom(maxX - minX + 1, maxY - minY + 1);
    cropped.context.drawImage(source, minX, minY, cropped.canvas.width, cropped.canvas.height, 0, 0, cropped.canvas.width, cropped.canvas.height);
    blobs.push({ sprite: cropped.canvas, x: minX, y: minY, w: cropped.canvas.width, h: cropped.canvas.height, area });
  }
  return blobs;
}

function sliceActors(source: HTMLCanvasElement, count: number, minArea = 800) {
  const cleaned = floodKey(source, isPaper);
  const blobs = extractBlobs(cleaned, minArea)
    .filter((blob) => blob.h > 48 && blob.w > 24)
    .sort((a, b) => b.area - a.area)
    .slice(0, count)
    .sort((a, b) => a.x - b.x);
  return blobs.map((blob) => cropAlpha(blob.sprite, 1));
}

/** Slice a sheet into equal cells, then crop transparent padding inside each cell. */
function sliceGrid(source: HTMLCanvasElement, cols: number, rows: number, trimBottom = 0) {
  const usableH = Math.max(1, Math.floor(source.height * (1 - trimBottom)));
  const cw = Math.floor(source.width / cols);
  const rh = Math.floor(usableH / rows);
  const frames: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = canvasFrom(cw, rh);
      cell.context.drawImage(source, col * cw, row * rh, cw, rh, 0, 0, cw, rh);
      frames.push(cropAlpha(cell.canvas, 1));
    }
  }
  return frames;
}

function copyRect(source: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const cell = canvasFrom(w, h);
  cell.context.drawImage(source, x, y, w, h, 0, 0, w, h);
  return cropAlpha(cell.canvas, 1);
}

function packNative(image: HTMLImageElement, keyLight = true) {
  let canvas = floodKey(drawImage(image).canvas, isInk);
  if (keyLight) canvas = floodKey(canvas, isPaper);
  return cropAlpha(canvas, 1);
}

function pixelSprite(canvas: HTMLCanvasElement): Sprite {
  return asSprite(canvas, pixelScaleFor(canvas.height));
}

function medianHeight(frames: HTMLCanvasElement[]) {
  const heights = frames.map((frame) => frame.height).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 1;
}

function hasFlame(source: HTMLCanvasElement) {
  const context = source.getContext("2d");
  if (!context) return false;
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 40) continue;
    if (pixels[i] > 170 && pixels[i + 1] > 60 && pixels[i + 2] < 90) return true;
  }
  return false;
}

function cropTalkPortrait(actions: HTMLCanvasElement) {
  const cleaned = floodKey(actions, isPaper);
  const cell = canvasFrom(140, 120);
  cell.context.drawImage(cleaned, 1096, 244, 140, 120, 0, 0, 140, 120);
  return cropAlpha(cell.canvas, 1);
}

export type SkywardAssets = {
  idle: Sprite;
  walk: Sprite[];
  hero: Record<string, Sprite>;
  enemies: Record<string, Sprite>;
  gear: Record<string, Sprite>;
  portrait: Sprite;
  trees: Record<string, Sprite>;
  grassEdge: Record<string, Sprite>;
  layers: Record<string, Sprite[]>;
  castle: Record<string, Sprite>;
  sun: Sprite;
  clouds: Sprite[];
  birds: Sprite[];
  campfire: Sprite[];
  house: Sprite;
};

export async function loadSkywardAssets(): Promise<SkywardAssets> {
  const layerFiles = (set: string) => [1, 2, 3, 4, 5].map((index) => loadImage(`/skyward/pack/bg/${set}/layer${index}.png`));
  const [
    walkImg,
    actionsImg,
    enemyImg,
    gearImg,
    tree1,
    tree2,
    tree3,
    tree4,
    willow1,
    willow2,
    pine,
    birch,
    flower,
    grass,
    tent,
    tentL,
    statue,
    tiles,
    house,
    sun,
    balloon,
    campfire,
    nCastle,
    aCastle,
    wCastle,
    ...rest
  ] = await Promise.all([
    loadImage("/skyward/generated/hero_walk.png"),
    loadImage("/skyward/generated/hero_actions.png"),
    loadImage("/skyward/generated/enemy_sheet.png"),
    loadImage("/skyward/generated/link_gear.png"),
    loadImage("/skyward/pack/Tree1.png"),
    loadImage("/skyward/pack/Tree2.png"),
    loadImage("/skyward/pack/Tree3.png"),
    loadImage("/skyward/pack/Tree4.png"),
    loadImage("/skyward/pack/Weeping Willow1.png"),
    loadImage("/skyward/pack/Weeping Willow2.png"),
    loadImage("/skyward/pack/Large Pine Tree.png"),
    loadImage("/skyward/pack/Birch1.png"),
    loadImage("/skyward/pack/Flowering Tree.png"),
    loadImage("/skyward/pack/Tall Grass.png"),
    loadImage("/skyward/pack/Small Tent.png"),
    loadImage("/skyward/pack/Large Tent.png"),
    loadImage("/skyward/pack/Angel Statue.png"),
    loadImage("/skyward/pack/Floor Tiles1.png"),
    loadImage("/skyward/pack/House Tiles.png"),
    loadImage("/skyward/pack/sun.png"),
    loadImage("/skyward/pack/hot air balloon.png"),
    loadImage("/skyward/pack/anim/campfire.png"),
    loadImage("/skyward/pack/bg/normal/castle.png"),
    loadImage("/skyward/pack/bg/autumn/castle.png"),
    loadImage("/skyward/pack/bg/winter/castle.png"),
    ...layerFiles("normal"),
    ...layerFiles("autumn"),
    ...layerFiles("winter"),
    ...[1, 2, 3, 4, 5, 6].map((index) => loadImage(`/skyward/pack/cloud${index}.png`)),
    ...[1, 2, 3, 4].map((index) => loadImage(`/skyward/pack/birds${index}.png`))
  ]);

  const nLayers = rest.slice(0, 5) as HTMLImageElement[];
  const aLayers = rest.slice(5, 10) as HTMLImageElement[];
  const wLayers = rest.slice(10, 15) as HTMLImageElement[];
  const cloudImgs = rest.slice(15, 21) as HTMLImageElement[];
  const birdImgs = rest.slice(21, 25) as HTMLImageElement[];

  await document.fonts.load('24px "Determination Mono"');

  const walkClean = floodKey(drawImage(walkImg).canvas, isPaper);
  const walkCanvases = sliceGrid(walkClean, 4, 1, 0.16);
  const actionCanvases = sliceActors(drawImage(actionsImg).canvas, 6, 1200);
  const actionNames = ["slash_horizontal", "slash_vertical", "slash_diagonal", "shield", "bow", "victory"];

  const walkBody = medianHeight(walkCanvases);
  const compactActions = [actionCanvases[0], actionCanvases[2], actionCanvases[3]].filter(Boolean);
  const actionBody = medianHeight(compactActions.length ? compactActions : actionCanvases);
  const walkScale = HERO_STAND_HEIGHT / walkBody;
  const actorScale = HERO_STAND_HEIGHT / actionBody;

  const walk = walkCanvases.map((frame) => asSprite(frame, walkScale));
  const idle = walk[1] ?? walk[0];
  const hero: Record<string, Sprite> = { idle, hurt: idle };
  actionNames.forEach((name, index) => {
    if (actionCanvases[index]) hero[name] = asSprite(actionCanvases[index], actorScale);
  });
  hero.bow_draw = hero.bow ?? idle;
  hero.bow_hold = hero.bow ?? idle;
  hero.bow_release = hero.bow ?? idle;

  const enemyCanvases = sliceActors(drawImage(enemyImg).canvas, 6, 900);
  const kinds = ["goblin", "shield_beast", "archer", "armored", "elite", "boss"];
  const enemies: Record<string, Sprite> = {};
  kinds.forEach((kind, index) => {
    if (enemyCanvases[index]) enemies[kind] = asSprite(enemyCanvases[index], actorScale);
  });

  const gearSheet = floodKey(drawImage(gearImg).canvas, isPaper);
  const gw = Math.floor(gearSheet.width / 3);
  const gh = Math.floor(gearSheet.height / 2);
  const gearLabels = ["sword", "shield", "bow", "arrow", "heart", "gem"];
  const gear: Record<string, Sprite> = {};
  gearLabels.forEach((label, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    gear[label] = asSprite(copyRect(gearSheet, col * gw, row * gh, gw, gh), SCALE.hud);
  });

  const houseSprite = pixelSprite(copyRect(keyBlack(drawImage(house).canvas), 0, 0, 224, 224));
  const trees: Record<string, Sprite> = {
    tree1: pixelSprite(packNative(tree1)),
    tree2: pixelSprite(packNative(tree2)),
    tree3: pixelSprite(packNative(tree3)),
    tree4: pixelSprite(packNative(tree4)),
    willow1: pixelSprite(packNative(willow1)),
    willow2: pixelSprite(packNative(willow2)),
    pine: pixelSprite(packNative(pine)),
    birch: pixelSprite(packNative(birch)),
    flower: pixelSprite(packNative(flower)),
    grass: asSprite(packNative(grass), SCALE.grass),
    tent: pixelSprite(packNative(tent)),
    tent_l: pixelSprite(packNative(tentL)),
    house: houseSprite,
    statue: pixelSprite(packNative(statue)),
    balloon: pixelSprite(packNative(balloon, false))
  };

  const tileSheet = drawImage(tiles).canvas;
  const grassLip = (sy: number) => {
    const lip = canvasFrom(96, 12);
    lip.context.imageSmoothingEnabled = false;
    lip.context.drawImage(tileSheet, 0, sy, 96, 12, 0, 0, 96, 12);
    return asSprite(lip.canvas, SCALE.pixel);
  };
  const grassEdge: Record<string, Sprite> = {
    grass: grassLip(0),
    autumn: grassLip(192),
    stone: grassLip(384)
  };

  const layerOf = (image: HTMLImageElement) => asSprite(trimFill(keyBlack(drawImage(image).canvas)), 1);
  const layers = {
    normal: nLayers.map(layerOf),
    autumn: aLayers.map(layerOf),
    winter: wLayers.map(layerOf)
  };
  const castle = {
    normal: asSprite(keyBlack(drawImage(nCastle).canvas), 1),
    autumn: asSprite(keyBlack(drawImage(aCastle).canvas), 1),
    winter: asSprite(keyBlack(drawImage(wCastle).canvas), 1)
  };

  const fireSheet = keyBy(drawImage(campfire).canvas, (r, g, b, a) => a < 8 || (r < 22 && g < 18 && b < 16 && Math.max(r, g, b) - Math.min(r, g, b) < 10));
  const fireFrames = sliceGrid(fireSheet, 5, 8)
    .filter((frame) => hasFlame(frame))
    .map((frame) => asSprite(frame, SCALE.pixel));

  return {
    idle,
    walk,
    hero,
    enemies,
    gear,
    portrait: asSprite(cropTalkPortrait(drawImage(actionsImg).canvas), 1),
    trees,
    grassEdge,
    layers,
    castle,
    sun: asSprite(packNative(sun, false), SCALE.pixel),
    clouds: cloudImgs.map((image) => asSprite(packNative(image, false), SCALE.cloud)),
    birds: birdImgs.map((image) => asSprite(packNative(image, false), SCALE.bird)),
    campfire: fireFrames,
    house: houseSprite
  };
}

export function heroFrame(assets: SkywardAssets, anim: string, t: number): Sprite {
  if (anim === "walk" && assets.walk.length) return assets.walk[Math.floor(t * 8) % assets.walk.length];
  return assets.hero[anim] ?? assets.hero.idle;
}
