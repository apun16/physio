import type { SkywardAssets } from "./assets";
import { heroFrame } from "./assets";
import { zoneAt, type Zone } from "./encounters";
import {
  CAMERA_LEAD,
  CAMPFIRE_X,
  FONT,
  GROUND_Y,
  HEIGHT,
  PARALLAX,
  SCALE,
  WALK_BOB,
  WIDTH
} from "./layout";
import {
  drawSpriteBottomAnchored,
  drawSpriteContain,
  drawSpriteFrame,
  getScaledDimensions,
  tileSprite
} from "./sprite";
import type { JourneyState } from "./state";

export { WIDTH, HEIGHT, GROUND_Y };

function setFont(ctx: CanvasRenderingContext2D, size: number) {
  ctx.font = `${size}px ${FONT}`;
}

function rgb(color: [number, number, number], alpha = 1) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function screenX(worldX: number, cam: number, shake = 0) {
  return worldX - cam + shake;
}

function catalog(zone: Zone) {
  if (zone.id === "forest") return ["tree1", "tree2", "pine", "birch", "tent"];
  if (zone.id === "deep") return ["willow1", "willow2", "pine", "tree3", "tree4"];
  if (zone.id === "range") return ["flower", "tree2", "birch", "balloon"];
  if (zone.id === "approach") return ["tree4", "statue", "birch"];
  return ["statue"];
}

export function drawSkyward(ctx: CanvasRenderingContext2D, state: JourneyState, assets: SkywardAssets, debug: boolean) {
  const zone = zoneAt(state.hero.x);
  const shakeX = (Math.random() - 0.5) * 18 * state.shake;
  const shakeY = (Math.random() - 0.5) * 12 * state.shake;
  const cam = state.hero.x - CAMERA_LEAD;
  const ground = GROUND_Y + shakeY;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawSky(ctx, assets, zone);
  drawParallax(ctx, assets, zone, cam, shakeX, ground);
  drawGround(ctx, assets, zone, cam, shakeX, ground);
  drawProps(ctx, assets, state, zone, cam, shakeX, ground);
  drawActors(ctx, assets, state, cam, shakeX, ground);
  drawFx(ctx, assets, state, cam, shakeX, ground);
  drawHud(ctx, assets, state, zone, debug);
  drawDialogue(ctx, assets, state);
}

function drawSky(ctx: CanvasRenderingContext2D, assets: SkywardAssets, zone: Zone) {
  const gradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  gradient.addColorStop(0, rgb(zone.skyTop));
  gradient.addColorStop(1, rgb(zone.skyBot));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, GROUND_Y);
  if (zone.bgSet !== "castle") {
    drawSpriteFrame(ctx, assets.sun, zone.id === "range" ? 160 : 1080, 36, { scale: SCALE.pixel, anchor: "topleft" });
  }
}

function drawParallax(
  ctx: CanvasRenderingContext2D,
  assets: SkywardAssets,
  zone: Zone,
  cam: number,
  shake: number,
  ground: number
) {
  if (zone.bgSet === "castle") {
    ctx.fillStyle = "#120e1a";
    ctx.fillRect(0, 0, WIDTH, GROUND_Y);
    const wall = assets.house;
    const size = getScaledDimensions(wall);
    let x = -(((cam * 0.35) % size.w) + size.w) % size.w;
    while (x < WIDTH + size.w) {
      drawSpriteBottomAnchored(ctx, wall, x + size.w / 2 + shake, ground);
      x += size.w;
    }
    return;
  }

  const layers = assets.layers[zone.bgSet] ?? assets.layers.normal;
  layers.forEach((layer, index) => {
    const size = getScaledDimensions(layer, { height: PARALLAX.band });
    const factor = PARALLAX.factors[index] ?? 0.12 + index * 0.12;
    const offset = ((-cam * factor) % size.w + size.w) % size.w;
    for (let x = -offset + shake; x < WIDTH + size.w; x += size.w) {
      drawSpriteFrame(ctx, layer, x, ground, { height: PARALLAX.band, anchor: "bottomleft" });
    }
  });

  const castle = zone.id === "approach" ? assets.castle.winter : assets.castle[zone.bgSet];
  if (castle && (zone.id === "approach" || zone.id === "range")) {
    drawSpriteBottomAnchored(ctx, castle, screenX(6400, cam, shake), ground, getScaledDimensions(castle, { maxHeight: 280 }).scale);
  }

  assets.clouds.slice(0, 4).forEach((cloud, index) => {
    const span = WIDTH + 200;
    const x = ((-cam * 0.08 + index * 340) % span + span) % span - 80;
    drawSpriteFrame(ctx, cloud, x + shake, 40 + index * 18, { scale: cloud.scale, anchor: "topleft" });
  });
  assets.birds.slice(0, 3).forEach((bird, index) => {
    const span = WIDTH + 180;
    const x = ((-cam * 0.16 + index * 480) % span + span) % span - 50;
    drawSpriteFrame(ctx, bird, x + shake, 72 + index * 22, { scale: bird.scale, anchor: "topleft" });
  });
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  assets: SkywardAssets,
  zone: Zone,
  cam: number,
  shake: number,
  ground: number
) {
  const soil = zone.ground === "stone" ? "#3a3438" : zone.ground === "autumn" ? "#5a4024" : "#3d6a32";
  ctx.fillStyle = soil;
  ctx.fillRect(0, ground, WIDTH, 28);
  ctx.fillStyle = "#141012";
  ctx.fillRect(0, ground + 22, WIDTH, HEIGHT);

  const edge = assets.grassEdge[zone.ground] ?? assets.grassEdge.grass;
  tileSprite(ctx, edge, cam - shake, ground, cam + WIDTH, edge.scale);
}

function drawProps(
  ctx: CanvasRenderingContext2D,
  assets: SkywardAssets,
  state: JourneyState,
  zone: Zone,
  cam: number,
  shake: number,
  ground: number
) {
  const picks = catalog(zone);
  let seed = 0;
  for (const ch of zone.id) seed += ch.charCodeAt(0);
  let x = zone.start;
  while (x < zone.end) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const choice = picks[seed % picks.length];
    const sprite = assets.trees[choice];
    const gap = 210 + (seed % 220);
    if (sprite) {
      const drawX = screenX(x, cam, shake);
      if (drawX > -320 && drawX < WIDTH + 80) drawSpriteBottomAnchored(ctx, sprite, drawX, ground);
    }
    x += gap;
  }
  if ((zone.id === "forest" || zone.id === "deep") && assets.campfire.length) {
    const frame = assets.campfire[Math.floor(state.elapsed * 10) % assets.campfire.length];
    drawSpriteBottomAnchored(ctx, frame, screenX(CAMPFIRE_X, cam, shake), ground);
  }
  if (zone.bgSet === "castle" && assets.trees.statue) {
    drawSpriteBottomAnchored(ctx, assets.trees.statue, screenX(9000, cam, shake), ground);
  }
}

function drawActors(
  ctx: CanvasRenderingContext2D,
  assets: SkywardAssets,
  state: JourneyState,
  cam: number,
  shake: number,
  ground: number
) {
  const bob = state.hero.anim === "walk" ? Math.sin(state.elapsed * 8) * WALK_BOB : 0;
  const frame = heroFrame(assets, state.hero.anim, state.hero.animT);
  if (state.hero.hurtT > 0) ctx.filter = "brightness(1.4) saturate(0.6) hue-rotate(-20deg)";
  drawSpriteBottomAnchored(ctx, frame, screenX(state.hero.x, cam, shake), ground - bob);
  ctx.filter = "none";

  const enemy = state.enemy;
  if (enemy && enemy.alive && assets.enemies[enemy.spec.kind]) {
    const sprite = assets.enemies[enemy.spec.kind];
    if (enemy.flash > 0) ctx.filter = "brightness(1.8)";
    else if (enemy.windup > 0) ctx.filter = "sepia(0.4) saturate(1.8)";
    const er = drawSpriteBottomAnchored(ctx, sprite, screenX(enemy.x, cam, shake) + enemy.hitReact * 40, ground);
    ctx.filter = "none";
    const barW = enemy.spec.boss ? 180 : 110;
    const bx = er.x + er.w / 2 - barW / 2;
    const by = er.y - 18;
    ctx.fillStyle = "#141012";
    ctx.fillRect(bx - 2, by - 2, barW + 4, 10);
    ctx.fillStyle = "#ba3030";
    ctx.fillRect(bx, by, barW * Math.max(0, enemy.hp / enemy.spec.maxHp), 6);
    ctx.fillStyle = "#f8f5dc";
    setFont(ctx, 18);
    ctx.fillText(enemy.spec.title, bx, by - 6);
  }
}

function drawFx(
  ctx: CanvasRenderingContext2D,
  assets: SkywardAssets,
  state: JourneyState,
  cam: number,
  shake: number,
  ground: number
) {
  for (const trail of state.trails) {
    const t = trail.t / trail.life;
    ctx.strokeStyle = trail.strong ? `rgba(255,230,120,${1 - t})` : `rgba(120,210,255,${1 - t})`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    const cx = screenX(trail.originX, cam, shake) + 90;
    const cy = ground - 110;
    if (trail.direction === "horizontal") ctx.arc(cx + 40, cy, 70, -0.4, 0.9);
    else if (trail.direction === "vertical") ctx.arc(cx, cy + 10, 80, 1.2, 4.4);
    else ctx.arc(cx + 20, cy, 70, 0.2, 2.4);
    ctx.stroke();
  }
  for (const impact of state.impacts) {
    const t = impact.t / impact.life;
    ctx.strokeStyle = impact.blocked ? "#8cbeff" : "#f0dc78";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX(impact.x, cam, shake), ground - impact.y, 12 + t * 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const shot of state.projectiles) {
    ctx.save();
    ctx.translate(screenX(shot.x, cam, shake), ground - shot.y);
    ctx.rotate(Math.atan2(-shot.vy, shot.vx) - Math.PI / 2);
    drawSpriteFrame(ctx, assets.gear.arrow, 0, 0, { height: 36, anchor: "center" });
    ctx.restore();
  }
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  assets: SkywardAssets,
  state: JourneyState,
  zone: Zone,
  debug: boolean
) {
  for (let i = 0; i < 3; i += 1) {
    const hp = state.hero.hp;
    ctx.globalAlpha = hp >= (i + 1) * 2 ? 1 : hp <= i * 2 ? 0.22 : 0.55;
    drawSpriteFrame(ctx, assets.gear.heart, 24 + i * 36, 18, { height: 28, anchor: "topleft" });
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#f0c44a";
  ctx.beginPath();
  ctx.moveTo(30, 56);
  ctx.lineTo(30, 76);
  ctx.lineTo(44, 66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#b48c46";
  ctx.fillRect(20, 63, 12, 6);
  ctx.fillStyle = "#f8f5dc";
  setFont(ctx, 22);
  ctx.fillText(`x${state.hero.arrows}`, 52, 74);
  ctx.fillStyle = "#f0c44a";
  setFont(ctx, 18);
  const name = zone.name.toUpperCase();
  ctx.fillText(name, WIDTH - ctx.measureText(name).width - 24, 32);
  if (debug) {
    const label = "DEBUG  J/K/L slash   F shield   E bow";
    setFont(ctx, 16);
    const w = ctx.measureText(label).width;
    ctx.fillStyle = "#f0c44a";
    ctx.fillRect(WIDTH - w - 36, 40, w + 16, 22);
    ctx.fillStyle = "#141210";
    ctx.fillText(label, WIDTH - w - 28, 57);
  } else if (state.phase === "combat") {
    ctx.fillStyle = "#f8f5dc";
    setFont(ctx, 16);
    ctx.fillText("waiting for IMU  (sword / shield / bow)", WIDTH / 2 - 200, 88);
  }
  if (state.phase === "dead" || state.phase === "complete") {
    ctx.fillStyle = "rgba(6,6,10,0.6)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#f0c44a";
    setFont(ctx, 32);
    const title = state.phase === "dead" ? "REST" : "JOURNEY'S END";
    ctx.fillText(title, WIDTH / 2 - ctx.measureText(title).width / 2, HEIGHT / 2 - 20);
    ctx.fillStyle = "#f8f5dc";
    setFont(ctx, 22);
    const sub = state.phase === "dead" ? "* Press R to walk the woods again." : "* The castle is quiet. You did the work.";
    ctx.fillText(sub, WIDTH / 2 - ctx.measureText(sub).width / 2, HEIGHT / 2 + 16);
  }
}

function drawDialogue(ctx: CanvasRenderingContext2D, assets: SkywardAssets, state: JourneyState) {
  if (state.dialogue.shown > state.dialogue.duration) return;
  const box = { x: 90, y: HEIGHT - 158, w: WIDTH - 180, h: 118 };
  ctx.fillStyle = "#08080c";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = "#f8f5dc";
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = "#18161c";
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x + 4, box.y + 4, box.w - 8, box.h - 8);
  const portrait = drawSpriteContain(ctx, assets.portrait, { x: box.x + 12, y: box.y + 12, w: 92, h: 94 }, "center");
  const chars = Math.floor(state.dialogue.shown * 38);
  const text = state.dialogue.text.slice(0, chars);
  ctx.fillStyle = "#f8f5dc";
  setFont(ctx, 22);
  wrapText(ctx, text, box.x + 28 + portrait.w, box.y + 42, box.w - portrait.w - 48, 28);
  if (chars < state.dialogue.text.length) {
    ctx.fillStyle = "#f8f5dc";
    ctx.fillRect(box.x + box.w - 22, box.y + box.h - 22, 8, 14);
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let cursor = y;
  for (const word of words) {
    const trial = (line + " " + word).trim();
    if (ctx.measureText(trial).width > maxWidth) {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else line = trial;
  }
  if (line) ctx.fillText(line, x, cursor);
}
