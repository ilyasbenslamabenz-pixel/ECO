/**
 * Scène : rendu WebGL, rue (ciel, soleil dont l'ombre suit le personnage, quartier, passants, circulation,
 * véhicules du joueur, balise de destination) et intérieur courant (commerce ou logement). Le personnage du joueur
 * passe d'une scène à l'autre. Caméra à la troisième personne. Dépend de three.
 */
import * as THREE from 'three';
import type { District } from '../sim/district';
import { FollowCamera } from '../input/follow-camera';
import { Collider } from '../world/collide';
import { DistrictView } from './district-view';
import { Humanoid, PLAYER_LOOK } from './humanoid';
import type { InteriorAgents } from './interior-agents';
import type { InteriorView } from './interior-view';
import { People } from './people';
import { PlayerVehicles, Traffic } from './vehicles3d';

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly street = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: FollowCamera;
  readonly view: DistrictView;
  readonly people: People;
  readonly traffic: Traffic;
  readonly vehicles = new PlayerVehicles();
  readonly player = new Humanoid(PLAYER_LOOK);
  readonly collider: Collider;
  private readonly sun: THREE.DirectionalLight;
  private readonly beacon: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  interior: { view: InteriorView; agents: InteriorAgents | null } | null = null;
  /** Caméra de rue mémorisée pendant la visite d'un intérieur. */
  private streetCam = { yaw: 0, pitch: 0, dist: 0 };

  constructor(readonly canvas: HTMLCanvasElement, district: District) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.street.background = new THREE.Color(0xa9cbe6);
    this.street.fog = new THREE.Fog(0xa9cbe6, 160, 620);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);

    this.street.add(new THREE.HemisphereLight(0xdfeeff, 0x6c6a5a, 1.5));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 70;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 400 });
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.4;
    this.street.add(this.sun, this.sun.target);

    this.view = new DistrictView(district);
    this.street.add(this.view.group);
    this.people = new People(district);
    this.street.add(this.people.mesh);
    this.traffic = new Traffic(district);
    this.street.add(this.traffic.group);
    this.street.add(this.vehicles.group);
    this.player.group.traverse((c) => { c.castShadow = true; });
    this.street.add(this.player.group);
    this.collider = Collider.fromDistrict(district);

    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 20, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.visible = false;
    this.street.add(this.beacon);

    this.cam = new FollowCamera(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setBeacon(p: { x: number; z: number; color?: string } | null): void {
    this.beacon.visible = !!p;
    if (p) { this.beacon.position.set(p.x, 0, p.z); (this.beacon.material as THREE.MeshBasicMaterial).color.set(p.color ?? '#5fc3ff'); }
  }

  enterInterior(view: InteriorView, agents: InteriorAgents | null): void {
    this.exitInterior();
    this.interior = { view, agents };
    view.scene.add(this.player.group);
    this.streetCam = { yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist };
    Object.assign(this.cam, { yaw: 0, pitch: 0.95, dist: Math.max(view.W, view.D) * 0.95 + 2, minDist: 3, maxDist: 22, minPitch: 0.35, maxPitch: 1.45 });
  }

  exitInterior(): void {
    if (!this.interior) return;
    this.interior.view.dispose();
    this.interior = null;
    this.street.add(this.player.group);
    Object.assign(this.cam, { yaw: this.streetCam.yaw || this.cam.yaw, pitch: this.streetCam.pitch || 0.38, dist: this.streetCam.dist || 9, minDist: 2.5, maxDist: 45, minPitch: 0.05, maxPitch: 1.4 });
  }

  /** Rayon depuis un point du canevas (pixels CSS). */
  ray(sx: number, sy: number): THREE.Raycaster {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1), this.camera);
    return this.raycaster;
  }
  /** Point du sol (y = 0) sous un point du canevas. */
  groundAt(sx: number, sy: number): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    return this.ray(sx, sy).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  /** Une image : `focus` = point suivi (tête du personnage ou véhicule). */
  frame(dt: number, focus: THREE.Vector3, snap = false): void {
    if (this.interior) {
      this.cam.apply(this.camera, focus, dt, undefined, snap);
      this.interior.view.updateCutaway(this.camera, snap ? 1 : dt);
      this.renderer.render(this.interior.view.scene, this.camera);
      return;
    }
    this.cam.apply(this.camera, focus, dt, (a, b) => this.collider.clearFraction(a.x, a.y, a.z, b.x, b.y, b.z), snap);
    this.sun.position.set(focus.x - 90, 160, focus.z + 60);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.people.update(dt);
    this.view.updateLabels(this.camera, dt);
    this.renderer.render(this.street, this.camera);
  }
}
