/**
 * Module « ameliorations » : niveau des équipements de service (tag `service:*`), de 1 à 3. Chaque niveau au-delà
 * du premier : rayon d'action +25 %, capacité +50 % (lus par la démographie via le service `ameliorations`),
 * travaux payés une fois (50 % du coût du bâtiment par niveau) et entretien mensuel +40 % par niveau.
 * Sans amélioration : aucun delta, aucune section, aucun effet. TypeScript pur : AUCUN import de three ni du DOM.
 */
import { runMigrations } from '../save-sections/types';
import { isCoverageServiceTag } from '../demography';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export const AMELIORATIONS_SAVE_VERSION = 1;
export const MAX_SERVICE_LEVEL = 3;
export interface AmeliorationsSave { levels: [number, number][] }
export const emptyAmeliorationsSave = (): AmeliorationsSave => ({ levels: [] });

export function migrateAmeliorations(data: unknown, from: number): AmeliorationsSave {
  const o = runMigrations(data, from, AMELIORATIONS_SAVE_VERSION, {}, 'ameliorations') as Partial<AmeliorationsSave>;
  const levels: [number, number][] = [];
  for (const e of Array.isArray(o.levels) ? o.levels : []) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || !Number.isInteger(e[1])) continue;
    const lv = Math.max(2, Math.min(MAX_SERVICE_LEVEL, e[1] as number));
    levels.push([e[0] as number, lv]);
  }
  return { levels };
}

/** Effets d'un niveau : multiplicateurs de rayon et de capacité. */
export const levelRadius = (lv: number): number => 1 + 0.25 * (lv - 1);
export const levelCapacity = (lv: number): number => 1 + 0.5 * (lv - 1);

export interface AmeliorationsService { levelOf(buildingId: number): number; version(): number }

export interface ServiceLevelInfo { buildingId: number; level: number; max: number; upgradeCost: number | null; extraUpkeep: number; radiusFactor: number; capacityFactor: number; service: string | null }

export function createAmeliorationsPlugin(): SimPlugin & { readonly state: () => AmeliorationsSave } {
  const levels = new Map<number, number>();
  let version = 0, sent = -1, everSent = false;
  // Seuls les services dont la démographie lit le niveau (couverture : éducation, santé, police, incendie, loisirs…)
  // sont améliorables : pour les autres (`service:eau`, `service:commerces`…), l'amélioration serait payée sans effet.
  const serviceTag = (ctx: PluginContext, id: number): string | null => ctx.buildings.assetOf(id)?.tags.find(isCoverageServiceTag) ?? null;
  const costOf = (ctx: PluginContext, id: number, lv: number): number => Math.round((ctx.buildings.assetOf(id)?.cost ?? 0) * 0.5 * lv);
  const upkeepOf = (ctx: PluginContext, id: number, lv: number): number => Math.round((ctx.buildings.assetOf(id)?.upkeepPerMonth ?? 0) * 0.4 * (lv - 1));
  const prune = (ctx: PluginContext): void => { for (const id of [...levels.keys()]) if (ctx.buildings.indexOf(id) < 0) { levels.delete(id); version++; } };
  const info = (ctx: PluginContext, id: number): ServiceLevelInfo => {
    const lv = levels.get(id) ?? 1;
    return { buildingId: id, level: lv, max: MAX_SERVICE_LEVEL, upgradeCost: lv < MAX_SERVICE_LEVEL ? costOf(ctx, id, lv) : null, extraUpkeep: upkeepOf(ctx, id, lv), radiusFactor: levelRadius(lv), capacityFactor: levelCapacity(lv), service: serviceTag(ctx, id) };
  };
  const view = (ctx: PluginContext): { levels: ServiceLevelInfo[] } => ({ levels: [...levels.keys()].sort((a, b) => a - b).map((id) => info(ctx, id)) });
  const service: AmeliorationsService = { levelOf: (id) => levels.get(id) ?? 1, version: () => version };
  return {
    id: 'ameliorations',
    saveVersion: AMELIORATIONS_SAVE_VERSION,
    state: () => ({ levels: [...levels] }),
    init(ctx) { ctx.provide('ameliorations', service); },
    onNewGame() { levels.clear(); version++; everSent = false; },
    onMonthStart(ctx) {
      if (!levels.size) return;
      prune(ctx);
      let extra = 0;
      for (const [id, lv] of levels) extra += upkeepOf(ctx, id, lv);
      if (extra > 0) ctx.economy.applyService(-extra);
    },
    takeDelta(ctx) {
      if (version === sent) return undefined;
      if (!levels.size && !everSent) { sent = version; return undefined; }
      sent = version; everSent = true;
      return view(ctx);
    },
    snapshot(ctx) { return levels.size ? view(ctx) : undefined; },
    save() { return levels.size ? { levels: [...levels].sort((a, b) => a[0] - b[0]) } : undefined; },
    load(_ctx, data, v) { levels.clear(); for (const [id, lv] of migrateAmeliorations(data, v).levels) levels.set(id, lv); version++; },
    command(ctx, name, payload): PluginCommandResult {
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
      if (name === 'state') return { ok: true, data: view(ctx) };
      const id = Number(p['buildingId']);
      if (!Number.isInteger(id) || ctx.buildings.indexOf(id) < 0) return { ok: false, code: 'NOT_FOUND', message: 'Bâtiment introuvable' };
      if (name === 'info') return { ok: true, data: info(ctx, id) };
      if (name === 'upgrade') {
        if (!serviceTag(ctx, id)) return { ok: false, code: 'INVALID_ARGS', message: 'Seuls les équipements de service couverts (éducation, santé, sécurité, incendie, loisirs) peuvent être améliorés' };
        const lv = levels.get(id) ?? 1;
        if (lv >= MAX_SERVICE_LEVEL) return { ok: false, code: 'INVALID_ARGS', message: 'Niveau maximal atteint' };
        const cost = costOf(ctx, id, lv);
        if (ctx.economy.bankrupt) return { ok: false, code: 'INSUFFICIENT_FUNDS', message: 'Ville en faillite : travaux d\'amélioration suspendus jusqu\'au retour d\'une trésorerie positive' };
        if (ctx.economy.money < cost) return { ok: false, code: 'INSUFFICIENT_FUNDS', message: `Fonds insuffisants (${cost} CHF requis)` };
        if (p['dryRun'] === true) return { ok: true, data: { ...info(ctx, id), cost } };
        ctx.economy.applyService(-cost, true);
        levels.set(id, lv + 1);
        version++;
        ctx.notify('info', `${ctx.buildings.assetOf(id)?.nameFr ?? 'Équipement'} amélioré au niveau ${lv + 1} : rayon ×${levelRadius(lv + 1).toFixed(2)}, capacité ×${levelCapacity(lv + 1).toFixed(1)}`);
        return { ok: true, data: { ...info(ctx, id), cost } };
      }
      return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue : ${name}` };
    },
  };
}

export const ameliorationsPlugin = createAmeliorationsPlugin();
