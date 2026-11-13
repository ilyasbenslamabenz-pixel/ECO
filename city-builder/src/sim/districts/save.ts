/**
 * Quartiers — FORMAT DE SAUVEGARDE du module « Bâtiments & quartiers » (données + migrations).
 *
 * Le fichier de section `src/sim/save-sections/batiments.ts` n'est qu'une façade sur ce module : la logique
 * vit ici pour que `src/sim/plugins/batiments.ts` puisse l'importer sans violer le garde-fou d'architecture
 * (`tests/unit/architecture.test.ts` interdit tout import `../save…` depuis la simulation).
 *
 * v1 : gabarit vide `{}` (préparation §0, aucun contenu).
 * v2 : quartiers suivis, propositions d'évolution en attente, options d'affichage.
 * Toute modification du format incrémente `BATIMENTS_SAVE_VERSION` et ajoute une étape à `migrateBatiments`
 * (v -> v+1), avec un test dans tests/batiments/. `migrateBatiments` LÈVE si les données sont inutilisables :
 * l'hôte attrape, notifie le joueur, conserve la section d'origine et charge le reste de la partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Copie locale du moteur de migration de `src/sim/save-sections/types.ts` (mêmes contrôles et mêmes messages) :
 * ce fichier ne peut pas importer `../save-sections/…` (garde-fou d'architecture).
 */
function runMigrations(
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



export const BATIMENTS_SAVE_VERSION = 2;

/** Quartier enregistré (format de sauvegarde : valeurs simples uniquement). */
export interface SavedDistrict {
  id: number;
  type: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rot: number;
  seed: number;
  createdDay: number;
  stage: number;
  value: number;
  ageMonths: number;
  pressure: number;
}

export interface SavedProposal {
  id: number;
  districtId: number;
  buildingId: number;
  fromAsset: string;
  fromVariant: number;
  toAsset: string;
  variant: number;
  x: number;
  z: number;
  rot: number;
  kind: string;
  reason: string;
  cost: number;
}

export interface BatimentsSaveV2 {
  districts: SavedDistrict[];
  proposals: SavedProposal[];
  nextDistrictId: number;
  nextProposalId: number;
  overlay: boolean;
  autoEvolve: boolean;
}
export type BatimentsSave = BatimentsSaveV2;

export function emptyBatimentsSave(): BatimentsSave {
  return { districts: [], proposals: [], nextDistrictId: 1, nextProposalId: 1, overlay: false, autoEvolve: false };
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 (gabarit vide) -> v2 : aucun quartier n'existait, on repart de l'état vide.
  1: () => emptyBatimentsSave() as unknown as Record<string, unknown>,
};

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migrateBatiments(data: unknown, fromVersion: number): BatimentsSave {
  const d = runMigrations(data, fromVersion, BATIMENTS_SAVE_VERSION, STEPS, 'batiments');
  if (!isArr(d['districts']) || !isArr(d['proposals'])) throw new Error('section batiments : quartiers illisibles');
  const e = emptyBatimentsSave();
  return {
    districts: d['districts'] as SavedDistrict[],
    proposals: d['proposals'] as SavedProposal[],
    nextDistrictId: typeof d['nextDistrictId'] === 'number' ? d['nextDistrictId'] : e.nextDistrictId,
    nextProposalId: typeof d['nextProposalId'] === 'number' ? d['nextProposalId'] : e.nextProposalId,
    overlay: d['overlay'] === true,
    autoEvolve: d['autoEvolve'] === true,
  };
}

