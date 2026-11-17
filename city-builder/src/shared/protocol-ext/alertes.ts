/**
 * Module « alertes » : problèmes des bâtiments affichés en icônes au-dessus d'eux (rendu) et comptés (interface).
 * Bits du masque : voir ALERT_BITS. Charge utile : `items` = [id, masque, x, y (haut du bâtiment), z] × n.
 */
export const ALERT_BITS = { road: 1, power: 2, water: 4, waste: 8, isolated: 16, fire: 32, ruin: 64, crime: 128 } as const;
export type AlertKind = keyof typeof ALERT_BITS;
/**
 * `isolated` (bit 16) : installation de déchets reliée à une route isolée du reste du réseau (dépôt sans aucun
 * bâtiment ni filière de traitement joignable, ou traitement sans dépôt joignable) : 0 tournée sans cela signalé.
 */
/**
 * Services (vague 2) : `fire` (bit 32) bâtiment en feu, `ruin` (64) détruit par le feu (à démolir ou reconstruire),
 * `crime` (128) criminalité élevée.
 */
export const ALERT_KINDS: readonly AlertKind[] = ['road', 'power', 'water', 'waste', 'isolated', 'fire', 'ruin', 'crime'];
export const ALERT_LABELS: Record<AlertKind, string> = {
  road: 'Pas d’accès routier', power: 'Sans électricité', water: 'Sans eau', waste: 'Poubelles pleines',
  isolated: 'Réseau routier isolé', fire: 'En feu', ruin: 'Ruine (incendie)', crime: 'Criminalité élevée',
};

export interface AlertesPayload {
  /** [id, masque, x, y, z] par bâtiment en alerte. */
  items: number[];
  /** Nombre de bâtiments par problème. */
  counts: Record<AlertKind, number>;
  /**
   * Aucun dépôt de camions-bennes : nombre de bâtiments (avec occupants) dont les bacs sont pleins. Alerte globale
   * « Aucune collecte des déchets » (pas d'icône par bâtiment). Absent quand la collecte existe ou que rien ne déborde.
   */
  noCollection?: number;
  /**
   * Réserve de courant faible (avant toute coupure) : marge la plus basse des dernières 24 h de jeu, en part de la
   * demande (0,08 = 8 %). Absente quand la marge reste au-dessus de `POWER_RESERVE_WARN` ou qu'il y a déjà des coupures.
   */
  powerReserve?: number;
}

/** Marge de production sous laquelle la ville est prévenue (avant que les lieux de travail passent en baisse de régime). */
export const POWER_RESERVE_WARN = 0.15;
