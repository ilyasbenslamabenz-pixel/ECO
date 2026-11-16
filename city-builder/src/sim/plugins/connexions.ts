/**
 * Module de simulation « connexions » : connexions extérieures (points d'entrée en bord de carte, docs/CONNEXIONS.md).
 * Le calcul vit dans `ConnexionsSystem` (src/sim/connexions/system.ts) ; ce module le branche sur les crochets :
 *  - service `connexions` : `attachCore({ demography, traffic })` appelé par la simulation (comme le module `bus`) ;
 *  - chaque tick : connexions recalculées si le réseau ou les bâtiments changent (contrôle en O(1) sinon) ;
 *  - chaque jour : marchandises (import / export, droits), réglages du trafic et de l'immigration ;
 *  - commandes : `state`, `stats`.
 * Sans connexion : aucun delta, aucune section de sauvegarde, aucun effet sur la simulation.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { CONNEXIONS_SAVE_VERSION, migrateConnexions } from '../save-sections/connexions';
import { ConnexionsSystem, type ConnexionsCore } from '../connexions/system';
import type { PluginCommandResult, SimPlugin } from './types';

export interface ConnexionsApi { attachCore(core: ConnexionsCore): void; readonly system: ConnexionsSystem }

export function createConnexionsPlugin(): SimPlugin & { readonly system: ConnexionsSystem } {
  const sys = new ConnexionsSystem();
  const api: ConnexionsApi = { system: sys, attachCore(core) { sys.attach(core); } };
  return {
    id: 'connexions',
    saveVersion: CONNEXIONS_SAVE_VERSION,
    system: sys,
    init(ctx) { ctx.provide('connexions', api); },
    onNewGame() { sys.reset(); },
    onTick(ctx) { if (ctx.inGame) sys.refresh(ctx); },
    onDayStart(ctx) { if (ctx.inGame) sys.daily(ctx); },
    onMonthStart() { sys.onMonth(); },
    takeDelta() { return sys.takeDelta(); },
    snapshot() { return sys.snapshot(); },
    save() { return sys.save(); },
    load(ctx, data, version) { sys.load(ctx, migrateConnexions(data, version)); },
    afterLoad(ctx) { sys.afterLoad(ctx); },
    command(ctx, name): PluginCommandResult {
      if (!ctx.inGame) return { ok: false, code: 'NO_GAME', message: 'Aucune partie en cours' };
      switch (name) {
        case 'state': return { ok: true, data: sys.state(ctx) };
        case 'stats': return { ok: true, data: sys.state(ctx).summary };
        default: return { ok: false, code: 'INVALID_ARGS', message: `Commande inconnue du module connexions : ${name}` };
      }
    },
  };
}

export const connexionsPlugin = createConnexionsPlugin();
