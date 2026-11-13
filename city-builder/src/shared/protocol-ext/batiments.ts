/**
 * Extension du protocole propre au module « Bâtiments & quartiers » — propriété de la branche p2a-batiments.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.batiments`, `snapshot.ext.batiments`
 * et la commande générique `pluginCommand { plugin: 'batiments', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Gabarit (à compléter) :
 *   export interface BatimentsDelta { version: number; positions?: Float32Array; ... }
 *   export interface BatimentsCommands { inspect: { payload: { id: number }; result: { ... } } }
 * Tableaux typés volumineux : neufs à chaque envoi et listés sous `$transfer` pour être transférés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Charge utile de `delta.ext.batiments` (absente quand rien n'a changé). */
export interface BatimentsDelta {
  // vide pour l'instant
}

/** Charge utile de `snapshot.ext.batiments` (état complet pour un rendu qui repart de zéro). */
export interface BatimentsSnapshot {
  // vide pour l'instant
}

/** Commandes du module : nom -> { payload, result }. */
export interface BatimentsCommands {
  // vide pour l'instant
}
