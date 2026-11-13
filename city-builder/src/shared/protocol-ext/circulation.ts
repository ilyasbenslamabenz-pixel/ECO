/**
 * Extension du protocole propre au module « Circulation » — propriété de la branche p2a-circulation.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.circulation`, `snapshot.ext.circulation`
 * et la commande générique `pluginCommand { plugin: 'circulation', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Gabarit (à compléter) :
 *   export interface CirculationDelta { version: number; positions?: Float32Array; ... }
 *   export interface CirculationCommands { inspect: { payload: { id: number }; result: { ... } } }
 * Tableaux typés volumineux : neufs à chaque envoi et listés sous `$transfer` pour être transférés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Charge utile de `delta.ext.circulation` (absente quand rien n'a changé). */
export interface CirculationDelta {
  // vide pour l'instant
}

/** Charge utile de `snapshot.ext.circulation` (état complet pour un rendu qui repart de zéro). */
export interface CirculationSnapshot {
  // vide pour l'instant
}

/** Commandes du module : nom -> { payload, result }. */
export interface CirculationCommands {
  // vide pour l'instant
}
