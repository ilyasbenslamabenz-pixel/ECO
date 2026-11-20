/**
 * Scène 3D : rendu WebGL, ciel, soleil avec ombres (boîte d'ombre réglée sur le quartier), brouillard léger,
 * caméra de gestion (reprise de Meknes City), quartier et passants. Rendu à la demande de la boucle principale.
 */
import * as THREE from 'three';
import { CameraController } from '../input/camera';
import type { District } from '../sim/district';
import { DistrictView } from './district-view';
import { People } from './people';

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: CameraController;
  readonly view: DistrictView;
  readonly people: People;
  private readonly raycaster = new THREE.Raycaster();

  constructor(readonly canvas: HTMLCanvasElement, district: District) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0xa9cbe6);
    this.scene.fog = new THREE.Fog(0xa9cbe6, 700, 1900);
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);

    const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6c6a5a, 1.5);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    const half = Math.max(district.size.w, district.size.d) / 2 + 30;
    sun.position.set(-260, 420, 180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -half; sun.shadow.camera.right = half; sun.shadow.camera.top = half; sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 50; sun.shadow.camera.far = 1200;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
    this.scene.add(sun);

    this.view = new DistrictView(district);
    this.scene.add(this.view.group);
    this.people = new People(district);
    this.scene.add(this.people.mesh);

    this.controls = new CameraController(this.camera, canvas, () => 0);
    this.controls.bounds = { minX: -district.size.w / 2 - 60, minZ: -district.size.d / 2 - 60, maxX: district.size.w / 2 + 60, maxZ: district.size.d / 2 + 60 };
    this.controls.setPose({ targetX: 0, targetY: 0, targetZ: 0, distance: 380, yaw: 0.55 });
    this.controls.setHome();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Rayon depuis un point du canevas (pixels CSS, origine en haut à gauche du canevas). */
  ray(sx: number, sy: number): THREE.Raycaster {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1), this.camera);
    return this.raycaster;
  }

  frame(dt: number): void {
    this.controls.update(dt);
    this.people.update(dt);
    this.view.updateLabels(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
