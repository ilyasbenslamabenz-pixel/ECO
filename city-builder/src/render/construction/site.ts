/**
 * Un CHANTIER à l'écran (rendu) — propriété p2a-chantiers.
 *
 * À partir d'un chantier de la simulation (position, emprise, modèle, avancement), compose la scène :
 * palissade périmétrique avec portail, baraque de chantier, matériaux, terrassement (plateforme, tas de
 * terre, pelle), fondations (coffrage, armatures, dalle, toupie), ossature qui monte étage par étage,
 * échafaudages et filets qui enveloppent les façades, grue à tour, camions, puis repli des installations.
 * Les démolitions suivent le chemin inverse : vestiges qui s'abaissent, gravats, évacuation.
 *
 * Tout ce qui est répétitif passe par les pools d'instances ; seules les pièces mobiles (grue, tourelle
 * de pelle, tambour de toupie) ont leur propre graphe, et uniquement près de la caméra.
 */
import * as THREE from 'three';
import {
  CHANTIER_PHASE_ENDS, CHANTIER_PHASES, DEMOLITION_PHASE_ENDS, DEMOLITION_PHASES, phaseIndexAt, phaseLocalProgress, type ChantierRecord,
} from '../../shared/protocol-ext/chantiers';
import type { ConstructionAssets } from './assets';
import { buildFormwork, buildPlatform, buildRebar, buildRemains, buildSlab, buildStructure, type StructureGeometry } from './geometry';
import type { InstancePools } from './instanced';
import { CraneRig, hash01, RotorRig } from './rigs';

/** Dimensions du bâtiment concerné (catalogue) et pose au sol. */
export interface SiteBuilding {
  width: number;
  depth: number;
  height: number;
  /** Angle de la rotation du bâtiment (radians). */
  angle: number;
  /** Hauteur du sol (m). */
  groundY: number;
}

/** Marges du chantier autour de l'emprise du bâtiment (m). */
const FENCE_MARGIN = 3.2;
const PANEL_W = 2.4;
const BAY_W = 2.5;
const BAY_H = 2.0;
/** Hauteur maximale échafaudée (au-delà : coffrage grimpant, seule la grue travaille). */
const MAX_SCAFFOLD_H = 46;
const MAX_BAYS = 420;

interface Placement { x: number; z: number; rot: number }

export class ChantierSite {
  readonly id: number;
  readonly buildingId: number;
  readonly record: ChantierRecord;
  readonly building: SiteBuilding;
  /** Avancement 0..1 (lissé entre deux deltas). */
  progress = 0;
  /** Index de phase courant. */
  phase = 0;
  /** Distance caméra du dernier calcul (m). */
  distance = 0;

  private readonly seed: number;
  private readonly cos: number;
  private readonly sin: number;
  /** Demi-dimensions de l'emprise (m). */
  private readonly hx: number;
  private readonly hz: number;

  private readonly fence: Placement[] = [];
  private readonly huts: Placement[] = [];
  private readonly stocks: Placement[] = [];
  private readonly heaps: Placement[] = [];
  /** Travées d'échafaudage (une par niveau et par position). */
  private readonly bays: { x: number; z: number; rot: number; level: number }[] = [];
  private readonly craneBase: Placement & { sections: number } | null = null;
  private readonly truck: Placement;
  private readonly digger: Placement;
  private readonly mixer: Placement;

  /** Géométrie propre au chantier (créée à la demande). */
  private group: THREE.Group | null = null;
  private platform: THREE.Mesh | null = null;
  private slab: THREE.Mesh | null = null;
  private formwork: THREE.Mesh | null = null;
  private rebar: THREE.Mesh | null = null;
  private structure: { mesh: THREE.Mesh; geo: StructureGeometry } | null = null;
  private remains: { mesh: THREE.Mesh; geo: StructureGeometry } | null = null;
  private crane: CraneRig | null = null;
  private diggerRig: RotorRig | null = null;
  private mixerRig: RotorRig | null = null;

  constructor(record: ChantierRecord, building: SiteBuilding, private readonly assets: ConstructionAssets, private readonly parent: THREE.Object3D) {
    this.id = record.id;
    this.buildingId = record.buildingId;
    this.record = record;
    this.building = building;
    this.seed = record.id * 2654435761 + record.buildingId;
    this.cos = Math.cos(building.angle);
    this.sin = Math.sin(building.angle);
    this.hx = building.width / 2;
    this.hz = building.depth / 2;

    const fx = this.hx + FENCE_MARGIN, fz = this.hz + FENCE_MARGIN;
    // Palissade : un panneau tous les PANEL_W, portail au milieu du côté +Z.
    const run = (len: number, place: (t: number) => Placement): void => {
      const n = Math.max(1, Math.round(len / PANEL_W));
      for (let i = 0; i < n; i++) this.fence.push(place((i + 0.5) / n));
    };
    run(2 * fx, (t) => ({ x: -fx + 2 * fx * t, z: fz, rot: 0 }));
    run(2 * fx, (t) => ({ x: -fx + 2 * fx * t, z: -fz, rot: Math.PI }));
    run(2 * fz, (t) => ({ x: fx, z: -fz + 2 * fz * t, rot: Math.PI / 2 }));
    run(2 * fz, (t) => ({ x: -fx, z: -fz + 2 * fz * t, rot: -Math.PI / 2 }));
    // Portail : on retire les panneaux au milieu du côté +Z.
    for (let i = this.fence.length - 1; i >= 0; i--) {
      const p = this.fence[i]!;
      if (p.z === fz && Math.abs(p.x) < Math.min(3.2, fx * 0.45)) this.fence.splice(i, 1);
    }

    // Baraque de chantier et stocks, dans un angle libre.
    const sgn = hash01(this.seed) > 0.5 ? 1 : -1;
    this.huts.push({ x: sgn * (fx - 3.4), z: -fz + 1.7, rot: sgn > 0 ? Math.PI / 2 : -Math.PI / 2 });
    this.stocks.push({ x: sgn * (fx - 2.2), z: -fz + 5.2, rot: 0.3 });
    if (fx > 10) this.stocks.push({ x: sgn * (fx - 2.2), z: -fz + 7.0, rot: -0.2 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + hash01(this.seed + i) * 0.7;
      this.heaps.push({ x: Math.cos(a) * (fx - 2.6), z: Math.sin(a) * (fz - 2.6) * 0.8, rot: a });
    }
    // Engins : près du portail.
    this.truck = { x: -sgn * (fx - 2.4), z: fz - 5.5, rot: Math.PI };
    this.digger = { x: sgn * (this.hx * 0.45), z: this.hz * 0.3, rot: hash01(this.seed * 3) * Math.PI * 2 };
    this.mixer = { x: -sgn * (fx - 2.6), z: -1.5, rot: 0 };

    // Grue : du côté le plus long, hors emprise, dans la palissade.
    if (this.needsCrane()) {
      const side = hash01(this.seed * 11) > 0.5 ? 1 : -1;
      const mastTop = Math.min(140, building.height + 11);
      const sections = Math.max(1, Math.round((mastTop - 2.6) / this.assets.pivot('matHauteur', 6)));
      this.craneBase = { x: side * (this.hx + 3.0), z: -this.hz * 0.15, rot: 0, sections };
    }

    // Échafaudages : travées autour des façades, par niveaux de BAY_H.
    const levels = Math.max(1, Math.min(Math.ceil(Math.min(building.height, MAX_SCAFFOLD_H) / BAY_H), Math.ceil(MAX_SCAFFOLD_H / BAY_H)));
    const ox = this.hx + 0.6, oz = this.hz + 0.6;
    const ring: { x: number; z: number; rot: number }[] = [];
    const along = (len: number, place: (t: number) => { x: number; z: number; rot: number }): void => {
      const n = Math.max(1, Math.round(len / BAY_W));
      for (let i = 0; i < n; i++) ring.push(place((i + 0.5) / n));
    };
    along(2 * ox, (t) => ({ x: -ox + 2 * ox * t, z: oz, rot: 0 }));
    along(2 * ox, (t) => ({ x: -ox + 2 * ox * t, z: -oz, rot: Math.PI }));
    along(2 * oz, (t) => ({ x: ox, z: -oz + 2 * oz * t, rot: Math.PI / 2 }));
    along(2 * oz, (t) => ({ x: -ox, z: -oz + 2 * oz * t, rot: -Math.PI / 2 }));
    for (let l = 0; l < levels && this.bays.length < MAX_BAYS; l++) {
      for (const p of ring) {
        if (this.bays.length >= MAX_BAYS) break;
        this.bays.push({ ...p, level: l });
      }
    }
  }

  /** Grue nécessaire : bâtiment haut ou emprise importante. */
  private needsCrane(): boolean {
    return this.record.kind === 'construction' && (this.building.height >= 9 || this.building.width * this.building.depth >= 260);
  }

  /** Transforme une position locale (x, z) en monde. */
  private wx(x: number, z: number): number { return this.record.x + x * this.cos + z * this.sin; }
  private wz(x: number, z: number): number { return this.record.z - x * this.sin + z * this.cos; }

  private get ground(): number { return this.building.groundY; }

  /** Met à jour l'avancement et la phase. */
  setProgress(p: number): void {
    this.progress = Math.min(1, Math.max(0, p));
    const ends = this.record.kind === 'construction' ? CHANTIER_PHASE_ENDS : DEMOLITION_PHASE_ENDS;
    this.phase = phaseIndexAt(this.progress, ends);
  }

  /** Avancement à l'intérieur de la phase courante. */
  get phaseProgress(): number {
    const ends = this.record.kind === 'construction' ? CHANTIER_PHASE_ENDS : DEMOLITION_PHASE_ENDS;
    return phaseLocalProgress(this.progress, this.phase, ends);
  }

  /**
   * Hauteur bâtie à l'instant courant (m) : la montée de l'ossature puis des façades.
   * Sert aussi au masquage du bâtiment de base (voir mask.ts).
   */
  get builtHeight(): number {
    if (this.record.kind === 'demolition') return this.building.height * (1 - Math.min(1, Math.max(0, (this.progress - DEMOLITION_PHASE_ENDS[0]!) / (DEMOLITION_PHASE_ENDS[1]! - DEMOLITION_PHASE_ENDS[0]!))));
    if (this.progress < CHANTIER_PHASE_ENDS[1]!) return 0;
    const t = Math.min(1, (this.progress - CHANTIER_PHASE_ENDS[1]!) / (CHANTIER_PHASE_ENDS[2]! - CHANTIER_PHASE_ENDS[1]!));
    return this.building.height * Math.min(1, t);
  }

  /** Vrai quand le bâtiment achevé doit être visible (sinon il est masqué par le module). */
  get buildingVisible(): boolean {
    if (this.record.kind === 'demolition') return false;
    // Révélé au milieu de la phase « façades », l'échafaudage restant monté jusqu'aux finitions.
    return this.progress >= (CHANTIER_PHASE_ENDS[2]! + CHANTIER_PHASE_ENDS[3]!) / 2;
  }

  /* --------------------------- Géométrie propre --------------------------- */

  private ensureGroup(): THREE.Group {
    if (!this.group) {
      this.group = new THREE.Group();
      this.group.name = `chantier_${this.id}`;
      this.group.position.set(this.record.x, this.ground, this.record.z);
      this.group.rotation.y = this.building.angle;
      this.parent.add(this.group);
    }
    return this.group;
  }

  private mesh(geometry: THREE.BufferGeometry, role: string, y = 0): THREE.Mesh {
    const m = new THREE.Mesh(geometry, this.assets.sharedMaterial(role));
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.y = y;
    m.userData['role'] = role;
    this.ensureGroup().add(m);
    return m;
  }

  private drop(m: THREE.Mesh | null): null {
    if (m) { m.geometry.dispose(); m.removeFromParent(); }
    return null;
  }

  /** Remplace les matériaux de repli par les matériaux définitifs une fois les GLB chargés. */
  private refreshMaterials(): void {
    const g = this.group;
    if (!g) return;
    for (const child of g.children) {
      const m = child as THREE.Mesh;
      const role = m.userData?.['role'] as string | undefined;
      if (!m.isMesh || !role || !this.assets.hasSharedMaterial(role)) continue;
      const mat = this.assets.sharedMaterial(role);
      if (m.material !== mat) m.material = mat;
    }
  }

  /** Construit / libère la géométrie selon la phase, et règle les plages de dessin. */
  private syncGeometry(): void {
    const b = this.building;
    const demolition = this.record.kind === 'demolition';
    if (demolition) {
      if (!this.remains && this.progress < DEMOLITION_PHASE_ENDS[1]!) {
        const geo = buildRemains(b.width, b.depth, Math.max(3, b.height * this.record.bati));
        this.remains = { mesh: this.mesh(geo.geometry, 'beton'), geo };
      }
      if (this.remains) {
        const left = 1 - Math.min(1, Math.max(0, (this.progress - DEMOLITION_PHASE_ENDS[0]!) / (DEMOLITION_PHASE_ENDS[1]! - DEMOLITION_PHASE_ENDS[0]!)));
        const slices = this.remains.geo.floors;
        const k = Math.max(0, Math.min(slices, Math.round(left * slices)));
        if (k === 0) { this.remains.mesh.geometry.dispose(); this.remains.mesh.removeFromParent(); this.remains = null; }
        else this.remains.mesh.geometry.setDrawRange(0, this.remains.geo.floorRanges[k - 1]!);
      }
      if (!this.platform && this.progress > DEMOLITION_PHASE_ENDS[0]!) this.platform = this.mesh(buildPlatform(b.width + 1, b.depth + 1, 0.22), 'terre');
      return;
    }

    // Construction : plateforme dès le terrassement, conservée jusqu'aux finitions.
    if (!this.platform && this.progress < CHANTIER_PHASE_ENDS[3]!) this.platform = this.mesh(buildPlatform(b.width + 2.4, b.depth + 2.4), 'terre');
    else if (this.platform && this.progress >= CHANTIER_PHASE_ENDS[3]!) this.platform = this.drop(this.platform);

    const inFondations = this.progress >= CHANTIER_PHASE_ENDS[0]!;
    if (inFondations && !this.slab) this.slab = this.mesh(buildSlab(b.width, b.depth), 'beton', 0.3);
    if (inFondations && !this.formwork && this.progress < CHANTIER_PHASE_ENDS[2]!) this.formwork = this.mesh(buildFormwork(b.width, b.depth), 'bois', 0.3);
    else if (this.formwork && this.progress >= CHANTIER_PHASE_ENDS[2]!) this.formwork = this.drop(this.formwork);
    if (inFondations && !this.rebar && this.progress < CHANTIER_PHASE_ENDS[1]!) this.rebar = this.mesh(buildRebar(b.width, b.depth, 0), 'acier_sombre', 0.8);
    else if (this.rebar && this.progress >= CHANTIER_PHASE_ENDS[1]!) this.rebar = this.drop(this.rebar);

    const inStructure = this.progress >= CHANTIER_PHASE_ENDS[1]!;
    if (inStructure && !this.structure && this.progress < CHANTIER_PHASE_ENDS[3]!) {
      const geo = buildStructure(b.width, b.depth, b.height);
      this.structure = { mesh: this.mesh(geo.geometry, 'beton', 0.72), geo };
    } else if (this.structure && this.progress >= CHANTIER_PHASE_ENDS[3]!) {
      this.structure.mesh.geometry.dispose();
      this.structure.mesh.removeFromParent();
      this.structure = null;
    }
    if (this.structure) {
      const t = Math.min(1, (this.progress - CHANTIER_PHASE_ENDS[1]!) / (CHANTIER_PHASE_ENDS[2]! - CHANTIER_PHASE_ENDS[1]!));
      const k = Math.max(1, Math.min(this.structure.geo.floors, Math.ceil(t * this.structure.geo.floors)));
      this.structure.mesh.geometry.setDrawRange(0, this.structure.geo.floorRanges[k - 1]!);
    }
  }

  /* ------------------------------- Instances ------------------------------- */

  /** Nombre de niveaux d'échafaudage montés à l'avancement courant. */
  private scaffoldLevels(): number {
    if (this.record.kind === 'demolition') return 0;
    const b = this.building;
    const maxLevels = Math.ceil(Math.min(b.height, MAX_SCAFFOLD_H) / BAY_H);
    if (this.progress < CHANTIER_PHASE_ENDS[1]!) return 0;
    if (this.progress < CHANTIER_PHASE_ENDS[2]!) {
      // Monte avec l'ossature, un cran derrière.
      const t = (this.progress - CHANTIER_PHASE_ENDS[1]!) / (CHANTIER_PHASE_ENDS[2]! - CHANTIER_PHASE_ENDS[1]!);
      return Math.max(0, Math.floor(t * maxLevels) - 1);
    }
    if (this.progress < CHANTIER_PHASE_ENDS[3]!) return maxLevels;
    // Finitions : démontage par le haut.
    const t = (this.progress - CHANTIER_PHASE_ENDS[3]!) / (1 - CHANTIER_PHASE_ENDS[3]!);
    return Math.max(0, Math.round(maxLevels * (1 - t)));
  }

  /** Ajoute les pièces fixes du chantier aux pools d'instances. */
  collect(pools: InstancePools, lodOf: (id: string) => number): void {
    this.refreshMaterials();
    const y = this.ground;
    const put = (id: string, p: Placement, dy = 0, scale = 1): void => {
      pools.push(id, lodOf(id), this.wx(p.x, p.z), y + dy, this.wz(p.x, p.z), this.building.angle + p.rot, scale, scale, scale);
    };
    for (const p of this.fence) put('palissade', p);
    for (const p of this.huts) put('baraque', p);
    for (const p of this.stocks) put('palettes', p);

    const demolition = this.record.kind === 'demolition';
    if (demolition) {
      if (this.progress > DEMOLITION_PHASE_ENDS[0]! * 0.5) {
        for (let i = 0; i < this.heaps.length; i++) {
          const p = this.heaps[i]!;
          const t = Math.min(1, this.progress / DEMOLITION_PHASE_ENDS[1]!);
          const s = 0.5 + 0.9 * t * (0.7 + 0.5 * hash01(this.seed + i));
          put('tas_gravats', p, 0, s);
        }
      }
    } else if (this.progress < CHANTIER_PHASE_ENDS[1]!) {
      for (let i = 0; i < this.heaps.length; i++) {
        const p = this.heaps[i]!;
        const s = 0.55 + 0.85 * hash01(this.seed * 5 + i);
        put('tas_terre', p, 0.1, s);
      }
    }

    // Échafaudages.
    const levels = this.scaffoldLevels();
    if (levels > 0) {
      const lod = lodOf('echafaudage');
      for (const bay of this.bays) {
        if (bay.level >= levels) continue;
        pools.push('echafaudage', lod, this.wx(bay.x, bay.z), y + bay.level * BAY_H, this.wz(bay.x, bay.z), this.building.angle + bay.rot);
      }
    }

    // Mât de grue (éléments empilés) : pièces fixes, la tête est animée.
    const cb = this.craneBase;
    if (cb && this.craneVisible()) {
      const h = this.assets.pivot('matHauteur', 6);
      put('grue_base', cb);
      const lod = lodOf('grue_mat');
      for (let i = 0; i < cb.sections; i++) {
        pools.push('grue_mat', lod, this.wx(cb.x, cb.z), y + 2.6 + i * h, this.wz(cb.x, cb.z), this.building.angle);
      }
    }

    // Engins : pièces fixes (les parties tournantes sont ajoutées par les rigs quand le chantier est proche).
    if (this.diggerActive()) put('pelleteuse_base', this.digger);
    if (this.mixerActive()) put('toupie_base', this.mixer);
    if (this.truckActive()) put('camion_benne', this.truck);
  }

  private craneVisible(): boolean {
    return this.craneBase !== null && this.progress >= CHANTIER_PHASE_ENDS[0]! * 0.5 && this.progress < 0.97;
  }
  private diggerActive(): boolean {
    return this.record.kind === 'demolition'
      ? this.progress > DEMOLITION_PHASE_ENDS[0]! * 0.4
      : this.progress < CHANTIER_PHASE_ENDS[1]!;
  }
  private mixerActive(): boolean {
    return this.record.kind === 'construction' && this.progress >= CHANTIER_PHASE_ENDS[0]! * 0.8 && this.progress < CHANTIER_PHASE_ENDS[2]!;
  }
  private truckActive(): boolean {
    return this.record.kind === 'demolition' ? this.progress > DEMOLITION_PHASE_ENDS[1]! * 0.5 : this.progress < CHANTIER_PHASE_ENDS[1]! || this.progress > CHANTIER_PHASE_ENDS[2]!;
  }

  /* -------------------------------- Mise à jour -------------------------------- */

  /**
   * Met à jour le chantier. `detailed` : le chantier est assez proche pour mériter ses pièces animées.
   * `working` : heures de travail (sinon tout est immobile).
   */
  update(dt: number, detailed: boolean, working: boolean, lodOf: (id: string) => number): void {
    this.syncGeometry();
    if (!detailed) {
      this.crane?.dispose();
      this.crane = null;
      this.diggerRig?.dispose();
      this.diggerRig = null;
      this.mixerRig?.dispose();
      this.mixerRig = null;
      return;
    }
    const y = this.ground;
    const cb = this.craneBase;
    if (cb && this.craneVisible()) {
      if (!this.crane) {
        this.crane = new CraneRig(this.assets, this.seed);
        this.parent.add(this.crane.group);
      }
      const top = y + 2.6 + cb.sections * this.assets.pivot('matHauteur', 6);
      this.crane.group.position.set(this.wx(cb.x, cb.z), top, this.wz(cb.x, cb.z));
      if (this.crane.build(lodOf('grue_tete'))) {
        this.crane.update(dt, working, Math.hypot(this.hx, this.hz) + 6, y + this.builtHeight);
      }
    } else if (this.crane) {
      this.crane.dispose();
      this.crane = null;
    }

    if (this.diggerActive()) {
      if (!this.diggerRig) {
        this.diggerRig = new RotorRig(this.assets, 'pelleteuse_tourelle', 'y', [0, this.assets.pivot('pelleteuseTourelleY', 1), 0], this.seed + 17);
        this.parent.add(this.diggerRig.group);
      }
      this.diggerRig.group.position.set(this.wx(this.digger.x, this.digger.z), y + 0.1, this.wz(this.digger.x, this.digger.z));
      this.diggerRig.group.rotation.y = this.building.angle + this.digger.rot;
      if (this.diggerRig.build(lodOf('pelleteuse_tourelle'))) this.diggerRig.update(dt, working);
    } else if (this.diggerRig) {
      this.diggerRig.dispose();
      this.diggerRig = null;
    }

    if (this.mixerActive()) {
      if (!this.mixerRig) {
        this.mixerRig = new RotorRig(this.assets, 'toupie_tambour', 'z', this.assets.pivotArray('toupieTambour', [0, 2, -0.6]), this.seed + 29);
        this.parent.add(this.mixerRig.group);
      }
      this.mixerRig.group.position.set(this.wx(this.mixer.x, this.mixer.z), y, this.wz(this.mixer.x, this.mixer.z));
      this.mixerRig.group.rotation.y = this.building.angle + this.mixer.rot;
      if (this.mixerRig.build(lodOf('toupie_tambour'))) this.mixerRig.update(dt, working);
    } else if (this.mixerRig) {
      this.mixerRig.dispose();
      this.mixerRig = null;
    }
  }

  /** Diagnostic (tests e2e). */
  debug(): Record<string, unknown> {
    return {
      id: this.id, buildingId: this.buildingId, kind: this.record.kind, progress: Math.round(this.progress * 1000) / 1000,
      phase: (this.record.kind === 'demolition' ? DEMOLITION_PHASES : CHANTIER_PHASES)[this.phase] ?? this.phase, x: this.record.x, z: this.record.z, hauteurBatie: Math.round(this.builtHeight * 10) / 10,
      palissade: this.fence.length, travees: this.bays.length, niveaux: this.scaffoldLevels(),
      grue: this.craneVisible() ? (this.craneBase?.sections ?? 0) : 0, grueAnimee: this.crane !== null,
      batimentVisible: this.buildingVisible,
      structure: this.structure ? this.structure.geo.floors : 0,
      vestiges: this.remains ? this.remains.geo.floors : 0,
    };
  }

  dispose(): void {
    this.platform = this.drop(this.platform);
    this.slab = this.drop(this.slab);
    this.formwork = this.drop(this.formwork);
    this.rebar = this.drop(this.rebar);
    if (this.structure) { this.structure.mesh.geometry.dispose(); this.structure.mesh.removeFromParent(); this.structure = null; }
    if (this.remains) { this.remains.mesh.geometry.dispose(); this.remains.mesh.removeFromParent(); this.remains = null; }
    this.crane?.dispose();
    this.crane = null;
    this.diggerRig?.dispose();
    this.diggerRig = null;
    this.mixerRig?.dispose();
    this.mixerRig = null;
    if (this.group) { this.group.removeFromParent(); this.group = null; }
  }
}
