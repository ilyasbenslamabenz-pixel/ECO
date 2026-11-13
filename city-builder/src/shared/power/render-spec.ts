/**
 * Électricité — géométrie partagée entre le générateur de modèles (tools/power) et le rendu (src/render/power) :
 * identifiants des modèles, position du moyeu des éoliennes, points d'accrochage des câbles sur les pylônes.
 * Repère des modèles : mètres, Y vers le haut, façade (face au vent pour l'éolienne) vers +Z, origine au centre
 * de l'emprise au sol. TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Identifiants des modèles du catalogue. */
export const POWER_ASSETS = {
  thermique: 'elec_centrale_gaz',
  eolien: 'elec_eolienne',
  solaire: 'elec_ferme_solaire',
  hydro: 'elec_barrage',
  poste: 'elec_poste',
  rotor: 'elec_eolienne_rotor',
  pylone: 'elec_pylone',
} as const;

/** Éolienne : hauteur du moyeu, avancée du moyeu devant l'axe du mât, rayon du rotor (m). */
export const TURBINE = { hubHeight: 80, hubForward: 5.4, rotorRadius: 42, towerBaseRadius: 2.3, towerTopRadius: 1.45 };

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
