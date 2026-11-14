/**
 * Module « alertes » : problèmes des bâtiments affichés en icônes au-dessus d'eux (rendu) et comptés (interface).
 * Bits du masque : voir ALERT_BITS. Charge utile : `items` = [id, masque, x, y (haut du bâtiment), z] × n.
 */
export const ALERT_BITS = { road: 1, power: 2, water: 4, waste: 8 } as const;
export type AlertKind = keyof typeof ALERT_BITS;
export const ALERT_KINDS: readonly AlertKind[] = ['road', 'power', 'water', 'waste'];
export const ALERT_LABELS: Record<AlertKind, string> = {
  road: 'Pas d’accès routier', power: 'Sans électricité', water: 'Sans eau', waste: 'Poubelles pleines',
};

export interface AlertesPayload {
  /** [id, masque, x, y, z] par bâtiment en alerte. */
  items: number[];
  /** Nombre de bâtiments par problème. */
  counts: Record<AlertKind, number>;
}
