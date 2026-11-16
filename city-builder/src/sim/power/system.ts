/**
 * Électricité (phase 2B, sous-étape 4) — moteur du service, branché sur le contrat municipal.
 *
 * Installations = bâtiments du catalogue étiquetés `elec:centrale:<type>` / `elec:poste` (posés par le joueur :
 * coût de construction, emplois et entretien du catalogue gérés par la simulation de base). Lignes haute tension
 * = objets du module (commande `buildLine`). Chaque heure de jeu :
 *  1. pannes aléatoires (PRNG du module ; taux × 1/financement²) et réparations ;
 *  2. production disponible par installation (vent, soleil, débit, panne, site) ;
 *  3. demande de chaque bâtiment (classe, taille, occupants, heure, saison) agrégée par installation de
 *     distribution (la plus proche à portée) et par classe ;
 *  4. graphe municipal reconstruit : producteur -> jeu de barres (J) -> transformateur -> nœud de distribution (D)
 *     -> un consommateur par classe (priorité = rang de la classe) ; lignes = arêtes J–J (capacité, pertes/km) ;
 *  5. répartition (`Networks.allocate`, ordre de mérite, délestage des priorités basses) ; dans une classe
 *     partiellement servie, les bâtiments déjà installés (identifiant le plus petit) sont alimentés d'abord :
 *     délestage progressif, les derniers arrivés sont coupés en premier au lieu de toute la ville à tour de rôle ;
 *     raccordement au réseau extérieur (réglage `raccordement`, `IMPORT_SPEC`) : appoint appelé en dernier, relié à
 *     toutes les installations raccordées à la voirie et aux bâtiments qu'aucune installation ne dessert ;
 *  6. effets : bâtiments coupés, emplois / habitants sans courant, pollution de l'air (thermique), bruit,
 *     satisfaction (pénalité réversible et bornée), registre d'effets (causes : panne, pénurie, réglage).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { governanceModifiers } from '../../shared/governance';
import {
  BATTERY_ONE_WAY, BATTERY_SPEC, batteryStep, capacityKwhOf,
  baseDemandKw, centsToChf, consumerClassOf, FACILITY_SPECS, facilityKindOf, failureMultiplier, hourlyFactor, hydroShare,
  damPlantKw, damPlantUpkeepChf, hydroDamKw, hydroDamSiteCheck, hydroSiteCheck, CABLE_SPEC, cableCost, EXPORT_SPEC, clampExportPrice, exportDemandShare, IMPORT_SPEC, LINE_SPEC, lineCost, nominalKwOf, repairMultiplier, ROOFTOP_SPEC, seasonDemandFactor, solarShare,
  TARIFF_CENTS_PER_KWH, windPowerShare, windProfile,
} from '../../shared/power/model';
import {
  type ClassBalance, CONSUMER_CLASSES, type ConsumerClass, COVER_CUT, COVER_NONE, COVER_OK, COVER_PARTIAL, COVER_UNLINKED,
  type CableEnd, type CableView, DEFAULT_PRIORITY_ORDER, type ElectriciteBudget, type ElectriciteCoverage, type ElectriciteDelta, type ElectriciteEvent,
  type ElectriciteRoads, type ElectriciteSettings, type ElectriciteSummary, ELECTRICITE_NETWORK, type FacilityKind, type FacilityView, FUNDING_MAX,
  FUNDING_MIN, type LineView, type PlantType, SOURCE_IDS, type SourceBalance, type SourceId, type StorageBalance, WEATHER_SERVICE,
  type WeatherLike,
} from '../../shared/power/types';
import { TILE_SIZE } from '../../shared/constants';
import type { Municipal } from '../municipal/municipal';
import { decodeFloat32, encodeFloat32 } from '../municipal/codec';
import type { PluginContext } from '../plugins/types';

/* ------------------------------- État sauvegardé ------------------------------- */

export interface LineState { id: number; a: number; b: number; lengthM: number; failedUntil: number; builtAt: number }
/**
 * Câble souterrain : installation `a` -> installation `b` (> 0) ou route (`b` = 0, point `bx`, `bz` sur la chaussée,
 * aimanté à la pose). Sans pylône, sans panne.
 */
export interface CableState { id: number; a: number; b: number; bx?: number; bz?: number; lengthM: number; builtAt: number }
/** `storedKwh` : énergie stockée (batteries de stockage seulement ; absent des autres installations et des anciennes parties). */
export interface FacilityState { failedUntil: number; failures: number; storedKwh?: number }

/** Distance maximale d'un bâtiment / d'une installation à la route pour être raccordé (m). */
const ROAD_ATTACH_M = 80;
/** Repli sans route : installation et bâtiment voisins (m). */
const LOCAL_FALLBACK_M = 80;
/**
 * Repli sans route entre deux INSTALLATIONS (m) : un parc éolien posé à l'écart (mâts espacés d'au moins
 * WIND_MIN_SPACING_M = 88 m pour que les rotors ne se chevauchent pas) reste d'un seul tenant ; il suffit qu'une
 * éolienne touche une route (ou une ligne HT) pour que tout le parc alimente le réseau.
 */
const FACILITY_LINK_M = 130;
/**
 * Réseau intégré aux routes : capacité de la distribution le long de la voirie (kW). Volontairement non bloquante
 * (la route transporte tout le courant nécessaire) : seules la production, les lignes HT entre réseaux séparés et
 * les raccordements hors route restent limités.
 */
const ROAD_GRID_KW = 10_000_000;

export interface PowerState {
  settings: ElectriciteSettings;
  lines: LineState[];
  nextLineId: number;
  /** Câbles souterrains (champ facultatif : absent des anciennes parties et tant qu'aucun câble n'a été posé). */
  cables?: CableState[];
  nextCableId?: number;
  /** État par installation (clé = identifiant de bâtiment). */
  facilities: Record<string, FacilityState>;
  /** Logements équipés de panneaux en toiture. */
  rooftopIds: number[];
  windForce: number | null;
  /** Cause de la pénurie en cours dans le registre d'effets (0 = aucune). */
  shortageCause: number;
  /** Coupures par classe au dernier enregistrement d'effet (détection des changements). */
  lastCutByClass: Record<string, number>;
  /** Pénalité de satisfaction appliquée par le module, par cellule (base64 Float32 ; '' = aucune). */
  penalty: string;
  penaltyCells: number;
  events: ElectriciteEvent[];
  month: { producedKwh: number; deliveredKwh: number; shedKwh: number; failures: number; importedKwh?: number; exportedKwh?: number; exportIncome?: number };
  lastMonth: { income: number; expense: number; failures: number; importCost?: number; exportIncome?: number };
  /** Notification « première vente d'électricité aux villes voisines » déjà envoyée (champ facultatif). */
  exportNotified?: boolean;
  investments: number;
  /** Dernière heure traitée (minutes de jeu). */
  lastHourAt: number;
  /** Bâtiments sans courant au dernier calcul (rechargement identique : la démographie les consulte). */
  unpowered?: number[];
  /** Parmi eux, ceux qu'aucun réseau ne dessert (ni installation ni raccordement extérieur). */
  unlinked?: number[];
  /**
   * Conseil « réseau seulement intermittent » déjà donné (minute de jeu) : envoyé une fois, à la première coupure
   * faute de vent ou de soleil ; réarmé quand le réseau gagne une batterie, une centrale pilotable ou le raccordement.
   */
  adviceAt?: number;
  /** Installations isolées déjà signalées (« Reliez la centrale à une route ») ; réarmé quand elles sont reliées. */
  isolatedNotified?: number[];
}

/** Conseil affiché quand un réseau uniquement éolien / solaire coupe faute de vent ou de soleil. */
/** Pannes aléatoires des centrales et postes (choix du joueur, comme Cities: Skylines II) : désactivées ; les coupures
 *  ne viennent que d'un manque de production. Les lignes HT gardent leurs pannes. */
export const PLANT_RANDOM_FAILURES = false as boolean;

export const INTERMITTENT_ADVICE = 'La nuit sans vent, vos éoliennes et panneaux solaires ne produisent rien. Raccordez-vous au réseau voisin, construisez une centrale thermique ou des batteries.';

/** Consigne affichée pour une installation isolée (notification, panneau). */
export function isolatedHint(kind: FacilityKind): string {
  const what = kind === 'poste' ? 'le poste' : kind === 'batterie' ? 'les batteries' : 'la centrale';
  return `reliez ${what} à une route. Le courant suit les routes : tout le réseau routier connecté sera alimenté (une seule éolienne d'un parc suffit ; une ligne haute tension reste possible pour un site éloigné).`;
}

export function emptyPowerState(): PowerState {
  return {
    settings: { funding: 1, priorities: [...DEFAULT_PRIORITY_ORDER], rooftops: false },
    lines: [], nextLineId: 1, facilities: {}, rooftopIds: [], windForce: null, shortageCause: 0, lastCutByClass: {},
    penalty: '', penaltyCells: 0, events: [],
    month: { producedKwh: 0, deliveredKwh: 0, shedKwh: 0, failures: 0 },
    lastMonth: { income: 0, expense: 0, failures: 0 },
    investments: 0, lastHourAt: -1,
  };
}

/* --------------------------------- Constantes --------------------------------- */

const MAX_EVENTS = 40;
/** Capacité minimale du transformateur de distribution d'une centrale (kW). */
const PLANT_DISTRIBUTION_MIN_KW = 20_000;
/** Raccordement local automatique (moyenne tension) entre installations proches : capacité (kW), pertes / km. */
const LOCAL_LINK_KW = 20_000;
const LOCAL_LINK_LOSS_PER_KM = 0.015;
/**
 * Pénalité de satisfaction des logements raccordés et coupés : +2/h quand coupé (plafond 12), −2/h quand alimenté.
 * Des coupures intermittentes (moins d'une heure sur deux) ne s'accumulent pas ; une pénurie durable coûte un peu
 * plus que l'absence de service (NO_POWER_PENALTY = 10, src/sim/demography.ts), sans faire chuter toute la ville.
 */
const PENALTY_STEP_CUT = 2;
const PENALTY_RECOVER = 2;
const PENALTY_MAX = 12;
/** Pseudo-installation « réseau extérieur » (identifiant de bâtiment jamais attribué : les ids commencent à 1). */
const IMPORT_HUB = 0;
/** Consommateur sans installation de distribution (les identifiants négatifs sont ceux des barrages). */
const NO_HUB = Number.NEGATIVE_INFINITY;

interface Facility {
  id: number;
  kind: FacilityKind;
  nameFr: string;
  x: number; y: number; z: number; rot: number;
  nominalKw: number;
  radius: number;
  halfSize: number;
  siteOk: boolean;
  siteReason: string;
  upkeep: number;
  /** Capacité de stockage (kWh) : batteries seulement, 0 sinon. */
  capacityKwh: number;
  /** Centrale hydroélectrique au pied d'un barrage (src/sim/hydro) : identifiant du barrage ; absent sinon. */
  damId?: number;
  /** Version du service `hydro` lors de la validation du site. */
  hydroVer?: number;
  /**
   * Barrage hydroélectrique : l'OUVRAGE lui-même (pas un bâtiment), identifiant négatif `damFacilityId(damId)`.
   * `attach` : points (x, z alternés) par lesquels il se raccorde à une route (extrémités de l'axe, milieu).
   */
  dam?: boolean;
  attach?: number[];
  damStat?: { headM: number; flowM3s: number };
}

interface DamInfo { id: number; headM: number; flowM3s: number; full: boolean; x: number; z: number; crest: number; lengthM: number; ax: number; az: number; bx: number; bz: number }
/** Service `hydro` publié par le cœur de la simulation (barrages et retenues, src/sim/hydro/system.ts). */
interface HydroDamService {
  version(): number;
  damNear(x: number, z: number, reach: number): DamInfo | null;
  dam(id: number): DamInfo | null;
  dams?(): DamInfo[];
}
/** Identifiant (négatif, jamais attribué à un bâtiment) de la centrale d'un barrage. */
export const damFacilityId = (damId: number): number => -(damId + 1);
/** Nom affiché d'une installation (bâtiment : « … n° id » ; barrage : « Barrage hydroélectrique (ouvrage n) »). */
const facLabel = (f: { id: number; nameFr: string }): string => (f.id < 0 ? `${f.nameFr} (ouvrage ${-f.id})` : `${f.nameFr} n° ${f.id}`);
/** Distance maximale entre une centrale et l'axe d'un barrage (m, en plus de sa demi-taille). */
const DAM_PLANT_REACH = 60;

interface Consumer {
  id: number;
  x: number; z: number;
  cls: ConsumerClass;
  demandKw: number;
  residents: number;
  jobs: number;
  hub: number; // identifiant de l'installation de distribution, NO_HUB = non raccordé (les barrages ont des identifiants négatifs)
  cell: number;
}

export class PowerSystem {
  state: PowerState = emptyPowerState();
  /** Installations courantes (reconstruites à chaque répartition depuis les bâtiments). */
  private facilities = new Map<number, Facility>();
  /** Part servie par bâtiment consommateur (absent = non consommateur, compté comme alimenté). */
  private served = new Map<number, number>();
  /** Consommateurs hors de tout réseau (aucune installation ni raccordement extérieur ne les dessert). */
  private noService = new Set<number>();
  /** Multiplicateur de production éolienne / solaire (recherche) ; 1 = neutre. */
  private govRenew = 1;
  /** Capacité du raccordement au réseau voisin (kW) à la dernière répartition (événement « panne » : réduite). */
  private importCapKw: number = IMPORT_SPEC.capacityKw;
  private cutList: number[] = [];
  private summaryCache: ElectriciteSummary | undefined;
  private facilityViews: FacilityView[] = [];
  private lineViews: LineView[] = [];
  private cableViews: CableView[] = [];
  private cableLoad = new Map<number, number>();
  private coverage: ElectriciteCoverage | undefined;
  private penaltyGrid: Float32Array | null = null;
  private rooftopSet = new Set<number>();
  /** Version de contenu (deltas) et dernière version envoyée. */
  version = 1;
  private sentVersion = -1;
  private coverageSent = -1;
  private eventsSent = 0;
  /** Mode d'hébergement du contrat municipal. */
  municipalMode: 'service' | 'integre' = 'service';

  constructor(private readonly getMunicipal: () => Municipal | undefined) {}

  /* ------------------------------ Cycle de vie ------------------------------ */

  reset(): void {
    this.state = emptyPowerState();
    this.facilities.clear();
    this.served.clear();
    this.noService.clear();
    this.cutList = [];
    this.summaryCache = undefined;
    this.facilityViews = [];
    this.lineViews = [];
    this.cableViews = [];
    this.coverage = undefined;
    this.penaltyGrid = null;
    this.rooftopSet = new Set();
    this.version++;
    this.sentVersion = -1;
    this.coverageSent = -1;
    this.eventsSent = 0;
    this.roadLayer = undefined;
    this.roadGeomVersion = -1;
    this.roadsSent = -1;
  }

  load(s: PowerState): void {
    this.reset();
    this.state = s;
    this.rooftopSet = new Set(s.rooftopIds);
    this.penaltyGrid = s.penalty && s.penaltyCells > 0 ? decodeFloat32(s.penalty, s.penaltyCells) : null;
    this.eventsSent = s.events.length;
    for (const id of s.unpowered ?? []) this.served.set(id, 0);
    for (const id of s.unlinked ?? []) this.noService.add(id);
  }

  toJSON(): PowerState {
    const s = this.state;
    s.rooftopIds = [...this.rooftopSet].sort((a, b) => a - b);
    const off: number[] = [];
    for (const [id, f] of this.served) if (f < 1) off.push(id);
    if (off.length) s.unpowered = off.sort((a, b) => a - b); else delete s.unpowered;
    if (this.noService.size) s.unlinked = [...this.noService].sort((a, b) => a - b); else delete s.unlinked;
    if (this.penaltyGrid) { s.penalty = encodeFloat32(this.penaltyGrid); s.penaltyCells = this.penaltyGrid.length; } else { s.penalty = ''; s.penaltyCells = 0; }
    return s;
  }

  /** Vrai si la partie n'a ni installation, ni ligne, ni réglage modifié (aucune section, aucun delta). */
  isIdle(ctx: PluginContext): boolean {
    if (this.state.lines.length || this.state.cables?.length || this.state.events.length || this.rooftopSet.size) return false;
    const s = this.state.settings;
    if (s.funding !== 1 || s.rooftops || s.raccordement || s.vente === false || s.prixVente !== undefined || s.priorities.join() !== DEFAULT_PRIORITY_ORDER.join()) return false;
    return this.scanFacilities(ctx).size === 0;
  }

  /* --------------------------------- Lecture --------------------------------- */

  powerFactor(id: number): number { return this.served.get(id) ?? 1; }
  /** État du service d'un bâtiment : alimenté, coupé (raccordé mais délesté) ou hors de tout réseau. */
  serviceState(id: number): 'ok' | 'coupe' | 'aucun' {
    if (this.noService.has(id)) return 'aucun';
    return (this.served.get(id) ?? 1) >= 1 ? 'ok' : 'coupe';
  }
  /** Contribution du module à la satisfaction dans une cellule de la grille municipale (pénalité des coupures, ≤ 0). */
  satisfactionCell(k: number): number { return -(this.penaltyGrid?.[k] ?? 0); }
  /** Raccordement au réseau extérieur actif. */
  get importOn(): boolean { return this.state.settings.raccordement === true; }
  /** Vente du surplus aux villes voisines autorisée par le joueur (absent = oui). */
  get exportOn(): boolean { return this.state.settings.vente !== false; }
  /** Installations connues (état sauvegardé : identique avant et après un rechargement). */
  facilityCount(): number { return Math.max(this.facilities.size, Object.keys(this.state.facilities).length); }
  summary(): ElectriciteSummary | undefined { return this.summaryCache; }
  exportableKw(): number { return this.summaryCache?.exportableKw ?? 0; }

  private event(ctx: PluginContext, kind: ElectriciteEvent['kind'], message: string, ref?: number): void {
    const e: ElectriciteEvent = { at: ctx.clock.totalMinutes, kind, message };
    if (ref !== undefined) e.ref = ref;
    this.state.events.push(e);
    if (this.state.events.length > MAX_EVENTS) {
      const drop = this.state.events.length - MAX_EVENTS;
      this.state.events.splice(0, drop);
      this.eventsSent = Math.max(0, this.eventsSent - drop);
    }
    this.version++;
  }

  /* ------------------------------ Installations ------------------------------ */

  /** Installations présentes (bâtiments étiquetés), avec validation de site. */
  scanFacilities(ctx: PluginContext): Map<number, Facility> {
    const out = new Map<number, Facility>();
    const b = ctx.buildings;
    const st = b.store;
    const assets = ctx.catalog?.assets;
    if (!assets) return out;
    for (let i = 0; i < b.count; i++) {
      const a = assets[st.assetIndex[i]!];
      const kind = facilityKindOf(a);
      if (!kind || !a) continue;
      const id = st.id[i]!;
      const x = st.x[i]!, z = st.z[i]!;
      const halfSize = (Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE) / 2;
      let siteOk = true, siteReason = '';
      let damId: number | undefined, hydroVer: number | undefined;
      if (kind === 'hydro') {
        const prev = this.facilities.get(id);
        // Au pied d'un barrage : production selon la chute et le débit ; sinon, règle d'origine (au fil de l'eau,
        // au bord d'un cours d'eau). Validation mise en cache tant que ni la centrale ni les barrages ne changent.
        const hs = ctx.use<HydroDamService>('hydro');
        const ver = hs?.version();
        if (prev && prev.kind === 'hydro' && prev.x === x && prev.z === z && prev.hydroVer === ver) {
          siteOk = prev.siteOk; siteReason = prev.siteReason; damId = prev.damId; hydroVer = ver;
        } else {
          const dam = hs?.damNear(x, z, halfSize + DAM_PLANT_REACH) ?? null;
          if (dam) {
            const c = hydroDamSiteCheck(dam);
            siteOk = c.ok; siteReason = c.reason; damId = dam.id;
          } else {
            const c = hydroSiteCheck(x, z, halfSize, (px, pz) => ctx.terrain.isWet(px, pz));
            siteOk = c.ok; siteReason = c.reason;
          }
          hydroVer = ver;
        }
      }
      out.set(id, {
        id, kind, nameFr: a.nameFr, x, y: st.y[i]!, z, rot: st.rot[i]!, nominalKw: nominalKwOf(a, kind),
        radius: FACILITY_SPECS[kind].radius, halfSize, siteOk, siteReason, upkeep: a.upkeepPerMonth,
        capacityKwh: kind === 'batterie' ? capacityKwhOf(a) : 0,
        ...(damId !== undefined ? { damId } : {}), ...(hydroVer !== undefined ? { hydroVer } : {}),
      });
    }
    // Barrages hydroélectriques (façon CS2 : l'ouvrage est la centrale) : chaque barrage traversé par un débit produit
    // selon sa chute et son débit, sauf s'il a déjà une centrale (bâtiment) à son pied, qui le remplace (même loi de
    // production : pas de double comptage).
    const hs = ctx.use<HydroDamService>('hydro');
    const dams = hs?.dams?.() ?? [];
    if (dams.length) {
      const equipped = new Set<number>();
      for (const f of out.values()) if (f.damId !== undefined && f.siteOk) equipped.add(f.damId);
      for (const d of [...dams].sort((a, b) => a.id - b.id)) {
        if (equipped.has(d.id) || !(d.flowM3s > 0)) continue;
        const id = damFacilityId(d.id);
        out.set(id, {
          id, kind: 'hydro', nameFr: 'Barrage hydroélectrique', x: d.x, y: d.crest, z: d.z, rot: 0,
          nominalKw: Math.round(damPlantKw(d.headM, d.flowM3s, 'printemps')), radius: FACILITY_SPECS.hydro.radius,
          halfSize: d.lengthM / 2, siteOk: true,
          siteReason: d.headM > 0 ? `centrale du barrage en service : chute ${d.headM.toLocaleString('fr-FR')} m, débit ${Math.round(d.flowM3s)} m³/s` : `retenue en remplissage (débit ${Math.round(d.flowM3s)} m³/s) : la production commence avec la chute`,
          upkeep: damPlantUpkeepChf(d.headM, d.flowM3s), capacityKwh: 0, damId: d.id, dam: true,
          attach: [d.ax, d.az, d.bx, d.bz], damStat: { headM: d.headM, flowM3s: d.flowM3s },
        });
      }
    }
    return out;
  }

  /** Synchronise la liste des installations (nouvelles, démolies) : lignes orphelines retirées, sites signalés. */
  private syncFacilities(ctx: PluginContext): void {
    const next = this.scanFacilities(ctx);
    for (const [id, f] of next) {
      if (!this.facilities.has(id) && !(String(id) in this.state.facilities)) {
        this.state.facilities[String(id)] = { failedUntil: 0, failures: 0 };
        if (f.kind === 'hydro') {
          this.event(ctx, 'site', `${facLabel(f)} : ${f.siteReason}`, id);
          if (!f.siteOk) ctx.notify('warn', `${f.nameFr} : ${f.siteReason}.`);
        }
      }
    }
    for (const key of Object.keys(this.state.facilities)) if (!next.has(Number(key))) delete this.state.facilities[key];
    const before = this.state.lines.length;
    this.state.lines = this.state.lines.filter((l) => next.has(l.a) && next.has(l.b));
    if (this.state.lines.length !== before) this.version++;
    // Câbles souterrains : retirés avec l'installation démolie (extrémité « route » : conservés, inactifs sans route).
    if (this.state.cables?.length) {
      const nc = this.state.cables.length;
      this.state.cables = this.state.cables.filter((c) => next.has(c.a) && (c.b === 0 || next.has(c.b)));
      if (this.state.cables.length !== nc) this.version++;
    }
    this.facilities = next;
  }

  /* ---------------------------------- Lignes ---------------------------------- */

  lineLength(a: Facility, b: Facility): number { return Math.hypot(a.x - b.x, a.z - b.z); }

  /* ----------------------- Réseau de distribution par les routes ----------------------- */

  /**
   * Distribution basse / moyenne tension LE LONG DES ROUTES (comme l'eau) : un bâtiment est raccordé à une
   * installation (centrale ou poste) reliée à lui par le réseau routier. Composantes connexes des routes,
   * recalculées quand la voirie change.
   */
  private compVersion = -1;
  private nodeComp = new Map<number, number>();
  /** Composante routière de chaque installation (-1 : à plus de 80 m d'une route). */
  private facComp = new Map<number, number>();

  private refreshRoadComponents(ctx: PluginContext): void {
    const roads = ctx.roads;
    if (roads.version === this.compVersion) return;
    this.compVersion = roads.version;
    const parent = new Map<number, number>();
    const find = (a: number): number => { let r = a; while (parent.get(r)! !== r) r = parent.get(r)!; let x = a; while (parent.get(x)! !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
    for (const id of roads.nodeIds()) parent.set(id, id);
    for (const s of roads.segmentIds()) {
      const [a, b] = roads.endpoints(s);
      if (!parent.has(a) || !parent.has(b)) continue;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    this.nodeComp.clear();
    for (const id of parent.keys()) this.nodeComp.set(id, find(id));
  }

  /** Composante routière BRUTE d'un point (tronçon le plus proche dans `reach` m), -1 sinon. */
  private rawCompAt(ctx: PluginContext, x: number, z: number, reach: number): number {
    const s = ctx.roads.segmentNear(x, z, reach);
    if (!s) return -1;
    const [a] = ctx.roads.endpoints(s.segId);
    return this.nodeComp.get(a) ?? -1;
  }

  /** Composante routière d'un point, après fusion des réseaux routiers reliés par des câbles souterrains. */
  private compAt(ctx: PluginContext, x: number, z: number, reach: number): number {
    return this.canonComp(this.rawCompAt(ctx, x, z, reach));
  }

  /**
   * Câbles souterrains vers une route : l'installation rejoint le réseau routier de l'extrémité du câble. Si elle
   * touche déjà une autre route (ou a plusieurs câbles), les réseaux routiers concernés sont fusionnés (le courant
   * passe par l'installation). Union-find sur les composantes ; `cableAnchor` = composante de rattachement d'une
   * installation à plus de 80 m de toute route.
   */
  private compAlias = new Map<number, number>();
  private cableAnchor = new Map<number, number>();
  /** Composante brute de l'extrémité « route » de chaque câble (-1 : plus de route). */
  private cableRoadComp = new Map<number, number>();

  private canonComp(c: number): number {
    if (c < 0) return c;
    let r = c;
    while (this.compAlias.has(r) && this.compAlias.get(r) !== r) r = this.compAlias.get(r)!;
    if (r !== c) this.compAlias.set(c, r);
    return r;
  }

  private applyCables(ctx: PluginContext, facs: Facility[]): void {
    this.compAlias.clear();
    this.cableAnchor.clear();
    this.cableRoadComp.clear();
    const cables = this.state.cables ?? [];
    if (!cables.length) return;
    const raw = new Map<number, number>();
    for (const f of facs) raw.set(f.id, this.rawCompAt(ctx, f.x, f.z, ROAD_ATTACH_M));
    const union = (a: number, b: number): void => {
      const ra = this.canonComp(a), rb = this.canonComp(b);
      if (ra !== rb) this.compAlias.set(Math.max(ra, rb), Math.min(ra, rb));
    };
    for (const c of cables) {
      if (c.b !== 0 || c.bx === undefined || c.bz === undefined) continue;
      const rc = this.rawCompAt(ctx, c.bx, c.bz, CABLE_SPEC.roadSnapM);
      this.cableRoadComp.set(c.id, rc);
      if (rc < 0 || !raw.has(c.a)) continue;
      const own = raw.get(c.a)!;
      const anchor = own >= 0 ? own : this.cableAnchor.get(c.a) ?? -1;
      if (anchor >= 0) union(anchor, rc);
      else this.cableAnchor.set(c.a, rc);
    }
  }

  /** Câbles souterrains entre deux installations existantes. */
  private facilityCables(): CableState[] {
    return (this.state.cables ?? []).filter((c) => c.b > 0 && this.facilities.has(c.a) && this.facilities.has(c.b));
  }

  /**
   * Raccordements locaux automatiques (réseau moyenne tension) : deux installations distantes de moins que le plus
   * petit de leurs rayons de distribution sont reliées sans ligne HT (capacité limitée, pertes plus fortes).
   */
  localLinks(): [number, number, number, boolean][] {
    const facs = [...this.facilities.values()].sort((a, b) => a.id - b.id);
    const out: [number, number, number, boolean][] = [];
    for (let i = 0; i < facs.length; i++) {
      for (let j = i + 1; j < facs.length; j++) {
        const a = facs[i]!, b = facs[j]!;
        const d = this.lineLength(a, b);
        // Même réseau routier (distribution le long des routes, non bloquante) ; repli : voisines (parc éolien).
        const ca = this.facComp.get(a.id) ?? -1, cb = this.facComp.get(b.id) ?? -1;
        const sameRoad = ca >= 0 && ca === cb;
        if (sameRoad || d <= FACILITY_LINK_M) out.push([a.id, b.id, d, sameRoad]);
      }
    }
    return out;
  }

  /**
   * Installations isolées : leur îlot (lignes HT, même en panne, et raccordements automatiques) ne touche aucune
   * route. Elles ne peuvent alimenter que les bâtiments à moins de 80 m : « Reliez la centrale à une route ».
   */
  private isolatedSet(): Set<number> {
    const parent = new Map<number, number>([...this.facilities.keys()].map((id) => [id, id]));
    const find = (a: number): number => { let r = a; while (parent.get(r)! !== r) r = parent.get(r)!; parent.set(a, r); return r; };
    const join = (a: number, b: number): void => { if (!parent.has(a) || !parent.has(b)) return; const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
    for (const l of this.state.lines) join(l.a, l.b);
    for (const c of this.facilityCables()) join(c.a, c.b);
    for (const [a, b] of this.localLinks()) join(a, b);
    const linked = new Set<number>();
    for (const f of this.facilities.values()) if ((this.facComp.get(f.id) ?? -1) >= 0) linked.add(find(f.id));
    const out = new Set<number>();
    for (const f of this.facilities.values()) if (!linked.has(find(f.id))) out.add(f.id);
    return out;
  }

  /** Signale (une fois) les installations isolées nouvelles ; réarme celles qui ont été reliées. */
  private reportIsolated(ctx: PluginContext, isolated: Set<number>): void {
    const before = new Set(this.state.isolatedNotified ?? []);
    const fresh = [...isolated].filter((id) => !before.has(id)).sort((a, b) => a - b);
    const keep = [...isolated].sort((a, b) => a - b);
    if (keep.length) this.state.isolatedNotified = keep; else delete this.state.isolatedNotified;
    if (!fresh.length) return;
    const f0 = this.facilities.get(fresh[0]!)!;
    const msg = fresh.length === 1
      ? `${facLabel(f0)} isolée : ${isolatedHint(f0.kind)}`
      : `${fresh.length} installations électriques isolées : ${isolatedHint('thermique')}`;
    this.event(ctx, 'site', msg, f0.id);
    ctx.notify('warn', msg);
  }

  quoteLine(ctx: PluginContext, a: number, b: number): { ok: true; lengthM: number; cost: number; upkeepPerMonth: number } | { ok: false; code: string; message: string } {
    this.syncFacilities(ctx);
    const fa = this.facilities.get(a), fb = this.facilities.get(b);
    if (!fa || !fb) return { ok: false, code: 'NOT_FOUND', message: 'Les deux extrémités doivent être des centrales ou des postes' };
    if (a === b) return { ok: false, code: 'INVALID_ARGS', message: 'Une ligne relie deux installations différentes' };
    const L = this.lineLength(fa, fb);
    if (L > LINE_SPEC.maxLengthM) return { ok: false, code: 'OUT_OF_BOUNDS', message: `Portée trop longue (${Math.round(L)} m > ${LINE_SPEC.maxLengthM} m) : ajouter un poste intermédiaire` };
    if (this.state.lines.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return { ok: false, code: 'COLLISION', message: 'Ces installations sont déjà reliées' };
    return { ok: true, lengthM: L, ...lineCost(L) };
  }

  buildLine(ctx: PluginContext, a: number, b: number): { ok: true; line: LineView; cost: number } | { ok: false; code: string; message: string } {
    const q = this.quoteLine(ctx, a, b);
    if (!q.ok) return q;
    const line: LineState = { id: this.state.nextLineId++, a, b, lengthM: Math.round(q.lengthM * 10) / 10, failedUntil: 0, builtAt: ctx.clock.totalMinutes };
    this.state.lines.push(line);
    this.state.investments += q.cost;
    const m = this.getMunicipal();
    const fa = this.facilities.get(a)!, fb = this.facilities.get(b)!;
    if (m) {
      m.budget.post('expense', 'investissement:lignes_ht', centsToChf(q.cost), 'electricite');
      const cause = m.effects.cause({ kind: 'electricite:ligne', label: `Ligne HT ${fa.nameFr} – ${fb.nameFr}`, source: 'joueur', at: ctx.clock.totalMinutes, x: (fa.x + fb.x) / 2, z: (fa.z + fb.z) / 2, ref: line.id });
      m.effects.record(cause, 'budget:investissement', -centsToChf(q.cost), 'CHF', ctx.clock.totalMinutes, { x: (fa.x + fb.x) / 2, z: (fa.z + fb.z) / 2 });
    }
    this.event(ctx, 'ligne', `Ligne HT construite (${(q.lengthM / 1000).toFixed(2)} km, ${Math.round(q.cost / 100).toLocaleString('fr-FR')} CHF)`, line.id);
    this.allocate(ctx, false);
    return { ok: true, line: this.lineViews.find((l) => l.id === line.id)!, cost: q.cost };
  }

  removeLine(ctx: PluginContext, id: number): boolean {
    const n = this.state.lines.length;
    this.state.lines = this.state.lines.filter((l) => l.id !== id);
    if (this.state.lines.length === n) return false;
    this.event(ctx, 'ligne', `Ligne HT n° ${id} démolie`, id);
    this.allocate(ctx, false);
    return true;
  }

  /* ------------------------------ Câbles souterrains ------------------------------ */

  /**
   * Résout et valide un tracé de câble : chaque extrémité est une installation (`id`) ou un point de route (`x`, `z`,
   * aimanté sur l'axe à moins de `CABLE_SPEC.roadSnapM`). Au moins une installation ; aucune collision (le câble
   * passe sous les routes, les bâtiments et l'eau).
   */
  private resolveCable(ctx: PluginContext, ea: CableEnd, eb: CableEnd):
    { ok: true; a: Facility; b: Facility | null; bx: number; bz: number; lengthM: number } | { ok: false; code: string; message: string } {
    this.syncFacilities(ctx);
    const end = (e: CableEnd): { f: Facility } | { x: number; z: number } | { error: { code: string; message: string } } => {
      if (e && typeof e.id === 'number') {
        const f = this.facilities.get(e.id);
        return f ? { f } : { error: { code: 'NOT_FOUND', message: 'Un câble part d’une installation électrique (centrale, éolienne, poste, batteries) ou d’une route' } };
      }
      if (e && typeof e.x === 'number' && typeof e.z === 'number' && Number.isFinite(e.x) && Number.isFinite(e.z)) {
        const s = ctx.roads.segmentNear(e.x, e.z, CABLE_SPEC.roadSnapM);
        return s ? { x: s.x, z: s.z } : { error: { code: 'NOT_FOUND', message: 'Aucune route à cet endroit : touchez une route ou une installation électrique' } };
      }
      return { error: { code: 'INVALID_ARGS', message: 'Extrémité du câble invalide' } };
    };
    let A = end(ea), B = end(eb);
    if ('error' in A) return { ok: false, ...A.error };
    if ('error' in B) return { ok: false, ...B.error };
    if (!('f' in A)) { if (!('f' in B)) return { ok: false, code: 'INVALID_ARGS', message: 'Un câble souterrain relie une installation électrique à une route ou à une autre installation (pas deux routes)' }; [A, B] = [B, A]; }
    let fa = (A as { f: Facility }).f;
    let fb = 'f' in B ? B.f : null;
    // Barrage (identifiant négatif) : toujours en extrémité `a` (b > 0 : installation, b = 0 : route).
    if (fb && fb.id < 0) {
      if (fa.id < 0) return { ok: false, code: 'INVALID_ARGS', message: 'Reliez un barrage à une route ou à une installation (pas à un autre barrage)' };
      [fa, fb] = [fb, fa];
    }
    if (fb && fb.id === fa.id) return { ok: false, code: 'INVALID_ARGS', message: 'Un câble relie deux extrémités différentes' };
    const bx = fb ? fb.x : (B as { x: number }).x, bz = fb ? fb.z : (B as { z: number }).z;
    const L = Math.hypot(bx - fa.x, bz - fa.z);
    if (L < CABLE_SPEC.minLengthM) return { ok: false, code: 'INVALID_ARGS', message: `Câble trop court (${Math.round(L)} m < ${CABLE_SPEC.minLengthM} m)` };
    if (L > CABLE_SPEC.maxLengthM) return { ok: false, code: 'OUT_OF_BOUNDS', message: `Câble trop long (${Math.round(L)} m > ${CABLE_SPEC.maxLengthM} m) : rapprochez-vous d’une route ou posez un relais` };
    const cables = this.state.cables ?? [];
    if (fb) {
      if (cables.some((c) => (c.a === fa.id && c.b === fb.id) || (c.a === fb.id && c.b === fa.id))) return { ok: false, code: 'COLLISION', message: 'Ces installations sont déjà reliées par un câble' };
    } else {
      this.refreshRoadComponents(ctx);
      const rc = this.rawCompAt(ctx, bx, bz, CABLE_SPEC.roadSnapM);
      const dup = cables.some((c) => c.a === fa.id && c.b === 0 && c.bx !== undefined && c.bz !== undefined && this.rawCompAt(ctx, c.bx, c.bz, CABLE_SPEC.roadSnapM) === rc);
      if (dup) return { ok: false, code: 'COLLISION', message: 'Cette installation est déjà reliée à ce réseau routier par un câble' };
    }
    return { ok: true, a: fa, b: fb, bx, bz, lengthM: L };
  }

  quoteCable(ctx: PluginContext, a: CableEnd, b: CableEnd): { ok: true; lengthM: number; cost: number; upkeepPerMonth: number } | { ok: false; code: string; message: string } {
    const r = this.resolveCable(ctx, a, b);
    if (!r.ok) return r;
    const c = cableCost(r.lengthM);
    if (ctx.economy.bankrupt || ctx.economy.money < centsToChf(c.cost)) return { ok: false, code: 'INSUFFICIENT_FUNDS', message: `Fonds insuffisants (${Math.round(c.cost / 100).toLocaleString('fr-FR')} CHF)` };
    return { ok: true, lengthM: r.lengthM, ...c };
  }

  buildCable(ctx: PluginContext, a: CableEnd, b: CableEnd): { ok: true; cable: CableView; cost: number } | { ok: false; code: string; message: string } {
    const q = this.quoteCable(ctx, a, b);
    if (!q.ok) return q;
    const r = this.resolveCable(ctx, a, b);
    if (!r.ok) return r;
    const id = this.state.nextCableId ?? 1;
    this.state.nextCableId = id + 1;
    const cable: CableState = { id, a: r.a.id, b: r.b ? r.b.id : 0, lengthM: Math.round(r.lengthM * 10) / 10, builtAt: ctx.clock.totalMinutes };
    if (!r.b) { cable.bx = Math.round(r.bx * 100) / 100; cable.bz = Math.round(r.bz * 100) / 100; }
    (this.state.cables ??= []).push(cable);
    this.state.investments += q.cost;
    const m = this.getMunicipal();
    const label = `Câble souterrain ${r.a.nameFr} – ${r.b ? r.b.nameFr : 'route'}`;
    const mx = (r.a.x + r.bx) / 2, mz = (r.a.z + r.bz) / 2;
    if (m) {
      m.budget.post('expense', 'investissement:cables_souterrains', centsToChf(q.cost), 'electricite');
      const cause = m.effects.cause({ kind: 'electricite:ligne', label, source: 'joueur', at: ctx.clock.totalMinutes, x: mx, z: mz, ref: id });
      m.effects.record(cause, 'budget:investissement', -centsToChf(q.cost), 'CHF', ctx.clock.totalMinutes, { x: mx, z: mz });
    } else ctx.economy.applyService(-centsToChf(q.cost), true);
    this.event(ctx, 'ligne', `${label} posé (${Math.round(q.lengthM)} m, ${Math.round(q.cost / 100).toLocaleString('fr-FR')} CHF)`, id);
    this.allocate(ctx, false);
    return { ok: true, cable: this.cableViews.find((c) => c.id === id) ?? this.cableView(cable), cost: q.cost };
  }

  removeCable(ctx: PluginContext, id: number): boolean {
    const list = this.state.cables;
    if (!list) return false;
    const n = list.length;
    this.state.cables = list.filter((c) => c.id !== id);
    if (this.state.cables.length === n) return false;
    this.event(ctx, 'ligne', `Câble souterrain n° ${id} retiré`, id);
    this.allocate(ctx, false);
    return true;
  }

  private cableView(c: CableState): CableView {
    const fa = this.facilities.get(c.a), fb = c.b > 0 ? this.facilities.get(c.b) : undefined;
    const bx = fb ? fb.x : c.bx ?? 0, bz = fb ? fb.z : c.bz ?? 0;
    const active = c.b > 0 ? !!fb : (this.cableRoadComp.get(c.id) ?? -1) >= 0;
    return { id: c.id, a: c.a, b: c.b, ax: fa?.x ?? bx, az: fa?.z ?? bz, bx, bz, lengthM: c.lengthM, capacityKw: CABLE_SPEC.capacityKw, load: this.cableLoad.get(c.id) ?? 0, active };
  }

  /** Relie l'installation `id` à l'installation alimentée (ou centrale) la plus proche non encore reliée. */
  autoConnect(ctx: PluginContext, id: number): ReturnType<PowerSystem['buildLine']> {
    this.syncFacilities(ctx);
    const f = this.facilities.get(id);
    if (!f) return { ok: false, code: 'NOT_FOUND', message: 'Installation inconnue' };
    const energized = this.energizedSet();
    let best: Facility | undefined, bestD = Infinity;
    for (const g of this.facilities.values()) {
      if (g.id === id) continue;
      if (this.state.lines.some((l) => (l.a === id && l.b === g.id) || (l.b === id && l.a === g.id))) continue;
      const bonus = energized.has(g.id) && !energized.has(id) ? 0 : 1;
      const d = this.lineLength(f, g) + bonus * 1e6;
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return { ok: false, code: 'NOT_FOUND', message: 'Aucune autre installation à relier' };
    return this.buildLine(ctx, id, best.id);
  }

  /* --------------------------------- Réglages --------------------------------- */

  private settingCause(ctx: PluginContext, label: string): number {
    const m = this.getMunicipal();
    return m ? m.effects.cause({ kind: 'electricite:reglage', label, source: 'joueur', at: ctx.clock.totalMinutes }) : 0;
  }

  setFunding(ctx: PluginContext, funding: number): void {
    const f = Math.round(Math.min(FUNDING_MAX, Math.max(FUNDING_MIN, funding)) * 100) / 100;
    const before = this.state.settings.funding;
    if (f === before) return;
    this.state.settings.funding = f;
    const cause = this.settingCause(ctx, `Financement de l'entretien électrique : ${Math.round(before * 100)} % -> ${Math.round(f * 100)} %`);
    const m = this.getMunicipal();
    if (m && cause) {
      m.effects.record(cause, 'electricite:taux_panne', failureMultiplier(f) / failureMultiplier(before), '×', ctx.clock.totalMinutes, {}, 'multiplicateur du taux de pannes');
      m.effects.record(cause, 'budget:entretien_reseau', Math.round(this.upkeepNominal() * (f - before)), '¢/mois', ctx.clock.totalMinutes);
    }
    this.event(ctx, 'reglage', `Financement de l'entretien : ${Math.round(f * 100)} %`);
  }

  setPriorities(ctx: PluginContext, order: ConsumerClass[]): boolean {
    if (order.length !== CONSUMER_CLASSES.length || new Set(order).size !== order.length || !order.every((c) => CONSUMER_CLASSES.includes(c))) return false;
    const before = this.allocate(ctx, false).byClass;
    this.state.settings.priorities = [...order];
    const cause = this.settingCause(ctx, `Priorités de délestage : ${order.join(' > ')}`);
    this.event(ctx, 'reglage', `Priorités de délestage modifiées`);
    const after = this.allocate(ctx, false).byClass;
    const m = this.getMunicipal();
    if (m && cause) {
      for (const a of after) {
        const b = before.find((x) => x.cls === a.cls)!;
        const dkw = a.deliveredKw - b.deliveredKw;
        if (Math.abs(dkw) > 1e-6 || a.cut !== b.cut) m.effects.record(cause, `electricite:livre:${a.cls}`, dkw, 'kW', ctx.clock.totalMinutes, {}, `coupés : ${b.cut} -> ${a.cut}`);
      }
      m.effects.record(cause, 'electricite:priorites', 0, 'rang', ctx.clock.totalMinutes, {}, order.join(' > '));
    }
    return true;
  }

  /**
   * Raccordement au réseau extérieur : à l'activation, frais de raccordement (investissement ponctuel, CHF) ;
   * refusé si la trésorerie ne les couvre pas. La désactivation est gratuite (un nouveau raccordement repaie).
   */
  setRaccordement(ctx: PluginContext, on: boolean): { ok: true } | { ok: false; code: string; message: string } {
    if (on === this.importOn) return { ok: true };
    if (on) {
      const fee = IMPORT_SPEC.connectionChf;
      if (ctx.economy.bankrupt || ctx.economy.money < fee) return { ok: false, code: 'INSUFFICIENT_FUNDS', message: `Fonds insuffisants pour le raccordement (${fee.toLocaleString('fr-FR')} CHF)` };
      const m = this.getMunicipal();
      if (m) m.budget.post('expense', 'investissement:raccordement_electrique', fee, 'electricite');
      else ctx.economy.applyService(-fee, true);
      this.state.investments += fee * 100;
    }
    this.state.settings = { ...this.state.settings, raccordement: on };
    this.event(ctx, 'reglage', on ? 'Raccordement au réseau extérieur mis en service' : 'Raccordement au réseau extérieur résilié');
    this.version++;
    this.allocate(ctx, false);
    return { ok: true };
  }

  /** Prix de vente du surplus choisi par le joueur (¢/kWh). */
  get exportPrice(): number { return clampExportPrice(this.state.settings.prixVente); }

  /** Règle le prix de vente du surplus (¢/kWh, borné). */
  setPrixVente(ctx: PluginContext, price: number): void {
    const p = clampExportPrice(price);
    if (p === this.exportPrice) return;
    const next = { ...this.state.settings };
    if (p === EXPORT_SPEC.priceCentsPerKwh) delete next.prixVente; else next.prixVente = p;
    this.state.settings = next;
    this.event(ctx, 'reglage', `Prix de vente de l'électricité : ${p.toLocaleString('fr-FR')} ct/kWh`);
    this.version++;
    this.allocate(ctx, false);
  }

  /** Vente du surplus aux villes voisines : activée (par défaut) ou désactivée par le joueur. */
  setVente(ctx: PluginContext, on: boolean): void {
    if (on === this.exportOn) return;
    const next: ElectriciteSettings = { ...this.state.settings };
    if (on) delete next.vente; else next.vente = false;
    this.state.settings = next;
    this.event(ctx, 'reglage', on ? 'Vente du surplus d\'électricité aux villes voisines activée' : 'Vente du surplus d\'électricité aux villes voisines désactivée');
    this.version++;
    this.allocate(ctx, false);
  }

  setRooftops(ctx: PluginContext, enabled: boolean): void {
    if (this.state.settings.rooftops === enabled) return;
    this.state.settings.rooftops = enabled;
    this.settingCause(ctx, `Programme de toitures solaires ${enabled ? 'lancé' : 'arrêté'}`);
    this.event(ctx, 'reglage', `Toitures solaires : programme ${enabled ? 'lancé' : 'arrêté (installations conservées)'}`);
  }

  /** Priorité numérique d'une classe (rang inversé : la première de la liste a la plus haute priorité). */
  priorityOf(cls: ConsumerClass): number {
    const i = this.state.settings.priorities.indexOf(cls);
    return (CONSUMER_CLASSES.length - (i < 0 ? CONSUMER_CLASSES.length : i)) * 2;
  }

  /* ------------------------------ Météo / soleil ------------------------------ */

  windNow(ctx: PluginContext): { ms: number; source: ElectriciteSummary['windSource'] } {
    if (this.state.windForce !== null) return { ms: this.state.windForce, source: 'force' };
    const w = ctx.use<WeatherLike>(WEATHER_SERVICE);
    const ww = w ? (typeof w.state === 'function' ? w.state()?.wind : w.wind) : undefined;
    if (typeof ww === 'number' && Number.isFinite(ww)) return { ms: Math.max(0, ww), source: 'meteo' };
    return { ms: windProfile(ctx.clock.totalMinutes, ctx.params?.seed ?? 0), source: 'profil' };
  }

  cloudNow(ctx: PluginContext): number {
    const w = ctx.use<WeatherLike>(WEATHER_SERVICE);
    const c = w ? (typeof w.state === 'function' ? w.state()?.cloud : w.cloud) : undefined;
    return typeof c === 'number' && Number.isFinite(c) ? c : 0;
  }

  /* -------------------------------- Fiabilité --------------------------------- */

  private facilityState(id: number): FacilityState {
    const k = String(id);
    return (this.state.facilities[k] ??= { failedUntil: 0, failures: 0 });
  }

  /** Tirage horaire des pannes et fin des réparations. Renvoie le nombre de nouvelles pannes. */
  rollFailures(ctx: PluginContext): number {
    const now = ctx.clock.totalMinutes;
    const fund = this.state.settings.funding;
    const mult = failureMultiplier(fund);
    const rep = repairMultiplier(fund);
    const m = this.getMunicipal();
    let n = 0;
    const ids = [...this.facilities.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const f = this.facilities.get(id)!;
      const fs = this.facilityState(id);
      if (fs.failedUntil > 0 && now >= fs.failedUntil) {
        fs.failedUntil = 0;
        this.event(ctx, 'reparation', `${facLabel(f)} réparée`, id);
      }
      const spec = FACILITY_SPECS[f.kind];
      const draw = ctx.rng.next();
      // Comme Cities: Skylines II (choix du joueur) : plus de panne aléatoire des installations. Le tirage est
      // conservé pour que la suite du générateur (lignes HT) reste identique.
      if (PLANT_RANDOM_FAILURES && fs.failedUntil === 0 && draw < spec.failurePerHour * mult) {
        const hours = Math.max(1, Math.round(spec.repairHours * rep * (0.6 + 0.8 * ctx.rng.next())));
        fs.failedUntil = now + hours * 60;
        fs.failures++;
        n++;
        this.state.month.failures++;
        const msg = `Panne : ${facLabel(f)} hors service (réparation ≈ ${hours} h)`;
        this.event(ctx, 'panne', msg, id);
        ctx.notify('warn', msg);
        if (m) {
          const cause = m.effects.cause({ kind: 'electricite:panne', label: msg, source: 'electricite', at: now, x: f.x, z: f.z, ref: id });
          m.effects.record(cause, f.kind === 'poste' ? 'electricite:transformation' : 'electricite:capacite', -f.nominalKw, 'kW', now, { x: f.x, z: f.z, radius: f.radius }, `financement ${Math.round(fund * 100)} %`);
        }
      }
    }
    for (const l of this.state.lines) {
      if (l.failedUntil > 0 && now >= l.failedUntil) { l.failedUntil = 0; this.event(ctx, 'reparation', `Ligne HT n° ${l.id} réparée`, l.id); }
      const draw = ctx.rng.next();
      if (l.failedUntil === 0 && draw < LINE_SPEC.failurePerKmHour * (l.lengthM / 1000) * mult) {
        const hours = Math.max(1, Math.round(LINE_SPEC.repairHours * rep * (0.6 + 0.8 * ctx.rng.next())));
        l.failedUntil = now + hours * 60;
        n++;
        this.state.month.failures++;
        const msg = `Panne : ligne HT n° ${l.id} coupée (réparation ≈ ${hours} h)`;
        this.event(ctx, 'panne', msg, l.id);
        if (m) {
          const fa = this.facilities.get(l.a), fb = this.facilities.get(l.b);
          const x = fa && fb ? (fa.x + fb.x) / 2 : undefined, z = fa && fb ? (fa.z + fb.z) / 2 : undefined;
          const cause = m.effects.cause({ kind: 'electricite:panne', label: msg, source: 'electricite', at: now, ...(x !== undefined && z !== undefined ? { x, z } : {}), ref: l.id });
          m.effects.record(cause, 'electricite:transport', -LINE_SPEC.capacityKw, 'kW', now, x !== undefined && z !== undefined ? { x, z } : {}, `financement ${Math.round(fund * 100)} %`);
        }
      }
    }
    if (n) this.version++;
    return n;
  }

  /* -------------------------------- Production -------------------------------- */

  private availableKw(ctx: PluginContext, f: Facility, wind: number, sun: number): number {
    if (this.facilityState(f.id).failedUntil > 0) return 0;
    switch (f.kind) {
      case 'thermique': return f.nominalKw;
      case 'eolien': return f.nominalKw * windPowerShare(wind) * this.govRenew;
      case 'solaire': return f.nominalKw * sun * this.govRenew;
      case 'hydro': {
        if (!f.siteOk) return 0;
        if (f.damId !== undefined) {
          const d = ctx.use<HydroDamService>('hydro')?.dam(f.damId);
          if (!d) return 0;
          // Barrage-centrale : loi du type (chute × débit), sinon centrale au pied du barrage (sa puissance nominale).
          return f.dam ? damPlantKw(d.headM, d.flowM3s, ctx.clock.season) : hydroDamKw(f.nominalKw, d.headM, d.flowM3s, ctx.clock.season);
        }
        return f.nominalKw * hydroShare(ctx.clock.season);
      }
      case 'poste': return 0;
      // Batteries : puissance de décharge possible pendant l'heure (bornée par la puissance max et l'énergie stockée).
      case 'batterie': return Math.min(f.nominalKw, (this.facilityState(f.id).storedKwh ?? 0) * BATTERY_ONE_WAY);
    }
  }

  /**
   * Charge des batteries par le SURPLUS des centrales locales (capacité disponible non appelée), par îlot du réseau
   * (installations reliées par la voirie, des raccordements locaux ou des lignes en service). Le surplus utilisé est
   * reporté sur la production des centrales (`outputOf`, pollution comprise). Renvoie la puissance de charge par batterie.
   */
  private chargeBatteries(facs: Facility[], avail: Map<number, number>, outputOf: Map<number, number>): Map<number, number> {
    const out = new Map<number, number>();
    const bats = facs.filter((f) => f.kind === 'batterie' && this.facilityState(f.id).failedUntil === 0 && (outputOf.get(f.id) ?? 0) <= 1e-6);
    if (!bats.length) return out;
    // Îlots (union-find) : lignes en service et raccordements locaux.
    const parent = new Map<number, number>(facs.map((f) => [f.id, f.id]));
    const find = (a: number): number => { let r = a; while (parent.get(r)! !== r) r = parent.get(r)!; parent.set(a, r); return r; };
    const join = (a: number, b: number): void => { if (!parent.has(a) || !parent.has(b)) return; const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
    for (const l of this.state.lines) if (l.failedUntil === 0) join(l.a, l.b);
    for (const c of this.facilityCables()) join(c.a, c.b);
    for (const [a, b] of this.localLinks()) join(a, b);
    const surplus = new Map<number, number>();
    for (const f of facs) {
      if (f.kind === 'poste' || f.kind === 'batterie') continue;
      const s = Math.max(0, (avail.get(f.id) ?? 0) - (outputOf.get(f.id) ?? 0));
      if (s > 1e-6) surplus.set(find(f.id), (surplus.get(find(f.id)) ?? 0) + s);
    }
    const room = new Map<number, number>();
    for (const b of bats) {
      const r = Math.max(0, Math.min(b.nominalKw, (b.capacityKwh - (this.facilityState(b.id).storedKwh ?? 0)) / BATTERY_ONE_WAY));
      if (r > 1e-6) room.set(find(b.id), (room.get(find(b.id)) ?? 0) + r);
    }
    const used = new Map<number, number>();
    for (const [c, r] of room) used.set(c, Math.min(r, surplus.get(c) ?? 0));
    for (const b of bats) {
      const c = find(b.id), r = room.get(c) ?? 0, u = used.get(c) ?? 0;
      if (r <= 0 || u <= 0) continue;
      const mine = Math.max(0, Math.min(b.nominalKw, (b.capacityKwh - (this.facilityState(b.id).storedKwh ?? 0)) / BATTERY_ONE_WAY));
      out.set(b.id, (mine / r) * u);
    }
    // Production supplémentaire des centrales de l'îlot, au prorata de leur surplus.
    for (const f of facs) {
      if (f.kind === 'poste' || f.kind === 'batterie') continue;
      const c = find(f.id), s = surplus.get(c) ?? 0, u = used.get(c) ?? 0;
      if (s <= 0 || u <= 0) continue;
      const mine = Math.max(0, (avail.get(f.id) ?? 0) - (outputOf.get(f.id) ?? 0));
      outputOf.set(f.id, (outputOf.get(f.id) ?? 0) + (mine / s) * u);
    }
    return out;
  }

  /** Installations reliées au réseau au dernier relevé (pour les alertes). */
  private lastFed: Set<number> = new Set();
  /** Vrai si le bâtiment est une installation électrique reliée au réseau (centrale, poste, batterie). */
  isConnectedFacility(id: number): boolean { return this.facilities.has(id) && this.lastFed.has(id); }

  /** Installations reliées (lignes en service) à une centrale disponible. */
  private energizedSet(avail?: Map<number, number>): Set<number> {
    const adj = new Map<number, number[]>();
    for (const l of this.state.lines) {
      if (l.failedUntil > 0) continue;
      if (!this.facilities.has(l.a) || !this.facilities.has(l.b)) continue;
      (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push(l.b);
      (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push(l.a);
    }
    for (const c of this.facilityCables()) {
      (adj.get(c.a) ?? adj.set(c.a, []).get(c.a)!).push(c.b);
      (adj.get(c.b) ?? adj.set(c.b, []).get(c.b)!).push(c.a);
    }
    for (const [a, b] of this.localLinks()) {
      (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
    }
    const out = new Set<number>();
    const stack: number[] = [];
    for (const f of this.facilities.values()) {
      if (f.kind === 'poste') continue;
      const ok = avail ? (avail.get(f.id) ?? 0) > 0 : this.facilityState(f.id).failedUntil === 0;
      if (ok) { out.add(f.id); stack.push(f.id); }
    }
    while (stack.length) {
      const u = stack.pop()!;
      if (this.facilities.get(u)?.kind === 'poste' && this.facilityState(u).failedUntil > 0) continue; // poste en panne : pas de transit
      for (const v of adj.get(u) ?? []) if (!out.has(v)) { out.add(v); stack.push(v); }
    }
    return out;
  }

  /* -------------------------------- Répartition -------------------------------- */

  /** Heure de jeu : pannes, toitures, répartition, effets. */
  hour(ctx: PluginContext): void {
    this.syncFacilities(ctx);
    this.rollFailures(ctx);
    this.allocate(ctx, true);
    this.state.lastHourAt = ctx.clock.totalMinutes;
  }

  /**
   * Reconstruit le graphe municipal et répartit. `hourly` = vraie heure de jeu (énergie comptée, pollution,
   * satisfaction) ; sinon recalcul immédiat après une décision du joueur (état seulement).
   */
  allocate(ctx: PluginContext, hourly: boolean): ElectriciteSummary {
    if (!hourly) this.syncFacilities(ctx);
    const m = this.getMunicipal();
    const now = ctx.clock.totalMinutes;
    const hourOfDay = ctx.clock.hourOfDay;
    const season = ctx.clock.season;
    const wind = this.windNow(ctx);
    const cloud = this.cloudNow(ctx);
    const sun = solarShare(hourOfDay, season, cloud);

    // Politiques et recherche : demande d'électricité et production renouvelable.
    const gm = governanceModifiers((n) => ctx.use(n));
    this.govRenew = gm.renewableFactor;
    const govDemand = gm.powerDemandFactor;
    // Panne du réseau voisin (module `evenements`) : capacité du raccordement réduite pendant l'événement.
    this.importCapKw = IMPORT_SPEC.capacityKw * gm.powerImportFactor;
    const imp = this.importOn;
    // 1. Production disponible par installation.
    const avail = new Map<number, number>();
    for (const f of this.facilities.values()) avail.set(f.id, this.availableKw(ctx, f, wind.ms, sun));

    // 2. Consommateurs (demande horaire) et rattachement : installation la plus proche RELIÉE PAR LA ROUTE
    //    (réseau de distribution le long des routes) ; repli : installation à moins de 80 m (sans route).
    const facs = [...this.facilities.values()].sort((a, b) => a.id - b.id);
    this.refreshRoadComponents(ctx);
    this.applyCables(ctx, facs);
    this.facComp.clear();
    for (const f of facs) {
      let c = this.compAt(ctx, f.x, f.z, ROAD_ATTACH_M);
      // Barrage : raccordé par l'une de ses culées (route sur une rive) s'il n'y a pas de route près de son milieu.
      if (c < 0 && f.attach) for (let q = 0; q + 1 < f.attach.length && c < 0; q += 2) c = this.compAt(ctx, f.attach[q]!, f.attach[q + 1]!, ROAD_ATTACH_M);
      // Installation loin des routes reliée par un câble souterrain : elle rejoint le réseau routier du câble.
      this.facComp.set(f.id, c >= 0 ? c : this.canonComp(this.cableAnchor.get(f.id) ?? -1));
    }
    // Installations reliées à une centrale (topologie, pannes comprises) : un poste isolé plus proche ne doit pas
    // « capter » un bâtiment qu'un poste ou une centrale alimenté(e) peut desservir.
    const fed = this.energizedSet();
    this.lastFed = fed;
    const geom = m?.grids.defaultGeometry;
    const consumers: Consumer[] = [];
    const st = ctx.buildings.store;
    const assets = ctx.catalog?.assets ?? [];
    const seasonF = seasonDemandFactor(season);
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = assets[st.assetIndex[i]!];
      if (!a || facilityKindOf(a)) continue;
      if (a.category === 'vehicle' || a.footprint.tilesX * a.footprint.tilesZ === 0) continue;
      const cls = consumerClassOf(a);
      const tiles = a.footprint.tilesX * a.footprint.tilesZ;
      const residents = st.residents[i]!, workers = st.workers[i]!;
      const demand = baseDemandKw(cls, tiles, residents, workers, a.capacity.jobs) * hourlyFactor(cls, hourOfDay) * seasonF * govDemand;
      const x = st.x[i]!, z = st.z[i]!;
      let hub = NO_HUB, best = Infinity, fedHub = NO_HUB, fedBest = Infinity;
      const comp = this.compAt(ctx, x, z, ROAD_ATTACH_M);
      for (const f of facs) {
        const d = Math.hypot(f.x - x, f.z - z);
        const linked = (comp >= 0 && this.facComp.get(f.id) === comp) || d <= LOCAL_FALLBACK_M;
        if (!linked) continue;
        if (d < best) { best = d; hub = f.id; }
        const usable = fed.has(f.id) && !(f.kind === 'poste' && this.facilityState(f.id).failedUntil > 0);
        if (usable && d < fedBest) { fedBest = d; fedHub = f.id; }
      }
      // Priorité à l'installation alimentée la plus proche ; repli : la plus proche (réseau isolé, coupé).
      if (fedHub !== NO_HUB) hub = fedHub;
      // Aucune installation : réseau extérieur (raccordement) le long de la voirie.
      if (hub === NO_HUB && imp && comp >= 0) hub = IMPORT_HUB;
      let cell = -1;
      if (geom) {
        const ci = Math.min(geom.cols - 1, Math.max(0, Math.floor((x - geom.originX) / geom.cellSize)));
        const cj = Math.min(geom.rows - 1, Math.max(0, Math.floor((z - geom.originZ) / geom.cellSize)));
        cell = cj * geom.cols + ci;
      }
      consumers.push({ id: st.id[i]!, x, z, cls, demandKw: demand, residents, jobs: workers, hub, cell });
    }

    // 3. Toitures solaires (production répartie au nœud de distribution du logement).
    const rooftopByHub = new Map<number, number>();
    let rooftopKw = 0, rooftopNominal = 0, rooftopCount = 0;
    if (this.rooftopSet.size) {
      for (const c of consumers) {
        if (!this.rooftopSet.has(c.id)) continue;
        rooftopCount++;
        rooftopNominal += ROOFTOP_SPEC.peakKwPerBuilding;
        if (c.hub === NO_HUB) continue;
        const kw = ROOFTOP_SPEC.peakKwPerBuilding * sun;
        rooftopKw += kw;
        rooftopByHub.set(c.hub, (rooftopByHub.get(c.hub) ?? 0) + kw);
      }
    }

    // 4. Graphe municipal (reconstruit : la topologie suit les bâtiments et les lignes du module).
    const prio: Record<ConsumerClass, number> = {} as Record<ConsumerClass, number>;
    for (const c of CONSUMER_CLASSES) prio[c] = this.priorityOf(c);
    const demandBy = new Map<string, number>(); // `${hub}|${cls}`
    for (const c of consumers) if (c.hub !== NO_HUB) demandBy.set(`${c.hub}|${c.cls}`, (demandBy.get(`${c.hub}|${c.cls}`) ?? 0) + c.demandKw);

    // 5. Répartition puis choix des bâtiments servis (ordre tournant dans chaque (installation, classe)).
    //    L'énergie attribuée à une classe mais inutilisable (le bâtiment suivant ne tient pas dans le reliquat)
    //    est rendue : la demande de la classe est ramenée à la part utilisable et la répartition est refaite,
    //    ce qui libère le reliquat pour les classes moins prioritaires (2 à 3 itérations en pratique).
    const groups = new Map<string, Consumer[]>();
    for (const c of consumers) if (c.hub !== NO_HUB) (groups.get(`${c.hub}|${c.cls}`) ?? groups.set(`${c.hub}|${c.cls}`, []).get(`${c.hub}|${c.cls}`)!).push(c);
    // Délestage progressif : les bâtiments les plus anciens (identifiant croissant) gardent le courant, les derniers
    // raccordés sont coupés d'abord (et non toute la ville à tour de rôle).
    for (const list of groups.values()) list.sort((p, q) => p.id - q.id);
    const pick = (list: Consumer[], budget: number): { on: Set<number>; used: number } => {
      const on = new Set<number>();
      let used = 0;
      for (const c of list) if (c.demandKw <= budget - used + 1e-6) { on.add(c.id); used += c.demandKw; }
      return { on, used };
    };
    let report = this.runNetwork(m, facs, avail, rooftopByHub, demandBy, prio, imp);
    let picks = new Map<string, { on: Set<number>; used: number }>();
    for (let iter = 0; iter < 6; iter++) {
      picks = new Map();
      let wasted = false;
      for (const [key, list] of groups) {
        const got = report.deliveredBy.get(key) ?? 0;
        const pk = pick(list, got);
        picks.set(key, pk);
        if (got - pk.used > 1e-3 && pk.used < (demandBy.get(key) ?? 0) - 1e-6) { demandBy.set(key, pk.used); wasted = true; }
      }
      if (!wasted) break;
      report = this.runNetwork(m, facs, avail, rooftopByHub, demandBy, prio, imp);
    }
    this.served.clear();
    this.noService.clear();
    for (const c of consumers) if (c.hub === NO_HUB) { this.served.set(c.id, 0); this.noService.add(c.id); }
    for (const [key, list] of groups) {
      const pk = picks.get(key)!;
      for (const c of list) this.served.set(c.id, pk.on.has(c.id) ? 1 : 0);
    }

    // 6. Bilans.
    const byClass: ClassBalance[] = CONSUMER_CLASSES.map((cls) => ({ cls, priority: prio[cls], demandKw: 0, deliveredKw: 0, buildings: 0, cut: 0, unlinked: 0 }));
    const clsIdx = new Map(CONSUMER_CLASSES.map((c, i) => [c, i]));
    let demandKw = 0, unlinkedKw = 0, cut = 0, unlinked = 0, jobsOff = 0, resOff = 0;
    this.cutList = [];
    for (const c of consumers) {
      const b = byClass[clsIdx.get(c.cls)!]!;
      b.buildings++;
      b.demandKw += c.demandKw;
      demandKw += c.demandKw;
      const on = this.served.get(c.id) === 1;
      if (on) b.deliveredKw += c.demandKw;
      else {
        if (c.hub === NO_HUB) { unlinked++; b.unlinked++; unlinkedKw += c.demandKw; } else { cut++; b.cut++; this.cutList.push(c.id); }
        jobsOff += c.jobs; resOff += c.residents;
      }
    }
    this.cutList.sort((a, b) => a - b);
    // Batteries : décharge appelée par la répartition, charge par le surplus des centrales (après la répartition).
    let dischargeKw = 0;
    for (const f of facs) if (f.kind === 'batterie') dischargeKw += report.outputOf.get(f.id) ?? 0;
    const charge = this.chargeBatteries(facs, avail, report.outputOf);
    let chargeKw = 0;
    for (const v of charge.values()) chargeKw += v;
    const bySource: SourceBalance[] = SOURCE_IDS.map((source) => ({ source, nominalKw: 0, availableKw: 0, outputKw: 0, count: 0 }));
    const srcIdx = new Map<SourceId, number>(SOURCE_IDS.map((s, i) => [s, i]));
    let availableKw = 0;
    for (const f of facs) {
      if (f.kind === 'poste' || f.kind === 'batterie') continue;
      const s = bySource[srcIdx.get(f.kind as PlantType)!]!;
      s.count++; s.nominalKw += f.nominalKw; s.availableKw += avail.get(f.id)!; s.outputKw += report.outputOf.get(f.id) ?? 0;
      availableKw += avail.get(f.id)!;
    }
    const roof = bySource[srcIdx.get('toitures')!]!;
    roof.count = rooftopCount; roof.nominalKw = rooftopNominal; roof.availableKw = rooftopKw; roof.outputKw = report.rooftopOut;
    availableKw += rooftopKw;
    const importedKw = report.imported;
    // Production des centrales et toitures : hors réseau voisin et hors décharge des batteries, recharge comprise.
    const producedKw = Math.max(0, report.produced - importedKw - dischargeKw + chargeKw);
    const deliveredKw = byClass.reduce((t, b) => t + b.deliveredKw, 0);
    const summary: ElectriciteSummary = {
      at: now, hour: Math.round(hourOfDay * 100) / 100,
      availableKw, producedKw, demandKw, deliveredKw, lossesKw: report.losses,
      shortfallKw: Math.max(0, demandKw - unlinkedKw - deliveredKw),
      unlinkedKw, exportableKw: Math.max(0, availableKw - producedKw),
      windMs: Math.round(wind.ms * 10) / 10, windSource: wind.source, sun: Math.round(sun * 1000) / 1000,
      bySource, byClass, buildings: consumers.length, powered: consumers.length - cut - unlinked, cut, unlinked,
      jobsWithoutPower: jobsOff, residentsWithoutPower: resOff,
    };
    if (imp) summary.importedKw = Math.round(importedKw * 10) / 10;
    // Énergie stockée : mise à jour seulement aux vraies heures de jeu (un recalcul immédiat ne charge rien).
    const bats = facs.filter((f) => f.kind === 'batterie');
    if (hourly) {
      for (const f of bats) {
        const fs = this.facilityState(f.id);
        const kw = (charge.get(f.id) ?? 0) - (report.outputOf.get(f.id) ?? 0);
        fs.storedKwh = Math.round(batteryStep(fs.storedKwh ?? 0, f.capacityKwh, kw) * 1000) / 1000;
      }
    }
    if (bats.length) {
      let stored = 0, cap = 0, pow = 0;
      for (const f of bats) {
        stored += this.facilityState(f.id).storedKwh ?? 0;
        cap += f.capacityKwh;
        if (this.facilityState(f.id).failedUntil === 0) pow += f.nominalKw;
      }
      // Autonomie : énergie restituable / décharge en cours (sinon / demande raccordée, si les centrales s'arrêtaient).
      const rate = dischargeKw > 1e-6 ? dischargeKw : Math.max(0, demandKw - unlinkedKw);
      const storage: StorageBalance = {
        count: bats.length, storedKwh: Math.round(stored), capacityKwh: cap, powerKw: pow,
        chargeKw: Math.round(chargeKw * 10) / 10, dischargeKw: Math.round(dischargeKw * 10) / 10, roundTrip: BATTERY_SPEC.roundTrip,
        autonomyH: rate > 1e-6 ? Math.round((stored * BATTERY_ONE_WAY / rate) * 10) / 10 : 0,
      };
      summary.storage = storage;
    }
    const nb = (k: SourceId): number => bySource[srcIdx.get(k)!]!.count;
    if (!imp && !bats.length && nb('thermique') + nb('hydro') === 0 && nb('eolien') + nb('solaire') > 0) summary.intermittentOnly = true;
    this.summaryCache = summary;

    // 7. Vues (rendu / interface).
    const energized = this.energizedSet(avail);
    const isolated = this.isolatedSet();
    this.reportIsolated(ctx, isolated);
    if (isolated.size) summary.isolatedFacilities = isolated.size;
    // Vente aux villes voisines : surplus éolien / solaire / hydro / toitures réellement disponible, ni consommé ni
    // stocké (la recharge des batteries est déjà comptée dans `outputOf`), installations reliées seulement.
    const exportKw = this.exportStep(ctx, facs, avail, report.outputOf, isolated, rooftopKw - report.rooftopOut, importedKw, gm.powerImportFactor, summary);
    this.updateRoads(ctx, fed, imp, summary);
    this.facilityViews = facs.map((f) => ({
      id: f.id, kind: f.kind, nameFr: f.nameFr, x: f.x, y: f.y, z: f.z, rot: f.rot,
      availableKw: avail.get(f.id)!, nominalKw: f.nominalKw, outputKw: report.outputOf.get(f.id) ?? 0,
      failedUntil: this.facilityState(f.id).failedUntil, siteOk: f.siteOk, energized: energized.has(f.id), radius: f.radius,
      roadLinked: (this.facComp.get(f.id) ?? -1) >= 0, ...(isolated.has(f.id) ? { isolated: true } : {}), ...(f.dam && f.damStat ? { dam: { ...f.damStat } } : {}),
      ...(f.kind === 'batterie' ? {
        storedKwh: Math.round(this.facilityState(f.id).storedKwh ?? 0), capacityKwh: f.capacityKwh,
        storageKw: Math.round(((charge.get(f.id) ?? 0) - (report.outputOf.get(f.id) ?? 0)) * 10) / 10,
      } : {}),
    }));
    this.lineViews = this.state.lines.map((l) => {
      const fa = this.facilities.get(l.a)!, fb = this.facilities.get(l.b)!;
      return { id: l.id, a: l.a, b: l.b, ax: fa.x, az: fa.z, bx: fb.x, bz: fb.z, lengthM: l.lengthM, capacityKw: LINE_SPEC.capacityKw, load: report.lineLoad.get(l.id) ?? 0, failedUntil: l.failedUntil };
    });
    this.cableViews = (this.state.cables ?? []).map((c) => this.cableView(c));
    this.updateCoverage(m, consumers);

    // 8. Effets de l'heure (énergie, pollution, satisfaction, registre).
    if (hourly) {
      this.state.month.producedKwh += producedKw;
      this.state.month.deliveredKwh += deliveredKw;
      this.state.month.shedKwh += summary.shortfallKw;
      if (importedKw > 0) this.state.month.importedKwh = (this.state.month.importedKwh ?? 0) + importedKw;
      if (exportKw > 0) this.sellExport(ctx, exportKw);
      if (m) this.hourlyEffects(ctx, m, summary, consumers);
    }
    this.version++;
    return summary;
  }

  /**
   * Surplus vendable et puissance vendue cette heure (kW). Vendable : capacité disponible non appelée des centrales
   * éoliennes, solaires et hydroélectriques en service et reliées (non isolées), plus les toitures, APRÈS la recharge
   * des batteries. Vendu : ce surplus multiplié par la part achetée au prix choisi (`exportDemandShare`), sans plafond ni lien exigé (ancien texte : réduit pendant une
   * panne du réseau voisin), seulement si la vente est activée, que la ville est reliée aux voisins (raccordement ou
   * connexion extérieure par route) et qu'elle n'achète rien cette heure-ci.
   */
  private exportStep(ctx: PluginContext, facs: Facility[], avail: Map<number, number>, outputOf: Map<number, number>, isolated: Set<number>, rooftopSpare: number, importedKw: number, capFactor: number, summary: ElectriciteSummary): number {
    let spare = Math.max(0, rooftopSpare);
    for (const f of facs) {
      if (f.kind !== 'eolien' && f.kind !== 'solaire' && f.kind !== 'hydro') continue;
      if (isolated.has(f.id) || this.facilityState(f.id).failedUntil > 0) continue;
      spare += Math.max(0, (avail.get(f.id) ?? 0) - (outputOf.get(f.id) ?? 0));
    }
    // Ni raccordement ni route au bord exigés, ni plafond : seul le prix choisi règle la part achetée par les voisins.
    void ctx; void capFactor;
    const sold = this.exportOn && importedKw <= 1e-6 ? spare * exportDemandShare(this.exportPrice) : 0;
    summary.sellableKw = Math.round(spare * 10) / 10;
    summary.exportedKw = Math.round(sold * 10) / 10;
    return sold > 1e-6 ? sold : 0;
  }

  /** Vente de l'heure : recette versée tout de suite à la trésorerie (poste détaillé du bilan), cumuls du mois. */
  private sellExport(ctx: PluginContext, kw: number): void {
    const cents = kw * this.exportPrice;
    const mo = this.state.month;
    mo.exportedKwh = (mo.exportedKwh ?? 0) + kw;
    mo.exportIncome = (mo.exportIncome ?? 0) + cents;
    ctx.economy.applyService(cents / 100, false, 'vente_electricite_exterieure');
    if (!this.state.exportNotified) {
      this.state.exportNotified = true;
      const msg = `Première vente d'électricité aux villes voisines : ${Math.round(kw).toLocaleString('fr-FR')} kW de surplus vendus à ${EXPORT_SPEC.priceCentsPerKwh.toLocaleString('fr-FR')} ct/kWh.`;
      ctx.notify('info', msg);
      this.event(ctx, 'reglage', msg);
    }
  }

  /** Construit le réseau municipal et répartit ; renvoie les quantités utiles (indépendantes des ids de nœuds). */
  private runNetwork(m: Municipal | undefined, facs: Facility[], avail: Map<number, number>, rooftopByHub: Map<number, number>, demandBy: Map<string, number>, prio: Record<ConsumerClass, number>, imp = false): {
    deliveredBy: Map<string, number>; outputOf: Map<number, number>; lineLoad: Map<number, number>; rooftopOut: number; produced: number; delivered: number; losses: number; imported: number;
  } {
    const deliveredBy = new Map<string, number>();
    const outputOf = new Map<number, number>();
    const lineLoad = new Map<number, number>();
    this.cableLoad.clear();
    const res = { deliveredBy, outputOf, lineLoad, rooftopOut: 0, produced: 0, delivered: 0, losses: 0, imported: 0 };
    if (!m) return res;
    m.networks.remove(ELECTRICITE_NETWORK);
    if (facs.length === 0 && !imp) return res;
    const net = m.networks.ensure(ELECTRICITE_NETWORK);
    const busOf = new Map<number, number>();
    const prodOf = new Map<number, number>(); // nœud producteur -> installation
    const roofNodes = new Set<number>();
    const consumerKey = new Map<number, string>();
    // Réseau extérieur : producteur plafonné, appelé en dernier, avec sa propre distribution (bâtiments sans
    // installation) et un lien vers chaque installation raccordée à la voirie (appoint du réseau local).
    let impBus = -1, impProd = -1;
    if (imp) {
      impBus = net.addNode({ role: 'junction', ref: IMPORT_HUB });
      const D = net.addNode({ role: 'junction', ref: IMPORT_HUB });
      net.addEdge(impBus, D, this.importCapKw, 0.01);
      impProd = net.addNode({ role: 'producer', capacity: this.importCapKw, cost: IMPORT_SPEC.meritCost, ref: IMPORT_HUB });
      net.addEdge(impProd, impBus, this.importCapKw, IMPORT_SPEC.lossShare);
      for (const cls of CONSUMER_CLASSES) {
        const d = demandBy.get(`${IMPORT_HUB}|${cls}`) ?? 0;
        if (d <= 0) continue;
        const C = net.addNode({ role: 'consumer', demand: d, priority: prio[cls], ref: IMPORT_HUB });
        consumerKey.set(C, `${IMPORT_HUB}|${cls}`);
        net.addEdge(D, C, d * 2 + 1, 0);
      }
    }
    for (const f of facs) {
      const failed = this.facilityState(f.id).failedUntil > 0;
      const J = net.addNode({ role: 'junction', x: f.x, z: f.z, ref: f.id, enabled: !(f.kind === 'poste' && failed) });
      busOf.set(f.id, J);
      if (imp && (this.facComp.get(f.id) ?? -1) >= 0) net.addEdge(impBus, J, this.importCapKw, 0);
      const D = net.addNode({ role: 'junction', x: f.x, z: f.z, ref: f.id, enabled: !(f.kind === 'poste' && failed) });
      // Installation reliée à une route : la distribution suit la voirie, sans plafond bloquant.
      const trCap = (this.facComp.get(f.id) ?? -1) >= 0 ? ROAD_GRID_KW : f.kind === 'poste' ? f.nominalKw : Math.max(PLANT_DISTRIBUTION_MIN_KW, f.nominalKw);
      net.addEdge(J, D, trCap, 0.01);
      if (f.kind !== 'poste') {
        const cap = avail.get(f.id) ?? 0;
        const P = net.addNode({ role: 'producer', capacity: cap, cost: FACILITY_SPECS[f.kind].meritCost, x: f.x, z: f.z, ref: f.id, enabled: cap > 0 });
        prodOf.set(P, f.id);
        net.addEdge(P, J, Math.max(cap, 1), 0);
      }
      const roof = rooftopByHub.get(f.id) ?? 0;
      if (roof > 0) {
        const R = net.addNode({ role: 'producer', capacity: roof, cost: 0, x: f.x, z: f.z, ref: f.id });
        roofNodes.add(R);
        net.addEdge(R, D, roof, 0);
      }
      for (const cls of CONSUMER_CLASSES) {
        const d = demandBy.get(`${f.id}|${cls}`) ?? 0;
        if (d <= 0) continue;
        const C = net.addNode({ role: 'consumer', demand: d, priority: prio[cls], x: f.x, z: f.z, ref: f.id });
        consumerKey.set(C, `${f.id}|${cls}`);
        net.addEdge(D, C, d * 2 + 1, 0);
      }
    }
    const lineEdge = new Map<number, number>();
    for (const l of this.state.lines) {
      const a = busOf.get(l.a), b = busOf.get(l.b);
      if (a === undefined || b === undefined) continue;
      const e = net.addEdge(a, b, LINE_SPEC.capacityKw, Math.min(0.5, LINE_SPEC.lossPerKm * (l.lengthM / 1000)));
      if (l.failedUntil > 0) net.setEdgeEnabled(e, false);
      lineEdge.set(e, l.id);
    }
    const cableEdge = new Map<number, number>();
    for (const c of this.facilityCables()) {
      const a = busOf.get(c.a), b = busOf.get(c.b);
      if (a === undefined || b === undefined) continue;
      cableEdge.set(net.addEdge(a, b, CABLE_SPEC.capacityKw, Math.min(0.5, CABLE_SPEC.lossPerKm * (c.lengthM / 1000))), c.id);
    }
    for (const [a, b, d, sameRoad] of this.localLinks()) net.addEdge(busOf.get(a)!, busOf.get(b)!, sameRoad ? ROAD_GRID_KW : LOCAL_LINK_KW, Math.min(0.5, LOCAL_LINK_LOSS_PER_KM * (d / 1000)));
    const r = m.networks.allocate(ELECTRICITE_NETWORK);
    for (const c of r.consumers) { const k = consumerKey.get(c.node); if (k) deliveredBy.set(k, c.delivered); }
    for (const p of r.producers) {
      if (roofNodes.has(p.node)) { res.rooftopOut += p.output; continue; }
      if (p.node === impProd) { res.imported += p.output; continue; }
      const f = prodOf.get(p.node);
      if (f !== undefined) outputOf.set(f, (outputOf.get(f) ?? 0) + p.output);
    }
    for (const e of r.edges) {
      const l = lineEdge.get(e.edge); if (l !== undefined) lineLoad.set(l, e.load);
      const c = cableEdge.get(e.edge); if (c !== undefined) this.cableLoad.set(c, e.load);
    }
    res.produced = r.produced; res.delivered = r.delivered; res.losses = r.losses;
    return res;
  }

  /* ---------------------- Réseau intégré aux routes (calque) ---------------------- */

  private roadGeomVersion = -1;
  private roadIds = new Int32Array(0);
  private roadOffsets = new Int32Array(1);
  private roadPoints = new Float32Array(0);
  private roadComp = new Int32Array(0);
  private roadLayer: ElectriciteRoads | undefined;
  private roadsSent = -1;

  /**
   * Routes alimentées : un tronçon l'est si son réseau routier (composante connexe) touche une installation reliée
   * à une centrale en service (pannes comprises, indépendamment du vent ou du soleil de l'heure), ou si le
   * raccordement au réseau voisin est actif (il dessert toute la voirie).
   */
  private updateRoads(ctx: PluginContext, fed: Set<number>, imp: boolean, summary: ElectriciteSummary): void {
    const net = ctx.roads;
    if (this.roadGeomVersion !== net.version) {
      this.roadGeomVersion = net.version;
      const ids = net.segmentIds().sort((a, b) => a - b);
      const offsets = new Int32Array(ids.length + 1);
      const comp = new Int32Array(ids.length);
      const pts: number[] = [];
      for (let s = 0; s < ids.length; s++) {
        const id = ids[s]!;
        comp[s] = this.nodeComp.get(net.endpoints(id)[0]) ?? -1;
        const c = net.curve(id);
        const k = Math.max(2, Math.min(9, Math.ceil(net.length(id) / 24) + 1));
        offsets[s] = pts.length / 2;
        for (let t = 0; t < k; t++) {
          const u = t / (k - 1), v = 1 - u;
          pts.push(v * v * v * c[0]! + 3 * v * v * u * c[2]! + 3 * v * u * u * c[4]! + u * u * u * c[6]!,
            v * v * v * c[1]! + 3 * v * v * u * c[3]! + 3 * v * u * u * c[5]! + u * u * u * c[7]!);
        }
      }
      offsets[ids.length] = pts.length / 2;
      this.roadIds = Int32Array.from(ids); this.roadOffsets = offsets; this.roadPoints = Float32Array.from(pts); this.roadComp = comp;
      this.roadLayer = undefined;
    }
    const live = new Set<number>();
    for (const f of this.facilities.values()) {
      const c = this.facComp.get(f.id) ?? -1;
      if (c >= 0 && fed.has(f.id) && !(f.kind === 'poste' && this.facilityState(f.id).failedUntil > 0)) live.add(this.canonComp(c));
    }
    const n = this.roadIds.length;
    const powered = new Uint8Array(n);
    let on = 0;
    for (let i = 0; i < n; i++) if (imp || live.has(this.canonComp(this.roadComp[i]!))) { powered[i] = 1; on++; }
    if (n) { summary.roadsPowered = on; summary.roadsUnpowered = n - on; }
    const prev = this.roadLayer;
    if (prev && prev.powered.length === n && prev.powered.every((v, k) => v === powered[k])) return;
    this.roadLayer = { ids: this.roadIds, offsets: this.roadOffsets, points: this.roadPoints, powered, version: Math.max(prev?.version ?? 0, this.roadsSent) + 1 };
  }

  /** Tronçon alimenté (réseau intégré aux routes) ; faux pour un tronçon inconnu. */
  roadPowered(segId: number): boolean {
    const r = this.roadLayer;
    if (!r) return false;
    let lo = 0, hi = r.ids.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1, v = r.ids[mid]!; if (v === segId) return r.powered[mid] === 1; if (v < segId) lo = mid + 1; else hi = mid - 1; }
    return false;
  }

  private cloneRoads(r: ElectriciteRoads): ElectriciteRoads {
    return { ids: r.ids.slice(), offsets: r.offsets.slice(), points: r.points.slice(), powered: r.powered.slice(), version: r.version };
  }

  /** Calque « réseau électrique » : état par cellule de la grille municipale. */
  private updateCoverage(m: Municipal | undefined, consumers: Consumer[]): void {
    const g = m?.grids.defaultGeometry;
    if (!g) { this.coverage = undefined; return; }
    const n = g.cols * g.rows;
    const on = new Uint16Array(n), off = new Uint16Array(n), unl = new Uint16Array(n);
    for (const c of consumers) {
      if (c.cell < 0) continue;
      const s = this.served.get(c.id) === 1;
      if (s) on[c.cell]!++; else if (c.hub === NO_HUB) unl[c.cell]!++; else off[c.cell]!++;
    }
    const cells = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const a = on[k]!, b = off[k]!, u = unl[k]!;
      cells[k] = a + b + u === 0 ? COVER_NONE : b === 0 && u === 0 ? COVER_OK : a === 0 && b > 0 ? COVER_CUT : a === 0 ? COVER_UNLINKED : COVER_PARTIAL;
    }
    const prev = this.coverage;
    const same = prev && prev.cols === g.cols && prev.rows === g.rows && prev.cells.length === n && prev.cells.every((v, k) => v === cells[k]);
    if (same) return;
    this.coverage = { originX: g.originX, originZ: g.originZ, cellSize: g.cellSize, cols: g.cols, rows: g.rows, cells, version: (prev?.version ?? 0) + 1 };
  }

  private hourlyEffects(ctx: PluginContext, m: Municipal, s: ElectriciteSummary, consumers: Consumer[]): void {
    const now = ctx.clock.totalMinutes;
    // Pollution de l'air (thermique, au prorata de la production appelée) et bruit (éoliennes, centrales).
    let air: ReturnType<Municipal['grids']['ensure']> | undefined;
    let noise: ReturnType<Municipal['grids']['ensure']> | undefined;
    for (const v of this.facilityViews) {
      const spec = FACILITY_SPECS[v.kind];
      const share = v.nominalKw > 0 ? v.outputKw / v.nominalKw : 0;
      if (spec.airPerHourAtFull > 0 && share > 0) (air ??= m.grids.ensure('pollution_air')).stamp(v.x, v.z, spec.airRadius, spec.airPerHourAtFull * share * 40, 'linear');
      if (spec.noisePerHourAtFull > 0 && share > 0) (noise ??= m.grids.ensure('bruit')).stamp(v.x, v.z, 120, spec.noisePerHourAtFull * share * 8, 'linear');
    }
    // Satisfaction : pénalité réversible (monte quand coupé, redescend quand rétabli).
    const g = m.grids.defaultGeometry;
    const n = g.cols * g.rows;
    if (this.penaltyGrid && this.penaltyGrid.length !== n) this.penaltyGrid = null;
    const cutCells = new Uint8Array(n);
    let anyCut = false;
    // Seuls les logements RACCORDÉS et coupés sont pénalisés ici ; ceux qu'aucun réseau ne dessert relèvent de la
    // pénalité « sans service » de la démographie (progressive, comme avant la première installation).
    for (const c of consumers) if (c.cell >= 0 && c.residents > 0 && c.hub !== NO_HUB && this.served.get(c.id) !== 1) { cutCells[c.cell] = 1; anyCut = true; }
    if (anyCut || this.penaltyGrid) {
      const pen = (this.penaltyGrid ??= new Float32Array(n));
      const sat = m.grids.ensure('satisfaction');
      let any = false;
      for (let k = 0; k < n; k++) {
        const old = pen[k]!;
        const nv = cutCells[k] ? Math.min(PENALTY_MAX, old + PENALTY_STEP_CUT) : Math.max(0, old - PENALTY_RECOVER);
        if (nv !== old) {
          pen[k] = nv;
          const j = Math.floor(k / g.cols), i = k - j * g.cols;
          sat.add(i, j, -(nv - old));
        }
        if (nv > 0) any = true;
      }
      if (!any) this.penaltyGrid = null;
    }
    // Registre d'effets : pénurie (début, évolution des coupures par classe, fin).
    const cutBy: Record<string, number> = {};
    for (const b of s.byClass) if (b.cut) cutBy[b.cls] = b.cut;
    const changed = JSON.stringify(cutBy) !== JSON.stringify(this.state.lastCutByClass);
    // Conseil (une fois) : réseau seulement éolien / solaire, sans batterie, centrale pilotable ni raccordement, qui
    // coupe faute de vent ou de soleil. Réarmé quand le réseau n'est plus seulement intermittent.
    let advised = false;
    if (!s.intermittentOnly) delete this.state.adviceAt;
    else if (s.cut > 0 && s.shortfallKw > 0 && this.state.adviceAt === undefined) {
      this.state.adviceAt = now;
      this.event(ctx, 'penurie', INTERMITTENT_ADVICE);
      ctx.notify('warn', INTERMITTENT_ADVICE);
      advised = true;
    }
    if (s.cut > 0 && !this.state.shortageCause) {
      const label = s.shortfallKw > 0 ? `Pénurie électrique : ${Math.round(s.shortfallKw)} kW non servis` : 'Coupures électriques (pannes du réseau)';
      this.state.shortageCause = m.effects.cause({ kind: 'electricite:penurie', label, source: 'electricite', at: now });
      this.event(ctx, 'penurie', `${label} — ${s.cut} bâtiments coupés`);
      const CLS_FR: Record<string, string> = { sante: 'santé', services: 'services', residentiel: 'logements', commerce: 'commerces', industrie: 'industrie' };
      const hint = s.intermittentOnly ? 'Raccordez-vous au réseau voisin, ajoutez des batteries ou une centrale thermique.' : 'Ajoutez une centrale ou une éolienne.';
      if (!advised) ctx.notify('warn', `${label} : ${s.cut} bâtiments coupés (${s.byClass.filter((b) => b.cut).map((b) => CLS_FR[b.cls] ?? b.cls).join(', ')}). ${hint}`);
    }
    if (this.state.shortageCause && changed) {
      const cause = this.state.shortageCause;
      for (const b of s.byClass) {
        if ((cutBy[b.cls] ?? 0) === (this.state.lastCutByClass[b.cls] ?? 0)) continue;
        m.effects.record(cause, `electricite:coupure:${b.cls}`, -(b.demandKw - b.deliveredKw), 'kW', now, {}, `${b.cut} bâtiments coupés sur ${b.buildings}, priorité ${b.priority}`);
      }
      m.effects.record(cause, 'emplois:sans_courant', -s.jobsWithoutPower, 'emplois', now);
      m.effects.record(cause, 'habitants:sans_courant', -s.residentsWithoutPower, 'habitants', now);
    }
    if (s.cut === 0 && this.state.shortageCause) {
      m.effects.record(this.state.shortageCause, 'electricite:retablissement', s.deliveredKw, 'kW', now, {}, 'tous les bâtiments raccordés sont alimentés');
      this.state.shortageCause = 0;
      this.event(ctx, 'fin_penurie', 'Alimentation rétablie pour tous les bâtiments raccordés');
    }
    this.state.lastCutByClass = cutBy;
  }

  /* -------------------------------- Toitures / mois -------------------------------- */

  /** Installation journalière de panneaux en toiture (logements habités, raccordés, du plus ancien au plus récent). */
  day(ctx: PluginContext): void {
    for (const id of [...this.rooftopSet]) if (ctx.buildings.indexOf(id) < 0) this.rooftopSet.delete(id);
    if (!this.state.settings.rooftops) return;
    const st = ctx.buildings.store;
    const assets = ctx.catalog?.assets ?? [];
    const cands: number[] = [];
    for (let i = 0; i < ctx.buildings.count; i++) {
      const a = assets[st.assetIndex[i]!];
      if (!a || facilityKindOf(a) || consumerClassOf(a) !== 'residentiel' || st.residents[i]! <= 0) continue;
      if (!this.rooftopSet.has(st.id[i]!)) cands.push(st.id[i]!);
    }
    cands.sort((a, b) => a - b);
    const add = cands.slice(0, ROOFTOP_SPEC.installsPerDay);
    if (!add.length) return;
    for (const id of add) this.rooftopSet.add(id);
    const cost = add.length * ROOFTOP_SPEC.costPerBuilding;
    this.state.investments += cost;
    this.getMunicipal()?.budget.post('expense', 'investissement:toitures_solaires', centsToChf(cost), 'electricite');
    this.version++;
  }

  upkeepNominal(): number {
    let s = 0;
    for (const l of this.state.lines) s += lineCost(l.lengthM).upkeepPerMonth;
    for (const c of this.state.cables ?? []) s += cableCost(c.lengthM).upkeepPerMonth;
    // Entretien du réseau de distribution : 1 500 ¢ par installation et par mois.
    s += this.facilities.size * 1_500;
    return s;
  }

  /** Entretien mensuel des barrages hydroélectriques en service (CHF). */
  damsUpkeepChf(): number {
    let s = 0;
    for (const f of this.facilities.values()) if (f.dam) s += f.upkeep;
    return s;
  }

  /** Clôture mensuelle : lignes budgétaires du service (entretien selon le financement, vente d'électricité). */
  month(ctx: PluginContext): void {
    const m = this.getMunicipal();
    const expense = Math.round(this.upkeepNominal() * this.state.settings.funding);
    const income = Math.round(this.state.month.deliveredKwh * TARIFF_CENTS_PER_KWH);
    const importCost = Math.round((this.state.month.importedKwh ?? 0) * IMPORT_SPEC.priceCentsPerKwh);
    const exportIncome = Math.round(this.state.month.exportIncome ?? 0);
    if (m) {
      // Montants du module en centimes ; trésorerie et grand livre en CHF (comme l'affichage du panneau).
      if (expense > 0) m.budget.post('expense', 'entretien:reseau_electrique', centsToChf(expense), 'electricite');
      if (importCost > 0) m.budget.post('expense', 'achat:electricite_exterieure', centsToChf(importCost), 'electricite');
      if (income > 0) m.budget.post('income', 'vente:electricite', centsToChf(income), 'electricite');
      // Vente aux voisins : déjà versée heure par heure à la trésorerie, inscrite au grand livre seulement.
      if (exportIncome > 0) m.budget.record('income', 'vente:electricite_exterieure', centsToChf(exportIncome), 'electricite');
      // Barrages hydroélectriques (ouvrages, pas des bâtiments du catalogue) : entretien payé par le module.
      const dams = this.damsUpkeepChf();
      if (dams > 0) m.budget.post('expense', 'entretien:barrages_hydro', dams, 'electricite');
    }
    this.state.lastMonth = { income, expense, failures: this.state.month.failures };
    if (importCost > 0 || this.importOn) this.state.lastMonth.importCost = importCost;
    if (exportIncome > 0 || this.state.exportNotified) this.state.lastMonth.exportIncome = exportIncome;
    this.state.month = { producedKwh: 0, deliveredKwh: 0, shedKwh: 0, failures: 0 };
    void ctx;
    this.version++;
  }

  budget(): ElectriciteBudget {
    let fac = 0;
    // Entretien catalogue (CHF, débité par la simulation de base) exprimé en centimes comme les autres champs.
    for (const f of this.facilities.values()) if (!f.dam) fac += f.upkeep * 100;
    const dams = this.damsUpkeepChf();
    const nominal = this.upkeepNominal();
    return {
      upkeepNominal: nominal, upkeepActual: Math.round(nominal * this.state.settings.funding), facilitiesUpkeep: fac, ...(dams > 0 ? { damsUpkeep: dams * 100 } : {}),
      lastIncome: this.state.lastMonth.income, lastExpense: this.state.lastMonth.expense, investments: this.state.investments,
      monthProducedKwh: Math.round(this.state.month.producedKwh), monthDeliveredKwh: Math.round(this.state.month.deliveredKwh),
      monthShedKwh: Math.round(this.state.month.shedKwh), monthFailures: this.state.month.failures, lastMonthFailures: this.state.lastMonth.failures,
      ...(this.importOn || this.state.lastMonth.importCost !== undefined ? { monthImportedKwh: Math.round(this.state.month.importedKwh ?? 0), lastImportCost: this.state.lastMonth.importCost ?? 0 } : {}),
      ...(this.state.exportNotified ? {
        monthExportedKwh: Math.round(this.state.month.exportedKwh ?? 0), monthExportIncome: Math.round(this.state.month.exportIncome ?? 0),
        lastExportIncome: this.state.lastMonth.exportIncome ?? 0,
      } : {}),
    };
  }

  /* ---------------------------------- Messages ---------------------------------- */

  full(): ElectriciteDelta {
    const d: ElectriciteDelta = {
      facilities: this.facilityViews, lines: this.lineViews, ...(this.state.cables ? { cables: this.cableViews } : {}), settings: { ...this.state.settings, priorities: [...this.state.settings.priorities] },
      budget: this.budget(), events: this.state.events.slice(-20), cutIds: [...this.cutList], municipal: this.municipalMode,
    };
    if (this.summaryCache) d.summary = this.summaryCache;
    if (this.coverage) d.coverage = { ...this.coverage, cells: this.coverage.cells.slice() };
    if (this.roadLayer) d.roads = this.cloneRoads(this.roadLayer);
    return d;
  }

  takeDelta(): ElectriciteDelta | undefined {
    if (this.version === this.sentVersion) return undefined;
    this.sentVersion = this.version;
    const d: ElectriciteDelta = {
      facilities: this.facilityViews, lines: this.lineViews, ...(this.state.cables ? { cables: this.cableViews } : {}), settings: { ...this.state.settings, priorities: [...this.state.settings.priorities] },
      budget: this.budget(), cutIds: [...this.cutList], municipal: this.municipalMode,
    };
    if (this.summaryCache) d.summary = this.summaryCache;
    if (this.state.events.length > this.eventsSent) d.events = this.state.events.slice(this.eventsSent);
    this.eventsSent = this.state.events.length;
    if (this.coverage && this.coverage.version !== this.coverageSent) {
      this.coverageSent = this.coverage.version;
      d.coverage = { ...this.coverage, cells: this.coverage.cells.slice() };
    }
    if (this.roadLayer && this.roadLayer.version !== this.roadsSent) {
      this.roadsSent = this.roadLayer.version;
      d.roads = this.cloneRoads(this.roadLayer);
    }
    return d;
  }

  markSnapshotSent(): void {
    this.sentVersion = this.version;
    this.eventsSent = this.state.events.length;
    this.coverageSent = this.coverage?.version ?? -1;
    this.roadsSent = this.roadLayer?.version ?? -1;
  }

  /** Forçage du vent (tests, démonstration). */
  forceWind(ms: number | null): void { this.state.windForce = ms === null ? null : Math.max(0, ms); this.version++; }

  /** Diagnostic (tests) : installations courantes. */
  facilityList(): Facility[] { return [...this.facilities.values()].sort((a, b) => a.id - b.id); }
  rooftopCount(): number { return this.rooftopSet.size; }
}
