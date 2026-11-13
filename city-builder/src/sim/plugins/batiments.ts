/**
 * Module de simulation « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 *
 * Rôle : suivre des QUARTIERS (rectangle + type), mesurer leur bâti (diversité, occupation, services,
 * nuisances), les faire évoluer (valorisation, densification) et proposer des remplacements de bâtiments.
 * La génération elle-même est dans src/sim/districts/** (pure et déterministe).
 *
 * Écriture dans la simulation : un module ne peut pas encore construire (PluginContext est en lecture seule).
 * Le module cherche donc un service `sim.actions` (`DistrictActions`) publié par le cœur ; tant qu'il n'existe
 * pas, `applyDistrict` / `applyProposal` renvoient NOT_IMPLEMENTED avec la marche à suivre (exécuter le plan
 * renvoyé par `planDistrict` avec les commandes `buildRoad` / `placeBuilding` du protocole).
 * API demandée : docs/requests/batiments.md. Tout le reste (plan, application, évolution) est déjà implémenté.
 *
 * Sans quartier enregistré, le module est totalement inerte : aucun delta, aucun instantané, aucune section
 * de sauvegarde, aucun tirage sur le PRNG de base (il n'utilise que `ctx.rng`).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CatalogAsset } from '../../shared/catalog';
import { TILE_SIZE } from '../../shared/constants';
import type {
  BatimentsApplyReport, BatimentsDelta, BatimentsDistrictSpec, BatimentsDistrictView, BatimentsPlanView, BatimentsProposalView,
} from '../../shared/protocol-ext/batiments';
import {
  applyPlan, applyProposal, DISTRICT_LABELS_FR, generateDistrict, isDistrictType, measureDiversity, proposeEvolutions,
  styleOf, tagNumber, updateDistrictState,
  type DistrictActions, type DistrictMeasures, type DistrictPlan, type DistrictState, type DistrictType,
  type DiversityItem, type EvolutionCandidate, type EvolutionProposal,
} from '../districts/index';
import { BATIMENTS_SAVE_VERSION, emptyBatimentsSave, migrateBatiments, type BatimentsSave, type SavedDistrict } from '../districts/save';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

/** Service d'écriture attendu du cœur (voir docs/requests/batiments.md). */
export const ACTIONS_SERVICE = 'sim.actions';

const MAX_DISTRICTS = 64;
const MAX_PROPOSALS = 24;
const PROPOSALS_PER_DISTRICT = 2;

interface District {
  id: number;
  type: DistrictType;
  x: number;
  z: number;
  width: number;
  depth: number;
  rot: number;
  seed: number;
  createdDay: number;
  state: DistrictState;
  measures: DistrictMeasures;
  distinctAssets: number;
}

interface State {
  districts: District[];
  proposals: EvolutionProposal[];
  nextDistrictId: number;
  nextProposalId: number;
  overlay: boolean;
  autoEvolve: boolean;
  /** Un delta est en attente d'envoi au rendu. */
  dirty: boolean;
  /** Nombre de modifications depuis la nouvelle partie (diagnostic, tests). */
  revision: number;
}

const emptyMeasures = (): DistrictMeasures => ({
  buildings: 0, residents: 0, capacity: 0, jobs: 0, roadAccessRate: 0, attractivity: 0, pollution: 0, services: 0, repetitionIndex: 0,
});

function emptyState(): State {
  return { districts: [], proposals: [], nextDistrictId: 1, nextProposalId: 1, overlay: false, autoEvolve: false, dirty: false, revision: 0 };
}

/**
 * État PAR PARTIE : la façade `PluginContext` est propre à chaque `Simulation` (un objet par module et par
 * simulation), ce qui isole naturellement deux parties vivant dans le même processus (tests, outils).
 */
const states = new WeakMap<PluginContext, State>();

function st(ctx: PluginContext): State {
  let s = states.get(ctx);
  if (!s) { s = emptyState(); states.set(ctx, s); }
  return s;
}

const ok = (data?: unknown): PluginCommandResult => (data === undefined ? { ok: true } : { ok: true, data });
const bad = (code: string, message: string): PluginCommandResult => ({ ok: false, code, message });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function touch(s: State): void { s.dirty = true; s.revision++; }

/** Enveloppe alignée sur les axes du monde d'un quartier. */
function boundsOf(d: District): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const swap = d.rot % 2 === 1;
  const hw = (swap ? d.depth : d.width) / 2;
  const hd = (swap ? d.width : d.depth) / 2;
  return { minX: d.x - hw, minZ: d.z - hd, maxX: d.x + hw, maxZ: d.z + hd };
}

function view(d: District): BatimentsDistrictView {
  return {
    id: d.id, type: d.type, nameFr: DISTRICT_LABELS_FR[d.type], x: d.x, z: d.z, width: d.width, depth: d.depth,
    rot: d.rot, seed: d.seed, bounds: boundsOf(d),
    stage: d.state.stage, value: Math.round(d.state.value * 10) / 10, ageMonths: d.state.ageMonths,
    buildings: d.measures.buildings, distinctAssets: d.distinctAssets,
    repetitionIndex: Math.round(d.measures.repetitionIndex * 1000) / 1000,
    residents: d.measures.residents, capacity: d.measures.capacity, jobs: d.measures.jobs,
  };
}

function proposalView(p: EvolutionProposal): BatimentsProposalView {
  return {
    id: p.id, districtId: p.districtId, buildingId: p.buildingId, fromAsset: p.fromAsset, toAsset: p.toAsset,
    variant: p.variant, x: p.x, z: p.z, rot: p.rot, kind: p.kind, reason: p.reason, cost: p.cost,
  };
}

function payloadView(s: State): BatimentsDelta {
  return {
    version: 1, overlay: s.overlay, autoEvolve: s.autoEvolve,
    districts: s.districts.map(view), proposals: s.proposals.map(proposalView),
  };
}

/** Bâtiments d'un quartier (centres dans le rectangle), avec leur modèle. */
function buildingsOf(ctx: PluginContext, d: District): { id: number; index: number; asset: CatalogAsset }[] {
  const b = ctx.buildings;
  const bb = boundsOf(d);
  const out: { id: number; index: number; asset: CatalogAsset }[] = [];
  const ids = b.query(bb.minX, bb.minZ, bb.maxX, bb.maxZ, []);
  for (const id of ids) {
    const i = b.indexOf(id);
    if (i < 0) continue;
    const x = b.store.x[i]!, z = b.store.z[i]!;
    if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
    const a = b.assetOf(id);
    if (a) out.push({ id, index: i, asset: a });
  }
  out.sort((p, q) => p.id - q.id);
  return out;
}

function measure(ctx: PluginContext, d: District): { measures: DistrictMeasures; distinctAssets: number; items: DiversityItem[] } {
  const b = ctx.buildings;
  const list = buildingsOf(ctx, d);
  const m = emptyMeasures();
  const items: DiversityItem[] = [];
  let access = 0;
  for (const e of list) {
    const i = e.index;
    m.buildings++;
    m.residents += b.store.residents[i]!;
    m.capacity += e.asset.capacity.residents;
    m.jobs += e.asset.capacity.jobs;
    if (b.store.roadAccess[i]) access++;
    m.attractivity += tagNumber(e.asset, 'attractivite');
    m.pollution += tagNumber(e.asset, 'pollution');
    if (e.asset.tags.some((t) => t.startsWith('service:'))) m.services++;
    items.push({
      assetId: e.asset.id, variant: b.store.variant[i]!, x: b.store.x[i]!, z: b.store.z[i]!,
      size: Math.max(e.asset.footprint.tilesX, e.asset.footprint.tilesZ) * TILE_SIZE,
    });
  }
  m.roadAccessRate = m.buildings > 0 ? access / m.buildings : 0;
  const div = diversityOf(ctx, items);
  m.repetitionIndex = div.repetitionIndex;
  return { measures: m, distinctAssets: div.distinctAssets, items };
}

function diversityOf(ctx: PluginContext, items: DiversityItem[]): ReturnType<typeof measureDiversity> {
  return measureDiversity(items, { styleOf: (id) => { const a = ctx.getAsset(id); return a ? styleOf(a) : undefined; } });
}

function parseSpec(ctx: PluginContext, payload: unknown): { spec: Required<BatimentsDistrictSpec> } | { error: PluginCommandResult } {
  if (!isObj(payload)) return { error: bad('INVALID_ARGS', 'Description de quartier attendue') };
  const type = payload['type'];
  if (!isDistrictType(type)) return { error: bad('INVALID_ARGS', `Type de quartier inconnu : ${String(type)}`) };
  const { x, z, width, depth } = payload as Record<string, unknown>;
  if (!num(x) || !num(z) || !num(width) || !num(depth)) return { error: bad('INVALID_ARGS', 'Centre et dimensions du quartier attendus (x, z, width, depth)') };
  const rot = num(payload['rot']) ? ((Math.round(payload['rot']) % 4) + 4) % 4 : 0;
  const seed = num(payload['seed']) ? Math.floor(payload['seed']) >>> 0 : ctx.rng.nextU32();
  return { spec: { type, x, z, width, depth, rot, seed } };
}

function planFor(ctx: PluginContext, spec: Required<BatimentsDistrictSpec>): DistrictPlan {
  const cat = ctx.catalog;
  if (!cat) throw new Error('Catalogue indisponible');
  const q: number[] = [];
  return generateDistrict({ type: spec.type, seed: spec.seed, x: spec.x, z: spec.z, width: spec.width, depth: spec.depth, rot: spec.rot }, cat, {
    heightAt: (x, z) => ctx.terrain.heightAt(x, z),
    isWet: (x, z) => ctx.terrain.isWet(x, z),
    blocked: (minX, minZ, maxX, maxZ) => ctx.buildings.query(minX, minZ, maxX, maxZ, q).length > 0,
  });
}

const planView = (p: DistrictPlan): BatimentsPlanView => p as unknown as BatimentsPlanView;

function register(ctx: PluginContext, s: State, spec: Required<BatimentsDistrictSpec>): District {
  const d: District = {
    id: s.nextDistrictId++, type: spec.type, x: spec.x, z: spec.z, width: spec.width, depth: spec.depth,
    rot: spec.rot, seed: spec.seed, createdDay: ctx.clock.dayIndex,
    state: { stage: 0, value: 50, ageMonths: 0, pressure: 0 }, measures: emptyMeasures(), distinctAssets: 0,
  };
  const m = measure(ctx, d);
  d.measures = m.measures;
  d.distinctAssets = m.distinctAssets;
  s.districts.push(d);
  if (s.districts.length > MAX_DISTRICTS) s.districts.shift();
  touch(s);
  return d;
}

function actions(ctx: PluginContext): DistrictActions | undefined {
  return ctx.use<DistrictActions>(ACTIONS_SERVICE);
}

const NO_ACTIONS = 'Le cœur de la simulation n\'expose pas encore d\'API d\'écriture aux modules : '
  + 'exécuter le plan renvoyé par planDistrict avec les commandes buildRoad puis placeBuilding (voir docs/requests/batiments.md).';

/** Candidats au remplacement dans un quartier. */
function candidates(ctx: PluginContext, d: District): EvolutionCandidate[] {
  const b = ctx.buildings;
  const out: EvolutionCandidate[] = [];
  for (const e of buildingsOf(ctx, d)) {
    const i = e.index;
    const cap = e.asset.capacity.residents;
    out.push({
      buildingId: e.id, asset: e.asset, variant: b.store.variant[i]!, x: b.store.x[i]!, z: b.store.z[i]!, rot: b.store.rot[i]!,
      occupancy: cap > 0 ? Math.min(1, b.store.residents[i]! / cap) : 1,
      roadAccess: b.store.roadAccess[i] === 1,
    });
  }
  return out;
}

export const batimentsPlugin: SimPlugin = {
  id: 'batiments',
  saveVersion: BATIMENTS_SAVE_VERSION,

  onNewGame(ctx) {
    states.set(ctx, emptyState());
  },

  onMonthStart(ctx) {
    const s = st(ctx);
    if (s.districts.length === 0) return;
    const cat = ctx.catalog;
    for (const d of s.districts) {
      const m = measure(ctx, d);
      d.measures = m.measures;
      d.distinctAssets = m.distinctAssets;
      d.state = updateDistrictState(d.state, m.measures);
      if (!cat || s.proposals.length >= MAX_PROPOSALS) continue;
      const fresh = proposeEvolutions(candidates(ctx, d), cat.assets, {
        districtId: d.id, type: d.type, state: d.state, measures: m.measures,
        max: PROPOSALS_PER_DISTRICT, nextId: s.nextProposalId, rand: () => ctx.rng.next(),
      });
      for (const p of fresh) {
        if (s.proposals.some((q) => q.buildingId === p.buildingId)) continue;
        s.proposals.push(p);
        s.nextProposalId = p.id + 1;
      }
    }
    // Application automatique (seulement si le cœur expose l'API d'écriture).
    if (s.autoEvolve) {
      const act = actions(ctx);
      if (act) {
        for (const p of [...s.proposals]) {
          const r = applyProposal(p, act);
          s.proposals = s.proposals.filter((q) => q.id !== p.id);
          const d = s.districts.find((e) => e.id === p.districtId);
          if (r.ok && d) ctx.notify('info', `${DISTRICT_LABELS_FR[d.type]} : ${p.reason}`);
        }
      }
    }
    touch(s);
  },

  takeDelta(ctx) {
    const s = states.get(ctx);
    if (!s || !s.dirty) return undefined;
    s.dirty = false;
    return payloadView(s);
  },

  snapshot(ctx) {
    const s = states.get(ctx);
    if (!s || (s.districts.length === 0 && s.proposals.length === 0 && !s.overlay && !s.autoEvolve)) return undefined;
    return payloadView(s);
  },

  command(ctx, name, payload): PluginCommandResult {
    const s = st(ctx);
    switch (name) {
      case 'planDistrict': {
        const p = parseSpec(ctx, payload);
        if ('error' in p) return p.error;
        return ok({ plan: planView(planFor(ctx, p.spec)) });
      }
      case 'registerDistrict': {
        const p = parseSpec(ctx, payload);
        if ('error' in p) return p.error;
        return ok({ district: view(register(ctx, s, p.spec)) });
      }
      case 'applyDistrict': {
        const p = parseSpec(ctx, payload);
        if ('error' in p) return p.error;
        const act = actions(ctx);
        if (!act) return bad('NOT_IMPLEMENTED', NO_ACTIONS);
        const plan = planFor(ctx, p.spec);
        const rep = applyPlan(plan, act);
        const d = register(ctx, s, p.spec);
        const report: BatimentsApplyReport = {
          roadsOk: rep.roadsOk, roadsRefused: rep.roadsRefused, lotsOk: rep.lotsOk, lotsRefused: rep.lotsRefused + rep.lotsSkipped,
          cost: rep.cost, errors: rep.errors,
        };
        return ok({ district: view(d), report });
      }
      case 'listDistricts':
        return ok({ districts: s.districts.map(view) });
      case 'districtReport': {
        if (!isObj(payload) || !num(payload['id'])) return bad('INVALID_ARGS', 'Identifiant de quartier attendu');
        const id = payload['id'];
        const d = s.districts.find((e) => e.id === id);
        if (!d) return bad('NOT_FOUND', `Quartier ${String(id)} inconnu`);
        const m = measure(ctx, d);
        d.measures = m.measures;
        d.distinctAssets = m.distinctAssets;
        touch(s);
        const div = diversityOf(ctx, m.items);
        return ok({
          district: view(d),
          diversity: {
            count: div.count, distinctAssets: div.distinctAssets, styles: div.styles,
            repetitionIndex: div.repetitionIndex, adjacentTwinRate: div.adjacentTwinRate, entropy: div.entropy, topShare: div.topShare,
          },
        });
      }
      case 'forgetDistrict': {
        if (!isObj(payload) || !num(payload['id'])) return bad('INVALID_ARGS', 'Identifiant de quartier attendu');
        const id = payload['id'];
        const n = s.districts.length;
        s.districts = s.districts.filter((d) => d.id !== id);
        s.proposals = s.proposals.filter((p) => p.districtId !== id);
        const removed = s.districts.length !== n;
        if (removed) touch(s);
        return ok({ removed });
      }
      case 'listProposals':
        return ok({ proposals: s.proposals.map(proposalView) });
      case 'applyProposal': {
        if (!isObj(payload) || !num(payload['id'])) return bad('INVALID_ARGS', 'Identifiant de proposition attendu');
        const id = payload['id'];
        const p = s.proposals.find((q) => q.id === id);
        if (!p) return bad('NOT_FOUND', `Proposition ${String(id)} inconnue`);
        const act = actions(ctx);
        if (!act) return bad('NOT_IMPLEMENTED', NO_ACTIONS);
        const r = applyProposal(p, act);
        s.proposals = s.proposals.filter((q) => q.id !== p.id);
        touch(s);
        if (!r.ok) return bad('COLLISION', r.message ?? 'Remplacement impossible');
        return ok({ buildingId: r.buildingId, cost: r.cost });
      }
      case 'dismissProposal': {
        if (!isObj(payload) || !num(payload['id'])) return bad('INVALID_ARGS', 'Identifiant de proposition attendu');
        const id = payload['id'];
        const n = s.proposals.length;
        s.proposals = s.proposals.filter((q) => q.id !== id);
        const removed = s.proposals.length !== n;
        if (removed) touch(s);
        return ok({ removed });
      }
      case 'setOverlay': {
        s.overlay = isObj(payload) && payload['on'] === true;
        touch(s);
        return ok({ overlay: s.overlay });
      }
      case 'setAutoEvolve': {
        s.autoEvolve = isObj(payload) && payload['on'] === true;
        touch(s);
        return ok({ autoEvolve: s.autoEvolve });
      }
      default:
        return bad('NOT_FOUND', `Commande inconnue du module bâtiments : ${name}`);
    }
  },

  save(ctx) {
    const s = states.get(ctx);
    if (!s || (s.districts.length === 0 && s.proposals.length === 0 && !s.overlay && !s.autoEvolve)) return undefined;
    const out: BatimentsSave = {
      districts: s.districts.map((d): SavedDistrict => ({
        id: d.id, type: d.type, x: d.x, z: d.z, width: d.width, depth: d.depth, rot: d.rot, seed: d.seed,
        createdDay: d.createdDay, stage: d.state.stage, value: d.state.value, ageMonths: d.state.ageMonths, pressure: d.state.pressure,
      })),
      proposals: s.proposals.map((p) => ({ ...p })),
      nextDistrictId: s.nextDistrictId, nextProposalId: s.nextProposalId,
      overlay: s.overlay, autoEvolve: s.autoEvolve,
    };
    return out;
  },

  load(ctx, data, version) {
    const saved = migrateBatiments(data, version);
    const s = emptyState();
    states.set(ctx, s);
    for (const d of saved.districts) {
      if (!isDistrictType(d.type)) throw new Error(`section batiments : type de quartier inconnu ${String(d.type)}`);
      if (!num(d.x) || !num(d.z) || !num(d.width) || !num(d.depth)) throw new Error('section batiments : quartier mal formé');
      const dis: District = {
        id: d.id | 0, type: d.type, x: d.x, z: d.z, width: d.width, depth: d.depth, rot: d.rot | 0, seed: d.seed >>> 0,
        createdDay: d.createdDay | 0,
        state: { stage: d.stage | 0, value: num(d.value) ? d.value : 50, ageMonths: d.ageMonths | 0, pressure: d.pressure | 0 },
        measures: emptyMeasures(), distinctAssets: 0,
      };
      const m = measure(ctx, dis);
      dis.measures = m.measures;
      dis.distinctAssets = m.distinctAssets;
      s.districts.push(dis);
    }
    for (const p of saved.proposals) {
      if (p.kind !== 'densification' && p.kind !== 'valorisation') continue;
      s.proposals.push({ ...p, kind: p.kind });
    }
    s.nextDistrictId = Math.max(saved.nextDistrictId, ...s.districts.map((d) => d.id + 1), 1);
    s.nextProposalId = Math.max(saved.nextProposalId, ...s.proposals.map((p) => p.id + 1), 1);
    s.overlay = saved.overlay;
    s.autoEvolve = saved.autoEvolve;
    s.dirty = s.districts.length > 0 || s.proposals.length > 0 || s.overlay || s.autoEvolve;
  },
};

/** Lecture de l'état interne d'une partie (tests, diagnostic). */
export function batimentsDebugState(ctx: PluginContext): { districts: number; proposals: number; overlay: boolean; autoEvolve: boolean; revision: number } {
  const s = st(ctx);
  return { districts: s.districts.length, proposals: s.proposals.length, overlay: s.overlay, autoEvolve: s.autoEvolve, revision: s.revision };
}

export { emptyBatimentsSave };
