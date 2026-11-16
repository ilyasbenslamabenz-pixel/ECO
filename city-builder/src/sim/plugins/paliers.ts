/**
 * Module « paliers » (docs/PROGRESSION.md) : points d'expansion et paliers de ville.
 *  - chaque jour : points de CROISSANCE (1 par habitant au-delà du record de population) et de BONHEUR (selon la
 *    satisfaction moyenne et la taille de la ville) ; les objectifs et réalisations en ajoutent (service `paliers`) ;
 *  - un palier franchi pour la première fois verse une prime (trésorerie, ligne « Services »), notifie et débloque ;
 *  - verrous (déblocages progressifs) : seulement si la partie a été créée dans ce mode (commande `mode`, ville
 *    vide). Une ancienne sauvegarde (sans section, ou section v1) garde tout débloqué ;
 *  - bonus additifs pour toutes les parties : capacité d'emprunt (lue par la simulation).
 * Ville vide et aucun point : aucun delta, aucune section de sauvegarde.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import {
  computeLocks, loanBonus, MILESTONES, PALIERS_SERVICE, milestoneForAsset, milestoneForBusLines, milestoneForLevel, milestoneForPolicy, milestoneForZone,
  type MilestoneDef, type PaliersLocks, type PaliersService, type PaliersState,
} from '../../shared/milestones';
import { DEVELOPMENT_SERVICE, type DevelopmentService } from '../../shared/development';
import type { DemographyReport } from '../demography';
import { runMigrations } from '../save-sections/types';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export const PALIERS_SAVE_VERSION = 2;
export interface PaliersSave {
  reached: string[];
  at: Record<string, number>;
  /** v2 : points d'expansion cumulés, détail par source, record de population, verrous actifs, points d'hier. */
  xp?: number;
  xpBy?: Record<string, number>;
  record?: number;
  locked?: boolean;
  xpLastDay?: number;
}
export const emptyPaliersSave = (): PaliersSave => ({ reached: [], at: {}, xp: 0, xpBy: {}, record: 0, locked: false, xpLastDay: 0 });

/** Points de bonheur par habitant et par jour, à pleine satisfaction utile (au-delà de 45, plafonné à 75). */
export const XP_HAPPY_PER_RESIDENT = 0.001;
export const XP_HAPPY_FLOOR = 45;
export const XP_HAPPY_SPAN = 15;
export const XP_HAPPY_MAX = 2;

/** Points de bonheur d'une journée (population, satisfaction moyenne 0..100). */
export function happinessXp(population: number, happiness: number): number {
  if (population < 50) return 0;
  const k = Math.max(0, Math.min(XP_HAPPY_MAX, (happiness - XP_HAPPY_FLOOR) / XP_HAPPY_SPAN));
  return population * XP_HAPPY_PER_RESIDENT * k;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function migratePaliers(data: unknown, from: number): PaliersSave {
  const o = runMigrations(data, from, PALIERS_SAVE_VERSION, { 1: (d) => d }, 'paliers') as Partial<PaliersSave>;
  const known = new Set(MILESTONES.map((m) => m.id));
  const reached = Array.isArray(o.reached) ? o.reached.filter((x): x is string => typeof x === 'string' && known.has(x)) : [];
  const at: Record<string, number> = {};
  for (const id of reached) { const v = o.at?.[id]; at[id] = fin(v) ? v : 0; }
  const out: PaliersSave = { reached, at };
  // Section v1 : pas de points ni de verrous (la reprise des points se fait à la fin du chargement, `afterLoad`).
  if (from >= 2) {
    out.xp = fin(o.xp) ? Math.max(0, o.xp) : 0;
    const by: Record<string, number> = {};
    if (o.xpBy && typeof o.xpBy === 'object') for (const [k, v] of Object.entries(o.xpBy)) if (fin(v)) by[k] = v;
    out.xpBy = by;
    out.record = fin(o.record) ? Math.max(0, o.record) : 0;
    out.locked = o.locked === true;
    out.xpLastDay = fin(o.xpLastDay) ? o.xpLastDay : 0;
  }
  return out;
}

interface Live { reached: string[]; at: Record<string, number>; xp: number; xpBy: Record<string, number>; record: number; locked: boolean; xpLastDay: number }
const fresh = (): Live => ({ reached: [], at: {}, xp: 0, xpBy: {}, record: 0, locked: false, xpLastDay: 0 });
const r1 = (v: number): number => Math.round(v * 10) / 10;

export function createPaliersPlugin(): SimPlugin & { readonly state: () => PaliersSave; readonly service: PaliersService } {
  let s = fresh();
  let version = 0, sent = -1;
  /** Vrai si la sauvegarde en cours de chargement contenait la section ; `catchUp` : section v1 (points à reprendre). */
  let sectionLoaded = false, catchUp = false;
  let ctxRef: PluginContext | null = null;
  let locksCache: { key: string; locks: PaliersLocks } | null = null;
  let loanCache = { n: -1, v: 0 };
  let lastDevVersion = 0;
  let dayRep: { at: number; r: DemographyReport } | null = null;
  const pop = (ctx: PluginContext | null): number => ctx?.demography?.population ?? 0;
  const reachedSet = (): Set<string> => new Set(s.reached);
  /** Arbres de développement (module `developpement`) : bâtiments débloqués avant leur palier. */
  const dev = (): DevelopmentService | undefined => ctxRef?.use<DevelopmentService>(DEVELOPMENT_SERVICE);
  const locks = (): PaliersLocks => {
    const d = dev();
    const key = `${s.reached.join(',')}|${d?.version() ?? 0}`;
    if (!locksCache || locksCache.key !== key) {
      const l = computeLocks(reachedSet());
      if (d) for (const id of Object.keys(l.assets)) if (d.assetUnlocked(id)) delete l.assets[id];
      locksCache = { key, locks: l };
    }
    return locksCache.locks;
  };
  const lastReached = (): MilestoneDef | null => [...MILESTONES].reverse().find((m) => s.reached.includes(m.id)) ?? null;
  const next = (): MilestoneDef | null => MILESTONES.find((m) => !s.reached.includes(m.id)) ?? null;
  const add = (points: number, source: string): void => {
    if (!(points > 0)) return;
    s.xp += points;
    s.xpBy[source] = (s.xpBy[source] ?? 0) + points;
  };
  const unlockText = (m: MilestoneDef): string => m.unlocks.map((u) => u.label).join(', ');
  /** Franchit les paliers dont les points sont atteints (prime, notification). */
  const checkReach = (ctx: PluginContext): void => {
    for (const m of MILESTONES) {
      if (s.reached.includes(m.id) || s.xp < m.xp) continue;
      s.reached.push(m.id);
      s.at[m.id] = ctx.clock.totalMinutes;
      ctx.economy.applyService(m.reward, true);
      const unl = m.unlocks.length ? ` Débloque : ${unlockText(m)}.` : '';
      ctx.notify('info', `Palier atteint : ${m.nameFr} (${m.xp.toLocaleString('fr-FR')} points d'expansion) — prime de ${m.reward.toLocaleString('fr-FR')} CHF versée à la trésorerie.${unl}`);
      version++;
    }
  };
  const lockMsg = (what: string, m: MilestoneDef | null): string | null => {
    if (!s.locked || !m || s.reached.includes(m.id)) return null;
    return `${what} : débloqué au palier « ${m.nameFr} » (${m.xp.toLocaleString('fr-FR')} points d'expansion ; ${Math.floor(s.xp).toLocaleString('fr-FR')} acquis)`;
  };
  const service: PaliersService = {
    assetLock: (id) => (dev()?.assetUnlocked(id) ? null : lockMsg(ctxRef?.getAsset(id)?.nameFr ?? 'Bâtiment', milestoneForAsset(id))),
    zoneLock: (zone) => lockMsg('Cette zone', milestoneForZone(zone)),
    policyLock: (id) => lockMsg('Cette politique', milestoneForPolicy(id)),
    levelLock: (level) => (s.locked && level > locks().maxLevel ? lockMsg(`Niveau ${level}`, milestoneForLevel(level)) : null),
    busLineLock: (count) => (s.locked && count > locks().busLines ? lockMsg(`Ligne de bus n° ${count}`, milestoneForBusLines(count)) : null),
    loanBonus: () => { if (loanCache.n !== s.reached.length) loanCache = { n: s.reached.length, v: loanBonus(reachedSet()) }; return loanCache.v; },
    grant(points, source) {
      if (!ctxRef || !(points > 0)) return 0;
      add(points, source);
      checkReach(ctxRef);
      version++;
      return points;
    },
    gap() {
      const prev = lastReached()?.xp ?? 0;
      const nx = next();
      if (nx) return nx.xp - prev;
      const last = MILESTONES[MILESTONES.length - 1]!, before = MILESTONES[MILESTONES.length - 2]!;
      return last.xp - before.xp;
    },
    xp: () => s.xp,
    reachedCount: () => s.reached.length,
    dayReport: (at) => (dayRep && dayRep.at === at ? dayRep.r : undefined),
  };
  const view = (ctx: PluginContext): PaliersState => {
    const done = reachedSet();
    const last = lastReached();
    const by: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.xpBy)) by[k] = Math.floor(v);
    return {
      population: pop(ctx), reached: [...s.reached], title: last?.nameFr ?? null, next: next(),
      milestones: MILESTONES.map((m) => ({ ...m, reached: done.has(m.id), at: s.at[m.id] ?? null })),
      xp: Math.floor(s.xp), xpBy: by, xpLastDay: r1(s.xpLastDay), locked: s.locked, locks: s.locked ? locks() : null, loanBonus: loanBonus(done),
    };
  };
  const active = (ctx: PluginContext): boolean => s.reached.length > 0 || s.xp > 0 || s.locked || pop(ctx) >= MILESTONES[0]!.population;
  return {
    id: 'paliers',
    saveVersion: PALIERS_SAVE_VERSION,
    service,
    state: () => ({ reached: [...s.reached], at: { ...s.at }, xp: s.xp, xpBy: { ...s.xpBy }, record: s.record, locked: s.locked, xpLastDay: s.xpLastDay }),
    init(ctx) { ctxRef = ctx; ctx.provide(PALIERS_SERVICE, service); },
    // Partie neuve (rien d'acquis : toutes les primes à gagner, tout débloqué sauf commande `mode`) OU début d'un chargement.
    onNewGame(ctx) { ctxRef = ctx; s = fresh(); version++; sent = -1; sectionLoaded = false; catchUp = false; locksCache = null; },
    // Chargement sans section : sauvegarde antérieure aux paliers (ou ville sous le premier seuil). Les seuils déjà
    // dépassés sont acquis sans prime rétroactive ; les suivants seront primés normalement. Section v1 (paliers par
    // population) : les points repartent du record de population (une ville ne recule jamais).
    afterLoad(ctx) {
      const had = sectionLoaded, v1 = catchUp;
      sectionLoaded = false; catchUp = false;
      const p = pop(ctx);
      if (!had) {
        const past = MILESTONES.filter((m) => p >= m.population && !s.reached.includes(m.id));
        for (const m of past) { s.reached.push(m.id); s.at[m.id] = ctx.clock.totalMinutes; }
        if (past.length) ctx.notify('info', `Paliers déjà atteints par cette ville : ${past.map((m) => m.nameFr).join(', ')} (sans prime rétroactive)`);
      }
      if (!had || v1) {
        const base = Math.max(p, ...s.reached.map((id) => MILESTONES.find((m) => m.id === id)?.xp ?? 0));
        if (base > s.xp) add(base - s.xp, 'reprise');
        s.record = Math.max(s.record, p);
      }
      version++;
    },
    onDayStart(ctx) {
      const p = pop(ctx);
      let gained = 0;
      if (p > s.record) { gained += p - s.record; add(p - s.record, 'croissance'); s.record = p; }
      if (p >= 50 && ctx.demography) {
        const r = ctx.demography.report();
        dayRep = { at: ctx.clock.totalMinutes, r };
        const h = happinessXp(p, r.happiness);
        gained += h;
        add(h, 'bonheur');
      }
      s.xpLastDay = gained;
      if (gained > 0) version++;
      checkReach(ctx);
    },
    takeDelta(ctx) {
      // Un déblocage des arbres de développement retire des cadenas : verrous renvoyés à l'interface.
      const dv = dev()?.version() ?? 0;
      if (dv !== lastDevVersion) { lastDevVersion = dv; if (s.locked) version++; }
      if (version === sent) return undefined;
      sent = version;
      return active(ctx) ? view(ctx) : undefined;
    },
    snapshot(ctx) { return active(ctx) ? view(ctx) : undefined; },
    // Section écrite dès qu'un point est acquis, qu'un seuil est dépassé (prime évaluée au jour suivant) ou que les
    // verrous sont actifs : une sauvegarde sans section signifie « ville vide » ou « antérieure aux paliers ».
    save(ctx) { return active(ctx) ? { reached: [...s.reached], at: { ...s.at }, xp: s.xp, xpBy: { ...s.xpBy }, record: s.record, locked: s.locked, xpLastDay: s.xpLastDay } : undefined; },
    load(_ctx, data, v) {
      const d = migratePaliers(data, v);
      s = { reached: d.reached, at: d.at, xp: d.xp ?? 0, xpBy: d.xpBy ?? {}, record: d.record ?? 0, locked: d.locked ?? false, xpLastDay: d.xpLastDay ?? 0 };
      locksCache = null;
      version++; sectionLoaded = true; catchUp = v < 2;
    },
    command(ctx, name, payload): PluginCommandResult {
      if (name === 'state') return { ok: true, data: view(ctx) };
      if (name === 'mode') {
        const on = (payload as { verrous?: unknown } | null)?.verrous;
        if (typeof on !== 'boolean') return { ok: false, code: 'INVALID_ARGS', message: 'verrous : booléen attendu' };
        // Les verrous ne s'activent que sur une ville vide (partie neuve) : rien de déjà accessible n'est retiré.
        if (on && !s.locked && (ctx.buildings.count > 0 || ctx.roads.segCount > 0)) return { ok: false, code: 'INVALID_ARGS', message: 'Les déblocages progressifs ne s’activent qu’au début d’une nouvelle partie' };
        if (s.locked !== on) { s.locked = on; version++; if (!on) ctx.notify('info', 'Tout est débloqué (mode libre) : les paliers versent toujours leurs primes.'); }
        return { ok: true, data: view(ctx) };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const paliersPlugin = createPaliersPlugin();
