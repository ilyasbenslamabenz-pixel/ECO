/**
 * Extension du protocole propre au module « Piétons » — propriété de la branche p2a-pietons.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.pietons`, `snapshot.ext.pietons`
 * et la commande générique `pluginCommand { plugin: 'pietons', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Gabarit (à compléter) :
 *   export interface PietonsDelta { version: number; positions?: Float32Array; ... }
 *   export interface PietonsCommands { inspect: { payload: { id: number }; result: { ... } } }
 * Tableaux typés volumineux : neufs à chaque envoi et listés sous `$transfer` pour être transférés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Charge utile de `delta.ext.pietons` (absente quand rien n'a changé). */
export interface PietonsDelta {
  // vide pour l'instant
}

/** Charge utile de `snapshot.ext.pietons` (état complet pour un rendu qui repart de zéro). */
export interface PietonsSnapshot {
  // vide pour l'instant
}

/** Commandes du module : nom -> { payload, result }. */
export interface PietonsCommands {
  // vide pour l'instant
}
