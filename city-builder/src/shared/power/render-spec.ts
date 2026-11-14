/**
 * Électricité — géométrie partagée entre le générateur de modèles (tools/power) et le rendu (src/render/power) :
 * identifiants des modèles, position du moyeu des éoliennes, points d'accrochage des câbles sur les pylônes.
 * Repère des modèles : mètres, Y vers le haut, façade (face au vent pour l'éolienne) vers +Z, origine au centre
 * de l'emprise au sol. TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Identifiants des modèles : bâtiments du catalogue + éléments instanciés par le rendu (hors catalogue). */
export const POWER_ASSETS = {
  thermique: 'elec_centrale_gaz',
  eolien: 'elec_eolienne',
  solaire: 'elec_ferme_solaire',
  hydro: 'elec_barrage',
  poste: 'elec_poste',
  rotor: 'elec_eolienne_rotor',
  pylone: 'elec_pylone',
} as const;

/**
 * Éléments instanciés (rotor animé, pylône) : GLB chargés directement par le rendu, sans entrée de catalogue
 * (ce ne sont pas des objets posables ; les règles de plausibilité des décors du catalogue ne s'y appliquent pas).
 * Chemins relatifs à dist/assets/, du LOD0 au LOD2.
 */
export const POWER_ELEMENT_FILES: Record<'rotor' | 'pylone', readonly string[]> = {
  rotor: [0, 1, 2].map((l) => `models/power/${POWER_ASSETS.rotor}_lod${l}.glb`),
  pylone: [0, 1, 2].map((l) => `models/power/${POWER_ASSETS.pylone}_lod${l}.glb`),
};

/** Éolienne : hauteur du moyeu, avancée du moyeu devant l'axe du mât, rayon du rotor (m). */
export const TURBINE = { hubHeight: 55, hubForward: 4.6, rotorRadius: 37, towerBaseRadius: 1.9, towerTopRadius: 1.25 };

/** Pylône treillis : hauteur totale et points d'accrochage des conducteurs (bas des chaînes d'isolateurs). */
export const PYLON = {
  height: 36,
  /** Conducteurs (x latéral, y) — deux ternes simplifiés à 4 conducteurs + câble de garde au sommet. */
  attach: [
    [-7.5, 22.6], [7.5, 22.6], [-5.5, 28.1], [5.5, 28.1],
  ] as readonly (readonly [number, number])[],
  earth: [0, 36] as const,
};

/** Hauteur des points d'arrivée des lignes sur une installation (portique) (m). */
export const GANTRY_HEIGHT = 14;
