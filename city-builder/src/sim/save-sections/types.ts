/**
 * Sections de sauvegarde versionnées des modules de phase 2 : contrat commun et moteur de migration.
 * Fichier COMMUN (superviseur). Chaque module décrit sa section dans `./<module>.ts`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Description d'une section : identifiant (= id du module), version courante, valeur vide, migration. */
export interface SaveSectionSpec<T> {
  readonly id: string;
  readonly version: number;
  empty(): T;
  /** Données écrites en `fromVersion` -> format courant. Lève une erreur si les données sont inutilisables. */
  migrate(data: unknown, fromVersion: number): T;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Applique les étapes `steps[v]` (v -> v+1) de `fromVersion` à `current`. Lève si les données ne sont pas un
 * objet, si la version est inconnue (future ou < 1) ou si une étape manque.
 */
export function runMigrations(
  data: unknown, fromVersion: number, current: number,
  steps: Record<number, (d: Record<string, unknown>) => Record<string, unknown>>, what: string,
): Record<string, unknown> {
  if (!isObj(data)) throw new Error(`section ${what} : objet attendu`);
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`section ${what} : version ${fromVersion} invalide`);
  if (fromVersion > current) throw new Error(`section ${what} : version ${fromVersion} plus récente que ${current}`);
  let d = data;
  for (let v = fromVersion; v < current; v++) {
    const step = steps[v];
    if (!step) throw new Error(`section ${what} : aucune migration depuis la version ${v}`);
    d = step(d);
  }
  return d;
}
