/**
 * Générateur de quartiers (module « Bâtiments & quartiers », phase 2A) — API publique.
 * Pur et déterministe : aucune écriture dans la simulation (un plan est exécuté par ./apply.ts avec les
 * opérations du joueur). TypeScript pur : AUCUN import de three ni du DOM.
 */
export * from './types';
export * from './profiles';
export * from './diversity';
export * from './generator';
export * from './evolution';
export * from './apply';
export * from './save';
