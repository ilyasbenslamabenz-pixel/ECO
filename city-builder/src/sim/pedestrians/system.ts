/**
 * Système « piétons » : assemble le graphe (reconstruit quand le réseau routier change), les itinéraires, la
 * foule et les emplois du temps, derrière la façade en lecture seule des modules (`PluginContext`).
 *
 * Activation : la foule n'est simulée qu'une fois un client attaché (premier instantané demandé — le worker
 * en envoie un après chaque nouvelle partie / chargement). Une simulation sans client (tests de la simulation
 * de base, outils en ligne de commande) n'a donc ni piétons, ni coût, ni section de sauvegarde.
 * Le module ne modifie JAMAIS la simulation de base et n'utilise que son propre PRNG (`ctx.rng`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CatalogAsset } from '../../shared/catalog';
import { PIETONS_CONFIG_DEFAUT, PIETON_AGE, PIETON_GENRE_BIT, type PietonInfo, type PietonsConfig, type PietonsDelta, type PietonsSnapshot, type PietonsStats } from '../../shared/protocol-ext/pietons';
import type { PluginCommandResult, PluginContext } from '../plugins/types';
import type { PietonsSave } from './save';
import { Crowd, MAX_PATH, PED_DT, ST_LEG_IN, ST_LEG_OUT, ST_WAIT, type SpawnParams } from './crowd';
import { adaptFeux, adaptTrafic, type FeuxPort, type PietonsService, type TraficPort } from './feux';
import { buildPedGraph, EDGE_CROSS_MARKED, type NearestHit, type PedGraph } from './graph';
import { PedRouter } from './router';
import {
  EPISODE_LATE_MIN, MOTIF_FLANERIE, MOTIF_NAMES, Personas, ROLE_ACTIF, ROLE_AUTRE, ROLE_ECOLIER, ROLE_NAMES, ROLE_RETRAITE,
  lookForRole, walkSpeed, type VenueFinder,
} from './schedule';

export const DEFAULT_CONFIG: Readonly<PietonsConfig> = PIETONS_CONFIG_DEFAUT;
export const MAX_PIETONS_LIMIT = 12000;
/** Part des habitants suivis comme marcheurs (les autres se déplacent en voiture : module circulation). */
export const WALKER_SHARE = 0.15;
/** Coût d'itinéraire maximal (m équivalents) d'un trajet à pied. */
export const MAX_WALK_COST = 420;
/** Plage nocturne (minutes du jour) sans nouvelle sortie. */
export const NIGHT_FROM_MIN = 21 * 60 + 30;
export const NIGHT_UNTIL_MIN = 6 * 60;
/** Distance porte -> trottoir maximale (m). */
export const MAX_ACCESS_M = 60;
const ANCHOR_RADIUS_WORK = 250;
const ANCHOR_RADIUS_SCHOOL = 350;
const ROUTES_PER_TICK = 14;
const REROUTES_PER_TICK = 24;
const TICK_WINDOW = 600;
const REBUILD_MIN_TICKS = 5;

interface Access { edge: number; s: number; x: number; y: number; z: number; doorX: number; doorY: number; doorZ: number }

const AGE_NAMES = ['enfant', 'ado', 'adulte', 'senior'] as const;
const STATE_NAMES = ['sortie', 'marche', 'attente', 'entree'] as const;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class PedestrianSystem {
  config: PietonsConfig = { ...DEFAULT_CONFIG };
  /** Un client (rendu) a demandé un instantané : la foule est simulée. */
  attached = false;
  graph: PedGraph | null = null;
  readonly crowd = new Crowd();
  readonly personas = new Personas();
  private router: PedRouter | null = null;
  private access = new Map<number, Access | null>();
  private readonly hit: NearestHit = { edge: 0, s: 0, x: 0, y: 0, z: 0, d: 0 };
  private readonly pathBuf = new Int32Array(MAX_PATH);
  private readonly lenBuf = new Float32Array(1);
  private readonly queryBuf: number[] = [];
  private cursor = 0;
  private routesThisTick = 0;
  private ticksSinceRebuild = 1e9;
  private lastResizeMin = -1e9;
  private lastPopulation = -1;
  private feuxRaw: unknown = undefined;
  private feux: FeuxPort | null = null;
  private traficRaw: unknown = undefined;
  private trafic: TraficPort | null = null;
  private regulatedCrossings = 0;
  /** Trajets en cours restaurés d'une sauvegarde, à remettre dans la rue quand le graphe est prêt. */
  private pendingTrips: number[] = [];
  private readonly cumul = { trajets: 0, arrivees: 0, nonMarchables: 0 };
  private readonly tickSamples = new Float32Array(TICK_WINDOW);
  private tickN = 0;
  private deltaN = 0;
  private sentEmpty = true;
  private configDirty = false;
  private dirty = false;

  /** Service publié pour la circulation (céder le passage aux piétons). */
  readonly service: PietonsService;

  constructor() {
    const self = this;
    const occ = { engages: 0, enAttente: 0 };
    this.service = {
      get count() { return self.crowd.count; },
      passage(nodeId: number, segId: number) {
        occ.engages = 0; occ.enAttente = 0;
        const g = self.graph;
        if (!g) return occ;
        for (let e = 0; e < g.edgeCount; e++) {
          if (g.eSeg[e] !== segId || g.eNode[e] !== nodeId || !g.isCrossing(e)) continue;
          occ.engages += self.crowd.crossOn[e]!;
          occ.enAttente += self.crowd.crossWait[e]!;
        }
        return occ;
      },
    };
  }

  /* --------------------------- Cycle de vie --------------------------- */

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.attached = false;
    this.graph = null;
    this.router = null;
    this.crowd.clear();
    this.crowd.nextId = 1;
    this.personas.clear();
    this.access.clear();
    this.cursor = 0;
    this.ticksSinceRebuild = 1e9;
    this.lastResizeMin = -1e9;
    this.lastPopulation = -1;
    this.pendingTrips = [];
    this.cumul.trajets = this.cumul.arrivees = this.cumul.nonMarchables = 0;
    this.tickN = 0;
    this.deltaN = 0;
    this.sentEmpty = true;
    this.configDirty = false;
    this.dirty = false;
    this.regulatedCrossings = 0;
  }

  private bindServices(ctx: PluginContext): void {
    const f = ctx.use<unknown>('feux');
    if (f !== this.feuxRaw) { this.feuxRaw = f; this.feux = adaptFeux(f); this.crowd.feux = this.feux; }
    const t = ctx.use<unknown>('trafic');
    if (t !== this.traficRaw) { this.traficRaw = t; this.trafic = adaptTrafic(t); this.crowd.trafic = this.trafic; }
  }

  private ensureGraph(ctx: PluginContext): boolean {
    const roads = ctx.roads;
    if (this.graph && this.graph.roadsVersion === roads.version) return true;
    // Pendant une rafale de modifications (ville générée, tracé en cours) : au plus une reconstruction par demi-seconde.
    if (this.graph && this.ticksSinceRebuild < REBUILD_MIN_TICKS) return true;
    const g = buildPedGraph(roads);
    this.graph = g;
    this.ticksSinceRebuild = 0;
    if (this.router) this.router.setGraph(g); else this.router = new PedRouter(g);
    this.crowd.setGraph(g);
    this.access.clear();
    return true;
  }

  /* ----------------------------- Bâtiments ----------------------------- */

  private assetAt(ctx: PluginContext, index: number): CatalogAsset | undefined {
    return ctx.catalog?.assets[ctx.buildings.store.assetIndex[index]!];
  }

  /** Accès piéton d'un bâtiment : porte (façade) et point du trottoir le plus proche ; null s'il n'y en a pas. */
  accessOf(ctx: PluginContext, id: number): Access | null {
    const cached = this.access.get(id);
    if (cached !== undefined) return cached;
    let res: Access | null = null;
    const g = this.graph;
    const i = ctx.buildings.indexOf(id);
    if (g && i >= 0) {
      const st = ctx.buildings.store;
      const a = this.assetAt(ctx, i);
      const f = a?.frontage.find((p) => p.kind === 'pedestrian') ?? a?.frontage[0];
      const th = st.rot[i]! * (Math.PI / 2), c = Math.cos(th), s = Math.sin(th);
      const lx = f ? f.x + f.nx * 0.4 : 0, lz = f ? f.z + f.nz * 0.4 : 0;
      const wx = st.x[i]! + lx * c + lz * s, wz = st.z[i]! - lx * s + lz * c;
      if (g.nearest(wx, wz, MAX_ACCESS_M, true, this.hit)) {
        const gy = ctx.terrain.heightAt(wx, wz);
        res = { edge: this.hit.edge, s: this.hit.s, x: this.hit.x, y: this.hit.y, z: this.hit.z, doorX: wx, doorY: Number.isFinite(gy) ? gy : this.hit.y, doorZ: wz };
      }
    }
    this.access.set(id, res);
    return res;
  }

  private readonly finder: VenueFinder & { ctx: PluginContext | null } = {
    ctx: null,
    venue: (around, radius, kind, r) => this.findVenue(around, radius, kind, r),
  };

  private venueMatches(a: CatalogAsset, kind: 'repas' | 'courses' | 'loisirs' | 'parc' | 'tout'): boolean {
    if (kind === 'tout') return true;
    const t = a.tags;
    const has = (x: string): boolean => t.includes(x);
    if (kind === 'parc') return has('parc') || has('espace_vert') || has('service:loisirs');
    if (kind === 'repas') return a.category === 'commercial' && (has('restaurant') || has('cafe') || has('boulangerie') || has('service:alimentation') || has('commerce'));
    if (kind === 'courses') return a.category === 'commercial' && (has('commerce') || t.some((x) => x.startsWith('service:')) ) && !has('bureaux') && !has('service:carburant');
    // loisirs : cafés, restaurants, culture, parcs, centre commercial, patrimoine
    return has('restaurant') || has('cafe') || has('service:culture') || has('parc') || has('service:loisirs') || has('service:commerces') || has('service:patrimoine') || has('cinema');
  }

  /** Tire un bâtiment d'un type donné autour d'un autre (échantillonnage en une passe) ; -1 si aucun. */
  private findVenue(around: number, radius: number, kind: 'repas' | 'courses' | 'loisirs' | 'parc' | 'tout', r: number): number {
    const ctx = this.finder.ctx;
    if (!ctx) return -1;
    const i = ctx.buildings.indexOf(around);
    if (i < 0) return -1;
    const st = ctx.buildings.store;
    const x = st.x[i]!, z = st.z[i]!;
    const ids = ctx.buildings.query(x - radius, z - radius, x + radius, z + radius, this.queryBuf);
    let n = 0;
    // Deux passes sans allocation : compter les candidats, puis prendre le k-ième.
    for (let pass = 0, pick = -1; pass < 2; pass++) {
      let k = 0;
      for (const id of ids) {
        if (id === around) continue;
        const j = ctx.buildings.indexOf(id);
        if (j < 0) continue;
        const dx = st.x[j]! - x, dz = st.z[j]! - z;
        if (dx * dx + dz * dz > radius * radius) continue;
        const a = this.assetAt(ctx, j);
        if (!a || !this.venueMatches(a, kind)) continue;
        if (pass === 1 && k === pick) return this.accessOf(ctx, id) ? id : -1;
        k++;
      }
      if (pass === 0) { n = k; if (n === 0) return -1; pick = Math.min(n - 1, Math.floor(r * n)); }
    }
    return -1;
  }

  /* ------------------------------ Marcheurs ------------------------------ */

  /** Lieu d'attache à distance de marche : emploi (pondéré par les postes) ou école. */
  private findAnchor(ctx: PluginContext, home: number, role: number): number {
    const i = ctx.buildings.indexOf(home);
    if (i < 0) return -1;
    const st = ctx.buildings.store;
    const x = st.x[i]!, z = st.z[i]!;
    const radius = role === ROLE_ECOLIER ? ANCHOR_RADIUS_SCHOOL : ANCHOR_RADIUS_WORK;
    const ids = ctx.buildings.query(x - radius, z - radius, x + radius, z + radius, this.queryBuf);
    let total = 0, best = -1;
    for (const id of ids) {
      if (id === home) continue;
      const j = ctx.buildings.indexOf(id);
      if (j < 0) continue;
      const dx = st.x[j]! - x, dz = st.z[j]! - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      const a = this.assetAt(ctx, j);
      if (!a) continue;
      let w: number;
      if (role === ROLE_ECOLIER) w = a.tags.includes('education') || a.tags.includes('ecole') || a.tags.includes('service:education') ? 1 : 0;
      else w = Math.max(st.workers[j]!, a.capacity.jobs > 0 ? 1 : 0);
      if (w <= 0) continue;
      // Échantillonnage pondéré en une passe.
      total += w;
      if (ctx.rng.next() * total < w) best = id;
    }
    return best >= 0 && this.accessOf(ctx, best) ? best : -1;
  }

  /** Ajuste le nombre de marcheurs à la population (appelé au début, chaque jour et quand la population bouge). */
  private resize(ctx: PluginContext): void {
    const demo = ctx.demography;
    const pop = demo ? demo.population : 0;
    this.lastResizeMin = ctx.clock.totalMinutes;
    this.lastPopulation = pop;
    const P = this.personas;
    const target = Math.min(Math.round(pop * WALKER_SHARE), Math.round(this.config.maxPietons * 1.5));
    // Réduction : on retire depuis la fin les marcheurs qui ne sont pas dans la rue.
    while (P.count > target && P.count > 0 && !P.travelling[P.count - 1]) P.count--;
    if (P.count >= target || !demo || !this.graph) return;
    const st = ctx.buildings.store, n = ctx.buildings.count;
    let totalRes = 0;
    for (let i = 0; i < n; i++) totalRes += st.residents[i]!;
    if (totalRes <= 0) return;
    const rep = demo.report();
    const wE = (rep.pupils / Math.max(1, rep.population)) * 1.6;
    const wR = (rep.retirees / Math.max(1, rep.population)) * 1.4;
    const wA = (rep.employed / Math.max(1, rep.population)) * 0.7;
    const wO = Math.max(0.05, 1 - (rep.pupils + rep.retirees + rep.employed) / Math.max(1, rep.population));
    const wSum = wE + wR + wA + wO;
    const rnd = (): number => ctx.rng.next();
    let guard = (target - P.count) * 4 + 16;
    while (P.count < target && guard-- > 0) {
      // Domicile tiré au prorata des habitants réels.
      let pick = rnd() * totalRes, hi = 0;
      for (; hi < n - 1; hi++) { pick -= st.residents[hi]!; if (pick < 0) break; }
      if (st.residents[hi]! <= 0) continue;
      const home = st.id[hi]!;
      if (!this.accessOf(ctx, home)) continue;
      const u = rnd() * wSum;
      const role = u < wE ? ROLE_ECOLIER : u < wE + wR ? ROLE_RETRAITE : u < wE + wR + wA ? ROLE_ACTIF : ROLE_AUTRE;
      const anchor = role === ROLE_ACTIF || role === ROLE_ECOLIER ? this.findAnchor(ctx, home, role) : -1;
      P.add(home, anchor, role, lookForRole(role, rnd), Math.floor(rnd() * 256), ctx.rng.nextU32());
    }
    this.syncPlanned();
  }

  /** Aligne le tableau « épisode en mémoire » sur le nombre de marcheurs (les nouveaux sont à planifier). */
  private syncPlanned(): void {
    const P = this.personas;
    if (this.planned.length < P.cap) { const n = new Uint8Array(P.cap); n.set(this.planned); this.planned = n; }
    for (let p = 0; p < P.count; p++) if (P.planDay[p] === -1) this.planned[p] = 0;
  }

  /** Démarre un trajet à pied entre deux bâtiments ; false si l'un n'a pas d'accès ou si c'est trop loin. */
  private startTrip(ctx: PluginContext, persona: number, from: number, to: number, motif: number, look: number, seed: number): boolean {
    const a = this.accessOf(ctx, from), b = this.accessOf(ctx, to);
    if (!a || !b || !this.router) return false;
    this.routesThisTick++;
    const n = this.router.route(a.edge, a.s, b.edge, b.s, this.pathBuf, 0, MAX_PATH, MAX_WALK_COST, this.lenBuf);
    if (n === 0) return false;
    const p: SpawnParams = {
      persona, look, seed, motif, v0: walkSpeed(look, seed), from, dest: to,
      ox: a.doorX, oy: a.doorY, oz: a.doorZ, dx: b.doorX, dy: b.doorY, dz: b.doorZ, s0: a.s, s1: b.s,
    };
    this.crowd.spawn(p, this.pathBuf, n);
    this.cumul.trajets++;
    return true;
  }

  private updatePersonas(ctx: PluginContext, minutes: number): void {
    const P = this.personas;
    if (P.count === 0) return;
    const clock = ctx.clock;
    const day = clock.dayIndex, mod = clock.minuteOfDay;
    this.finder.ctx = ctx;
    // Chaque marcheur est examiné toutes les ~4 minutes de jeu.
    const slots = Math.min(P.count, Math.max(1, Math.ceil((P.count * minutes) / 4)));
    const full = this.crowd.count >= this.config.maxPietons;
    const night = mod >= NIGHT_FROM_MIN || mod < NIGHT_UNTIL_MIN;
    for (let k = 0; k < slots; k++) {
      if (this.cursor >= P.count) this.cursor = 0;
      const p = this.cursor++;
      if (P.travelling[p]) continue;
      if (P.planDay[p] !== day || !this.planned[p]) {
        // Domicile ou attache démolis : le marcheur déménage / change de lieu.
        if (ctx.buildings.indexOf(P.home[p]!) < 0) { this.rehome(ctx, p); if (ctx.buildings.indexOf(P.home[p]!) < 0) continue; }
        if (P.anchor[p]! >= 0 && ctx.buildings.indexOf(P.anchor[p]!) < 0) P.anchor[p] = this.findAnchor(ctx, P.home[p]!, P.role[p]!);
        P.makeEpisode(p, day, clock.weekday, this.finder, P.planDay[p] === day);
        this.planned[p] = 1;
      }
      if (P.done[p]) continue;
      const t = P.epT[p]!;
      if (mod < t) continue;
      // Trop tard (trajet de la veille à peine terminé, rue saturée) ou nuit tombée : l'épisode du jour est abandonné.
      if (night || mod > t + EPISODE_LATE_MIN) { P.done[p] = 1; this.cumul.nonMarchables++; continue; }
      if (full || this.routesThisTick >= ROUTES_PER_TICK) continue;
      P.done[p] = 1;
      const from = P.epFrom[p]!, dest = P.epDest[p]!;
      if (ctx.buildings.indexOf(from) >= 0 && ctx.buildings.indexOf(dest) >= 0 && this.startTrip(ctx, p, from, dest, P.epMotif[p]!, P.look[p]!, P.seed8[p]!)) {
        P.travelling[p] = 1;
      } else {
        // Pas de trottoir, trop loin, bâtiment disparu : ce déplacement se fait autrement (voiture, bus).
        this.cumul.nonMarchables++;
      }
    }
  }
  /** 1 si l'épisode du marcheur est en mémoire (0 après un chargement : à régénérer). */
  private planned = new Uint8Array(0);

  private rehome(ctx: PluginContext, p: number): void {
    const st = ctx.buildings.store, n = ctx.buildings.count;
    for (let tries = 0; tries < 8 && n > 0; tries++) {
      const i = Math.min(n - 1, Math.floor(ctx.rng.next() * n));
      if (st.residents[i]! > 0 && this.accessOf(ctx, st.id[i]!)) {
        this.personas.home[p] = st.id[i]!;
        this.personas.anchor[p] = this.findAnchor(ctx, st.id[i]!, this.personas.role[p]!);
        return;
      }
    }
  }

  /** Fin de trajet d'un marcheur (arrivée ou trajet abandonné). */
  private personaArrived(p: number): void {
    const P = this.personas;
    if (p >= 0 && p < P.count) P.travelling[p] = 0;
  }

  /** Foule imposée (banc, démonstration) : passants sans emploi du temps entre bâtiments voisins. */
  private fillCrowd(ctx: PluginContext): void {
    const want = Math.min(this.config.foule, this.config.maxPietons);
    const n = ctx.buildings.count;
    if (this.crowd.count >= want || n < 2) return;
    const st = ctx.buildings.store;
    const rnd = (): number => ctx.rng.next();
    this.finder.ctx = ctx;
    for (let tries = 0; tries < 24 && this.crowd.count < want && this.routesThisTick < ROUTES_PER_TICK * 2; tries++) {
      const i = Math.min(n - 1, Math.floor(rnd() * n));
      const from = st.id[i]!;
      const to = this.findVenue(from, 320, 'tout', rnd());
      if (to < 0) continue;
      const role = rnd() < 0.2 ? ROLE_ECOLIER : rnd() < 0.25 ? ROLE_RETRAITE : ROLE_AUTRE;
      this.startTrip(ctx, -1, from, to, MOTIF_FLANERIE, lookForRole(role, rnd), Math.floor(rnd() * 256));
    }
  }

  /** Remet dans la rue les trajets en cours d'une sauvegarde (une fois le graphe construit). */
  private restoreTrips(ctx: PluginContext): void {
    const T = this.pendingTrips, P = this.personas, g = this.graph!;
    this.pendingTrips = [];
    for (let k = 0; k + 5 < T.length; k += 6) {
      const p = T[k]!, x = T[k + 1]! / 10, z = T[k + 2]! / 10, dest = T[k + 3]!, from = T[k + 4]!, motif = T[k + 5]!;
      if (p < 0 || p >= P.count) continue;
      const b = this.accessOf(ctx, dest);
      if (b && g.nearest(x, z, MAX_ACCESS_M, false, this.hit)) {
        const e0 = this.hit.edge, s0 = this.hit.s;
        const n = this.router!.route(e0, s0, b.edge, b.s, this.pathBuf, 0, MAX_PATH, MAX_WALK_COST * 2, this.lenBuf);
        if (n > 0) {
          this.crowd.spawn({
            persona: p, look: P.look[p]!, seed: P.seed8[p]!, motif, v0: walkSpeed(P.look[p]!, P.seed8[p]!), from, dest,
            ox: x, oy: 0, oz: z, skipLeg: true, dx: b.doorX, dy: b.doorY, dz: b.doorZ, s0, s1: b.s,
          }, this.pathBuf, n);
          P.travelling[p] = 1;
        }
      }

    }
  }

  /** Recalcule (par lots) les chemins invalidés par une modification du réseau. */
  private processReroutes(ctx: PluginContext): void {
    const c = this.crowd, g = this.graph!;
    let budget = REROUTES_PER_TICK;
    for (let i = c.count - 1; i >= 0 && budget > 0; i--) {
      if (!c.reroute[i]) continue;
      budget--;
      const st = c.state[i]!;
      const b = this.accessOf(ctx, c.dest[i]!);
      let ok = false;
      if (b && st !== ST_LEG_IN) {
        // Départ : point du graphe le plus proche (pour un piéton encore en sortie de bâtiment : l'accès d'origine).
        const a = st === ST_LEG_OUT ? this.accessOf(ctx, c.from[i]!) : null;
        let e0 = -1, s0 = 0;
        if (a) { e0 = a.edge; s0 = a.s; }
        else if (c.relocate(i, this.hit)) { e0 = this.hit.edge; s0 = this.hit.s; }
        if (e0 >= 0) {
          const n = this.router!.route(e0, s0, b.edge, b.s, this.pathBuf, 0, MAX_PATH, MAX_WALK_COST * 2, this.lenBuf);
          if (n > 0) {
            c.setPath(i, this.pathBuf, n, s0, b.s);
            c.dx[i] = b.doorX; c.dy[i] = b.doorY; c.dz[i] = b.doorZ;
            if (st === ST_LEG_OUT) { g.pointAt(e0, s0, this.pt); c.ox[i] = this.pt[0]!; c.oy[i] = this.pt[1]!; c.oz[i] = this.pt[2]!; }
            else { c.lat[i] = 0; c.latT[i] = 0; c.speed[i] = 0; }
            ok = true;
          }
        }
      } else if (st === ST_LEG_IN) { c.reroute[i] = 0; ok = true; }
      if (!ok) {
        const p = c.persona[i]!;
        c.remove(i);
        this.personaArrived(p);
      }
    }
  }
  private readonly pt = new Float32Array(5);

  /* -------------------------------- Tick -------------------------------- */

  tick(ctx: PluginContext, minutes: number): void {
    if (!this.attached || !this.config.actif || !ctx.inGame) return;
    const t0 = now();
    this.ticksSinceRebuild++;
    this.routesThisTick = 0;
    this.bindServices(ctx);
    this.crowd.random = () => ctx.rng.next();
    this.ensureGraph(ctx);
    const g = this.graph!;
    if (this.pendingTrips.length > 0) this.restoreTrips(ctx);
    this.processReroutes(ctx);
    const pop = ctx.demography?.population ?? 0;
    const total = ctx.clock.totalMinutes;
    if (g.edgeCount > 0 && (total - this.lastResizeMin >= 60 || (this.personas.count === 0 && pop > 0 && total - this.lastResizeMin >= 5))) {
      if (this.lastPopulation < 0 || this.personas.count === 0 || Math.abs(pop - this.lastPopulation) > Math.max(20, this.lastPopulation * 0.05) || total - this.lastResizeMin >= 24 * 60) this.resize(ctx);
      else this.lastResizeMin = total;
    }
    if (g.edgeCount > 0) {
      this.updatePersonas(ctx, minutes);
      if (this.config.foule > 0) this.fillCrowd(ctx);
    }
    const c = this.crowd;
    c.step(PED_DT);
    for (const i of c.arrived) {
      const p = c.persona[i]!;
      c.remove(i);
      this.cumul.arrivees++;
      this.personaArrived(p);
    }
    this.dirty = true;
    this.tickSamples[this.tickN++ % TICK_WINDOW] = now() - t0;
  }

  onDayStart(ctx: PluginContext): void {
    if (!this.attached || !this.config.actif || !this.graph) return;
    this.resize(ctx);
  }

  /* ---------------------------- Statistiques ---------------------------- */

  private countRegulated(): number {
    const g = this.graph, f = this.feux;
    if (!g || !f) return 0;
    const out = { etat: 0, restant: 0 };
    let n = 0;
    for (let e = 0; e < g.edgeCount; e++) if (g.eKind[e] === EDGE_CROSS_MARKED && g.eNode[e]! >= 0 && f.passage(g.eNode[e]!, g.eSeg[e]!, out)) n++;
    return n;
  }

  stats(): PietonsStats {
    const c = this.crowd, P = this.personas, g = this.graph;
    const roles = [0, 0, 0, 0];
    for (let p = 0; p < P.count; p++) roles[P.role[p]!]!++;
    const motifs = [0, 0, 0, 0, 0, 0];
    let walking = 0, waiting = 0, crossing = 0;
    for (let i = 0; i < c.count; i++) {
      motifs[c.motif[i]!]!++;
      if (c.state[i] === ST_WAIT || c.reroute[i]) waiting++;
      else if (c.onCross[i]) crossing++;
      else walking++;
    }
    const n = Math.min(this.tickN, TICK_WINDOW);
    let mean = 0, max = 0, p95 = 0;
    if (n > 0) {
      const sorted = Array.from(this.tickSamples.subarray(0, n)).sort((a, b) => a - b);
      for (const v of sorted) mean += v;
      mean /= n;
      max = sorted[n - 1]!;
      p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))]!;
    }
    this.regulatedCrossings = this.countRegulated();
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      pietons: c.count, enMarche: walking, enAttente: waiting, enTraversee: crossing,
      marcheurs: P.count,
      roles: { actifs: roles[ROLE_ACTIF]!, ecoliers: roles[ROLE_ECOLIER]!, retraites: roles[ROLE_RETRAITE]!, autres: roles[ROLE_AUTRE]! },
      motifs: { travail: motifs[0]!, ecole: motifs[1]!, courses: motifs[2]!, loisirs: motifs[3]!, retour: motifs[4]!, flanerie: motifs[5]! },
      graphe: {
        noeuds: g?.stats.nodes ?? 0, aretes: g?.stats.edges ?? 0, trottoirsM: g?.stats.sidewalkM ?? 0,
        passages: g?.stats.crossings ?? 0, passagesMarques: g?.stats.crossingsMarked ?? 0, passagesRegules: this.regulatedCrossings,
      },
      feux: this.feux !== null, trafic: this.trafic !== null,
      cumul: {
        trajets: this.cumul.trajets, arrivees: this.cumul.arrivees, traversees: c.counters.crossings, traverseesAuVert: c.counters.green,
        traverseesPrudentes: c.counters.prudent, traverseesForcees: c.counters.forced, nonMarchables: this.cumul.nonMarchables,
        itineraires: this.router?.queries ?? 0,
      },
      tickMs: { moyenne: r3(mean), p95: r3(p95), max: r3(max), echantillons: n },
    };
  }

  /* ------------------------- Deltas / instantané ------------------------- */

  takeDelta(): PietonsDelta | undefined {
    if (!this.attached) return undefined;
    const c = this.crowd;
    const out: PietonsDelta = {};
    let any = false;
    if (this.configDirty) { out.config = { ...this.config }; this.configDirty = false; any = true; }
    // Trame : à chaque delta quand la foule a bougé ; une dernière trame vide quand la rue se vide.
    if ((c.count > 0 && this.dirty) || (c.count === 0 && !this.sentEmpty)) {
      const f = c.frame();
      out.frame = f;
      out.$transfer = [f.ids, f.pos, f.meta];
      this.sentEmpty = c.count === 0;
      this.dirty = false;
      any = true;
    }
    // Statistiques : environ une fois par seconde tant que le module a quelque chose à montrer.
    if ((any || this.personas.count > 0) && this.deltaN++ % 10 === 0) { out.stats = this.stats(); any = true; }
    return any ? out : undefined;
  }

  snapshot(): PietonsSnapshot | undefined {
    const first = !this.attached;
    this.attached = true;
    this.sentEmpty = true;
    this.deltaN = 0;
    // Premier instantané d'un module encore vierge : rien à transmettre (le rendu se vide de lui-même).
    if (first && this.isPristine()) return undefined;
    return { config: { ...this.config }, stats: this.stats() };
  }

  private isPristine(): boolean {
    const c = this.config;
    return this.personas.count === 0 && this.crowd.count === 0 && this.pendingTrips.length === 0
      && c.actif === DEFAULT_CONFIG.actif && c.maxPietons === DEFAULT_CONFIG.maxPietons && c.foule === DEFAULT_CONFIG.foule;
  }

  /* ----------------------------- Sauvegarde ----------------------------- */

  save(): PietonsSave | undefined {
    if (this.isPristine()) return undefined;
    const P = this.personas, c = this.crowd, n = P.count;
    const arr = (a: ArrayLike<number>): number[] => Array.from({ length: n }, (_, i) => a[i]!);
    const trajets: number[] = [];
    for (let i = 0; i < c.count; i++) {
      const p = c.persona[i]!;
      if (p < 0) continue; // les passants de la foule imposée ne sont pas sauvegardés (ils sont recréés)
      trajets.push(p, Math.round(c.x[i]! * 10), Math.round(c.z[i]! * 10), c.dest[i]!, c.from[i]!, c.motif[i]!);
    }
    for (let k = 0; k < this.pendingTrips.length; k++) trajets.push(this.pendingTrips[k]!);
    return {
      config: { ...this.config },
      prochainId: c.nextId,
      marcheurs: {
        home: arr(P.home), anchor: arr(P.anchor), role: arr(P.role), look: arr(P.look), seed8: arr(P.seed8), seed: arr(P.seed),
        planDay: arr(P.planDay), done: arr(P.done),
      },
      trajets,
    };
  }

  load(data: PietonsSave): void {
    this.config = sanitizeConfig({ ...DEFAULT_CONFIG }, data.config);
    const m = data.marcheurs, P = this.personas;
    P.clear();
    const n = m.home.length;
    for (let i = 0; i < n; i++) {
      const p = P.add(m.home[i]!, m.anchor[i] ?? -1, (m.role[i] ?? ROLE_AUTRE) & 3, (m.look[i] ?? PIETON_AGE.adulte) & 7, (m.seed8[i] ?? 0) & 255, (m.seed[i] ?? i + 1) >>> 0);
      P.planDay[p] = m.planDay[i] ?? -1;
      P.done[p] = m.done[i] ? 1 : 0;
    }
    this.planned = new Uint8Array(P.cap); // épisodes à régénérer (déterministes)
    this.crowd.nextId = Math.max(1, data.prochainId | 0);
    this.pendingTrips = data.trajets.slice(0, Math.floor(data.trajets.length / 6) * 6);
    this.lastResizeMin = -1e9;
    this.lastPopulation = -1;
    this.configDirty = true;
  }

  /* ------------------------------ Commandes ------------------------------ */

  private info(i: number): PietonInfo {
    const c = this.crowd;
    const look = c.look[i]!, p = c.persona[i]!;
    const st = c.state[i]!;
    return {
      id: c.id[i]!,
      etat: st === 1 && c.onCross[i] ? 'traversee' : STATE_NAMES[st]!,
      age: AGE_NAMES[look & 3]!, genre: look & PIETON_GENRE_BIT ? 'femme' : 'homme',
      role: p >= 0 && p < this.personas.count ? ROLE_NAMES[this.personas.role[p]!]! : 'passant',
      motif: MOTIF_NAMES[c.motif[i]!]!,
      x: c.x[i]!, z: c.z[i]!, vitesse: Math.round(c.speed[i]! * 100) / 100,
      origine: c.from[i]!, destination: c.dest[i]!, resteM: Math.round(c.remaining(i)),
    };
  }

  command(ctx: PluginContext, name: string, payload: unknown): PluginCommandResult {
    const obj = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    if (name === 'config') {
      if (payload !== undefined && payload !== null) {
        if (typeof payload !== 'object') return { ok: false, code: 'INVALID_ARGS', message: 'config : objet attendu' };
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'actif' ? typeof v !== 'boolean' : (k !== 'maxPietons' && k !== 'foule') || typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return { ok: false, code: 'INVALID_ARGS', message: `config : champ « ${k} » invalide` };
          }
        }
        const before = this.config.actif;
        this.config = sanitizeConfig(this.config, obj);
        if (before && !this.config.actif) { this.crowd.clear(); for (let p = 0; p < this.personas.count; p++) this.personas.travelling[p] = 0; this.sentEmpty = false; }
        // Plafond abaissé : les piétons en trop rentrent (retirés du plus récent au plus ancien).
        while (this.crowd.count > this.config.maxPietons) {
          const i = this.crowd.count - 1, p = this.crowd.persona[i]!;
          this.crowd.remove(i);
          this.personaArrived(p);
        }
        this.configDirty = true;
      }
      return { ok: true, data: { ...this.config } };
    }
    if (name === 'stats') return { ok: true, data: this.stats() };
    if (name === 'inspecter') {
      const id = obj.id;
      if (typeof id !== 'number') return { ok: false, code: 'INVALID_ARGS', message: 'inspecter : id attendu' };
      const c = this.crowd;
      for (let i = 0; i < c.count; i++) if (c.id[i] === id) return { ok: true, data: this.info(i) };
      return { ok: false, code: 'NOT_FOUND', message: 'Ce piéton n\'est plus dans la rue' };
    }
    if (name === 'proche') {
      const x = obj.x, z = obj.z, r = typeof obj.rayon === 'number' && obj.rayon > 0 ? obj.rayon : 6;
      if (typeof x !== 'number' || typeof z !== 'number') return { ok: false, code: 'INVALID_ARGS', message: 'proche : x et z attendus' };
      const c = this.crowd;
      let best = -1, bd = r * r;
      for (let i = 0; i < c.count; i++) {
        const d = (c.x[i]! - x) ** 2 + (c.z[i]! - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best >= 0 ? { ok: true, data: this.info(best) } : { ok: false, code: 'NOT_FOUND', message: 'Aucun piéton à cet endroit' };
    }
    return { ok: false, code: 'INVALID_ARGS', message: `Commande piétons inconnue : ${name}` };
  }
}

/** Applique les champs valides de `patch` à une configuration (bornes appliquées). */
export function sanitizeConfig(base: PietonsConfig, patch: unknown): PietonsConfig {
  const out = { ...base };
  if (typeof patch !== 'object' || patch === null) return out;
  const p = patch as Record<string, unknown>;
  if (typeof p.actif === 'boolean') out.actif = p.actif;
  if (typeof p.maxPietons === 'number' && Number.isFinite(p.maxPietons)) out.maxPietons = Math.max(0, Math.min(MAX_PIETONS_LIMIT, Math.round(p.maxPietons)));
  if (typeof p.foule === 'number' && Number.isFinite(p.foule)) out.foule = Math.max(0, Math.min(MAX_PIETONS_LIMIT, Math.round(p.foule)));
  return out;
}
