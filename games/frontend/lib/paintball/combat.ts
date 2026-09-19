import * as THREE from "three";
import type { TargetKind } from "./types";

export type Lane = "left" | "center" | "right";
export type Height = "low" | "mid" | "high";

export const SLOTS: { id: string; pos: [number, number, number]; lane: Lane; height: Height }[] = [
  { id: "st-a", pos: [-8, 0, -36], lane: "left", height: "mid" },
  { id: "st-b", pos: [8, 0, -18], lane: "right", height: "mid" },
  { id: "st-c", pos: [0, 0, -48], lane: "center", height: "mid" },
  { id: "st-d", pos: [-10, 0, 6], lane: "left", height: "low" },
  { id: "st-e", pos: [10, 0, 22], lane: "right", height: "low" },
  { id: "st-f", pos: [0, 0, 38], lane: "center", height: "high" },
  { id: "st-g", pos: [-6, 0, 52], lane: "right", height: "mid" }
];

function mat(color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.18, ...extra });
}

function runnerModel() {
  const group = new THREE.Group();
  const skin = mat(0xf3c7b3);
  const black = mat(0x14181f);
  const cyan = mat(0x6fe7ff, { emissive: 0x2ad4ff, emissiveIntensity: 0.55 });
  const hair = mat(0xe44fd4, { roughness: 0.55 });

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.18), black);
  hips.position.y = 0.84;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.52, 0.22), black);
  torso.position.y = 1.18;
  torso.userData.paintable = true;
  const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), cyan);
  glowL.position.set(-0.12, 1.18, 0.12);
  const glowR = glowL.clone();
  glowR.position.x = 0.12;
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 6), cyan);
  hex.rotation.x = Math.PI / 2;
  hex.position.set(0, 1.28, 0.12);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.y = 1.58;
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), hair);
  bangs.scale.set(1.15, 0.78, 1.2);
  bangs.position.set(0, 1.7, 0.02);
  const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.08), hair);
  fringe.position.set(0, 1.52, 0.14);
  const sideL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), hair);
  sideL.position.set(-0.14, 1.54, 0.02);
  const sideR = sideL.clone();
  sideR.position.x = 0.14;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0x2a1240, { emissive: 0x7a3cff, emissiveIntensity: 0.4 }));
  eyeL.position.set(-0.05, 1.58, 0.14);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.05;
  const setL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.06), black);
  setL.position.set(-0.18, 1.6, 0.02);
  const setR = setL.clone();
  setR.position.x = 0.18;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.04), cyan);
  band.position.set(0, 1.64, 0);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), black);
  armL.position.set(-0.26, 1.12, 0);
  const armR = armL.clone();
  armR.position.x = 0.26;
  const cuffL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), cyan);
  cuffL.position.set(-0.26, 0.94, 0);
  const cuffR = cuffL.clone();
  cuffR.position.x = 0.26;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.56, 0.14), black);
  legL.position.set(-0.1, 0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.1;
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.2), cyan);
  bootL.position.set(-0.1, 0.08, 0.02);
  const bootR = bootL.clone();
  bootR.position.x = 0.1;

  group.add(hips, torso, glowL, glowR, hex, head, bangs, fringe, sideL, sideR, eyeL, eyeR, setL, setR, band, armL, armR, cuffL, cuffR, legL, legR, bootL, bootR);
  return { group, body: torso };
}

export class Target {
  id = Math.random().toString(36).slice(2, 8);
  kind: TargetKind;
  hp: number;
  maxHp: number;
  group = new THREE.Group();
  body: THREE.Mesh;
  glow: THREE.PointLight;
  laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff5ad5, transparent: true, opacity: 0 }));
  slot = SLOTS[0];
  hide = new THREE.Vector3();
  peek = new THREE.Vector3();
  age = 0;
  windup = 0;
  cooldown = 1.4;
  moving = true;
  t = 0;
  alive = true;
  flash = 0;
  notice = 0.2;
  lockedAim?: THREE.Vector3;
  speed = 3.4;
  spit = new THREE.Object3D();
  mixer: THREE.AnimationMixer | null = null;
  hunterId = "";

  constructor(kind: TargetKind, slot: (typeof SLOTS)[number], hp: number, robot?: THREE.Object3D, mixer: THREE.AnimationMixer | null = null) {
    this.kind = kind;
    this.hp = hp;
    this.maxHp = hp;
    this.slot = slot;
    this.peek = new THREE.Vector3(...slot.pos);
    this.hide = this.peek.clone();
    const model = robot ?? runnerModel().group;
    this.mixer = mixer;
    this.group = new THREE.Group();
    this.group.name = "hunter";
    this.group.add(model);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.9;
    hit.name = "hitBody";
    this.body = hit;
    this.group.add(hit);
    this.spit.position.set(0, 1.45, 0.38);
    this.group.add(this.spit);
    this.glow = new THREE.PointLight(0xff66d2, 0.2, 6);
    this.glow.position.set(0, 1.4, 0.2);
    this.group.add(this.glow);
    this.group.position.copy(this.peek);
    this.speed = kind === "armoured" ? 2.6 : kind === "moving" ? 4.4 : 3.3;
  }

  spitOrigin() {
    const origin = new THREE.Vector3();
    this.spit.getWorldPosition(origin);
    return origin;
  }

  occupy(target: THREE.Vector3, dt: number) {
    this.chase(target, dt);
  }

  chase(player: THREE.Vector3, dt: number) {
    const to = player.clone().sub(this.group.position);
    to.y = 0;
    const dist = to.length();
    if (dist > 3.2 && dist < 40) {
      to.normalize();
      this.group.position.x += to.x * this.speed * dt;
      this.group.position.z += to.z * this.speed * dt;
    } else if (dist < 2.2) {
      to.normalize();
      this.group.position.x -= to.x * this.speed * 0.55 * dt;
      this.group.position.z -= to.z * this.speed * 0.55 * dt;
    }
    this.group.position.y = 0;
    const look = player.clone();
    look.y = 1.2;
    this.group.lookAt(look);
    this.mixer?.update(dt);
  }
}

export class Paintball {
  mesh: THREE.Mesh;
  velocity = new THREE.Vector3();
  life = 2.8;
  fromEnemy: boolean;
  color: number;
  spent = false;
  near = false;

  constructor(color: number, fromEnemy: boolean) {
    this.color = color;
    this.fromEnemy = fromEnemy;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(fromEnemy ? 0.13 : 0.06, 8, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }));
  }
}

export class CollisionManager {
  hitTarget(origin: THREE.Vector3, direction: THREE.Vector3, targets: Target[]) {
    const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0.15, 48);
    const hits = ray.intersectObjects(targets.filter((item) => item.alive).map((item) => item.group), true);
    if (!hits[0]) return null;
    const matched = targets.find((item) => {
      let found = false;
      item.group.traverse((child) => {
        if (child === hits[0].object) found = true;
      });
      return found;
    });
    if (!matched) return null;
    return { target: matched, point: hits[0].point, normal: hits[0].face?.normal.clone() ?? new THREE.Vector3(0, 0, 1), center: hits[0].point.y > matched.group.position.y + 1.4 };
  }

  hitWorld(origin: THREE.Vector3, direction: THREE.Vector3, world: THREE.Object3D[]) {
    const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0.12, 80);
    const hits = ray.intersectObjects(world, true);
    return hits[0] ?? null;
  }
}

export class PaintSurfaceManager {
  private group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private next = 0;
  coverageCells = new Set<string>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (let i = 0; i < 140; i += 1) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.28, 10), new THREE.MeshBasicMaterial({ color: 0x3cf0ff, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push(mesh);
    }
  }

  splat(point: THREE.Vector3, normal: THREE.Vector3, color: number) {
    const mesh = this.pool[this.next % this.pool.length];
    this.next += 1;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    const n = normal.clone().normalize();
    mesh.position.copy(point).addScaledVector(n, 0.03);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    mesh.rotateZ(Math.random() * Math.PI);
    mesh.scale.setScalar(0.8 + Math.random() * 1.1);
    mesh.visible = true;
    const key = `${Math.round(point.x * 2)}:${Math.round(point.y * 2)}:${Math.round(point.z * 2)}:${color}`;
    const fresh = !this.coverageCells.has(key);
    this.coverageCells.add(key);
    return fresh;
  }

  get coverage() {
    return Math.min(1, this.coverageCells.size / 80);
  }

  reset() {
    this.coverageCells.clear();
    this.pool.forEach((mesh) => {
      mesh.visible = false;
    });
    this.next = 0;
  }
}
