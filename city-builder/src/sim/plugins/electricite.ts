/**
 * Module de simulation « Électricité » (phase 2B, sous-étape 4) — propriété de la branche p2b-electricite.
 * Moteur : src/sim/power/system.ts ; modèle : src/shared/power/model.ts ; protocole : src/shared/protocol-ext/electricite.ts ;
 * sauvegarde : src/sim/save-sections/electricite.ts. Documentation : docs/ELECTRICITE.md.
 *
 * Contrat municipal : le module utilise le service `municipal` (`ctx.use`) si le module `municipal` est enregistré
 * AVANT lui ; sinon il héberge sa propre instance du contrat (même code, `createMunicipalPlugin()`), publie le
 * service `municipal` pour les modules suivants et en écrit l'état dans sa propre section (`municipal`).
 *
 * Tâches de l'ordonnanceur municipal : `electricite:heure` (pannes, répartition, effets), `electricite:jour`
 * (toitures solaires), `electricite:mois` (lignes budgétaires du service).
 * Service publié : `electricite` (`ElectriciteService` : part servie par bâtiment, surplus exportable, bilan).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { createMunicipalPlugin, MUNICIPAL_SAVE_VERSION, MUNICIPAL_SERVICE, type Municipal } from '../municipal';
import { PowerSystem } from '../power/system';
import { ELECTRICITE_SAVE_VERSION, migrateElectricite, type ElectriciteSave } from '../power/save';
import {
  CONSUMER_CLASSES, type ConsumerClass, ELECTRICITE_ID, ELECTRICITE_SERVICE, type ElectriciteService, type FacilityKind,
} from '../../shared/power/types';
import { FACILITY_SPECS, hydroSiteCheck } from '../../shared/power/model';
import { TILE_SIZE } from '../../shared/constants';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bad = (message: string): PluginCommandResult => ({ ok: false, code: 'INVALID_ARGS', message });

export type ElectricitePlugin = SimPlugin & { readonly system: PowerSystem; municipal(): Municipal | undefined };

/** Fabrique un module (une instance par simulation dans les tests ; le registre utilise `electricitePlugin`). */
export function createElectricitePlugin(): ElectricitePlugin {
  let muni: Municipal | undefined;
  let embedded: ReturnType<typeof createMunicipalPlugin> | null = null;
  const system = new PowerSystem(() => muni);
  /** Rien à faire tant qu'aucune installation n'existe (partie sans électricité : aucun effet, aucune section). */
  let active = false;

  const ensureActive = (ctx: PluginContext): boolean => {
    if (active) return true;
    if (system.isIdle(ctx)) return false;
    active = true;
    return true;
  };

  const service: ElectriciteService = {
    powerFactor: (id) => system.powerFactor(id),
    isPowered: (id) => system.powerFactor(id) >= 1,
    exportableKw: () => system.exportableKw(),
    summary: () => system.summary(),
  };

  const plugin: ElectricitePlugin = {
    id: ELECTRICITE_ID,
    saveVersion: ELECTRICITE_SAVE_VERSION,
    system,
    municipal: () => muni,

    init(ctx) {
      muni = ctx.use<Municipal>(MUNICIPAL_SERVICE);
      if (!muni) {
        embedded = createMunicipalPlugin();
        embedded.init!(ctx); // publie le service `municipal` pour les modules suivants
        muni = embedded.municipal;
        system.municipalMode = 'integre';
      }
      ctx.provide(ELECTRICITE_SERVICE, service);
      muni.scheduler.add({ id: 'electricite:heure', every: 'hour', run: () => { if (ensureActive(ctx)) system.hour(ctx); } });
      muni.scheduler.add({ id: 'electricite:jour', every: 'day', run: () => { if (active) system.day(ctx); } });
      muni.scheduler.add({ id: 'electricite:mois', every: 'month', run: () => { if (active) system.month(ctx); } });
    },

    onNewGame(ctx) {
      embedded?.onNewGame!(ctx);
      system.reset();
      active = false;
    },

    onTick(ctx, minutes) { embedded?.onTick!(ctx, minutes); },
    onDayStart(ctx) { embedded?.onDayStart!(ctx); },
    onMonthStart(ctx) { embedded?.onMonthStart!(ctx); },

    takeDelta() { return active ? system.takeDelta() : undefined; },

    snapshot() {
      if (!active) return undefined;
      const d = system.full();
      system.markSnapshotSent();
      return d;
    },

    command(ctx, name, payload): PluginCommandResult {
      if (!ctx.inGame && name !== 'state') return { ok: false, code: 'NO_GAME', message: 'Aucune partie en cours' };
      const p = isObj(payload) ? payload : {};
      const activate = (): void => { active = true; };
      switch (name) {
        case 'state':
          if (ctx.inGame) { system.allocate(ctx, false); if (!system.isIdle(ctx)) activate(); }
          return { ok: true, data: system.full() };
        case 'refresh':
          activate();
          return { ok: true, data: system.allocate(ctx, false) };
        case 'quoteLine': {
          const a = num(p.a), b = num(p.b);
          if (a === undefined || b === undefined) return bad('a et b (identifiants de bâtiments) attendus');
          const q = system.quoteLine(ctx, a, b);
          return q.ok ? { ok: true, data: { lengthM: q.lengthM, cost: q.cost, upkeepPerMonth: q.upkeepPerMonth } } : q;
        }
        case 'buildLine': {
          const a = num(p.a), b = num(p.b);
          if (a === undefined || b === undefined) return bad('a et b (identifiants de bâtiments) attendus');
          activate();
          const r = system.buildLine(ctx, a, b);
          return r.ok ? { ok: true, data: { line: r.line, cost: r.cost } } : r;
        }
        case 'autoConnect': {
          const id = num(p.id);
          if (id === undefined) return bad('id (installation) attendu');
          activate();
          const r = system.autoConnect(ctx, id);
          return r.ok ? { ok: true, data: { line: r.line, cost: r.cost } } : r;
        }
        case 'removeLine': {
          const id = num(p.id);
          if (id === undefined) return bad('id (ligne) attendu');
          return { ok: true, data: { removed: system.removeLine(ctx, id) } };
        }
        case 'setFunding': {
          const f = num(p.funding);
          if (f === undefined) return bad('funding (nombre) attendu');
          activate();
          system.setFunding(ctx, f);
          return { ok: true, data: system.state.settings };
        }
        case 'setPriorities': {
          const order = Array.isArray(p.order) ? p.order : null;
          if (!order || !order.every((c): c is ConsumerClass => typeof c === 'string' && (CONSUMER_CLASSES as readonly string[]).includes(c))) {
            return bad(`order : permutation de ${CONSUMER_CLASSES.join(', ')} attendue`);
          }
          activate();
          if (!system.setPriorities(ctx, order)) return bad(`order : permutation de ${CONSUMER_CLASSES.join(', ')} attendue`);
          return { ok: true, data: system.state.settings };
        }
        case 'setRooftops':
          if (typeof p.enabled !== 'boolean') return bad('enabled (booléen) attendu');
          activate();
          system.setRooftops(ctx, p.enabled);
          return { ok: true, data: system.state.settings };
        case 'forceWind': {
          const ms = p.ms === null ? null : num(p.ms);
          if (ms === undefined) return bad('ms (nombre ou null) attendu');
          system.forceWind(ms);
          if (active) system.allocate(ctx, false);
          return { ok: true, data: { windMs: system.windNow(ctx).ms } };
        }
        case 'checkSite': {
          const kind = p.kind as FacilityKind;
          const x = num(p.x), z = num(p.z);
          if (!(kind in FACILITY_SPECS) || x === undefined || z === undefined) return bad('kind, x, z attendus');
          if (kind !== 'hydro') return { ok: true, data: { ok: true, reason: 'Aucune contrainte de site', wetShare: 0 } };
          const half = (4 * TILE_SIZE) / 2;
          const c = hydroSiteCheck(x, z, half, (px, pz) => ctx.terrain.isWet(px, pz));
          return { ok: true, data: { ok: c.ok, reason: c.reason, wetShare: c.wetShare } };
        }
        case 'effects': {
          const limit = Math.max(1, Math.min(200, Math.floor(num(p.limit) ?? 30)));
          const all = muni?.effects.query({ limit: 1000 }) ?? [];
          const causes = new Set((muni?.effects.topCauses(1000) ?? []).filter((s) => s.cause.kind.startsWith('electricite:')).map((s) => s.cause.id));
          return { ok: true, data: all.filter((e) => causes.has(e.cause)).slice(0, limit) };
        }
        default:
          return bad(`Commande électricité inconnue : ${name}`);
      }
    },

    save(ctx) {
      const out: ElectriciteSave = {};
      if (active || !system.isIdle(ctx)) out.power = system.toJSON();
      if (embedded) {
        const m = embedded.save!(ctx);
        if (m !== undefined) { out.municipal = m; out.municipalVersion = MUNICIPAL_SAVE_VERSION; }
      }
      return out.power || out.municipal ? out : undefined;
    },

    load(ctx, data, version) {
      const d = migrateElectricite(data, version);
      if (embedded && d.municipal !== undefined) embedded.load!(ctx, d.municipal, d.municipalVersion ?? 1);
      if (d.power) { system.load(d.power); active = true; }
    },
  };
  return plugin;
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const electricitePlugin = createElectricitePlugin();
