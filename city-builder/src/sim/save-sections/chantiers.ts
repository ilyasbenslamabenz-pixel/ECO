/**
 * Section de sauvegarde versionnée du module « Chantiers » — propriété de la branche p2a-chantiers.
 * Écrite sous `save.plugins.chantiers = { v, data, rng }` par l'hôte des modules (src/sim/plugins/host.ts).
 *
 * Règles : toute modification du format incrémente `CHANTIERS_SAVE_VERSION` et ajoute une étape à
 * `migrateChantiers` (v -> v+1), avec un test dans tests/chantiers/ (sauvegarde de l'ancienne version -> chargée).
 * `migrateChantiers` LÈVE une erreur si les données sont inutilisables : l'hôte attrape, notifie le joueur,
 * conserve la section d'origine et charge le reste de la partie.
 *
 * Versions :
 *  - v1 : gabarit vide de la préparation de phase 2 (`{}`), jamais écrit par un module réel ;
 *  - v2 : chantiers réels (activation, horloge de travail, liste des chantiers en cours).
 * Une sauvegarde SANS section (phase 1, ou module en sommeil) se charge : tous ses bâtiments sont achevés.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { ChantierRecord } from '../../shared/protocol-ext/chantiers';
import { runMigrations, type SaveSectionSpec } from './types';

export const CHANTIERS_SAVE_VERSION = 2;

/** Format v1 : gabarit vide. */
export type ChantiersSaveV1 = Record<string, never>;

/** Format v2 (courant). */
export interface ChantiersSaveV2 {
  /** Chantiers actifs pour cette partie (faux : construction instantanée, comme en phase 1). */
  actif: boolean;
  /** Horloge de travail : minutes de jeu travaillées cumulées. */
  horloge: number;
  /** Prochain identifiant de chantier. */
  prochainId: number;
  chantiers: ChantierRecord[];
}
export type ChantiersSave = ChantiersSaveV2;

export function emptyChantiersSave(): ChantiersSave {
  return { actif: false, horloge: 0, prochainId: 1, chantiers: [] };
}

/** Étapes de migration : STEPS[v] transforme des données v en v+1. */
const STEPS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 (gabarit vide) -> v2 : aucun chantier, module en sommeil.
  1: (d) => ({ ...emptyChantiersSave(), ...d }),
};

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Vérifie un chantier relu (lève avec un message précis). */
function checkRecord(r: unknown, i: number): ChantierRecord {
  const o = r as Partial<ChantierRecord> | null;
  const bad = (what: string): never => { throw new Error(`section chantiers : chantier n° ${i} invalide (${what})`); };
  if (typeof o !== 'object' || o === null) return bad('objet attendu');
  if (!num(o.id) || !Number.isInteger(o.id) || o.id < 1) bad('id');
  if (o.kind !== 'construction' && o.kind !== 'demolition') bad('kind');
  if (!num(o.buildingId) || !Number.isInteger(o.buildingId)) bad('buildingId');
  if (typeof o.assetId !== 'string' || o.assetId.length === 0) bad('assetId');
  if (!num(o.variant) || !num(o.x) || !num(o.y) || !num(o.z) || !num(o.rot)) bad('position');
  if (!num(o.t0)) bad('t0');
  if (!num(o.duree) || o.duree! <= 0) bad('duree');
  const bati = num(o.bati) ? Math.min(1, Math.max(0, o.bati)) : 1;
  return {
    id: o.id!, kind: o.kind!, buildingId: o.buildingId!, assetId: o.assetId!, variant: o.variant!,
    x: o.x!, y: o.y!, z: o.z!, rot: o.rot!, t0: o.t0!, duree: o.duree!, bati,
  };
}

/** Migre des données écrites en version `fromVersion` vers le format courant (lève si impossible). */
export function migrateChantiers(data: unknown, fromVersion: number): ChantiersSave {
  const d = runMigrations(data, fromVersion, CHANTIERS_SAVE_VERSION, STEPS, 'chantiers');
  if (typeof d.actif !== 'boolean') throw new Error('section chantiers : champ « actif » manquant');
  if (!num(d.horloge) || d.horloge < 0) throw new Error('section chantiers : horloge invalide');
  if (!Array.isArray(d.chantiers)) throw new Error('section chantiers : liste des chantiers manquante');
  const chantiers = d.chantiers.map(checkRecord);
  const ids = new Set<number>();
  for (const c of chantiers) {
    if (ids.has(c.id)) throw new Error(`section chantiers : identifiant ${c.id} en double`);
    ids.add(c.id);
  }
  let prochainId = num(d.prochainId) && Number.isInteger(d.prochainId) && d.prochainId >= 1 ? d.prochainId : 1;
  for (const c of chantiers) if (c.id >= prochainId) prochainId = c.id + 1;
  return { actif: d.actif, horloge: d.horloge, prochainId, chantiers };
}

export const chantiersSaveSection: SaveSectionSpec<ChantiersSave> = {
  id: 'chantiers', version: CHANTIERS_SAVE_VERSION, empty: emptyChantiersSave, migrate: migrateChantiers,
};
