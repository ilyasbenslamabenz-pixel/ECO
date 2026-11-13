/**
 * Module de simulation « Déchets » (phase 2B.6) — propriété de la branche p2b-dechets.
 * Branché sur le contrat municipal (service `municipal`, enregistré AVANT ce module) : tâches de l'ordonnanceur
 * multi-fréquence (production horaire, départ des tournées, clôture journalière, budget mensuel), grilles
 * d'indicateurs (pollutions, nuisances, satisfaction, valeur foncière), lignes budgétaires, registre d'effets.
 * Sans le service `municipal`, le module reste inactif (aucun ext, aucune section).
 * Logique : src/sim/waste/system.ts ; graphe des camions : src/sim/waste/graph.ts ; format : src/sim/waste/save.ts.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { DechetsDelta, DechetsLayer, DechetsSnapshot } from '../../shared/protocol-ext/dechets';
import { PLUGIN_TRANSFER_KEY } from '../../shared/protocol';
import { WASTE_PARAMS } from '../../shared/waste/types';
import { MUNICIPAL_SERVICE, type Municipal } from '../municipal/municipal';
import { ROAD_KINDS } from '../roads/types';
import { DECHETS_SAVE_VERSION, loadWaste, migrateDechets, saveWaste } from '../waste/save';
import { NUISANCE_ID, WasteSystem } from '../waste/system';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fabrique un module `dechets` (une instance par simulation ; le registre utilise `dechetsPlugin`). */
export function createDechetsPlugin(): SimPlugin & { readonly waste: WasteSystem } {
  let muni: Municipal | undefined;
  const waste = new WasteSystem(() => muni);
  let ctxRef: PluginContext | null = null;
  let sentVersion = -1;
  let layerHour = -1;
  let lastTrucks = 0;
  /** Le module n'émet rien tant qu'aucun bâtiment n'a produit de déchets ni aucune installation n'existe. */
  const active = (): boolean => !!muni && (waste.producers > 0 || waste.facilities.size > 0 || waste.runs.length > 0);

  const layer = (ctx: PluginContext): DechetsLayer | null => {
    const g = muni?.grids.get(NUISANCE_ID), soil = muni?.grids.get('pollution_sol');
    if (!g) return null;
    return {
      originX: g.originX, originZ: g.originZ, cellSize: g.cellSize, cols: g.cols, rows: g.rows,
      nuisance: g.copyValues(), soil: soil && soil.size === g.size ? soil.copyValues() : new Float32Array(g.size), bins: waste.binLayer(ctx),
    };
  };

  /** Points d'apport : un groupe de conteneurs au bord de la route par îlot de 96 m contenant des producteurs. */
  const containers = (ctx: PluginContext): Float32Array => {
    if (waste.settings.sortShare <= 0) return new Float32Array(0);
    const st = ctx.buildings.store, cells = new Map<string, { x: number; z: number; n: number }>();
    for (let i = 0; i < ctx.buildings.count; i++) {
      if (st.residents[i]! <= 0 && st.workers[i]! <= 0) continue;
      if (waste.facilities.has(st.id[i]!)) continue;
      const key = `${Math.floor(st.x[i]! / 96)},${Math.floor(st.z[i]! / 96)}`;
      const c = cells.get(key) ?? { x: 0, z: 0, n: 0 };
      c.x += st.x[i]!; c.z += st.z[i]!; c.n++;
      cells.set(key, c);
    }
    const out: number[] = [];
    const keys = [...cells.keys()].sort();
    for (const k of keys) {
      const c = cells.get(k)!;
      const cx = c.x / c.n, cz = c.z / c.n;
      const near = ctx.roads.segmentNear(cx, cz, 80, (id) => !ROAD_KINDS[ctx.roads.kindOf(id)].vehicles);
      if (!near) continue;
      const dx = cx - near.x, dz = cz - near.z, l = Math.hypot(dx, dz) || 1;
      const half = ROAD_KINDS[ctx.roads.kindOf(near.segId)].sidewalk + 4.5;
      // Sur le trottoir, côté îlot, face à la chaussée.
      out.push(near.x + (dx / l) * half, near.z + (dz / l) * half, Math.atan2(-dx, -dz));
    }
    return new Float32Array(out);
  };

  const plugin: SimPlugin & { readonly waste: WasteSystem } = {
    id: 'dechets',
    saveVersion: DECHETS_SAVE_VERSION,
    waste,

    init(ctx) {
      ctxRef = ctx;
      muni = ctx.use<Municipal>(MUNICIPAL_SERVICE);
      if (!muni) return;
      const s = muni.scheduler;
      if (s.has('dechets:production')) return; // instance du registre partagée entre plusieurs simulations (tests)
      s.add({ id: 'dechets:production', every: 'hour', order: 10, run: (info) => { if (ctxRef?.inGame) waste.produce(ctxRef, info.minutes || 60); } });
      s.add({
        id: 'dechets:tournees', every: 'hour', order: 20,
        run: (info) => {
          const c = ctxRef;
          if (!c?.inGame) return;
          const minuteOfDay = ((info.index * 60) % 1440 + 1440) % 1440;
          const day = Math.floor((info.index * 60) / 1440);
          if (minuteOfDay === WASTE_PARAMS.departureMinute && waste.isCollectionDay(day)) waste.planTours(c, info.index * 60);
        },
      });
      s.add({ id: 'dechets:cloture', every: 'day', order: 10, run: (info) => { if (ctxRef?.inGame) waste.closeDay(ctxRef, info.index, info.totalMinutes); } });
      s.add({ id: 'dechets:budget', every: 'month', order: 10, run: () => { if (ctxRef?.inGame) waste.closeMonth(ctxRef); } });
    },

    onNewGame(ctx) {
      ctxRef = ctx;
      waste.reset();
      waste.today.day = ctx.clock.dayIndex;
      sentVersion = -1; layerHour = -1; lastTrucks = 0;
      waste.ensureGrids();
    },

    onTick(ctx) {
      ctxRef = ctx;
      if (!muni) return;
      waste.advanceTrucks(ctx.clock.totalMinutes);
    },

    takeDelta(ctx): DechetsDelta | undefined {
      if (!active()) return undefined;
      const d: DechetsDelta = {};
      const transfer: ArrayBufferLike[] = [];
      if (waste.runs.length || lastTrucks) {
        d.trucks = waste.truckPoses(ctx.clock.totalMinutes);
        transfer.push(d.trucks.buffer);
        lastTrucks = waste.runs.length;
      }
      const hour = Math.floor(ctx.clock.totalMinutes / 60);
      if (waste.version !== sentVersion && hour !== layerHour) {
        sentVersion = waste.version;
        layerHour = hour;
        d.summary = waste.summary(ctx.clock.dayIndex);
        const l = layer(ctx);
        if (l) { d.layer = l; transfer.push(l.nuisance.buffer, l.soil.buffer, l.bins.buffer); }
        d.containers = containers(ctx);
        transfer.push(d.containers.buffer);
      }
      if (!d.trucks && !d.summary) return undefined;
      if (transfer.length) d[PLUGIN_TRANSFER_KEY] = transfer;
      return d;
    },

    snapshot(ctx): DechetsSnapshot | undefined {
      if (!active()) return undefined;
      sentVersion = waste.version;
      layerHour = Math.floor(ctx.clock.totalMinutes / 60);
      return { trucks: waste.truckPoses(ctx.clock.totalMinutes), summary: waste.summary(ctx.clock.dayIndex), layer: layer(ctx), containers: containers(ctx) };
    },

    command(ctx, name, payload): PluginCommandResult {
      if (!muni) return { ok: false, code: 'NOT_IMPLEMENTED', message: 'Module municipal absent : déchets inactifs' };
      const p = isObj(payload) ? payload : {};
      switch (name) {
        case 'etat':
          waste.syncFacilities(ctx);
          return { ok: true, data: waste.summary(ctx.clock.dayIndex) };
        case 'reglages': {
          waste.setSettings({
            collectsPerWeek: typeof p.collectsPerWeek === 'number' ? p.collectsPerWeek : undefined,
            sortShare: typeof p.sortShare === 'number' ? p.sortShare : undefined,
            funding: typeof p.funding === 'number' ? p.funding : undefined,
          }, ctx.clock.totalMinutes);
          layerHour = -1; // la synthèse repart au prochain delta
          return { ok: true, data: waste.summary(ctx.clock.dayIndex) };
        }
        case 'collecter':
          return { ok: true, data: { tours: waste.planTours(ctx, ctx.clock.totalMinutes) } };
        case 'bacs': {
          const id = typeof p.buildingId === 'number' ? p.buildingId : NaN;
          const b = waste.bins.get(id);
          return { ok: true, data: b ? { rec: b.rec, res: b.res, cap: b.cap } : null };
        }
        default:
          return { ok: false, code: 'INVALID_ARGS', message: `Commande déchets inconnue : ${name}` };
      }
    },

    save() { return active() ? saveWaste(waste) : undefined; },

    load(ctx, data, version) {
      ctxRef = ctx;
      loadWaste(waste, migrateDechets(data, version));
      waste.ensureGrids();
      sentVersion = -1; layerHour = -1;
    },
  };
  return plugin;
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const dechetsPlugin = createDechetsPlugin();
