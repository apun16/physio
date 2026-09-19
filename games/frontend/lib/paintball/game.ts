import * as THREE from "three";
import { AudioManager } from "./audio";
import { CollisionManager, PaintSurfaceManager, Paintball, SLOTS, Target } from "./combat";
import { InputManager } from "./input";
import { ExternalMovementInput, PlayerHitbox } from "./movement";
import { PaintballScene } from "./scene";
import { DifficultyManager, ScoreManager, WaveManager } from "./systems";
import type { GamePhase, HudSnapshot, InputMode } from "./types";
import { HUNTER_SPECS, unlockedHunterIds } from "./robot";

const PLAYER_COLOR = 0x3cf0ff;
const ENEMY_COLOR = 0xff5ad5;
const SPEED = 7.4;
const RADIUS = 0.45;
const HUNTER_RADIUS = 0.55;
/** Half-angle of the wedge in front of the player that hunters are kept inside. */
const VIEW_CONE = 0.7;
/** How fast an off-screen hunter slides back into view, in radians per second. */
const VIEW_SWING = 2.4;
const HUNTER_MIN_DIST = 2.2;
const HUNTER_SEPARATION = 1.6;
const ARENA_PAD = 2.5;
const UP = new THREE.Vector3(0, 1, 0);

export class PaintballGame {
  phase: GamePhase = "boot";
  health = 5;
  maxHealth = 5;
  toast = "";
  hitFlash = 0;
  dodgeFlash = 0;
  input = new InputManager();
  hitbox = new PlayerHitbox();
  movement = new ExternalMovementInput();
  scores = new ScoreManager();
  waves = new WaveManager();
  difficulty = new DifficultyManager();
  audio = new AudioManager();
  collision = new CollisionManager();
  scene: PaintballScene;
  paint: PaintSurfaceManager;
  targets: Target[] = [];
  shots: Paintball[] = [];
  player = new THREE.Vector3(0, 1.6, 12);
  private toastT = 0;
  private countdown = 0;
  private countdownAt = 0;
  private used = new Set<string>();
  private root: HTMLElement;
  private lastAim = { x: 0, y: 0 };
  private fireCool = 0;
  private huntersWanted = 1;
  private hunterTimer = 0;
  private spawnCool = 0;
  private falling = false;
  private fallRestartIn = -1;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.root = root;
    this.scene = new PaintballScene(canvas);
    this.paint = new PaintSurfaceManager(this.scene.scene);
    this.input.attach(root, canvas);
    // The cursor is only captured during a live match, and losing it (Esc,
    // alt-tab, clicking away) pauses instead of leaving the match running
    // under a free cursor.
    this.input.allowCapture = () => this.phase === "play" || this.phase === "countdown";
    this.input.onLockLost = () => {
      if (this.phase === "play") this.phase = "pause";
    };
    this.movement.registerExternalDodgeInput((state) => this.hitbox.setPlayerMovementState(state));
    this.waves.reset();
    this.resize();
  }

  setMode(mode: InputMode) {
    this.input.setMode("kbm");
    void mode;
  }

  startPlay() {
    this.phase = "countdown";
    this.countdown = 3;
    this.countdownAt = performance.now();
    this.audio.resume();
    this.input.capturePointer();
  }

  beginMatch() {
    this.phase = "play";
    this.health = this.maxHealth;
    this.scores.reset();
    this.waves.reset();
    this.clearCombat();
    this.paint.reset();
    this.hitbox.invuln = 1.6;
    this.input.squeeze.reset();
    this.player.copy(this.scene.spawn);
    this.input.yaw = 0;
    this.input.pitch = 0;
    this.fireCool = 0;
    this.huntersWanted = 1;
    this.hunterTimer = 0;
    this.spawnCool = 0.4;
    this.falling = false;
    this.fallRestartIn = -1;
    this.waves.wave = 1;
  }

  togglePause() {
    if (this.phase === "play") {
      this.phase = "pause";
      this.input.releasePointer();
    } else if (this.phase === "pause") {
      this.phase = "play";
      this.input.capturePointer();
    }
  }

  restart() {
    this.beginMatch();
    this.input.capturePointer();
  }

  calibrateAim() {}

  private spawn() {
    const unlocked = unlockedHunterIds(this.huntersWanted);
    const present = new Set(this.targets.map((item) => item.hunterId));
    const fresh = unlocked.find((id) => !present.has(id));
    const kind = fresh ?? unlocked[Math.floor(Math.random() * unlocked.length)];
    const sideSlots = SLOTS.filter((slot) => Math.abs(slot.pos[0]) > 4 || slot.pos[2] > 10);
    const slot = (sideSlots.length ? sideSlots : SLOTS)[Math.floor(Math.random() * (sideSlots.length ? sideSlots.length : SLOTS.length))];
    const hunter = this.scene.makeHunter(kind);
    const spec = hunter?.spec ?? HUNTER_SPECS.find((item) => item.id === kind);
    const target = new Target("moving", slot, spec?.hp ?? 2, hunter?.model, hunter?.mixer ?? null);
    target.hunterId = kind;
    target.notice = 0.2;
    target.speed = (spec?.speed ?? 3.4) + (this.huntersWanted - 1) * 0.22 + Math.min(1.8, this.scores.survival * 0.015);
    target.cooldown = 0.8 + Math.random() * 0.6;
    const spot = this.spawnPointInView();
    if (spot) target.group.position.copy(spot);
    this.scene.scene.add(target.group, target.laser);
    this.targets.push(target);
  }

  private onMap(x: number, z: number) {
    return x >= this.scene.playMin.x && x <= this.scene.playMax.x && z >= this.scene.playMin.z && z <= this.scene.playMax.z;
  }

  private fallOut() {
    this.falling = false;
    this.health = 0;
    this.phase = "over";
    this.toast = "FELL OFF THE MAP";
    this.toastT = 1.1;
    this.audio.over();
    this.input.releasePointer();
    this.fallRestartIn = 1.05;
  }

  private syncHunters() {
    const next = this.hunterTimer < 14 ? 1 : this.hunterTimer < 28 ? 2 : this.hunterTimer < 44 ? 3 : this.hunterTimer < 62 ? 4 : Math.min(6, 4 + Math.floor((this.hunterTimer - 62) / 18));
    if (next > this.huntersWanted) {
      this.huntersWanted = next;
      this.waves.wave = next;
      const unlocked = unlockedHunterIds(next);
      const newest = HUNTER_SPECS.find((item) => item.id === unlocked[unlocked.length - 1]);
      this.toast = next <= 4 && newest ? `${newest.label} INBOUND` : `${next} HUNTERS`;
      this.toastT = 1.2;
      this.audio.wave();
    }
  }

  private lookDir() {
    const dir = new THREE.Vector3();
    this.scene.camera.getWorldDirection(dir);
    return dir.normalize();
  }

  private fire() {
    this.audio.shoot();
    (this.scene.flash.material as THREE.MeshBasicMaterial).opacity = 1;
    const origin = new THREE.Vector3();
    this.scene.muzzle.getWorldPosition(origin);
    const direction = this.lookDir();
    const shot = new Paintball(PLAYER_COLOR, false);
    shot.mesh.position.copy(origin);
    shot.velocity.copy(direction).multiplyScalar(36);
    shot.life = 1.8;
    this.scene.scene.add(shot.mesh);
    this.shots.push(shot);

    const hit = this.collision.hitTarget(origin, direction, this.targets);
    if (hit) {
      hit.target.hp -= 1;
      hit.target.flash = 0.16;
      this.audio.hit();
      this.scores.hit(hit.center, true);
      const n = hit.normal.clone();
      if (hit.target.body.parent) n.transformDirection(hit.target.body.matrixWorld);
      const fresh = this.paint.splat(hit.point, n, PLAYER_COLOR);
      this.scores.paint(fresh);
      this.toast = hit.center ? "CRITICAL HIT" : "HIT";
      this.toastT = 0.45;
      if (hit.target.hp <= 0) this.defeat(hit.target);
      return;
    }
    const world = this.collision.hitWorld(origin, direction, this.scene.world);
    if (world) {
      const normal = world.face?.normal.clone().transformDirection(world.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
      const fresh = this.paint.splat(world.point, normal, PLAYER_COLOR);
      this.scores.paint(fresh);
      this.scores.miss();
      this.audio.miss();
      this.toast = "MISS";
      this.toastT = 0.28;
      return;
    }
    this.scores.miss();
    this.audio.miss();
    this.toast = "MISS";
    this.toastT = 0.28;
  }

  private defeat(target: Target) {
    target.alive = false;
    this.scores.defeat();
    this.toast = "TARGET SPLATTED";
    this.toastT = 0.5;
    this.scene.scene.remove(target.group, target.laser);
    this.used.delete(target.slot.id);
    this.targets = this.targets.filter((item) => item !== target);
  }

  private enemyFire(target: Target, speed: number) {
    const origin = target.spitOrigin();
    const blobs = this.huntersWanted >= 3 ? 2 : 1;
    for (let i = 0; i < blobs; i += 1) {
      const aim = this.player.clone();
      aim.x += (Math.random() - 0.5) * 0.55;
      aim.y += (Math.random() - 0.5) * 0.2;
      aim.z += (Math.random() - 0.5) * 0.55;
      const shot = new Paintball(ENEMY_COLOR, true);
      shot.mesh.position.copy(origin);
      shot.velocity.copy(aim.sub(origin).normalize()).multiplyScalar(speed);
      shot.velocity.y += 1.1;
      shot.life = 3.2;
      this.scene.scene.add(shot.mesh);
      this.shots.push(shot);
    }
  }

  private clearCombat() {
    this.targets.forEach((target) => this.scene.scene.remove(target.group, target.laser));
    this.shots.forEach((shot) => this.scene.scene.remove(shot.mesh));
    this.targets = [];
    this.shots = [];
    this.used.clear();
  }

  private movePlayer(dt: number, forward: number, strafe: number) {
    if (!forward && !strafe) return;
    const yaw = this.input.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const next = this.player.clone();
    next.x += (fx * forward + rx * strafe) * SPEED * dt;
    next.z += (fz * forward + rz * strafe) * SPEED * dt;
    this.resolve(next);
    this.player.copy(next);
    if (!this.onMap(this.player.x, this.player.z)) this.falling = true;
  }

  private resolve(pos: THREE.Vector3, radius = RADIUS) {
    for (const box of this.scene.colliders) {
      if (pos.y < box.min.y - 0.2 || pos.y > box.max.y + 0.2) continue;
      const closestX = THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x);
      const closestZ = THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z);
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(Math.max(d2, 1e-6));
        const push = (radius - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }

  /** Flat unit vector for where the player is looking, on the xz plane. */
  private flatLook() {
    const dir = this.lookDir();
    dir.y = 0;
    return dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 0, -1);
  }

  private blocked(x: number, z: number) {
    const probe = new THREE.Vector3(x, 0.9, z);
    const before = probe.clone();
    this.resolve(probe, HUNTER_RADIUS);
    return !probe.equals(before);
  }

  /** A standing spot in front of the player, on the map and clear of buildings. */
  private spawnPointInView() {
    const forward = this.flatLook();
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const spread = (Math.random() - 0.5) * 2 * VIEW_CONE * 0.85;
      const dist = 13 + Math.random() * 13;
      const point = forward.clone().applyAxisAngle(UP, spread).multiplyScalar(dist).add(this.player);
      point.y = 0;
      if (!this.onMap(point.x, point.z)) continue;
      if (this.blocked(point.x, point.z)) continue;
      return point;
    }
    return null;
  }

  /**
   * Hunters are kept on the map, out of the buildings, off each other and
   * inside the player's view wedge, so they can never wander off, stack up or
   * close in from somewhere off-screen.
   */
  private containTargets(dt: number) {
    const forward = this.flatLook();

    for (const target of this.targets) {
      const pos = target.group.position;
      const probe = new THREE.Vector3(
        THREE.MathUtils.clamp(pos.x, this.scene.playMin.x + ARENA_PAD, this.scene.playMax.x - ARENA_PAD),
        0.9,
        THREE.MathUtils.clamp(pos.z, this.scene.playMin.z + ARENA_PAD, this.scene.playMax.z - ARENA_PAD)
      );
      this.resolve(probe, HUNTER_RADIUS);

      const offset = new THREE.Vector3(probe.x - this.player.x, 0, probe.z - this.player.z);
      const dist = offset.length();
      if (dist > 1e-4) {
        const heading = offset.clone().divideScalar(dist);
        const angle = Math.acos(THREE.MathUtils.clamp(forward.dot(heading), -1, 1));
        if (angle > VIEW_CONE) {
          // Swing back toward the edge of the wedge at a capped rate, so turning
          // around pulls hunters into view smoothly instead of snapping them.
          const side = Math.sign(forward.z * heading.x - forward.x * heading.z) || 1;
          const step = Math.min(angle - VIEW_CONE, VIEW_SWING * dt);
          const swung = heading.clone().applyAxisAngle(UP, -side * step);
          probe.x = this.player.x + swung.x * dist;
          probe.z = this.player.z + swung.z * dist;
        }
        if (dist < HUNTER_MIN_DIST) {
          probe.x = this.player.x + heading.x * HUNTER_MIN_DIST;
          probe.z = this.player.z + heading.z * HUNTER_MIN_DIST;
        }
      }

      pos.set(probe.x, 0, probe.z);
    }

    // Keep hunters from piling into the same spot.
    for (let i = 0; i < this.targets.length; i += 1) {
      for (let j = i + 1; j < this.targets.length; j += 1) {
        const a = this.targets[i].group.position;
        const b = this.targets[j].group.position;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= HUNTER_SEPARATION) continue;
        const push = (HUNTER_SEPARATION - Math.max(d, 1e-4)) * 0.5;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }

    const look = new THREE.Vector3();
    for (const target of this.targets) {
      look.set(this.player.x, 1.2, this.player.z);
      target.group.lookAt(look);
    }
  }

  update(dt: number) {
    const clock = Math.min(Math.max(0, dt), 0.35);
    dt = Math.min(clock, 0.05);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.dodgeFlash = Math.max(0, this.dodgeFlash - dt);
    this.toastT = Math.max(0, this.toastT - dt);
    this.fireCool = Math.max(0, this.fireCool - dt);
    if (this.toastT <= 0) this.toast = "";
    this.hitbox.invuln = Math.max(0, this.hitbox.invuln - dt);
    if (this.fallRestartIn >= 0) {
      this.fallRestartIn -= dt;
      if (this.fallRestartIn <= 0) {
        this.fallRestartIn = -1;
        this.restart();
      }
    }
    (this.scene.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (this.scene.flash.material as THREE.MeshBasicMaterial).opacity - dt * 8);
    this.scene.tick(dt);

    const poll = this.input.poll(dt);
    this.lastAim = { x: poll.aim.x, y: poll.aim.y };

    if (this.phase !== "play") {
      if (this.phase === "countdown") {
        if (this.countdownAt <= 0) this.countdownAt = performance.now();
        this.countdown = 3 - (performance.now() - this.countdownAt) / 1000;
        if (this.countdown <= 0) this.beginMatch();
      }
      this.applyView();
      this.scene.render();
      return;
    }

    this.scores.survival += dt;
    this.hunterTimer += dt;
    this.spawnCool = Math.max(0, this.spawnCool - dt);
    this.movePlayer(dt, poll.forward, poll.strafe);
    if (this.falling) {
      this.player.y -= 22 * dt;
      if (this.player.y < -8) this.fallOut();
    } else {
      this.player.y = 1.6;
    }
    if (poll.fired && this.fireCool <= 0) {
      this.fire();
      this.fireCool = 0.18;
    }

    const settings = this.difficulty.params(this.waves.wave, this.scores.survival, this.scores.accuracy);
    this.syncHunters();
    if (this.targets.length < this.huntersWanted && this.spawnCool <= 0) {
      this.spawn();
      this.spawnCool = Math.max(0.7, 2.2 - this.huntersWanted * 0.35);
    }

    for (const target of this.targets) {
      target.age += dt;
      target.flash = Math.max(0, target.flash - dt);
      target.t += dt;
      target.chase(this.player, dt);
      target.cooldown = Math.max(0, target.cooldown - dt);
      if (target.windup > 0) {
        target.windup -= dt;
        const p = 1 - target.windup / settings.warning;
        target.glow.material.opacity = 0.25 + p * 0.7;
        target.glow.scale.setScalar(1 + p * 0.8);
        (target.laser.material as THREE.LineBasicMaterial).opacity = 0.15 + p * 0.7;
        const origin = target.group.position.clone().add(new THREE.Vector3(0, 1.35, 0.15));
        target.laser.geometry.setFromPoints([origin, target.lockedAim ?? this.player.clone()]);
        if (target.windup <= 0) {
          this.enemyFire(target, settings.projectileSpeed + 5 + this.huntersWanted);
          target.cooldown = Math.max(0.55, 1.35 - this.huntersWanted * 0.22 + Math.random() * 0.4);
          (target.laser.material as THREE.LineBasicMaterial).opacity = 0;
          target.glow.material.opacity = 0.12;
          target.glow.scale.setScalar(1);
        }
      } else if (target.age > target.notice && target.cooldown <= 0) {
        target.windup = Math.max(0.55, settings.warning);
        target.lockedAim = this.player.clone();
      }
      target.group.children.forEach((child) => {
        if (child.name.startsWith("armour-")) child.visible = Number(child.name.slice(7)) < target.hp;
      });
    }

    this.containTargets(dt);

    for (const shot of [...this.shots]) {
      if (shot.spent) continue;
      shot.life -= dt;
      shot.mesh.position.addScaledVector(shot.velocity, dt);
      shot.velocity.y -= dt * (shot.fromEnemy ? 6.5 : 2.2);
      if (shot.fromEnemy) {
        const dist = shot.mesh.position.distanceTo(this.player);
        if (dist < 2.4) shot.near = true;
        if (dist < 0.72 && this.hitbox.invuln <= 0) {
          shot.spent = true;
          this.health -= 1;
          this.hitbox.invuln = 1.05;
          this.hitFlash = 0.32;
          this.scores.hurt();
          this.audio.hurt();
          this.toast = "PAINTED";
          this.toastT = 0.4;
          if (this.health <= 0) {
            this.phase = "over";
            this.audio.over();
            this.input.releasePointer();
          }
          this.scene.scene.remove(shot.mesh);
          this.shots = this.shots.filter((item) => item !== shot);
          continue;
        }
        const world = this.collision.hitWorld(shot.mesh.position, shot.velocity.clone().normalize(), this.scene.world);
        if (world && world.distance < 0.35) {
          const normal = world.face?.normal.clone().transformDirection(world.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
          this.paint.splat(world.point, normal, ENEMY_COLOR);
          if (shot.near && dist > 0.72) {
            this.scores.dodge();
            this.audio.dodge();
            this.dodgeFlash = 0.4;
            this.toast = "DODGED!";
            this.toastT = 0.5;
          }
          shot.spent = true;
          this.scene.scene.remove(shot.mesh);
          this.shots = this.shots.filter((item) => item !== shot);
          continue;
        }
      } else {
        const world = this.collision.hitWorld(shot.mesh.position, shot.velocity.clone().normalize(), this.scene.world);
        if (world && world.distance < 0.28) {
          const normal = world.face?.normal.clone().transformDirection(world.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
          this.paint.splat(world.point, normal, PLAYER_COLOR);
          shot.spent = true;
          this.scene.scene.remove(shot.mesh);
          this.shots = this.shots.filter((item) => item !== shot);
          continue;
        }
      }
      if (shot.life <= 0) {
        this.scene.scene.remove(shot.mesh);
        this.shots = this.shots.filter((item) => item !== shot);
      }
    }

    this.applyView();
    this.scene.render();
  }

  private applyView() {
    if (this.phase === "boot" || this.phase === "countdown") this.player.copy(this.scene.spawn);
    const shake = this.hitFlash * 0.08;
    this.scene.camera.position.set(this.player.x + (Math.random() - 0.5) * shake, this.player.y, this.player.z + (Math.random() - 0.5) * shake);
    this.scene.camera.rotation.set(this.input.pitch, this.input.yaw, 0, "YXZ");
    const recoil = (this.scene.flash.material as THREE.MeshBasicMaterial).opacity * 0.06;
    this.scene.blaster.position.z = -0.42 + recoil;
  }

  resize() {
    this.scene.resize(this.root.clientWidth || 1280, this.root.clientHeight || 720);
  }

  snapshot(): HudSnapshot {
    return {
      phase: this.phase,
      health: this.health,
      maxHealth: this.maxHealth,
      score: this.scores.score,
      wave: this.waves.wave,
      combo: this.scores.combo,
      accuracy: this.scores.accuracy,
      hits: this.scores.hits,
      misses: this.scores.misses,
      defeats: this.scores.defeats,
      coverage: this.paint.coverage,
      survival: this.scores.survival,
      longestCombo: this.scores.longestCombo,
      toast: this.toast,
      shootState: this.input.squeeze.phase,
      aiming: false,
      imu: "off",
      mode: "kbm",
      dodge: this.hitbox.state,
      count: this.countdown,
      hitFlash: this.hitFlash,
      dodgeFlash: this.dodgeFlash,
      debug: {
        pitch: this.input.pitch,
        yaw: this.input.yaw,
        roll: 0,
        squeeze: 0,
        connected: false,
        noise: false,
        aim: this.lastAim
      }
    };
  }

  dispose() {
    this.input.detach();
    this.audio.dispose();
    this.clearCombat();
    this.scene.dispose();
  }
}
