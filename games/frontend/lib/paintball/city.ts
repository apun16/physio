import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type Collider = { min: THREE.Vector3; max: THREE.Vector3 };

export type CityDistrict = {
  root: THREE.Group;
  colliders: Collider[];
  spawn: THREE.Vector3;
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

function stripHelpers(model: THREE.Object3D) {
  const extras: THREE.Object3D[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Light || child instanceof THREE.Camera) extras.push(child);
  });
  extras.forEach((child) => child.parent?.remove(child));
}

function paintMesh(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // The district is three full FBX blocks (~2.4k meshes). Casting shadows from
    // all of them doubled every frame into a second pass, and disabling culling
    // meant the whole district drew even when it was behind the camera.
    child.castShadow = false;
    child.receiveShadow = true;
    child.frustumCulled = true;
    child.userData.paintable = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      if ("map" in material && material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = 8;
      }
      if ("side" in material) material.side = THREE.DoubleSide;
    }
  });
}

export function streetBounds(root: THREE.Object3D) {
  const found = { box: null as THREE.Box3 | null, area: 0 };
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const meshBox = new THREE.Box3().setFromObject(child);
    if (meshBox.isEmpty()) return;
    const meshSize = meshBox.getSize(new THREE.Vector3());
    if (meshSize.y > 2.6) return;
    const area = meshSize.x * meshSize.z;
    if (area < 60 || area <= found.area) return;
    found.area = area;
    found.box = meshBox.clone();
  });
  return found.box;
}

function corridorX(root: THREE.Object3D) {
  const box = boxOf(root);
  const width = Math.max(1, box.max.x - box.min.x);
  const bins = 48;
  const occ = new Array<number>(bins).fill(0);
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const meshBox = new THREE.Box3().setFromObject(child);
    if (meshBox.isEmpty()) return;
    const size = meshBox.getSize(new THREE.Vector3());
    if (size.y < 4.5) return;
    const i0 = Math.max(0, Math.floor(((meshBox.min.x - box.min.x) / width) * bins));
    const i1 = Math.min(bins - 1, Math.floor(((meshBox.max.x - box.min.x) / width) * bins));
    for (let i = i0; i <= i1; i += 1) occ[i] += size.z;
  });
  const streetBins = THREE.MathUtils.clamp(Math.round((14 / width) * bins), 3, 12);
  const mid = (box.min.x + box.max.x) * 0.5;
  let bestAt = Math.floor((bins - streetBins) * 0.5);
  let bestScore = Number.POSITIVE_INFINITY;
  const pad = Math.max(4, Math.floor(bins * 0.16));
  for (let i = pad; i <= bins - streetBins - pad; i += 1) {
    let sum = 0;
    for (let j = 0; j < streetBins; j += 1) sum += occ[i + j];
    const left = occ[i - 1] + occ[i - 2];
    const right = occ[i + streetBins] + occ[i + streetBins + 1];
    if (left < sum * 0.55 || right < sum * 0.55) continue;
    const x = box.min.x + ((i + streetBins * 0.5) / bins) * width;
    const score = sum + Math.abs(x - mid) * 8;
    if (score < bestScore) {
      bestScore = score;
      bestAt = i;
    }
  }
  return box.min.x + ((bestAt + streetBins * 0.5) / bins) * width;
}

function recenterOn(model: THREE.Object3D, box: THREE.Box3, sitY = true) {
  model.position.x -= (box.min.x + box.max.x) * 0.5;
  model.position.z -= (box.min.z + box.max.z) * 0.5;
  if (sitY) model.position.y -= box.max.y;
  model.updateMatrixWorld(true);
}

function sitGroup(model: THREE.Object3D) {
  const box = boxOf(model);
  if (box.min.y > 0.04) {
    model.position.y -= box.min.y;
    model.updateMatrixWorld(true);
  }
}

function dropFloatingMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  for (const mesh of meshes) {
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    if (size.y < 5 || size.x < 3.2 || size.z < 3.2) continue;
    if (box.min.y <= 0.22 || box.min.y > 12) continue;
    const parentScale = new THREE.Vector3(1, 1, 1);
    mesh.parent?.getWorldScale(parentScale);
    mesh.position.y -= box.min.y / Math.max(parentScale.y, 0.001);
    mesh.updateMatrixWorld(true);
  }
}

function fitStreetBlock(model: THREE.Group, targetHeight = 22) {
  stripHelpers(model);
  paintMesh(model);
  model.updateMatrixWorld(true);
  const size = boxOf(model).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(targetHeight / Math.max(size.y, 0.001));
  model.updateMatrixWorld(true);

  const grounded = boxOf(model);
  model.position.y -= grounded.min.y;
  model.updateMatrixWorld(true);

  let street = streetBounds(model);
  if (street) {
    const span = street.getSize(new THREE.Vector3());
    if (span.x > span.z * 1.12) {
      model.rotation.y += Math.PI / 2;
      model.updateMatrixWorld(true);
      street = streetBounds(model);
    }
  }
  if (street) recenterOn(model, street, true);
  else {
    const box = boxOf(model);
    model.position.x -= (box.min.x + box.max.x) * 0.5;
    model.position.z -= (box.min.z + box.max.z) * 0.5;
    model.updateMatrixWorld(true);
  }
  return model;
}

function placeAlongZ(moving: THREE.Object3D, stationary: THREE.Object3D, side: 1 | -1, gap: number) {
  const stay = boxOf(stationary);
  const move = boxOf(moving);
  if (side > 0) moving.position.z += stay.max.z + gap - move.min.z;
  else moving.position.z += stay.min.z - gap - move.max.z;
  moving.updateMatrixWorld(true);
}

function joinStreetEnd(moving: THREE.Object3D, host: THREE.Object3D, side: 1 | -1, gap: number) {
  const hostRoad = streetBounds(host) ?? boxOf(host);
  const hostMidX = (hostRoad.min.x + hostRoad.max.x) * 0.5;
  moving.position.x += hostMidX - corridorX(moving);
  moving.updateMatrixWorld(true);
  const moveRoad = streetBounds(moving) ?? boxOf(moving);
  if (side > 0) moving.position.z += hostRoad.max.z + gap - moveRoad.min.z;
  else moving.position.z += hostRoad.min.z - gap - moveRoad.max.z;
  moving.updateMatrixWorld(true);
}

function alignStreetX(moving: THREE.Object3D, stationary: THREE.Object3D) {
  const stay = streetBounds(stationary) ?? boxOf(stationary);
  const move = streetBounds(moving) ?? boxOf(moving);
  moving.position.x += (stay.min.x + stay.max.x) * 0.5 - (move.min.x + move.max.x) * 0.5;
  moving.updateMatrixWorld(true);
}

function groundMaterial(source: THREE.Object3D) {
  const found = { map: null as THREE.Texture | null, area: 0 };
  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 2.6) return;
    const area = size.x * size.z;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const map = material && "map" in material ? (material.map as THREE.Texture | null) : null;
    if (!map || area <= found.area) return;
    found.area = area;
    found.map = map;
  });
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.02, side: THREE.DoubleSide });
  if (!found.map) {
    material.color = new THREE.Color(0x7a7670);
    return material;
  }
  const map = found.map.clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  material.map = map;
  return material;
}

function makeFill(minX: number, maxX: number, minZ: number, maxZ: number, y: number, source: THREE.MeshStandardMaterial, name: string) {
  const width = Math.max(4, maxX - minX);
  const length = Math.max(4, maxZ - minZ);
  const material = source.clone();
  if (source.map) {
    const map = source.map.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(Math.max(2, width / 6.5), Math.max(2, length / 6.5));
    map.anisotropy = 8;
    map.needsUpdate = true;
    material.map = map;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((minX + maxX) * 0.5, y, (minZ + maxZ) * 0.5);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.paintable = true;
  mesh.name = name;
  return mesh;
}

function makeRoad(x: number, z0: number, z1: number, width: number) {
  const length = Math.max(1.6, Math.abs(z1 - z0));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ color: 0x5c5a56, roughness: 0.96, metalness: 0.02 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.02, (z0 + z1) * 0.5);
  mesh.receiveShadow = true;
  mesh.userData.paintable = true;
  mesh.name = "connectorRoad";
  return mesh;
}

export function cityColliders(root: THREE.Object3D): Collider[] {
  root.updateMatrixWorld(true);
  const whole = boxOf(root);
  const span = whole.getSize(new THREE.Vector3());
  const colliders: Collider[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    if (size.y < 1.4) return;
    if (box.min.y > 1.15) return;
    if (size.x < 0.7 && size.z < 0.7) return;
    if (size.x > span.x * 0.72 && size.z > span.z * 0.72) return;
    colliders.push({ min: box.min.clone(), max: box.max.clone() });
  });
  return colliders;
}

function loadFbx(url: string, dir: string) {
  return new Promise<THREE.Group>((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(textureUrl(dir, url));
    const loader = new FBXLoader(manager);
    loader.setResourcePath(dir);
    loader.load(url, (group) => (group ? resolve(group) : reject(new Error("empty fbx"))), undefined, reject);
  });
}

export async function loadCityDistrict(): Promise<CityDistrict> {
  const root = new THREE.Group();
  root.name = "cityDistrict";

  const cityA = fitStreetBlock(await loadFbx("/paintball/city/city.fbx", "/paintball/city/"), 22);
  cityA.name = "streetA";
  sitGroup(cityA);
  dropFloatingMeshes(cityA);
  root.add(cityA);

  const extra = await Promise.allSettled([
    loadFbx("/paintball/city8/city.fbx", "/paintball/city8/"),
    loadFbx("/paintball/ruins/city.fbx", "/paintball/ruins/")
  ]);

  if (extra[0].status === "fulfilled") {
    const cityB = fitStreetBlock(extra[0].value, 22);
    cityB.name = "streetB";
    alignStreetX(cityB, cityA);
    placeAlongZ(cityB, cityA, 1, 4.8);
    sitGroup(cityB);
    dropFloatingMeshes(cityB);
    root.add(cityB);
    const boxA = boxOf(cityA);
    const boxB = boxOf(cityB);
    const streetA = streetBounds(cityA);
    const width = streetA ? THREE.MathUtils.clamp(streetA.max.x - streetA.min.x, 12, 20) : 14;
    root.add(makeRoad(0, boxA.max.z - 0.5, boxB.min.z + 0.5, width));
  } else {
    console.warn("City block 8 failed to load.", extra[0].reason);
  }

  if (extra[1].status === "fulfilled") {
    const ruins = fitStreetBlock(extra[1].value, 22);
    ruins.name = "ruins";
    joinStreetEnd(ruins, cityA, -1, 1.4);
    // Visual tune: the ruined-city avenue sits east of the cobblestone center.
    ruins.position.x -= 6;
    ruins.updateMatrixWorld(true);
    sitGroup(ruins);
    dropFloatingMeshes(ruins);
    root.add(ruins);
  } else {
    console.warn("Ruined city block failed to load.", extra[1].reason);
  }

  const cobble = groundMaterial(cityA);
  const union = boxOf(root);
  const pad = 36;
  root.add(makeFill(union.min.x - pad, union.max.x + pad, union.min.z - pad, union.max.z + pad, -0.05, cobble, "groundFill"));
  const streetA = streetBounds(cityA);
  const ruins = root.getObjectByName("ruins");
  if (streetA && ruins) {
    const ruinsBox = boxOf(ruins);
    root.add(
      makeFill(
        Math.min(streetA.min.x, ruinsBox.min.x) - 22,
        Math.max(streetA.max.x, ruinsBox.max.x) + 22,
        Math.min(streetA.min.z, ruinsBox.min.z) - 10,
        Math.max(streetA.min.z, ruinsBox.max.z) + 18,
        0.01,
        cobble,
        "seamFill"
      )
    );
  }

  const colliders: Collider[] = [];
  root.children.forEach((child) => {
    if (child.name === "connectorRoad" || child.name === "groundFill" || child.name === "seamFill") return;
    colliders.push(...cityColliders(child));
  });

  const spawn = new THREE.Vector3(0, 1.6, THREE.MathUtils.clamp(boxOf(cityA).max.z * 0.18, 4, 14));
  return { root, colliders, spawn };
}

export function loadCityStreet(): Promise<THREE.Group> {
  return loadFbx("/paintball/city/city.fbx", "/paintball/city/").then((group) => fitStreetBlock(group, 22));
}
