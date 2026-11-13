/**
 * Module de simulation « Eau et assainissement » (phase 2B.5) — branché sur le contrat municipal.
 *
 * Utilise le service `municipal` s'il est enregistré (grilles, réseaux `eau` / `egouts`, budget, registre d'effets,
 * ordonnanceur partagés) ; sinon un contrat municipal PRIVÉ, piloté par les crochets du module et sauvegardé dans
 * sa propre section. Publie le service `eau` (`growthAllowed`, `buildingState`, `system`) pour les autres modules.
 *
 * Dormant tant qu'aucune installation d'eau (bâtiment `eau_*` du catalogue) n'a été posée : aucun `ext`, aucune
 * section de sauvegarde, aucune grille : partie identique tick à tick (tests/eau/plugin.test.ts).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { geometryFor } from '../municipal/grid';
import { DEFAULT_CELL_SIZE, Municipal, MUNICIPAL_SERVICE } from '../municipal/municipal';
import { migrateMunicipal, MUNICIPAL_SAVE_VERSION } from '../municipal/save';
import { EAU_SAVE_VERSION, migrateEau, type EauSave } from '../save-sections/eau';
import { WaterSystem } from '../water-network/system';
import type { WaterSettings } from '../../shared/water-network/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

/** Nom du service inter-modules publié par le module. */
export const EAU_SERVICE = 'eau';

export interface EauService {
  /** Croissance autorisée pour un bâtiment (vrai tant que le service n'existe pas, puis seulement s'il est desservi). */
  growthAllowed(buildingId: number): boolean;
  buildingState: WaterSystem['buildingState'];
  readonly system: WaterSystem;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createEauPlugin(): SimPlugin & { readonly system: WaterSystem; municipalOf(): Municipal | null } {
  const system = new WaterSystem();
  let ctxRef: PluginContext | null = null;
  /** Contrat privé (module `municipal` absent). */
  let own: Municipal | null = null;
  let shared: Municipal | null = null;
  let sentVersion = -1;
  let sentPipes = -1;

  const muni = (): Municipal | null => shared ?? own;
  const register = (m: Municipal): void => {
    m.scheduler.add({ id: 'eau:heure', every: 'hour', run: (info) => { if (ctxRef) system.hourly(ctxRef, info.totalMinutes); } });
    m.scheduler.add({ id: 'eau:jour', every: 'day', run: (info) => { if (ctxRef) system.daily(ctxRef, info.totalMinutes); } });
    m.scheduler.add({ id: 'eau:mois', every: 'month', run: () => { system.monthly(); } });
  };

  const plugin: SimPlugin & { readonly system: WaterSystem; municipalOf(): Municipal | null } = {
    id: 'eau',
    saveVersion: EAU_SAVE_VERSION,
    system,
    municipalOf: muni,

    init(ctx) {
      ctxRef = ctx;
      shared = ctx.use<Municipal>(MUNICIPAL_SERVICE) ?? null;
      if (!shared) { own = new Municipal(); own.scheduler.log = (m) => { console.error(m); }; }
      register(muni()!);
      const api: EauService = {
        growthAllowed: (id) => system.growthAllowed(id),
        buildingState: (id) => system.buildingState(id),
        system,
      };
      ctx.provide(EAU_SERVICE, api);
    },

    onNewGame(ctx) {
      if (own) {
        const b = ctx.terrain.bounds() ?? { minX: 0, minZ: 0, maxX: DEFAULT_CELL_SIZE, maxZ: DEFAULT_CELL_SIZE };
        own.reset(geometryFor(b, DEFAULT_CELL_SIZE));
      }
      system.reset(muni()!);
      sentVersion = -1; sentPipes = -1;
    },

    onTick(ctx, minutes) { if (own) own.scheduler.advance(ctx.clock.totalMinutes, minutes); },
    onDayStart(ctx) { if (own) own.scheduler.day(ctx.clock.dayIndex, ctx.clock.totalMinutes); },
    onMonthStart(ctx) { if (own) own.scheduler.month(ctx.clock.monthIndex, ctx.clock.totalMinutes); },

    takeDelta() {
      if (!system.active || system.version === sentVersion) return undefined;
      sentVersion = system.version;
      const withPipes = system.pipesVersion !== sentPipes;
      sentPipes = system.pipesVersion;
      return system.delta(withPipes);
    },

    snapshot() {
      if (!system.active) return undefined;
      sentVersion = system.version; sentPipes = system.pipesVersion;
      return system.snapshot();
    },

    command(ctx, name, payload): PluginCommandResult {
      const p = isObj(payload) ? payload : {};
      switch (name) {
        case 'settings':
          return { ok: true, data: system.applySettings(p as Partial<WaterSettings>, ctx.clock.totalMinutes) };
        case 'state':
          return {
            ok: true,
            data: {
              active: system.active, balance: system.balance, settings: { ...system.settings }, facilities: system.facilityStates(),
              budget: { current: { ...system.month, lines: { ...system.month.lines } }, last: system.lastBudget }, alerts: [...system.alerts],
            },
          };
        case 'building': {
          if (typeof p.id !== 'number') return { ok: false, code: 'INVALID_ARGS', message: 'id (nombre) attendu' };
          return { ok: true, data: system.buildingState(p.id) };
        }
        case 'history':
          return { ok: true, data: system.history.map((h) => ({ ...h })) };
        default:
          return { ok: false, code: 'INVALID_ARGS', message: `Commande eau inconnue : ${name}` };
      }
    },

    save(): EauSave | undefined {
      if (!system.active) return undefined;
      return { system: system.toJSON(), municipal: own ? own.toJSON() : null };
    },

    load(_ctx, data, version) {
      const d = migrateEau(data, version);
      if (own && d.municipal) own.load(migrateMunicipal(d.municipal, MUNICIPAL_SAVE_VERSION));
      if (d.system) system.load(d.system);
      sentVersion = -1; sentPipes = -1;
    },
  };
  return plugin;
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const eauPlugin = createEauPlugin();
