/**
 * Extension du protocole propre au module « Ressources » (zones spécialisées du zonage : exploitation forestière,
 * agricole, mixte) : charges utiles de `delta.ext.ressources` / `snapshot.ext.ressources` et commandes
 * `pluginCommand { plugin: 'ressources', name, payload }`. Documentation : docs/ZONAGE.md §8.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export const RESSOURCES_ID = 'ressources';

/** Bilan quotidien d'une ressource (bois en m³, nourriture en t). */
export interface ResourceFlow {
  /** Production du dernier jour. */
  production: number;
  /** Consommation de la ville du dernier jour. */
  consumption: number;
  /** Excédent exporté du dernier jour (production − consommation, ≥ 0). */
  exported: number;
  /** Manque importé par les entreprises du dernier jour (≥ 0). */
  imported: number;
  /** Totaux depuis le début de la partie. */
  totalProduced: number;
}

export interface RessourcesStats {
  bois: ResourceFlow;
  nourriture: ResourceFlow;
  foret: {
    /** Cases de la zone forestière suivies. */
    cells: number;
    /** Stock sur pied / capacité de ces cases (0..1). */
    stock: number;
    /** Cases déboisées (stock sous le seuil) ; cases repoussées depuis le début de la partie. */
    deboisees: number;
    repoussees: number;
    exploitations: number;
  };
  agricole: { fermes: number; champs: number; fertilite: number };
  mixte: { batiments: number; logements: number; emplois: number };
  /** Recette municipale (part fiscale des exportations) du mois en cours et du mois précédent (CHF). */
  recetteMois: number;
  recetteMoisPrecedent: number;
}

/**
 * Charge utile de `delta.ext.ressources` (champs présents seulement s'ils ont changé).
 *  - `tints` : bâtiments des zones spécialisées à teinter [id, code de zone 7..9, …] (ajouts depuis le dernier envoi) ;
 *  - `cleared` / `regrown` : centres (x, z) des cases de forêt devenues déboisées / repoussées.
 */
export interface RessourcesDelta {
  stats?: RessourcesStats;
  tints?: number[];
  cleared?: number[];
  regrown?: number[];
}

/** Instantané : état complet (liste complète des teintes et des cases déboisées). */
export interface RessourcesSnapshot extends RessourcesDelta {
  stats: RessourcesStats;
  tints: number[];
  cleared: number[];
}

/** Teinte multiplicative (r, g, b) des bâtiments par zone spécialisée (assets existants, aucune ressource lourde). */
export const SPECIAL_TINTS: Record<number, [number, number, number]> = {
  7: [0.86, 0.95, 0.78], // forêt : bois et mousse
  8: [1.08, 0.98, 0.78], // agricole : paille
  9: [0.94, 1.0, 1.08], // mixte : vitrines claires
};

export interface RessourcesCommands {
  state: { payload?: undefined; result: RessourcesSnapshot };
  /** Avance la simulation des ressources de `days` jours (tests, démonstration). */
  simulate: { payload?: { days?: number }; result: RessourcesStats };
}
