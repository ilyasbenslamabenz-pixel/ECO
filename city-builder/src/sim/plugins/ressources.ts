/**
 * Module de simulation « Ressources » : production des zones spécialisées du zonage — bois des exploitations
 * forestières (déforestation et repousse), nourriture des fermes, statistiques de la zone mixte ; consommation
 * de la ville, exportations et part fiscale versée à la ville ; demande des zones forêt / agricole publiée pour
 * le zonage. Moteur : src/sim/ressources/** ; protocole : src/shared/protocol-ext/ressources.ts ; sauvegarde :
 * src/sim/save-sections/ressources.ts (section facultative) ; documentation : docs/ZONAGE.md §8.
 *
 * Services : lit `zonage:etat` (zones et bâtiments nés du zonage) ; publie `ressources:demande`.
 * Sans zone spécialisée, le module est totalement inerte : aucun delta, aucun instantané, aucune section.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { RESSOURCES_ID } from '../../shared/protocol-ext/ressources';
// Chemin écrit depuis la racine de src/sim (garde-fou d'architecture sur « ../save… », voir zonage).
import { RESSOURCES_SAVE_VERSION, migrateRessources } from '../../sim/save-sections/ressources';
import { RessourcesSystem } from '../ressources/system';
import { SPECIAL_DEMAND_SERVICE } from '../zoning/system';
import type { PluginCommandResult, PluginContext, SimPlugin } from './types';

export type RessourcesPlugin = SimPlugin & { systemOf(ctx: PluginContext): RessourcesSystem };

export function createRessourcesPlugin(): RessourcesPlugin {
  const systems = new WeakMap<PluginContext, RessourcesSystem>();
  const sys = (ctx: PluginContext): RessourcesSystem => {
    let s = systems.get(ctx);
    if (!s) { s = new RessourcesSystem(); systems.set(ctx, s); }
    return s;
  };
  return {
    id: RESSOURCES_ID,
    saveVersion: RESSOURCES_SAVE_VERSION,
    systemOf: sys,
    init(ctx) { ctx.provide(SPECIAL_DEMAND_SERVICE, sys(ctx).demandProvider()); },
    onNewGame(ctx) { sys(ctx).reset(); },
    onDayStart(ctx) { sys(ctx).day(ctx); },
    onMonthStart(ctx) { sys(ctx).month(); },
    takeDelta(ctx) { return sys(ctx).takeDelta(ctx); },
    snapshot(ctx) { const s = sys(ctx); s.sync(ctx); return s.active ? s.full(ctx) : undefined; },
    command(ctx, name, payload): PluginCommandResult {
      if (!ctx.inGame) return { ok: false, code: 'NO_GAME', message: 'Aucune partie en cours' };
      const s = sys(ctx);
      switch (name) {
        case 'state':
          return { ok: true, data: s.full(ctx) };
        case 'simulate': {
          const p = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
          const days = Math.max(0, Math.min(365, Math.floor(typeof p.days === 'number' && Number.isFinite(p.days) ? p.days : 1)));
          for (let k = 0; k < days; k++) s.day(ctx);
          return { ok: true, data: s.stats(ctx) };
        }
        default:
          return { ok: false, code: 'INVALID_ARGS', message: `Commande ressources inconnue : ${name}` };
      }
    },
    save(ctx) { return sys(ctx).toSave(); },
    load(ctx, data, version) { sys(ctx).load(migrateRessources(data, version)); },
  };
}

/** Instance du registre (src/sim/plugins/index.ts). */
export const ressourcesPlugin = createRessourcesPlugin();
