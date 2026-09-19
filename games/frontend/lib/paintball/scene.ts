import * as THREE from "three";
import { loadCityDistrict } from "./city";
import { loadPaintballGun } from "./gun";
import { instanceHunter, loadHunterTemplates, type HunterId, type HunterTemplate } from "./robot";

export type Collider = { min: THREE.Vector3; max: THREE.Vector3 };

export class PaintballScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 1, 0.02, 640);
  blaster = new THREE.Group();
  muzzle = new THREE.Object3D();
  flash: THREE.Mesh;
  world: THREE.Object3D[] = [];
  colliders: Collider[] = [];
  sign: THREE.Object3D = new THREE.Group();
  spawn = new THREE.Vector3(0, 1.6, 12);
  playMin = new THREE.Vector3(-36, 0, -36);
  playMax = new THREE.Vector3(36, 8, 36);
  hunterTemplates: HunterTemplate[] = [];
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x7ec4e8, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog(0x8aa0c8, 140, 480);
    this.camera.position.copy(this.spawn);
    this.buildWorld();
    this.mountSky();
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0x9bfff4, transparent: true, opacity: 0 }));
    this.muzzle.position.set(0.02, 0.02, -0.38);
    const placeholder = this.buildBlaster();
    placeholder.name = "placeholder";
    this.blaster.add(placeholder, this.flash, this.muzzle);
    this.blaster.position.set(0.28, -0.12, -0.42);
    this.blaster.rotation.set(0, 0, 0);
    this.camera.add(this.blaster);
    this.scene.add(this.camera);
    this.flash.position.copy(this.muzzle.position);
    void this.mountAssetGun();
    void this.mountCity();
    void this.mountRobot();
  }

  private mountSky() {
    const texture = new THREE.TextureLoader().load("/paintball/sky/background.jpg");
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = texture;
  }

  private async mountAssetGun() {
    try {
      const gun = await loadPaintballGun();
      const placeholder = this.blaster.getObjectByName("placeholder");
      if (placeholder) this.blaster.remove(placeholder);
      this.blaster.add(gun);
      gun.updateMatrixWorld(true);
      const muzzleMesh = gun.getObjectByName("Muzzle");
      if (muzzleMesh) {
        const tip = new THREE.Vector3();
        muzzleMesh.getWorldPosition(tip);
        this.muzzle.position.copy(this.blaster.worldToLocal(tip));
      } else {
        const box = new THREE.Box3().setFromObject(gun);
        const min = this.blaster.worldToLocal(box.min.clone());
        const max = this.blaster.worldToLocal(box.max.clone());
        this.muzzle.position.set((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, Math.min(min.z, max.z) - 0.02);
      }
      this.flash.position.copy(this.muzzle.position);
    } catch (error) {
      console.warn("Paintball gun asset failed to load; keeping placeholder.", error);
    }
  }

  private async mountRobot() {
    try {
      this.hunterTemplates = await loadHunterTemplates();
    } catch (error) {
      console.warn("Hunter assets failed to load.", error);
    }
  }

  makeHunter(kind?: HunterId) {
    const pool = kind ? this.hunterTemplates.filter((item) => item.spec.id === kind) : this.hunterTemplates;
    const template = pool[0] ?? this.hunterTemplates[0];
    if (!template) return undefined;
    return instanceHunter(template);
  }

  private async mountCity() {
    try {
      const district = await loadCityDistrict();
      this.scene.add(district.root);
      this.world.push(district.root);
      district.root.traverse((child) => {
        if (child instanceof THREE.Mesh) this.world.push(child);
      });
      this.colliders = district.colliders;
      const box = new THREE.Box3().setFromObject(district.root);
      this.playMin.set(box.min.x, 0, box.min.z);
      this.playMax.set(box.max.x, 8, box.max.z);
      this.spawn.copy(district.spawn);
    } catch (error) {
      console.warn("City street asset failed to load.", error);
    }
  }

  private buildBlaster() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.48), new THREE.MeshBasicMaterial({ color: 0x3cf0ff }));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 10), new THREE.MeshBasicMaterial({ color: 0x7b5cff }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.4);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9bff4a }));
    tank.position.set(0.04, -0.1, 0.05);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.11), new THREE.MeshBasicMaterial({ color: 0x241433 }));
    grip.position.set(0, -0.16, 0.1);
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: 0xffef7a }));
    gauge.position.set(0.09, 0.04, -0.04);
    group.add(body, barrel, tank, grip, gauge);
    return group;
  }

  private buildWorld() {
    this.scene.add(new THREE.HemisphereLight(0xd7eaff, 0x6a5a48, 1.05));
    const sun = new THREE.DirectionalLight(0xfff1d2, 1.7);
    sun.position.set(24, 42, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xb7d4ea, 0.42));
  }

  tick(dt: number) {
    this.t += dt;
    this.blaster.position.y = -0.12 + Math.sin(this.t * 2.4) * 0.006;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
