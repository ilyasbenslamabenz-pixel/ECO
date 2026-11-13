/**
 * Historique d'annulation (Ctrl+Z) des actions de construction (pur TypeScript).
 * Chaque action réussie empile son INVERSE exprimé en commandes du protocole :
 *  - bâtiment posé   → demolish(buildingId)
 *  - route tracée    → removeRoad(edgeId) pour chaque tronçon créé
 *  - bâtiment démoli → placeBuilding(même asset, position, rotation, variante)
 *  - route supprimée → buildRoad(même type, mêmes extrémités)
 * L'annulation passe par la simulation : elle applique ses propres règles (remboursement
 * de 25 % à la démolition, coût de reconstruction). Pas de remboursement intégral tant que
 * le protocole n'a pas de commande `undo` dédiée (demande dans docs/requests/construction-ui.md).
 * Propriétaire : agent construction/caméra/UI.
 */
import type { RoadKindId } from '../../shared/contracts';

export type UndoStep =
  | { kind: 'demolish'; buildingId: number }
  | { kind: 'removeRoad'; edgeId: number }
  | { kind: 'placeBuilding'; assetId: string; x: number; z: number; rot: number; variant: number }
  | { kind: 'buildRoad'; kindId: RoadKindId; points: number[]; c1?: [number, number]; c2?: [number, number] };

export interface UndoEntry {
  label: string;
  steps: UndoStep[];
}

export class UndoStack {
  private entries: UndoEntry[] = [];
  constructor(private readonly max = 50) {}

  push(e: UndoEntry): void {
    if (e.steps.length === 0) return;
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.shift();
  }

  pop(): UndoEntry | undefined { return this.entries.pop(); }
  peek(): UndoEntry | undefined { return this.entries[this.entries.length - 1]; }
  get size(): number { return this.entries.length; }
  clear(): void { this.entries.length = 0; }

  /** Après une démolition externe, retire les étapes qui visent un objet disparu. */
  forgetBuilding(id: number): void {
    for (const e of this.entries) e.steps = e.steps.filter((s) => !(s.kind === 'demolish' && s.buildingId === id));
    this.entries = this.entries.filter((e) => e.steps.length > 0);
  }

  forgetEdge(id: number): void {
    for (const e of this.entries) e.steps = e.steps.filter((s) => !(s.kind === 'removeRoad' && s.edgeId === id));
    this.entries = this.entries.filter((e) => e.steps.length > 0);
  }
}
