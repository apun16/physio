import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";

const GUN_URL = "/paintball/gun/model.dae";
const TEX = "/paintball/gun";

function loadMap(file: string, srgb = false) {
  const texture = new THREE.TextureLoader().load(`${TEX}/${file}`);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function gunMaterial() {
  return new THREE.MeshStandardMaterial({
    map: loadMap("openPBR_shader1_albedo.jpg", true),
    normalMap: loadMap("openPBR_shader1_normal.png"),
    roughnessMap: loadMap("openPBR_shader1_roughness.jpg"),
    metalnessMap: loadMap("openPBR_shader1_metallic.jpg"),
    aoMap: loadMap("openPBR_shader1_AO.jpg"),
    roughness: 1,
    metalness: 1
  });
}

function applyMaterial(root: THREE.Object3D, material: THREE.MeshStandardMaterial) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    if (geometry.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute("uv2", geometry.attributes.uv);
    child.material = material;
    child.castShadow = true;
    child.frustumCulled = false;
  });
}

function frameBox(parts: Array<THREE.Object3D | undefined | null>) {
  const box = new THREE.Box3();
  for (const part of parts) {
    if (!part) continue;
    part.updateMatrixWorld(true);
    box.expandByObject(part);
  }
  return box;
}

export function fitGunForFirstPerson(model: THREE.Object3D) {
  const wrapper = new THREE.Group();
  wrapper.name = "assetGun";
  wrapper.add(model);

  // Asset barrel runs +Z with the hopper on +Y. Camera looks down -Z.
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);

  const muzzle = model.getObjectByName("Muzzle");
  const body = model.getObjectByName("Gun") ?? model;
  const grip = model.getObjectByName("Grip");
  // Frame on the marker body, not the hopper AABB — centering on Pellet_Box
  // plants the purple tank in the lens and hides the black barrel.
  let frame = frameBox([body, muzzle, grip]);
  const size = frame.getSize(new THREE.Vector3());
  wrapper.scale.setScalar(0.5 / Math.max(size.z, 0.001));
  wrapper.updateMatrixWorld(true);

  frame = frameBox([body, muzzle, grip]);
  wrapper.position.sub(frame.getCenter(new THREE.Vector3()));
  // Strong yaw so we see the left side of the muzzle cylinder. A rear view
  // is just the hopper; the 56cm barrel sits in front of it and is occluded.
  wrapper.rotation.set(-0.12, 0.58, 0.1);
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

export function loadPaintballGun(): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new ColladaLoader();
    loader.load(
      GUN_URL,
      (collada) => {
        if (!collada) {
          reject(new Error("empty collada"));
          return;
        }
        applyMaterial(collada.scene, gunMaterial());
        resolve(fitGunForFirstPerson(collada.scene));
      },
      undefined,
      (error) => reject(error)
    );
  });
}
