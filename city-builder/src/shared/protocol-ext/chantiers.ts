/**
 * Extension du protocole propre au module « Chantiers » — propriété de la branche p2a-chantiers.
 * Rétrocompatible par construction : ces données circulent dans `delta.ext.chantiers`, `snapshot.ext.chantiers`
 * et la commande générique `pluginCommand { plugin: 'chantiers', name, payload }` (src/shared/protocol.ts).
 * Un client qui ignore le module ignore simplement ces clés.
 *
 * Gabarit (à compléter) :
 *   export interface ChantiersDelta { version: number; positions?: Float32Array; ... }
 *   export interface ChantiersCommands { inspect: { payload: { id: number }; result: { ... } } }
 * Tableaux typés volumineux : neufs à chaque envoi et listés sous `$transfer` pour être transférés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Charge utile de `delta.ext.chantiers` (absente quand rien n'a changé). */
export interface ChantiersDelta {
  // vide pour l'instant
}

/** Charge utile de `snapshot.ext.chantiers` (état complet pour un rendu qui repart de zéro). */
export interface ChantiersSnapshot {
  // vide pour l'instant
}

/** Commandes du module : nom -> { payload, result }. */
export interface ChantiersCommands {
  // vide pour l'instant
}
