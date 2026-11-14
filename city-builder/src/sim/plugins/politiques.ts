/**
 * Module « politiques » (phase 2C) : politiques publiques activables. Coût mensuel prélevé sur la trésorerie
 * (service municipal), effets publiés comme modificateurs (service `politiques`, src/shared/governance.ts).
 * Sans politique active : aucun delta, aucune section de sauvegarde, aucun effet.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { POLICIES, POLICY_SERVICE, combine, type GovernanceService, type PolicyDef } from '../../shared/governance';
import type { PluginCommandResult, SimPlugin } from './types';
import { runMigrations } from '../save-sections/types';

export const POLITIQUES_SAVE_VERSION = 1;
export interface PolitiquesSave { active: string[]; lastCost: number; since: Record<string, number> }
export const emptyPolitiquesSave = (): PolitiquesSave => ({ active: [], lastCost: 0, since: {} });

export function migratePolitiques(data: unknown, from: number): PolitiquesSave {
  const o = runMigrations(data, from, POLITIQUES_SAVE_VERSION, {}, 'politiques') as Partial<PolitiquesSave>;
  const known = new Set(POLICIES.map((p) => p.id));
  const active = Array.isArray(o.active) ? o.active.filter((x): x is string => typeof x === 'string' && known.has(x)) : [];
  const since: Record<string, number> = {};
  for (const id of active) { const v = o.since?.[id]; since[id] = typeof v === 'number' && Number.isFinite(v) ? v : 0; }
  return { active, lastCost: typeof o.lastCost === 'number' && Number.isFinite(o.lastCost) ? o.lastCost : 0, since };
}

export interface PolitiquesState {
  policies: (PolicyDef & { active: boolean; monthlyCost: number; since: number | null })[];
  lastCost: number;
  totalCost: number;
}

/** Coût mensuel d'une politique pour une population donnée (CHF). */
export const policyCost = (p: PolicyDef, population: number): number => Math.round(p.costPerMonth + p.costPerResident * population);

export function createPolitiquesPlugin(): SimPlugin & { readonly state: () => PolitiquesSave } {
  let s = emptyPolitiquesSave();
  let version = 0, sent = -1, everSent = false;
  const pop = (ctx: { demography: { population: number } | null }): number => ctx.demography?.population ?? 0;
  const view = (population: number, now: number): PolitiquesState => {
    const act = new Set(s.active);
    const policies = POLICIES.map((p) => ({ ...p, active: act.has(p.id), monthlyCost: policyCost(p, population), since: act.has(p.id) ? (s.since[p.id] ?? now) : null }));
    return { policies, lastCost: s.lastCost, totalCost: policies.filter((p) => p.active).reduce((a, p) => a + p.monthlyCost, 0) };
  };
  const service: GovernanceService = { modifiers: () => combine(POLICIES.filter((p) => s.active.includes(p.id)).map((p) => p.effect)) };

  return {
    id: 'politiques',
    saveVersion: POLITIQUES_SAVE_VERSION,
    state: () => s,
    init(ctx) { ctx.provide(POLICY_SERVICE, service); },
    onNewGame() { s = emptyPolitiquesSave(); version++; everSent = false; },
    onMonthStart(ctx) {
      if (!s.active.length) return;
      const n = pop(ctx);
      const cost = POLICIES.filter((p) => s.active.includes(p.id)).reduce((a, p) => a + policyCost(p, n), 0);
      if (cost > 0) ctx.economy.applyService(-cost);
      s.lastCost = cost;
      version++;
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      // Module jamais utilisé : aucun delta (simulation identique avec ou sans le module).
      if (!s.active.length && !everSent) { sent = version; return undefined; }
      sent = version; everSent = true;
      return view(pop(ctx), ctx.clock.totalMinutes);
    },
    snapshot(ctx) { return s.active.length ? view(pop(ctx), ctx.clock.totalMinutes) : undefined; },
    save() { return s.active.length || s.lastCost ? { ...s, active: [...s.active], since: { ...s.since } } : undefined; },
    load(_ctx, data, v) { s = migratePolitiques(data, v); version++; },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { id?: unknown; on?: unknown };
      if (name === 'state') return { ok: true, data: view(pop(ctx), ctx.clock.totalMinutes) };
      if (name === 'toggle') {
        const def = POLICIES.find((x) => x.id === p.id);
        if (!def) return { ok: false, code: 'INVALID_ARGS', message: 'Politique inconnue' };
        const on = typeof p.on === 'boolean' ? p.on : !s.active.includes(def.id);
        if (on && !s.active.includes(def.id)) { s.active.push(def.id); s.since[def.id] = ctx.clock.totalMinutes; ctx.notify('info', `Politique adoptée : ${def.nameFr}`); }
        if (!on && s.active.includes(def.id)) { s.active = s.active.filter((x) => x !== def.id); delete s.since[def.id]; ctx.notify('info', `Politique abandonnée : ${def.nameFr}`); }
        version++;
        return { ok: true, data: view(pop(ctx), ctx.clock.totalMinutes) };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const politiquesPlugin = createPolitiquesPlugin();
