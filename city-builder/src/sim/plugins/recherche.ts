/**
 * Module « recherche » (phase 2C) : projets de recherche municipale. Points mensuels produits par les écoles
 * (bâtiments au tag `service:education`), la population et un budget de recherche réglable (prélevé sur la
 * trésorerie) ; un projet terminé donne un effet permanent (service `recherche`, src/shared/governance.ts).
 * Sans activité (aucun projet, budget nul) : aucun delta, aucune section de sauvegarde.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { RESEARCH, RESEARCH_BUDGETS, RESEARCH_SERVICE, combine, researchPointsPerMonth, type GovernanceService, type ResearchDef } from '../../shared/governance';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';
import { runMigrations } from '../save-sections/types';

export const RECHERCHE_SAVE_VERSION = 1;
export interface RechercheSave { done: string[]; current: string | null; progress: number; budget: number; lastPoints: number }
export const emptyRechercheSave = (): RechercheSave => ({ done: [], current: null, progress: 0, budget: 0, lastPoints: 0 });

export function migrateRecherche(data: unknown, from: number): RechercheSave {
  const o = runMigrations(data, from, RECHERCHE_SAVE_VERSION, {}, 'recherche') as Partial<RechercheSave>;
  const known = new Set(RESEARCH.map((r) => r.id));
  const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    done: Array.isArray(o.done) ? o.done.filter((x): x is string => typeof x === 'string' && known.has(x)) : [],
    current: typeof o.current === 'string' && known.has(o.current) ? o.current : null,
    progress: Math.max(0, fin(o.progress, 0)),
    budget: (RESEARCH_BUDGETS as readonly number[]).includes(fin(o.budget, 0)) ? fin(o.budget, 0) : 0,
    lastPoints: fin(o.lastPoints, 0),
  };
}

export interface RechercheState {
  projects: (ResearchDef & { done: boolean; available: boolean; current: boolean })[];
  current: string | null;
  progress: number;
  budget: number;
  budgets: readonly number[];
  pointsPerMonth: number;
  schools: number;
  lastPoints: number;
}

/** Écoles (bâtiments d'enseignement) de la ville. */
function schoolsOf(ctx: PluginContext): number {
  const assets = ctx.catalog?.assets ?? [];
  const st = ctx.buildings.store;
  let n = 0;
  for (let i = 0; i < ctx.buildings.count; i++) if (assets[st.assetIndex[i]!]?.tags.includes('service:education')) n++;
  return n;
}

export function createRecherchePlugin(): SimPlugin & { readonly state: () => RechercheSave } {
  let s = emptyRechercheSave();
  let version = 0, sent = -1, everSent = false;
  const idle = (): boolean => !s.done.length && !s.current && !s.budget;
  const points = (ctx: PluginContext): number => researchPointsPerMonth(schoolsOf(ctx), ctx.demography?.population ?? 0, s.budget);
  const view = (ctx: PluginContext): RechercheState => {
    const done = new Set(s.done);
    return {
      projects: RESEARCH.map((r) => ({ ...r, done: done.has(r.id), available: !done.has(r.id) && r.requires.every((q) => done.has(q)), current: s.current === r.id })),
      current: s.current, progress: Math.floor(s.progress), budget: s.budget, budgets: RESEARCH_BUDGETS,
      pointsPerMonth: points(ctx), schools: schoolsOf(ctx), lastPoints: s.lastPoints,
    };
  };
  const service: GovernanceService = { modifiers: () => combine(RESEARCH.filter((r) => s.done.includes(r.id)).map((r) => r.effect)) };

  return {
    id: 'recherche',
    saveVersion: RECHERCHE_SAVE_VERSION,
    state: () => s,
    init(ctx) { ctx.provide(RESEARCH_SERVICE, service); },
    onNewGame() { s = emptyRechercheSave(); version++; everSent = false; },
    onMonthStart(ctx) {
      if (idle()) return;
      if (s.budget > 0) ctx.economy.applyService(-s.budget);
      const pts = points(ctx);
      s.lastPoints = pts;
      if (s.current) {
        s.progress += pts;
        const def = RESEARCH.find((r) => r.id === s.current)!;
        if (s.progress >= def.cost) {
          s.done.push(def.id);
          s.progress = 0;
          s.current = null;
          ctx.notify('info', `Recherche terminée : ${def.nameFr} — ${def.descFr}`);
        }
      }
      version++;
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      if (idle() && !everSent) { sent = version; return undefined; }
      sent = version; everSent = true;
      return view(ctx);
    },
    snapshot(ctx) { return idle() ? undefined : view(ctx); },
    save() { return idle() ? undefined : { ...s, done: [...s.done] }; },
    load(_ctx, data, v) { s = migrateRecherche(data, v); version++; },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { id?: unknown; budget?: unknown };
      if (name === 'state') return { ok: true, data: view(ctx) };
      if (name === 'start') {
        const def = RESEARCH.find((r) => r.id === p.id);
        if (!def) return { ok: false, code: 'INVALID_ARGS', message: 'Projet inconnu' };
        if (s.done.includes(def.id)) return { ok: false, code: 'INVALID_ARGS', message: 'Projet déjà terminé' };
        const missing = def.requires.filter((q) => !s.done.includes(q));
        if (missing.length) return { ok: false, code: 'INVALID_ARGS', message: `Il faut d'abord : ${missing.map((q) => RESEARCH.find((r) => r.id === q)?.nameFr ?? q).join(', ')}` };
        if (s.current !== def.id) { s.current = def.id; s.progress = 0; }
        version++;
        return { ok: true, data: view(ctx) };
      }
      if (name === 'budget') {
        const b = typeof p.budget === 'number' ? p.budget : NaN;
        if (!(RESEARCH_BUDGETS as readonly number[]).includes(b)) return { ok: false, code: 'INVALID_ARGS', message: 'Budget invalide' };
        s.budget = b;
        version++;
        return { ok: true, data: view(ctx) };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const recherchePlugin = createRecherchePlugin();
