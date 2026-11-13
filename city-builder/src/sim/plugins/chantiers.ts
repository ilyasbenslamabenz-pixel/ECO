/**
 * Module de simulation « Chantiers » — propriété de la branche p2a-chantiers.
 *
 * Un bâtiment posé par le joueur ouvre un chantier : phases visibles (terrassement, fondations, structure,
 * façades, finitions), durée fonction du coût, de la hauteur et de l'emprise, avancement sur une horloge de
 * travail (06:00–20:00). Une démolition ouvre un chantier de déblaiement. Tout est sauvegardé
 * (`save.plugins.chantiers`, section versionnée) et envoyé au rendu par `delta.ext.chantiers`.
 *
 * Le module n'écrit dans la simulation de base QUE par le « portail d'activité » facultatif
 * (`ctx.buildings.setActive`, voir docs/requests/chantiers.md) : présent, un bâtiment en chantier ne loge,
 * n'emploie et ne produit rien ; absent, le module fonctionne sans régression (chantiers suivis et affichés).
 *
 * Activation : la commande `pluginCommand { plugin:'chantiers', name:'configurer', payload:{ actif:true } }`.
 * Par défaut les chantiers sont actifs en partie ; la ville de démonstration et les sauvegardes sans section
 * arrivent achevées. TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { ChantiersService } from '../../shared/protocol-ext/chantiers';
import { ChantierSystem, type BuildingOrigin } from '../construction/system';
// Voir la note de src/sim/construction/system.ts sur ce chemin.
import { CHANTIERS_SAVE_VERSION } from '../../sim/save-sections/chantiers';
import type { PluginContext, SimPlugin } from './types';

/** Chantiers actifs par défaut au démarrage d'une partie. */
export const CHANTIERS_ACTIFS_PAR_DEFAUT = true;

/** Système exposé pour les tests du module (une seule instance, comme les autres registres). */
export const chantierSystem = new ChantierSystem();

/** Crochets facultatifs attendus du cœur (demande n° 2 de docs/requests/chantiers.md). */
interface ChantiersPlugin extends SimPlugin {
  onBuildingAdded?(ctx: PluginContext, buildingId: number, origin: BuildingOrigin): void;
  onBuildingRemoved?(ctx: PluginContext, buildingId: number): void;
}

export const chantiersPlugin: ChantiersPlugin = {
  id: 'chantiers',
  saveVersion: CHANTIERS_SAVE_VERSION,

  init(ctx) {
    const service: ChantiersService = {
      enChantier: (id) => chantierSystem.enChantier(id),
      avancement: (id) => chantierSystem.avancement(id),
      get nombre() { return chantierSystem.sites.size; },
    };
    ctx.provide('chantiers', service);
  },

  onNewGame() {
    chantierSystem.reset(CHANTIERS_ACTIFS_PAR_DEFAUT);
  },

  onTick(ctx, minutes) {
    chantierSystem.tick(ctx, minutes);
  },

  onBuildingAdded(ctx, buildingId, origin) {
    chantierSystem.onBuildingAdded(ctx, buildingId, origin);
  },

  takeDelta(ctx) { return chantierSystem.takeDelta(ctx); },
  snapshot(ctx) { return chantierSystem.snapshot(ctx); },
  save(ctx) { return chantierSystem.save(ctx, CHANTIERS_ACTIFS_PAR_DEFAUT); },
  load(ctx, data, version) { chantierSystem.load(ctx, data, version); },
  command(ctx, name, payload) { return chantierSystem.command(ctx, name, payload); },
};
