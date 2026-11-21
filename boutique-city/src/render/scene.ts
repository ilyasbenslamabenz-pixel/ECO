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
import { StreetLife } from './life';
import { PlayerVehicles, Traffic } from './vehicles3d';

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly street = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: FollowCamera;
  readonly view: DistrictView;
  readonly people: People;
  readonly traffic: Traffic;
  readonly life: StreetLife;
  readonly vehicles = new PlayerVehicles();
  readonly player = new Humanoid(PLAYER_LOOK);
  readonly collider: Collider;
  private readonly sun: THREE.DirectionalLight;
  private readonly beacon: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  interior: { view: InteriorView; agents: InteriorAgents | null } | null = null;
  private readonly hemi = new THREE.HemisphereLight(0xdfeeff, 0x6c6a5a, 1.5);
  /** Quatre lampes réelles, placées sur les lampadaires les plus proches du joueur la nuit. */
  private readonly lamps: THREE.PointLight[] = [];
  private night = 0;
  private lampTimer = 0;
  private readonly daySky = new THREE.Color(0xa9cbe6);
  private readonly duskSky = new THREE.Color(0xe8a070);
  private readonly nightSky = new THREE.Color(0x0e1626);
  private readonly greySky = new THREE.Color(0x8d98a3);
  /** Couverture nuageuse 0..1 (1 = pluie) et averse : gouttes autour de la caméra. */
  private cloud = 0;
  private rain: THREE.LineSegments | null = null;
  private rainOn = false;

  /** Météo du jour : soleil, nuages ou pluie (ciel, lumière, brouillard, pluie). */
  setWeather(w: 'soleil' | 'nuages' | 'pluie'): void {
    this.cloud = w === 'pluie' ? 1 : w === 'nuages' ? 0.45 : 0;
    this.rainOn = w === 'pluie';
    if (this.rainOn && !this.rain) {
      const n = 2600, pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70;
        pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0.45 }));
      this.rain.frustumCulled = false;
      this.street.add(this.rain);
    }
    if (this.rain) this.rain.visible = this.rainOn;
  }

  /**
   * Heure du jour (minutes depuis minuit) : soleil, ciel, brouillard et lumière ambiante suivent le cycle ; la nuit,
   * globes des lampadaires et portes vitrées s'allument et quatre vraies lampes éclairent les abords du joueur.
   */
  setTime(minute: number): void {
    const h = minute / 60;
    // 0 la nuit, 1 en plein jour ; aube 5 h 30 – 7 h 30, crépuscule 19 h – 21 h.
    const day = h < 5.5 || h > 21 ? 0 : h < 7.5 ? (h - 5.5) / 2 : h > 19 ? (21 - h) / 2 : 1;
    const dusk = Math.max(0, 1 - Math.abs(day - 0.45) * 2.2) * (day > 0 && day < 1 ? 1 : 0);
    this.night = 1 - day;
    const wet = this.cloud;
    this.sun.intensity = (0.15 + 2.45 * day) * (1 - 0.55 * wet);
    this.sun.color.setRGB(1, 0.85 + 0.1 * day, 0.7 + 0.2 * day);
    this.hemi.intensity = 0.35 + 1.15 * day;
    const sky = this.nightSky.clone().lerp(this.daySky, day).lerp(this.duskSky, dusk * 0.6).lerp(this.greySky.clone().multiplyScalar(0.25 + 0.75 * day), wet * 0.75);
    (this.street.fog as THREE.Fog).near = 160 - 110 * wet; (this.street.fog as THREE.Fog).far = 620 - 330 * wet;
    (this.street.background as THREE.Color).copy(sky);
    (this.street.fog as THREE.Fog).color.copy(sky);
    this.renderer.toneMappingExposure = 0.85 + 0.2 * day;
    this.view.setNight(this.night);
  }
  /** Caméra de rue mémorisée pendant la visite d'un intérieur. */
  private streetCam = { yaw: 0, pitch: 0, dist: 0 };

  constructor(readonly canvas: HTMLCanvasElement, district: District) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.street.background = new THREE.Color(0xa9cbe6);
    this.street.fog = new THREE.Fog(0xa9cbe6, 160, 620);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);

    this.street.add(this.hemi);
    for (let k = 0; k < 3; k++) { const l = new THREE.PointLight(0xffd9a0, 0, 22, 1.6); this.lamps.push(l); this.street.add(l); }
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
    this.life = new StreetLife(district);
    this.street.add(this.life.group);
    this.street.add(this.vehicles.group);
    this.player.group.traverse((c) => { c.castShadow = true; });
    this.street.add(this.player.group);
    this.collider = Collider.fromDistrict(district);
    for (const r of this.view.parkedRects) this.collider.add(r);

    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 20, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.visible = false;
    this.street.add(this.beacon);

    this.cam = new FollowCamera(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Niveau de qualité : 0 = basse (résolution 1, pas d'ombres), 1 = moyenne, 2 = haute. */
  quality = 2;
  setQuality(level: number): void {
    this.quality = Math.max(0, Math.min(2, level));
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio([1, Math.min(1.25, dpr), Math.min(1.75, dpr)][this.quality]!);
    this.renderer.shadowMap.enabled = this.quality > 0;
    this.sun.castShadow = this.quality > 0;
    const size = this.quality === 2 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.resize();
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
    this.life.update(dt, focus);
    this.view.updateLabels(this.camera, dt);
    if ((this.lampTimer -= dt) <= 0) {
      this.lampTimer = 0.5;
      const near = this.view.lightPoints.map((p) => ({ p, d: p.distanceToSquared(focus) })).sort((a, b) => a.d - b.d).slice(0, this.lamps.length);
      this.lamps.forEach((l, k) => { const n = near[k]; if (n) l.position.copy(n.p).setY(4.6); l.intensity = this.night > 0.3 ? 40 * this.night : 0; });
    }
    if (this.rain && this.rainOn) {
      this.rain.position.set(focus.x, 0, focus.z);
      const a = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute, arr = a.array as Float32Array;
      const fall = 26 * dt;
      for (let i = 1; i < arr.length; i += 6) { arr[i]! -= fall; arr[i + 3]! -= fall; if (arr[i]! < 0) { arr[i]! += 40; arr[i + 3]! += 40; } }
      a.needsUpdate = true;
    }
    this.renderer.render(this.street, this.camera);
  }
}
