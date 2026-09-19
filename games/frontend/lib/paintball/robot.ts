import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export type HunterId = "alien" | "zombie" | "evil" | "junkyard";

export type HunterSpec = {
  id: HunterId;
  label: string;
  url: string;
  dir: string;
  height: number;
  speed: number;
  hp: number;
};

export const HUNTER_SPECS: HunterSpec[] = [
  { id: "alien", label: "ALIEN RUNNER", url: "/paintball/hunters/alien/model.fbx", dir: "/paintball/hunters/alien/", height: 1.9, speed: 4.6, hp: 2 },
  { id: "zombie", label: "FANTASY ZOMBIE", url: "/paintball/hunters/zombie/model.fbx", dir: "/paintball/hunters/zombie/", height: 1.85, speed: 3.1, hp: 3 },
  { id: "evil", label: "EVIL ROBOT", url: "/paintball/hunters/evil/model.fbx", dir: "/paintball/hunters/evil/", height: 1.8, speed: 3.8, hp: 2 },
  { id: "junkyard", label: "JUNKYARD R5", url: "/paintball/hunters/junkyard/model.fbx", dir: "/paintball/hunters/junkyard/", height: 1.25, speed: 3.5, hp: 2 }
];

export type HunterTemplate = {
  spec: HunterSpec;
  root: THREE.Group;
  clips: THREE.AnimationClip[];
};

export type HunterInstance = {
  spec: HunterSpec;
  model: THREE.Group;
  mixer: THREE.AnimationMixer | null;
};

function textureUrl(dir: string, fallback: string) {
  return (url: string) => {
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    if (url.includes(".fbx") || url.includes(".glb")) return fallback;
    const base = decodeURIComponent(url.split(/[?#]/)[0].split(/[\\/]/).pop() || url);
    return `${dir}${encodeURIComponent(base)}`;
  };
}

function boxOf(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function paintHunter(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.SkinnedMesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;
    child.userData.paintable = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      if ("map" in material && material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = 8;
      }
    }
  });
}

export function fitHunter(model: THREE.Object3D, height = 1.85) {
  paintHunter(model);
  const extras: THREE.Object3D[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Light || child instanceof THREE.Camera) extras.push(child);
    if (child instanceof THREE.Mesh) {
      child.geometry?.computeBoundingBox();
      child.geometry?.computeBoundingSphere();
    }
  });
  extras.forEach((child) => child.parent?.remove(child));
  model.updateMatrixWorld(true);
  let box = boxOf(model);
  let size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(THREE.MathUtils.clamp(height / Math.max(size.y, 0.001), 0.002, 6));
  model.updateMatrixWorld(true);
  box = boxOf(model);
  size = box.getSize(new THREE.Vector3());
  if (size.y > 2.3 || size.y < 0.6) {
    model.scale.multiplyScalar(height / Math.max(size.y, 0.001));
    model.updateMatrixWorld(true);
    box = boxOf(model);
  }
  model.position.x -= (box.min.x + box.max.x) * 0.5;
  model.position.z -= (box.min.z + box.max.z) * 0.5;
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);
  return model;
}

function loadFbx(url: string, dir: string) {
  return new Promise<THREE.Group>((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(textureUrl(dir, url));
    const loader = new FBXLoader(manager);
    loader.setResourcePath(dir);
    loader.load(url, (group) => (group ? resolve(group) : reject(new Error("empty hunter"))), undefined, reject);
  });
}

export async function loadHunterTemplates(): Promise<HunterTemplate[]> {
  const results = await Promise.allSettled(
    HUNTER_SPECS.map(async (spec) => {
      const root = await loadFbx(spec.url, spec.dir);
      fitHunter(root, spec.height);
      root.name = `hunter-${spec.id}`;
      return { spec, root, clips: root.animations?.slice() ?? [] } satisfies HunterTemplate;
    })
  );
  const loaded: HunterTemplate[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") loaded.push(result.value);
    else console.warn(`Hunter ${HUNTER_SPECS[index].id} failed to load.`, result.reason);
  });
  return loaded;
}

export function instanceHunter(template: HunterTemplate): HunterInstance {
  const model = cloneSkinned(template.root) as THREE.Group;
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) child.material = child.material.map((material) => material?.clone());
    else if (child.material) child.material = child.material.clone();
  });
  let mixer: THREE.AnimationMixer | null = null;
  if (template.clips.length) {
    mixer = new THREE.AnimationMixer(model);
    const clip = template.clips.find((item) => /run|walk|jog/i.test(item.name)) ?? template.clips[0];
    const action = mixer.clipAction(clip);
    action.play();
  }
  return { spec: template.spec, model, mixer };
}

export function unlockedHunterIds(aliveWanted: number): HunterId[] {
  if (aliveWanted <= 1) return ["alien"];
  if (aliveWanted === 2) return ["alien", "zombie"];
  if (aliveWanted === 3) return ["alien", "zombie", "evil"];
  return ["alien", "zombie", "evil", "junkyard"];
}
