/**
 * Hôte des modules de simulation : construit la façade `PluginContext` de chaque module, appelle les
 * crochets en isolant les exceptions, assemble `delta.ext` / `snapshot.ext`, écrit et relit les sections
 * de sauvegarde (`save.plugins`), route les commandes `pluginCommand`.
 *
 * Fichier COMMUN (superviseur) : les branches de phase 2 n'y touchent pas.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CommandError, CommandErrorCode } from '../../shared/contracts';
import { terrainBounds } from '../../shared/terrain-gen';
import { Rng } from '../rng';
import type { Simulation } from '../world';
import type {
  PluginBuildings, PluginClock, PluginCommandResult, PluginContext, PluginDemography, PluginEconomy, PluginErrorRecord, PluginRoads,
  PluginSaveSection, PluginTerrain, SimPlugin,
} from './types';

const COMMAND_ERROR_CODES: readonly CommandErrorCode[] = [
  'NO_GAME', 'INVALID_ARGS', 'UNKNOWN_ASSET', 'OUT_OF_BOUNDS', 'INSUFFICIENT_FUNDS', 'COLLISION', 'TOO_STEEP', 'UNDER_WATER',
  'NOT_FOUND', 'BAD_SAVE', 'NOT_IMPLEMENTED',
];
const MAX_ERROR_RECORDS = 64;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Graine du PRNG d'un module : graine de la partie mélangée au hachage FNV-1a de son identifiant. */
export function pluginSeed(gameSeed: number, id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h ^ Math.imul(gameSeed | 0, 0x9e3779b1)) >>> 0;
}

/** Journal par défaut : console (disponible dans le worker et sous Node). */
const defaultLog = (message: string): void => { console.error(message); };

export class PluginHost {
  readonly plugins: readonly SimPlugin[];
  private readonly byId = new Map<string, SimPlugin>();
  private readonly ctxs = new Map<string, PluginContext>();
  private readonly rngs = new Map<string, Rng>();
  private readonly services = new Map<string, unknown>();
  /** Sections de sauvegarde de modules inconnus (ou trop récentes) : réécrites telles quelles à la prochaine sauvegarde. */
  private foreign: Record<string, PluginSaveSection> = {};
  private initialized = false;
  private readonly notified = new Set<string>();
  /** Erreurs attrapées (une entrée par module + crochet, compteur d'occurrences). */
  readonly errors: PluginErrorRecord[] = [];
  /** Journal des erreurs (remplaçable : tests, worker). */
  log: (message: string) => void = defaultLog;

  constructor(private readonly sim: Simulation, plugins: readonly SimPlugin[]) {
    const list: SimPlugin[] = [];
    for (const p of plugins) {
      if (!p || typeof p.id !== 'string' || p.id.length === 0) throw new Error('Module de simulation sans identifiant');
      if (this.byId.has(p.id)) throw new Error(`Module de simulation en double : ${p.id}`);
      this.byId.set(p.id, p);
      list.push(p);
      this.rngs.set(p.id, new Rng(pluginSeed(0, p.id)));
      this.ctxs.set(p.id, this.makeContext(p.id));
    }
    this.plugins = list;
  }

  has(id: string): boolean { return this.byId.has(id); }
  ids(): string[] { return this.plugins.map((p) => p.id); }
  /** Contexte d'un module (tests). */
  contextOf(id: string): PluginContext | undefined { return this.ctxs.get(id); }

  /* ----------------------------- Façade ----------------------------- */

  private makeContext(pluginId: string): PluginContext {
    const sim = this.sim;
    const clock: PluginClock = {
      get totalMinutes() { return sim.clock.totalMinutes; },
      get hourOfDay() { return sim.clock.hourOfDay; },
      get minuteOfDay() { return sim.clock.minuteOfDay; },
      get dayIndex() { return sim.clock.dayIndex; },
      get monthIndex() { return sim.clock.monthIndex; },
      get month() { return sim.clock.month; },
      get year() { return sim.clock.year; },
      get season() { return sim.clock.season; },
      get weekday() { return sim.clock.weekday; },
    };
    const terrain: PluginTerrain = {
      heightAt: (x, z) => sim.groundHeight(x, z),
      isWet: (x, z) => sim.isWet(x, z),
      bounds: () => (sim.terrain ? terrainBounds(sim.terrain) : null),
    };
    const roads: PluginRoads = {
      get version() { return sim.net.version; },
      get nodeCount() { return sim.net.nodeCount; },
      get segCount() { return sim.net.segCount; },
      hasNode: (id) => sim.net.hasNode(id),
      nodePos: (id) => sim.net.nodePos(id),
      incident: (id) => sim.net.incident(id),
      nodeNear: (x, z, r, ex) => sim.net.nodeNear(x, z, r, ex),
      nodeIds: () => sim.net.nodeIds(),
      hasSegment: (id) => sim.net.hasSegment(id),
      kindOf: (id) => sim.net.kindOf(id),
      endpoints: (id) => sim.net.endpoints(id),
      curve: (id) => sim.net.curve(id),
      length: (id) => sim.net.length(id),
      profile: (id) => sim.net.profile(id),
      segmentsIn: (x0, z0, x1, z1, out) => sim.net.segmentsIn(x0, z0, x1, z1, out),
      segmentNear: (x, z, r, ex) => sim.net.segmentNear(x, z, r, ex),
      segmentIds: () => sim.net.segmentIds(),
      totalLength: () => sim.net.totalLength(),
    };
    const assetOfIndex = (i: number) => sim.catalog?.assets[sim.buildings.assetIndex[i]!];
    const buildings: PluginBuildings = {
      get count() { return sim.buildings.count; },
      get store() { return sim.buildings; },
      indexOf: (id) => sim.buildings.indexOf(id),
      record: (id) => {
        const b = sim.buildings, i = b.indexOf(id);
        const a = i >= 0 ? assetOfIndex(i) : undefined;
        return a ? { id, assetId: a.id, variant: b.variant[i]!, x: b.x[i]!, y: b.y[i]!, z: b.z[i]!, rot: b.rot[i]! } : null;
      },
      assetOf: (id) => { const i = sim.buildings.indexOf(id); return i >= 0 ? assetOfIndex(i) : undefined; },
      query: (x0, z0, x1, z1, out) => sim.buildingIndex.query(x0, z0, x1, z1, out),
    };
    const demography: PluginDemography = {
      get population() { return sim.demography?.population ?? 0; },
      get households() { return sim.demography?.households.count ?? 0; },
      report: () => sim.demography!.report(sim.clock.totalMinutes, sim.economy.taxRates.residential),
    };
    const economy: PluginEconomy = {
      get money() { return sim.economy.money; },
      get taxRates() { return { ...sim.economy.taxRates }; },
      lastMonth: () => {
        const h = sim.economy.history[sim.economy.history.length - 1];
        return h ? { ...h, income: { ...h.income }, expenses: { ...h.expenses } } : undefined;
      },
    };
    const rngs = this.rngs, services = this.services;
    return {
      pluginId,
      clock,
      get params() { return sim.params; },
      get inGame() { return sim.terrain !== null; },
      get catalog() { return sim.catalog; },
      getAsset: (id) => sim.getAsset(id),
      terrain,
      roads,
      buildings,
      get demography() { return sim.demography ? demography : null; },
      economy,
      get speed() { return sim.speed; },
      get rng() { return rngs.get(pluginId)!; },
      notify: (level, message) => sim.notify(level, message),
      provide: (name, api) => { services.set(name, api); },
      use: <T>(name: string) => services.get(name) as T | undefined,
    };
  }

  /* ------------------------ Appels protégés ------------------------ */

  /** Journalise une erreur de module (console à la première occurrence, notification joueur une fois par module). */
  private report(plugin: string, hook: string, e: unknown): void {
    const message = errMsg(e);
    const rec = this.errors.find((r) => r.plugin === plugin && r.hook === hook);
    if (rec) { rec.count++; rec.message = message; return; }
    if (this.errors.length < MAX_ERROR_RECORDS) this.errors.push({ plugin, hook, message, count: 1 });
    this.log(`[module ${plugin}] erreur dans ${hook} : ${message}`);
    if (!this.notified.has(plugin)) {
      this.notified.add(plugin);
      this.sim.notify('warn', `Module « ${plugin} » : erreur interne (${hook}). La partie continue sans ce traitement.`);
    }
  }

  /** Appelle `fn` en attrapant toute exception ; renvoie `fallback` en cas d'erreur. */
  private guard<T>(p: SimPlugin, hook: string, fn: () => T, fallback: T): T {
    try { return fn(); } catch (e) { this.report(p.id, hook, e); return fallback; }
  }

  private ctx(p: SimPlugin): PluginContext { return this.ctxs.get(p.id)!; }

  /* ---------------------------- Crochets ---------------------------- */

  /** Une fois, au premier catalogue. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const p of this.plugins) if (p.init) this.guard(p, 'init', () => p.init!(this.ctx(p)), undefined);
  }

  onNewGame(): void {
    this.foreign = {};
    const seed = this.sim.params?.seed ?? 0;
    for (const p of this.plugins) {
      this.rngs.get(p.id)!.setState(new Rng(pluginSeed(seed, p.id)).getState());
      if (p.onNewGame) this.guard(p, 'onNewGame', () => p.onNewGame!(this.ctx(p)), undefined);
    }
  }

  onTick(minutes: number): void {
    for (const p of this.plugins) if (p.onTick) this.guard(p, 'onTick', () => p.onTick!(this.ctx(p), minutes), undefined);
  }

  onDayStart(): void {
    for (const p of this.plugins) if (p.onDayStart) this.guard(p, 'onDayStart', () => p.onDayStart!(this.ctx(p)), undefined);
  }

  onMonthStart(): void {
    for (const p of this.plugins) if (p.onMonthStart) this.guard(p, 'onMonthStart', () => p.onMonthStart!(this.ctx(p)), undefined);
  }

  /** Charges utiles des modules pour un message (undefined si aucun module n'a rien à envoyer). */
  private collect(hook: 'takeDelta' | 'snapshot'): Record<string, unknown> | undefined {
    let out: Record<string, unknown> | undefined;
    for (const p of this.plugins) {
      const f = p[hook];
      if (!f) continue;
      const v = this.guard(p, hook, () => f.call(p, this.ctx(p)), undefined);
      if (v !== undefined) (out ??= {})[p.id] = v;
    }
    return out;
  }

  takeDelta(): Record<string, unknown> | undefined { return this.collect('takeDelta'); }
  snapshot(): Record<string, unknown> | undefined { return this.collect('snapshot'); }

  /* --------------------------- Commandes --------------------------- */

  command(plugin: string, name: string, payload: unknown): { ok: true; data: { data?: unknown } } | { ok: false; error: CommandError } {
    const p = this.byId.get(plugin);
    if (!p) return { ok: false, error: { code: 'INVALID_ARGS', message: `Module inconnu : ${plugin}` } };
    if (!p.command) return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: `Le module « ${plugin} » n'accepte aucune commande` } };
    let r: PluginCommandResult;
    try {
      r = p.command(this.ctx(p), name, payload);
    } catch (e) {
      this.report(plugin, `command:${name}`, e);
      return { ok: false, error: { code: 'INVALID_ARGS', message: `Erreur interne du module « ${plugin} » (${name})` } };
    }
    if (!isObj(r) || typeof r.ok !== 'boolean') return { ok: false, error: { code: 'INVALID_ARGS', message: `Réponse invalide du module « ${plugin} »` } };
    if (r.ok) return { ok: true, data: r.data === undefined ? {} : { data: r.data } };
    const known = (COMMAND_ERROR_CODES as readonly string[]).includes(r.code);
    return { ok: false, error: { code: known ? (r.code as CommandErrorCode) : 'INVALID_ARGS', message: known ? r.message : `[${String(r.code)}] ${r.message}` } };
  }

  /* --------------------------- Sauvegarde --------------------------- */

  /** Sections à écrire (modules connus + sections étrangères conservées) ; undefined s'il n'y en a aucune. */
  save(): Record<string, PluginSaveSection> | undefined {
    const out: Record<string, PluginSaveSection> = { ...this.foreign };
    for (const p of this.plugins) {
      // Section d'origine conservée (chargement en échec ou version trop récente) : jamais écrasée.
      if (!p.save || p.id in this.foreign) continue;
      const data = this.guard(p, 'save', () => p.save!(this.ctx(p)), undefined);
      if (data === undefined) continue;
      // Copie JSON : la sauvegarde ne partage aucune référence avec l'état vivant du module.
      const json = this.guard(p, 'save', () => JSON.parse(JSON.stringify(data)) as unknown, undefined);
      if (json === undefined) continue;
      out[p.id] = { v: p.saveVersion ?? 1, data: json, rng: this.rngs.get(p.id)!.getState() };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /**
   * Relit les sections (après `onNewGame`). Une section illisible ou un module en erreur produit une
   * notification et n'empêche pas le chargement du reste ; une section inconnue ou trop récente est conservée.
   */
  load(raw: unknown): void {
    this.foreign = {};
    if (raw === undefined || raw === null) return;
    if (!isObj(raw)) { this.sim.notify('warn', 'Sauvegarde : sections des modules illisibles, ignorées.'); return; }
    for (const [id, sec] of Object.entries(raw)) {
      if (!isObj(sec) || typeof sec.v !== 'number' || !Number.isInteger(sec.v) || sec.v < 0 || !('data' in sec)) {
        this.sim.notify('warn', `Sauvegarde : section du module « ${id} » mal formée, ignorée.`);
        continue;
      }
      const section: PluginSaveSection = { v: sec.v, data: sec.data };
      if (Array.isArray(sec.rng)) section.rng = sec.rng as number[];
      const p = this.byId.get(id);
      if (!p) { this.foreign[id] = section; continue; }
      const current = p.saveVersion ?? 1;
      if (section.v > current) {
        this.foreign[id] = section;
        this.sim.notify('warn', `Sauvegarde : section du module « ${id} » en version ${section.v} (plus récente que ${current}), conservée sans être chargée.`);
        continue;
      }
      if (!p.load) continue;
      if (section.rng && section.rng.length === 4 && section.rng.every((n) => Number.isInteger(n))) this.rngs.get(id)!.setState(section.rng);
      try {
        p.load(this.ctx(p), section.data, section.v);
      } catch (e) {
        this.notified.add(id); // une seule notification, la plus précise ci-dessous
        this.report(id, 'load', e);
        this.sim.notify('warn', `Sauvegarde : la section du module « ${id} » n'a pas pu être chargée (${errMsg(e)}) ; le reste de la partie est chargé.`);
        // Le module repart d'un état neuf ; la section d'origine est conservée (réécrite telle quelle) pour ne rien perdre.
        this.guard(p, 'onNewGame', () => p.onNewGame?.(this.ctx(p)), undefined);
        this.foreign[id] = section;
      }
    }
  }
}
