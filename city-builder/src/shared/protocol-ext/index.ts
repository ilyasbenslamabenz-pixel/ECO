/**
 * Extensions du protocole par module (phase 2) : types des charges utiles de `delta.ext`, `snapshot.ext`
 * et des commandes `pluginCommand`. Fichier COMMUN (superviseur) : une ligne par module ;
 * chaque branche ne modifie que `./<module>.ts`.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { BatimentsCommands, BatimentsDelta, BatimentsSnapshot } from './batiments';
import type { ChantiersCommands, ChantiersDelta, ChantiersSnapshot } from './chantiers';
import type { CirculationCommands, CirculationDelta, CirculationSnapshot } from './circulation';
import type { PietonsCommands, PietonsDelta, PietonsSnapshot } from './pietons';
export type * from './electricite';

export type * from './batiments';
export type * from './circulation';
export type * from './pietons';
export type * from './chantiers';

/** Identifiants des modules de phase 2 (= `SimPlugin.id`, `RenderPlugin.id`, `UiPanel.id`). */
export const PHASE2_MODULES = ['batiments', 'circulation', 'pietons', 'chantiers'] as const;
export type Phase2ModuleId = (typeof PHASE2_MODULES)[number];

export interface PluginDeltaMap {
  batiments: BatimentsDelta;
  circulation: CirculationDelta;
  pietons: PietonsDelta;
  chantiers: ChantiersDelta;
}

export interface PluginSnapshotMap {
  batiments: BatimentsSnapshot;
  circulation: CirculationSnapshot;
  pietons: PietonsSnapshot;
  chantiers: ChantiersSnapshot;
}

export interface PluginCommandMaps {
  batiments: BatimentsCommands;
  circulation: CirculationCommands;
  pietons: PietonsCommands;
  chantiers: ChantiersCommands;
}

/** Lecture typée de la charge utile d'un module dans `delta.ext` (undefined si absente). */
export function deltaExt<K extends Phase2ModuleId>(ext: Record<string, unknown> | undefined, id: K): PluginDeltaMap[K] | undefined {
  return ext?.[id] as PluginDeltaMap[K] | undefined;
}

/** Lecture typée de la charge utile d'un module dans `snapshot.ext` (undefined si absente). */
export function snapshotExt<K extends Phase2ModuleId>(ext: Record<string, unknown> | undefined, id: K): PluginSnapshotMap[K] | undefined {
  return ext?.[id] as PluginSnapshotMap[K] | undefined;
}
