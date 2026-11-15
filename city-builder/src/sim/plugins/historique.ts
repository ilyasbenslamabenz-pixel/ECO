/**
 * Module de simulation « historique » (vague 5, docs/INTERFACE.md) : enregistre chaque jour de jeu la population,
 * la trésorerie, les emplois, le chômage et la satisfaction, et chaque mois le solde réalisé, pour les graphiques
 * d'évolution (3 mois, 1 an, toute la partie). Format compact et borné : src/shared/protocol-ext/historique.ts.
 *  - lecture seule : le rapport démographique du jour est celui que le module « paliers » calcule déjà (aucun calcul
 *    supplémentaire) ; sous 50 habitants, seuls habitants et trésorerie sont relevés ;
 *  - sauvegarde : section `historique` v1 ; ancienne sauvegarde (sans section) : la série longue et les soldes sont
 *    repris de l'historique mensuel de l'économie (jusqu'à 240 mois) ;
 *  - commande `etat` → { today, state } ; aucun delta (l'interface lit l'état à l'ouverture des graphiques).
 * Rien n'est tiré au hasard : la simulation est identique avec ou sans ce module.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { PaliersService } from '../../shared/milestones';
import { PALIERS_SERVICE } from '../../shared/milestones';
import { emptyHistorique, pushMonth, pushSample, readHistorique, type HistoriqueState } from '../../shared/protocol-ext/historique';
import { DAYS_PER_MONTH, MINUTES_PER_DAY } from '../clock';
import type { DemographyReport } from '../demography';
import { runMigrations } from '../save-sections/types';
import type { PluginCommandResult, SimPlugin } from './types';

export const HISTORIQUE_SAVE_VERSION = 1;
export const emptyHistoriqueSave = emptyHistorique;
export function migrateHistorique(data: unknown, from: number): HistoriqueState {
  return readHistorique(runMigrations(data, from, HISTORIQUE_SAVE_VERSION, {}, 'historique'));
}

export function createHistoriquePlugin(): SimPlugin & { readonly state: () => HistoriqueState } {
  let h = emptyHistorique();
  let sectionLoaded = false;
  const hasData = (): boolean => h.recent.length > 0 || h.long.length > 0 || h.months.length > 0;
  return {
    id: 'historique',
    saveVersion: HISTORIQUE_SAVE_VERSION,
    state: () => h,
    onNewGame() { h = emptyHistorique(); sectionLoaded = false; },
    onDayStart(ctx) {
      if (!ctx.inGame || !ctx.demography) return;
      const now = ctx.clock.totalMinutes;
      const pop = ctx.demography.population;
      const r = ctx.use<PaliersService>(PALIERS_SERVICE)?.dayReport(now) as DemographyReport | undefined;
      pushSample(h, {
        day: Math.floor(now / MINUTES_PER_DAY), pop, money: ctx.economy.money,
        jobs: r ? r.jobsTotal : -1, filled: r ? r.jobsFilled : -1,
        unemp: r ? r.unemploymentRate * 1000 : -1, happy: r && r.population > 0 ? r.happiness * 10 : -1,
      });
    },
    onMonthStart(ctx) {
      const m = ctx.economy.lastMonth();
      if (m) pushMonth(h, m.monthIndex, m.balance);
    },
    save() { return hasData() ? { recent: [...h.recent], long: [...h.long], longStep: h.longStep, months: [...h.months] } : undefined; },
    load(_ctx, data, v) { h = migrateHistorique(data, v); sectionLoaded = true; },
    // Ancienne sauvegarde : série longue et soldes repris de l'historique mensuel de l'économie.
    afterLoad(ctx) {
      if (!sectionLoaded) {
        h = emptyHistorique();
        for (const m of ctx.economy.history?.() ?? []) {
          const day = (m.monthIndex + 1) * DAYS_PER_MONTH;
          pushSample(h, { day, pop: m.population, money: m.moneyEnd, jobs: m.jobs, filled: -1, unemp: m.unemploymentRate * 1000, happy: m.population > 0 ? m.happiness * 10 : -1 });
          pushMonth(h, m.monthIndex, m.balance);
        }
        // Les points repris sont mensuels : ils restent dans la série longue, pas dans la série quotidienne.
        h.recent.length = 0;
      }
      sectionLoaded = false;
    },
    command(ctx, name): PluginCommandResult {
      if (name === 'etat') return { ok: true, data: { today: Math.floor(ctx.clock.totalMinutes / MINUTES_PER_DAY), state: { recent: [...h.recent], long: [...h.long], longStep: h.longStep, months: [...h.months] } } };
      return { ok: false, code: 'INVALID_ARGS', message: `Commande historique inconnue : ${name}` };
    },
  };
}

export const historiquePlugin = createHistoriquePlugin();
