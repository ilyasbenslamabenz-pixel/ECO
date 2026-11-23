/**
 * Scène : rendu WebGL, rue (ciel, soleil qui suit sa course et dont l'ombre suit le personnage, quartier, passants,
 * circulation, véhicules du joueur, balise de destination) et intérieur courant (commerce ou logement). Le
 * personnage du joueur passe d'une scène à l'autre. Caméra à la troisième personne.
 * Quatre qualités (setQuality) : basse (résolution 1, sans ombres, FXAA), moyenne (ombres 1024), haute et ultra
 * (éclairage d'environnement calculé depuis le ciel, ciel détaillé, ombres douces élargies vers la vue, puis
 * post-traitement : occlusion ambiante, halo des lumières, brume, étalonnage, vignettage ; voir post.ts).
 * Dépend de three.
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
import { FXAA_FRAG, FXAA_VERT, PostFX, canRender, defaultPostParams } from './post';
import { AnalyticEnv, SkyDome, makeSkyState } from './sky';

// Ombres douces (PCF) : estompées sur les derniers 6 % de la carte au lieu de s'arrêter net à son bord.
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
  'return mix( 1.0, shadow, shadowIntensity );',
  'vec2 shadowEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );\n\t\t\treturn mix( 1.0, shadow, shadowIntensity * smoothstep( 0.0, 0.06, min( shadowEdge.x, shadowEdge.y ) ) );',
);

/**
 * Couleur d'affichage (sRGB, telle qu'on veut la voir à l'écran) → valeur de scène avant le tone mapping ACES de three
 * et l'exposition donnée : la luminance passe par l'inverse de la courbe RRT/ODT, la teinte est gardée (inverser
 * canal par canal ferait exploser les couleurs vives). Sert au ciel et à la brume, pour qu'ils aient la teinte voulue
 * quel que soit le chemin de rendu.
 */
function displayToScene(hex: number, exposure: number, out = new THREE.Color()): THREE.Color {
  out.setHex(hex);
  const l = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b, y = Math.min(0.96, Math.max(1e-4, l));
  const a = 1 - 0.983729 * y, b = 0.0245786 - 0.432951 * y, c = 0.000090537 + 0.238081 * y;
  const L = ((-b + Math.sqrt(b * b + 4 * a * c)) / (2 * a)) * (0.6 / exposure);
  return out.multiplyScalar(L / Math.max(1e-4, l));
}
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Couleurs d'affichage du zénith et de l'horizon : nuit, plein jour, crépuscule, temps couvert. */
const SKY_ZENITH = [0x070e22, 0x3a7fd8, 0x56609e, 0x9aa5b0] as const;
const SKY_HORIZON = [0x1d2b48, 0xb8d6f2, 0xf7a36e, 0xc6cdd4] as const;

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
  /** Balise de destination : colonne lumineuse, doublée d'une colonne pâle dessinée par-dessus les murs. */
  private readonly beacon = new THREE.Group();
  private beaconT = 0;
  private readonly raycaster = new THREE.Raycaster();
  interior: { view: InteriorView; agents: InteriorAgents | null } | null = null;
  private readonly hemi = new THREE.HemisphereLight(0xdfeeff, 0x6c6a5a, 1.5);
  /** Quatre lampes réelles, placées sur les lampadaires les plus proches du joueur la nuit. */
  private readonly lamps: THREE.PointLight[] = [];
  private night = 0;
  private day = 1;
  private dusk = 0;
  private lampTimer = 0;
  /** Shaders « lampes allumées » déjà compilés ? */
  private lampsWarm = false;
  /** Ciel (dôme), son état (couleurs, astres) et environnement calculé depuis lui (qualités haute et ultra). */
  private readonly skyDome = new SkyDome(1000);
  private readonly skyState = makeSkyState();
  /** État du ciel pour l'environnement (luminances d'éclairage, voir setTime). */
  private readonly envState = makeSkyState();
  private env: AnalyticEnv | null = null;
  /** Environnement des intérieurs (pièce éclairée), partagé. */
  private roomEnv: AnalyticEnv | null = null;
  /** Post-traitement (qualités haute et ultra) et ses réglages de l'image courante. */
  private post: PostFX | null = null;
  private readonly postOk: boolean;
  private readonly postParams = defaultPostParams();
  /** Horloge (s) des nuages. */
  private clock = 0;
  /** Couverture nuageuse 0..1 (1 = pluie) et averse : gouttes autour de la caméra. */
  private cloud = 0;
  private rain: THREE.LineSegments | null = null;
  private rainOn = false;

  /** Météo du jour : soleil, nuages ou pluie (ciel, lumière, brouillard, pluie). */
  setWeather(w: 'soleil' | 'nuages' | 'pluie'): void {
    this.cloud = w === 'pluie' ? 1 : w === 'nuages' ? 0.45 : 0;
    this.rainOn = w === 'pluie';
    this.view.setWet(this.rainOn ? 1 : 0);
    if (this.rainOn && !this.rain) {
      const n = 2600, pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70;
        pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0.45, depthWrite: false }));
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
    this.night = 1 - day; this.day = day; this.dusk = dusk;
    const wet = this.cloud;
    const exposure = 0.85 + 0.2 * day;
    this.renderer.toneMappingExposure = exposure;
    // Course du soleil : lever à l'est vers 6 h, plein sud vers 13 h (50°), coucher à l'ouest vers 20 h 30 ; la nuit,
    // la lumière (faible, bleutée) vient de la lune.
    const t = Math.min(1, Math.max(0, (h - 6) / 14.5));
    const el = THREE.MathUtils.degToRad(4 + 46 * Math.sin(t * Math.PI)), az = THREE.MathUtils.degToRad(100 - 200 * t);
    const s = this.skyState;
    s.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const toSun = smooth(0.04, 0.25, day);
    const L = this.tmpV.copy(s.moonDir).lerp(s.sunDir, toSun).normalize();
    if (L.distanceToSquared(this.lightDir) > 1e-7) this.setLightDir(L);
    // Soleil un peu plus fort qu'avant (il n'est plus fixe à 56° mais monte au plus à 50°) ; heure dorée : lumière
    // rasante renforcée au lever et au coucher.
    this.sun.intensity = (0.18 + 2.72 * day + 1.1 * dusk) * (1 - 0.55 * wet);
    this.sun.color.setRGB(0.62, 0.72, 1).lerp(this.tmpC.setRGB(1, 0.95, 0.88), toSun).lerp(this.tmpC.setRGB(1, 0.6, 0.36), dusk * 0.85 * (1 - wet));
    const envOn = this.env !== null;
    this.hemi.intensity = (0.35 + 1.15 * day) * (envOn ? 0.4 + 0.35 * this.night : 1);
    this.hemi.color.setHex(0x8fa6d6).lerp(this.tmpC.setHex(0xdfeeff), day).lerp(this.tmpC.setHex(0xffd2b0), dusk * 0.45);
    // Ciel : couleurs d'affichage voulues (zénith, horizon : nuit, jour, crépuscule, temps couvert), en valeurs de
    // scène (haute et ultra) et telles quelles pour le dégradé simple (basse et moyenne).
    const k = dusk * (1 - 0.6 * wet), grey = 0.3 + 0.7 * day;
    const mixSky = (hx: readonly number[], out: THREE.Color, scene: boolean): THREE.Color => {
      const at = (i: number, o: THREE.Color): THREE.Color => (scene ? displayToScene(hx[i]!, exposure, o) : o.setHex(hx[i]!, THREE.LinearSRGBColorSpace));
      return at(0, out).lerp(at(1, this.tmpC2), day).lerp(at(2, this.tmpC2), k * 0.8).lerp(at(3, this.tmpC2).multiplyScalar(grey), wet * 0.8);
    };
    mixSky(SKY_ZENITH, s.zenith, true); mixSky(SKY_HORIZON, s.horizon, true);
    mixSky(SKY_ZENITH, this.zenithD, false); mixSky(SKY_HORIZON, this.horizonD, false);
    s.ground.copy(displayToScene(0x2a3030, exposure, this.tmpC)).multiplyScalar(0.25 + 0.75 * day);
    s.sunColor.setRGB(1.5, 1.42, 1.3).lerp(this.tmpC2.setRGB(2.2, 1.05, 0.5), dusk).multiplyScalar(day > 0 ? 1 : 0);
    s.cloud = wet; s.night = this.night; s.dusk = dusk;
    this.skyDome.update(s, this.clock, this.zenithD, this.horizonD);
    // Environnement (éclairage) : mêmes teintes que le ciel, mais ramenées à une luminance d'ambiance (le ciel
    // affiché, presque blanc à l'horizon, éclairerait dix fois trop) et en partie désaturées (ambiance moins bleue).
    const e = this.envState, lum = (x: THREE.Color): number => 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b;
    const sc = (0.06 + 0.27 * day) / Math.max(1e-4, (lum(s.zenith) + 2 * lum(s.horizon)) / 3);
    const desat = (x: THREE.Color, k2: number): THREE.Color => x.lerp(this.tmpC2.setScalar(lum(x)), k2);
    desat(e.zenith.copy(s.zenith).multiplyScalar(sc), 0.5 - 0.2 * dusk - 0.15 * this.night);
    desat(e.horizon.copy(s.horizon).multiplyScalar(sc), 0.45 - 0.25 * dusk - 0.15 * this.night);
    e.ground.setRGB(0.21, 0.19, 0.16).multiplyScalar(0.1 + 0.9 * day * (1 - 0.4 * wet));
    e.sunColor.copy(s.sunColor).multiplyScalar(0.35);
    e.sunDir.copy(s.sunDir); e.cloud = wet; e.night = this.night; e.dusk = dusk;
    // Brouillard des matériaux (qualités basse et moyenne : appliqué à l'écran, après le tone mapping) ; avec le
    // post-traitement, la brume est calculée dans la passe finale et celui-ci ne garde que le fondu des globes.
    const fog = this.street.fog as THREE.Fog;
    if (this.post) { fog.near = 1e6; fog.far = 2e6; fog.color.copy(s.horizon); }
    else {
      fog.near = 160 - 110 * wet; fog.far = 620 - 330 * wet;
      fog.color.setRGB(this.horizonD.r, this.horizonD.g, this.horizonD.b, THREE.SRGBColorSpace);
    }
    (this.street.background as THREE.Color).copy(fog.color);
    this.view.setNight(this.night, h);
    this.interior?.view.setDaylight(day);
  }
  private readonly tmpV = new THREE.Vector3();
  /** Couleurs d'affichage (sRGB) du dégradé simple du ciel. */
  private readonly zenithD = new THREE.Color();
  private readonly horizonD = new THREE.Color();
  private readonly tmpC = new THREE.Color();
  private readonly tmpC2 = new THREE.Color();
  /** Direction vers la lumière principale (soleil ou lune) et axes de la carte d'ombre (droite, haut). */
  private readonly lightDir = new THREE.Vector3(-90, 160, 60).normalize();
  private readonly sunRight = new THREE.Vector3();
  private readonly sunUp = new THREE.Vector3();
  private setLightDir(L: THREE.Vector3): void {
    this.lightDir.copy(L);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.tmpV.copy(L).negate(), new THREE.Vector3(0, 1, 0));
    m.extractBasis(this.sunRight, this.sunUp, new THREE.Vector3());
  }
  /** Caméra de rue mémorisée pendant la visite d'un intérieur. */
  private streetCam = { yaw: 0, pitch: 0, dist: 0 };

  constructor(readonly canvas: HTMLCanvasElement, district: District) {
    // Anticrénelage multi-échantillon seulement sur les écrans de densité normale : sur un écran haute densité
    // (pixel ratio ≥ 1,5) le crénelage se voit à peine et le MSAA coûte cher (≈ 25 % de l'image en rendu logiciel).
    // Le MSAA est fixé à la création du contexte : si la qualité basse est la préférence enregistrée (« bc-qualite »,
    // réglage de l'interface), il est omis dès le chargement et un FXAA léger le remplace (voir `fxaa`).
    // Qualités haute et ultra : le post-traitement a son propre MSAA (cible de rendu) ; celui du contexte est alors
    // omis aussi (s'il redescend en moyenne, le FXAA le remplace, comme en basse).
    let pref = 'auto';
    try { pref = localStorage.getItem('bc-qualite') ?? 'auto'; } catch { /* stockage indisponible */ }
    const ownAA = pref === 'basse' || pref === 'haute' || pref === 'ultra';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !ownAA && (window.devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
    this.msaa = this.renderer.getContext().getContextAttributes()?.antialias === true;
    this.fxaa = !this.msaa && (window.devicePixelRatio || 1) < 1.5;
    this.postOk = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float');
    // Compteurs remis à zéro à chaque image (voir frame) : scène et passes de post-traitement comptées ensemble.
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.street.background = new THREE.Color(0xa9cbe6);
    // Dôme du ciel : rayon sous le plan lointain de la caméra (1200 m), sinon il est entièrement découpé. Dessiné
    // après les objets opaques (test de profondeur) : seuls les pixels de ciel encore libres sont calculés.
    this.street.add(this.skyDome.mesh);
    this.street.fog = new THREE.Fog(0xa9cbe6, 160, 620);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.25, 1200);

    this.street.add(this.hemi);
    for (let k = 0; k < 3; k++) { const l = new THREE.PointLight(0xffd9a0, 0, 22, 1.6); this.lamps.push(l); this.street.add(l); }
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 700 });
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.4;
    this.street.add(this.sun, this.sun.target);
    this.setLightDir(this.lightDir.clone());

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
    // Auvents et parasols au-dessus du trottoir : la caméra les évite (on marche dessous).
    for (const r of this.view.overheads) this.collider.add(r);

    // Balise : colonne normale (cachée par les immeubles) et même colonne en « rayons X » (sans test de profondeur,
    // plus pâle) : derrière un immeuble, on la voit encore à travers lui. Anneau au sol à la porte.
    const col = new THREE.CylinderGeometry(1.2, 1.2, 60, 20, 1, true).translate(0, 30, 0);
    const solid = new THREE.Mesh(col, new THREE.MeshBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const xray = new THREE.Mesh(col, new THREE.MeshBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.14, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
    xray.renderOrder = 8;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.6, 40).rotateX(-Math.PI / 2).translate(0, 0.22, 0), new THREE.MeshBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.beacon.add(solid, xray, ring);
    this.beacon.visible = false;
    this.street.add(this.beacon);

    this.cam = new FollowCamera(canvas);
    this.quality = this.suggestedQuality = Scene3D.autoLevel(this.renderer);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Qualité de départ du mode automatique selon la carte graphique : basse en rendu logiciel, ultra sur une carte
   * dédiée (NVIDIA, Radeon RX / Pro, Intel Arc), haute sinon (graphismes intégrés, Apple) ; le mode automatique
   * ajuste ensuite selon les images par seconde.
   */
  static autoLevel(r: THREE.WebGLRenderer): number {
    const gl = r.getContext();
    let name = '';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    } catch { /* inconnu */ }
    if (/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/.test(name)) return 0;
    if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|radeon r9|intel\(r\) arc|\barc a\d/.test(name)) return 3;
    return 2;
  }
  readonly suggestedQuality: number;

  /** Demi-côté (m) de la zone couverte par la carte d'ombre du soleil (décalée vers ce que regarde la caméra). */
  private shadowExtent = 70;
  private readonly shadowCenter = new THREE.Vector3();

  /**
   * Niveau de qualité : 0 = basse (résolution 1, pas d'ombres, FXAA au lieu du MSAA), 1 = moyenne (ombres 1024),
   * 2 = haute (environnement, ciel détaillé, ombres douces 2048 élargies, post-traitement : occlusion en
   * demi-résolution, halo, brume, étalonnage), 3 = ultra (rendu sur-échantillonné 1,5 fois, au plus 2 fois la
   * résolution de l'écran, ombres 4096 sur une zone plus grande, occlusion en pleine résolution, MSAA même sur
   * écran haute densité).
   */
  quality = 2;
  setQuality(level: number): void {
    const q = this.quality = Math.max(0, Math.min(3, Math.round(level)));
    const dpr = window.devicePixelRatio || 1;
    // Post-traitement : cible HDR en flottants compacts 11-11-10 bits si possible, demi-flottants sinon, MSAA si la
    // carte le permet pour ce format (sinon FXAA).
    const gl = this.renderer.getContext() as WebGL2RenderingContext, cbf = this.renderer.extensions.has('EXT_color_buffer_float');
    let msaa = dpr < 1.5 || q === 3, packed = false, usePost = q >= 2 && this.postOk;
    if (usePost) {
      const fmt = (ms: boolean): boolean => (packed = cbf && canRender(gl, gl.R11F_G11F_B10F, ms ? 4 : 0)) || canRender(gl, gl.RGBA16F, ms ? 4 : 0);
      if (!fmt(msaa)) { msaa = false; usePost = fmt(false); }
    }
    this.fxaa = !usePost && !this.msaa && (q === 0 || dpr < 1.5);
    this.renderer.shadowMap.enabled = q > 0;
    this.sun.castShadow = q > 0;
    const size = Math.min([1024, 1024, 2048, 4096][q]!, this.renderer.capabilities.maxTextureSize);
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    const ext = this.shadowExtent = [70, 70, 90, 120][q]!;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    this.sun.shadow.camera.far = q >= 2 ? 700 : 400;
    this.sun.shadow.camera.updateProjectionMatrix();
    // Pénombre (rayon du filtrage PCF, en texels) : plus large en haute et ultra.
    this.sun.shadow.radius = [1, 1, 2.4, 3][q]!;
    if (usePost) {
      this.post ??= new PostFX();
      this.post.configure({ msaa, fxaa: !msaa && dpr < 1.5, aoFull: q === 3, aoSamples: q === 3 ? 16 : 10, bloomLevels: q === 3 ? 5 : 4, packed });
    } else if (this.post) { this.post.dispose(); this.post = null; }
    // Environnement : carte calculée depuis le ciel (et pièce éclairée pour les intérieurs).
    const envSize = q === 3 ? 128 : 64;
    if (q >= 2) {
      if (this.env?.target.width !== envSize) { this.env?.dispose(); this.env = new AnalyticEnv(envSize, 'ciel'); }
      this.roomEnv ??= new AnalyticEnv(64, 'piece');
    } else {
      this.env?.dispose(); this.env = null;
      this.roomEnv?.dispose(); this.roomEnv = null;
    }
    this.street.environment = this.env?.texture ?? null;
    this.skyDome.setHQ(q >= 2);
    this.view.setQuality(q);
    this.life.setQuality(q);
    if (this.interior) this.interior.view.setLook(q, this.roomEnv?.texture ?? null);
    // Variantes de shaders à compiler de nouveau (lampes allumées comprises).
    this.lampsWarm = false;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    // Résolution selon la qualité ; ultra : sur-échantillonnage (rendu 1,5 fois plus fin sur un écran de densité
    // normale, réduit à l'affichage), au plus 2 fois l'écran et environ 8,3 millions de pixels (l'équivalent de la 4K).
    const dpr = window.devicePixelRatio || 1;
    const ultra = Math.min(2, dpr * 1.5, Math.max(dpr, Math.sqrt(8.3e6 / Math.max(1, w * h))));
    this.renderer.setPixelRatio([1, Math.min(1.25, dpr), Math.min(1.75, dpr), ultra][this.quality] ?? 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setBeacon(p: { x: number; z: number; color?: string } | null): void {
    this.beacon.visible = !!p;
    if (p) {
      this.beacon.position.set(p.x, 0, p.z);
      for (const m of this.beacon.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(p.color ?? '#5fc3ff');
    }
  }

  enterInterior(view: InteriorView, agents: InteriorAgents | null): void {
    this.exitInterior();
    this.interior = { view, agents };
    view.scene.add(this.player.group);
    view.setLook(this.quality, this.roomEnv?.texture ?? null);
    view.setDaylight(this.day);
    this.streetCam = { yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist };
    Object.assign(this.cam, { yaw: 0, pitch: 0.95, dist: Math.max(view.W, view.D) * 0.95 + 2, minDist: 3, maxDist: 22, minPitch: 0.35, maxPitch: 1.45 });
  }

  exitInterior(): void {
    if (!this.interior) return;
    this.interior.view.dispose();
    this.interior = null;
    this.street.add(this.player.group);
    Object.assign(this.cam, { yaw: this.streetCam.yaw || this.cam.yaw, pitch: this.streetCam.pitch || 0.3, dist: this.streetCam.dist || 14, minDist: 2.5, maxDist: 45, minPitch: 0.05, maxPitch: 1.4 });
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

  /** Contexte avec MSAA ? Sinon, FXAA actif quand les pixels sont gros (qualité basse, ou écran de densité normale). */
  private readonly msaa: boolean;
  private fxaa: boolean;
  private fxaaPass: { scene: THREE.Scene; camera: THREE.Camera; mat: THREE.RawShaderMaterial; tex: THREE.FramebufferTexture | null } | null = null;
  private readonly bufSize = new THREE.Vector2();

  /**
   * FXAA léger sur l'image finale (déjà tonemappée, dans l'espace de l'écran) : copie du tampon de dessin dans une
   * texture, puis un triangle plein écran qui adoucit les bords contrastés (9 lectures au plus, rien sur les zones
   * unies). Le rendu de la scène lui-même est inchangé.
   */
  private antialias(): void {
    const r = this.renderer;
    if (!this.fxaaPass) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
      const mat = new THREE.RawShaderMaterial({
        uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } },
        vertexShader: FXAA_VERT, fragmentShader: FXAA_FRAG, depthTest: false, depthWrite: false,
      });
      const quad = new THREE.Mesh(geo, mat);
      quad.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(quad);
      this.fxaaPass = { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat, tex: null };
    }
    const p = this.fxaaPass, size = r.getDrawingBufferSize(this.bufSize);
    if (!p.tex || p.tex.image.width !== size.x || p.tex.image.height !== size.y) {
      p.tex?.dispose();
      p.tex = new THREE.FramebufferTexture(size.x, size.y);
      p.tex.minFilter = p.tex.magFilter = THREE.LinearFilter;
      p.mat.uniforms['tDiffuse']!.value = p.tex;
      (p.mat.uniforms['texel']!.value as THREE.Vector2).set(1 / size.x, 1 / size.y);
    }
    r.copyFramebufferToTexture(p.tex);
    const clear = r.autoClear;
    r.autoClear = false;
    r.render(p.scene, p.camera);
    r.autoClear = clear;
  }

  /** Une image : `focus` = point suivi (tête du personnage ou véhicule). */
  frame(dt: number, focus: THREE.Vector3, snap = false): void {
    this.renderer.info.reset();
    this.clock += dt;
    if (this.interior) {
      this.cam.apply(this.camera, focus, dt, undefined, snap);
      this.interior.view.updateCutaway(this.camera, snap ? 1 : dt);
      this.roomEnv?.updateRoom(this.renderer, this.interior.view.roomState());
      this.draw(this.interior.view.scene, true);
      return;
    }
    this.cam.apply(this.camera, focus, dt, (a, b) => this.collider.clearFraction(a.x, a.y, a.z, b.x, b.y, b.z), snap);
    // Carte d'ombre centrée sur le joueur (en haute et ultra : avancée vers ce que regarde la caméra, pour couvrir la
    // rue devant), recalée sur sa grille de texels dans le repère de la lumière (les bords d'ombre ne scintillent
    // pas quand on marche).
    const ext = this.shadowExtent, texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const c = this.shadowCenter.copy(focus).setY(0);
    if (this.quality >= 2) {
      const f = this.tmpV.copy(focus).sub(this.camera.position).setY(0);
      if (f.lengthSq() > 1e-6) c.addScaledVector(f.normalize(), ext * 0.45);
    }
    const r = c.dot(this.sunRight), u = c.dot(this.sunUp);
    c.addScaledVector(this.sunRight, Math.round(r / texel) * texel - r)
      .addScaledVector(this.sunUp, Math.round(u / texel) * texel - u);
    this.sun.target.position.copy(c);
    // Lumière reculée (et plan lointain) plus loin en haute et ultra : grandes ombres du soleil rasant.
    this.sun.position.copy(c).addScaledVector(this.lightDir, this.quality >= 2 ? 300 : 192);
    this.skyDome.mesh.position.set(focus.x, 0, focus.z);
    this.people.update(dt);
    this.life.update(dt, focus);
    this.view.updateLabels(this.camera, dt);
    if (this.beacon.visible) {
      // Balise qui respire (colonne et anneau au sol).
      this.beaconT += dt;
      const k = 0.5 + 0.5 * Math.sin(this.beaconT * 3.2);
      const [solid, xray, ring] = this.beacon.children as THREE.Mesh[];
      (solid!.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.12 * k;
      (xray!.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.08 * k;
      ring!.scale.setScalar(1 + 0.3 * k);
    }
    if ((this.lampTimer -= dt) <= 0) {
      this.lampTimer = 0.5;
      const near = this.view.lightPoints.map((p) => ({ p, d: p.distanceToSquared(focus) })).sort((a, b) => a.d - b.d).slice(0, this.lamps.length);
      // Lampes éteintes : retirées du rendu (sinon chaque pixel calcule encore trois lumières ponctuelles, ≈ 10 %
      // de l'image en rendu logiciel). Les deux variantes des shaders sont compilées dès la première image.
      this.lamps.forEach((l, k) => { const n = near[k]; if (n) l.position.copy(n.p).setY(4.6); l.intensity = 40 * this.night; l.visible = this.night > 0.3; });
    }
    if (!this.lampsWarm) {
      this.lampsWarm = true;
      const vis = this.lamps.map((l) => l.visible);
      this.lamps.forEach((l) => { l.visible = true; });
      // Variante des shaders du chemin de rendu courant (cible HDR du post-traitement, ou écran).
      const prev = this.renderer.getRenderTarget();
      if (this.post) this.renderer.setRenderTarget(this.post.sceneTarget(this.renderer));
      this.renderer.compileAsync(this.street, this.camera).catch(() => { /* compilé au premier usage */ });
      this.renderer.setRenderTarget(prev);
      this.lamps.forEach((l, k) => { l.visible = vis[k]!; });
    }
    this.env?.updateSky(this.renderer, this.envState);
    if (this.rain && this.rainOn) {
      this.rain.position.set(focus.x, 0, focus.z);
      const a = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute, arr = a.array as Float32Array;
      const fall = 26 * dt;
      for (let i = 1; i < arr.length; i += 6) { arr[i]! -= fall; arr[i + 3]! -= fall; if (arr[i]! < 0) { arr[i]! += 40; arr[i + 3]! += 40; } }
      a.needsUpdate = true;
    }
    this.draw(this.street, false);
  }

  /** Rendu de la scène : post-traitement (haute, ultra) ou direct à l'écran (basse, moyenne ; FXAA éventuel). */
  private draw(scene: THREE.Scene, inside: boolean): void {
    if (this.post) {
      this.postFor(inside);
      this.post.render(this.renderer, scene, this.camera, this.postParams);
      return;
    }
    this.renderer.render(scene, this.camera);
    if (this.fxaa) this.antialias();
  }

  /**
   * Réglages du post-traitement : intérieur (occlusion serrée, halo discret des appliques, tons chauds) ou rue selon
   * l'heure et la météo (halo des lumières surtout la nuit, brume teintée vers le soleil au crépuscule, ombres
   * bleutées et lumières chaudes, saturation un peu plus forte au coucher du soleil, plus faible sous la pluie).
   */
  private postFor(inside: boolean): void {
    const p = this.postParams, d = this.day, n = this.night, k = this.dusk, wet = this.cloud, s = this.skyState, t = this.tmpC;
    p.exposure = this.renderer.toneMappingExposure;
    if (inside) {
      // Intérieur éclairé : même exposition de jour comme de nuit.
      p.exposure = 1;
      p.ao = 1; p.aoRadius = 0.55;
      p.bloom = 0.22; p.bloomThreshold = 2.2;
      p.contrast = 1.05; p.saturation = 1.08;
      p.shadowTint.setRGB(0.97, 0.96, 1); p.highlightTint.setRGB(1.04, 1, 0.94);
      p.vignette = 0.3; p.fog = 0;
      return;
    }
    p.ao = 1; p.aoRadius = 1.3;
    p.bloom = 0.14 + 0.85 * n + 0.1 * k; p.bloomThreshold = 2.6 - 1.4 * n;
    p.contrast = 1.06 + 0.05 * d * (1 - wet); p.saturation = 1.1 + 0.05 * k - 0.14 * wet - 0.1 * n;
    p.shadowTint.setRGB(1, 1, 1.02).lerp(t.setRGB(0.97, 0.95, 1.04), k).lerp(t.setRGB(0.93, 0.96, 1.07), n);
    p.highlightTint.setRGB(1.025, 1, 0.97).lerp(t.setRGB(1.05, 0.99, 0.93), k).lerp(t.setRGB(1.04, 1, 0.94), n);
    p.vignette = 0.2 + 0.1 * n;
    p.fog = (0.0005 + 0.0035 * wet) * (1 - 0.3 * n); p.fogHeight = 0.012; p.fogMax = 0.7;
    // Brume : teinte de l'horizon en partie désaturée (le coucher de soleil ne noie pas la rue dans l'orange).
    const hl = 0.2126 * s.horizon.r + 0.7152 * s.horizon.g + 0.0722 * s.horizon.b;
    p.fogColor.copy(s.horizon).lerp(this.tmpC2.setScalar(hl), 0.25 + 0.35 * k);
    p.fogSunColor.copy(p.fogColor).lerp(t.copy(s.sunColor).multiplyScalar(0.5), d > 0 ? 0.1 + 0.3 * k : 0);
    p.sunDir.copy(s.sunDir);
  }
}
