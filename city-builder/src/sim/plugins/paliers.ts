/**
 * Module « paliers » : chaque jour, compare la population aux seuils (src/shared/milestones.ts) ; un palier
 * franchi pour la première fois donne une prime (trésorerie, ligne « Services ») et une notification.
 * Sans palier atteint : aucun delta, aucune section de sauvegarde.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { MILESTONES, type PaliersState } from '../../shared/milestones';
import { runMigrations } from '../save-sections/types';
import type { PluginContext, SimPlugin } from './types';

export const PALIERS_SAVE_VERSION = 1;
export interface PaliersSave { reached: string[]; at: Record<string, number> }
export const emptyPaliersSave = (): PaliersSave => ({ reached: [], at: {} });

export function migratePaliers(data: unknown, from: number): PaliersSave {
  const o = runMigrations(data, from, PALIERS_SAVE_VERSION, {}, 'paliers') as Partial<PaliersSave>;
  const known = new Set(MILESTONES.map((m) => m.id));
  const reached = Array.isArray(o.reached) ? o.reached.filter((x): x is string => typeof x === 'string' && known.has(x)) : [];
  const at: Record<string, number> = {};
  for (const id of reached) { const v = o.at?.[id]; at[id] = typeof v === 'number' && Number.isFinite(v) ? v : 0; }
  return { reached, at };
}

export function createPaliersPlugin(): SimPlugin & { readonly state: () => PaliersSave } {
  let s = emptyPaliersSave();
  let version = 0, sent = -1;
  /** Vrai si la sauvegarde en cours de chargement contenait la section (voir `afterLoad`). */
  let sectionLoaded = false;
  const pop = (ctx: PluginContext): number => ctx.demography?.population ?? 0;
  const view = (ctx: PluginContext): PaliersState => {
    const done = new Set(s.reached);
    const last = [...MILESTONES].reverse().find((m) => done.has(m.id)) ?? null;
    return {
      population: pop(ctx), reached: [...s.reached], title: last?.nameFr ?? null,
      next: MILESTONES.find((m) => !done.has(m.id)) ?? null,
      milestones: MILESTONES.map((m) => ({ ...m, reached: done.has(m.id), at: s.at[m.id] ?? null })),
    };
  };
  return {
    id: 'paliers',
    saveVersion: PALIERS_SAVE_VERSION,
    state: () => s,
    // Partie neuve (rien d'acquis : toutes les primes à gagner) OU début d'un chargement (avant les sections).
    onNewGame() { s = emptyPaliersSave(); version++; sent = -1; sectionLoaded = false; },
    // Chargement sans section : sauvegarde antérieure aux paliers (ou ville sous le premier seuil). Les seuils déjà
    // dépassés sont acquis sans prime rétroactive ; les suivants seront primés normalement.
    afterLoad(ctx) {
      const had = sectionLoaded;
      sectionLoaded = false;
      if (had) return;
      const p = pop(ctx);
      const past = MILESTONES.filter((m) => p >= m.population && !s.reached.includes(m.id));
      for (const m of past) { s.reached.push(m.id); s.at[m.id] = ctx.clock.totalMinutes; }
      if (past.length) { ctx.notify('info', `Paliers déjà atteints par cette ville : ${past.map((m) => m.nameFr).join(', ')} (sans prime rétroactive)`); version++; }
    },
    onDayStart(ctx) {
      const p = pop(ctx);
      for (const m of MILESTONES) {
        if (p < m.population || s.reached.includes(m.id)) continue;
        s.reached.push(m.id);
        s.at[m.id] = ctx.clock.totalMinutes;
        ctx.economy.applyService(m.reward, true);
        ctx.notify('info', `Palier atteint : ${m.nameFr} (${m.population.toLocaleString('fr-FR')} habitants) — prime de ${m.reward.toLocaleString('fr-FR')} CHF versée à la trésorerie`);
        version++;
      }
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      sent = version;
      return s.reached.length ? view(ctx) : undefined;
    },
    snapshot(ctx) { return s.reached.length ? view(ctx) : undefined; },
    // Section écrite dès qu'un seuil est atteint OU dépassé (prime pas encore versée : évaluée au jour suivant) : une
    // sauvegarde sans section signifie « sous le premier seuil » ou « antérieure aux paliers » (voir afterLoad).
    save(ctx) { return s.reached.length || pop(ctx) >= MILESTONES[0]!.population ? { reached: [...s.reached], at: { ...s.at } } : undefined; },
    load(_ctx, data, v) { s = migratePaliers(data, v); version++; sectionLoaded = true; },
    command(ctx, name) {
      if (name === 'state') return { ok: true, data: view(ctx) };
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const paliersPlugin = createPaliersPlugin();
