/**
 * État local de la progression côté interface (paliers, objectifs, événements), alimenté par les charges utiles des
 * modules (`snapshot.ext`, `delta.ext`) : verrous affichés dans la barre de construction, le zonage et les politiques,
 * rappel de l'objectif en cours. Aucune valeur inventée : tout vient de la simulation.
 */
import type { PaliersLocks, PaliersState } from '../shared/milestones';
import type { ObjectifsState } from '../shared/protocol-ext/objectifs';
import type { EvenementsState } from '../shared/protocol-ext/evenements';

type Listener = () => void;

class ProgressionView {
  paliers: PaliersState | null = null;
  objectifs: ObjectifsState | null = null;
  evenements: EvenementsState | null = null;
  private readonly listeners = new Set<Listener>();

  /** Verrous restants (null : tout est débloqué). */
  get locks(): PaliersLocks | null { return this.paliers?.locked ? this.paliers.locks : null; }
  /** Palier requis pour un bâtiment, une zone, une politique (null : libre). */
  assetLock(id: string): string | null { return this.locks?.assets[id] ?? null; }
  zoneLock(zone: string): string | null { return this.locks?.zones[zone] ?? null; }
  policyLock(id: string): string | null { return this.locks?.policies[id] ?? null; }

  onChange(fn: Listener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Instantané : les modules absents repartent de zéro. */
  setSnapshot(ext: Record<string, unknown> | undefined): void {
    this.paliers = (ext?.['paliers'] as PaliersState | undefined) ?? null;
    this.objectifs = (ext?.['objectifs'] as ObjectifsState | undefined) ?? null;
    this.evenements = (ext?.['evenements'] as EvenementsState | undefined) ?? null;
    this.emit();
  }

  /** Delta : seuls les modules présents changent. */
  pushDelta(ext: Record<string, unknown> | undefined): void {
    if (!ext) return;
    let changed = false;
    if (ext['paliers']) { this.paliers = ext['paliers'] as PaliersState; changed = true; }
    if (ext['objectifs']) { this.objectifs = ext['objectifs'] as ObjectifsState; changed = true; }
    if (ext['evenements']) { this.evenements = ext['evenements'] as EvenementsState; changed = true; }
    if (changed) this.emit();
  }

  private emit(): void { for (const l of this.listeners) { try { l(); } catch (e) { console.error('[progression]', e); } } }
}

export const progressionView = new ProgressionView();

/** Ouvre un tableau de bord par son identifiant (géré par l'interface : src/ui/hud.ts). */
export function openView(dash: string, tab?: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ui:open-view', { detail: { dash, tab } }));
}
