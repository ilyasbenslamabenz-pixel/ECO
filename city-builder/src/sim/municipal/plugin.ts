/**
 * Module de simulation `municipal` : héberge le contrat municipal (src/sim/municipal/municipal.ts) dans la
 * simulation via les crochets de `SimPlugin`, et le publie comme service `municipal` aux autres modules :
 *
 *   const m = ctx.use<Municipal>(MUNICIPAL_SERVICE);   // undefined si le module n'est pas enregistré
 *   m?.grids.ensure('pollution_air').stamp(x, z, 120, 30);
 *
 * Sans aucun usage (aucune grille, aucun réseau, aucune ligne, aucun effet), le module n'envoie rien, n'écrit
 * aucune section et ne touche à aucun état de la simulation de base : partie identique tick à tick.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { IndicatorId, MunicipalDelta, MunicipalSnapshot } from '../../shared/municipal/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from '../plugins/types';
import { MUNICIPAL_SAVE_VERSION, migrateMunicipal } from '../save-sections/municipal';
import type { EconomyMonthLike } from './budget';
import { geometryFor } from './grid';
import { DEFAULT_CELL_SIZE, Municipal, MUNICIPAL_SERVICE } from './municipal';

/**
 * Accès facultatif au bilan mensuel de l'économie de base. N'existe PAS encore dans `PluginContext` :
 * demandé dans docs/requests/municipal.md. Dès que le cœur l'ajoute, le miroir budgétaire s'active seul.
 */
interface EconomyAccess { economy?: { lastMonth(): EconomyMonthLike | undefined } }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface MunicipalPluginOptions {
  /** Taille des cellules des grilles (m). */
  cellSize?: number;
}

/** Fabrique un module `municipal` (une instance de contrat par module ; le registre utilise `municipalPlugin`). */
export function createMunicipalPlugin(opts: MunicipalPluginOptions = {}): SimPlugin & { readonly municipal: Municipal } {
  const cellSize = opts.cellSize ?? DEFAULT_CELL_SIZE;
  const muni = new Municipal();
  let sentVersion = -1;

  const summary = (full: boolean): MunicipalDelta => {
    const d: MunicipalDelta = {};
    if (muni.grids.count) d.grids = muni.grids.ids().sort().map((id) => ({ id, stats: muni.grids.get(id)!.stats() }));
    const nets = muni.networks.allReports();
    if (nets.length) d.networks = nets;
    const recent = muni.effects.drainRecent();
    if (full) d.effects = muni.effects.query({ limit: 50 });
    else if (recent.length) d.effects = recent;
    const last = muni.budget.lastMonth;
    if (last) d.budget = last;
    return d;
  };

  const plugin: SimPlugin & { readonly municipal: Municipal } = {
    id: 'municipal',
    saveVersion: MUNICIPAL_SAVE_VERSION,
    municipal: muni,

    init(ctx: PluginContext) {
      ctx.provide(MUNICIPAL_SERVICE, muni);
      muni.scheduler.log = (m) => { console.error(m); };
      muni.economySource = () => (ctx as PluginContext & EconomyAccess).economy?.lastMonth();
    },

    onNewGame(ctx) {
      const b = ctx.terrain.bounds() ?? { minX: 0, minZ: 0, maxX: cellSize, maxZ: cellSize };
      muni.reset(geometryFor(b, cellSize));
      sentVersion = -1;
    },

    onTick(ctx, minutes) { muni.scheduler.advance(ctx.clock.totalMinutes, minutes); },
    onDayStart(ctx) { muni.scheduler.day(ctx.clock.dayIndex, ctx.clock.totalMinutes); },
    onMonthStart(ctx) { muni.scheduler.month(ctx.clock.monthIndex, ctx.clock.totalMinutes); },

    takeDelta() {
      if (muni.isEmpty) return undefined;
      const v = muni.contentVersion();
      if (v === sentVersion) return undefined;
      sentVersion = v;
      return summary(false);
    },

    snapshot(): MunicipalSnapshot | undefined {
      if (muni.isEmpty) return undefined;
      sentVersion = muni.contentVersion();
      return summary(true);
    },

    command(_ctx, name, payload): PluginCommandResult {
      const p = isObj(payload) ? payload : {};
      switch (name) {
        case 'indicators':
          return {
            ok: true,
            data: muni.grids.ids().sort().map((id) => {
              const g = muni.grids.get(id)!;
              return { id, nameFr: g.spec.nameFr, unit: g.spec.unit, geometry: { ...g.geometry }, stats: g.stats() };
            }),
          };
        case 'grid': {
          const g = typeof p.id === 'string' ? muni.grids.get(p.id as IndicatorId) : undefined;
          if (!g) return { ok: false, code: 'NOT_FOUND', message: `Indicateur inconnu : ${String(p.id)}` };
          const values = g.copyValues();
          // Copie neuve (le résultat d'une commande est cloné par postMessage ; `$transfer` ne vaut que pour les deltas).
          return { ok: true, data: { geometry: { ...g.geometry }, values } };
        }
        case 'effects': {
          const q: Parameters<typeof muni.effects.query>[0] = {};
          const cause = num(p.cause), x = num(p.x), z = num(p.z), radius = num(p.radius), since = num(p.since), limit = num(p.limit);
          if (cause !== undefined) q.cause = cause;
          if (typeof p.target === 'string') q.target = p.target;
          if (x !== undefined && z !== undefined) { q.x = x; q.z = z; q.radius = radius ?? 0; }
          if (since !== undefined) q.since = since;
          if (limit !== undefined) q.limit = Math.max(1, Math.min(1000, Math.floor(limit)));
          return { ok: true, data: muni.effects.query(q) };
        }
        case 'causes':
          return { ok: true, data: muni.effects.topCauses(Math.max(1, Math.min(100, Math.floor(num(p.limit) ?? 10)))) };
        case 'budget': {
          const months = Math.max(1, Math.min(120, Math.floor(num(p.months) ?? 12)));
          const groupBy = p.groupBy === 'service' || p.groupBy === 'district' ? p.groupBy : 'category';
          return { ok: true, data: { months: muni.budget.history.slice(-months), groups: muni.budget.groupBy(groupBy, months) } };
        }
        case 'network': {
          if (typeof p.kind !== 'string') return { ok: false, code: 'INVALID_ARGS', message: 'kind (texte) attendu' };
          return { ok: true, data: muni.networks.lastReport(p.kind) ?? null };
        }
        default:
          return { ok: false, code: 'INVALID_ARGS', message: `Commande municipale inconnue : ${name}` };
      }
    },

    save() { return muni.isEmpty ? undefined : muni.toJSON(); },

    load(_ctx, data, version) {
      muni.load(migrateMunicipal(data, version));
      sentVersion = -1;
    },
  };
  return plugin;
}

/** Instance du registre (src/sim/plugins/index.ts — ligne d'enregistrement demandée dans docs/requests/municipal.md). */
export const municipalPlugin = createMunicipalPlugin();
