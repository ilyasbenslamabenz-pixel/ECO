/**
 * Historique d'annulation (Ctrl+Z) des actions de construction (pur TypeScript).
 * Chaque action réussie empile son INVERSE exprimé en commandes du protocole :
 *  - bâtiment posé   → demolish(buildingId)
 *  - route tracée    → removeRoad(edgeId) pour chaque tronçon créé
 *  - bâtiment démoli → placeBuilding(même asset, position, rotation, variante)
 *  - route supprimée → buildRoad(même type, mêmes extrémités)
 *  - route modifiée  → upgradeRoad(type d'origine, même inversion de sens)
 *  - quadrillage     → removeRoad de chaque tronçon posé sur ses rues et créé pendant l'opération
 *                      (résolu au moment de l'annulation : les croisements ont découpé les tronçons)
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
  | { kind: 'buildRoad'; kindId: RoadKindId; points: number[]; c1?: [number, number]; c2?: [number, number] }
  | { kind: 'upgradeRoad'; edgeId: number; toKind: RoadKindId; reverse: boolean }
  /** Tronçons d'id ≥ minEdgeId posés sur les rues du quadrillage (x0..x1, z0..z1, pas `block`). */
  | { kind: 'removeGrid'; minEdgeId: number; x0: number; z0: number; x1: number; z1: number; block: number };

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
    for (const e of this.entries) e.steps = e.steps.filter((s) => !((s.kind === 'removeRoad' || s.kind === 'upgradeRoad') && s.edgeId === id));
    this.entries = this.entries.filter((e) => e.steps.length > 0);
  }

  /** Un tronçon modifié (upgradeRoad) change d'identifiant : les étapes qui le visent suivent. */
  renameEdge(from: number, to: number): void {
    for (const e of this.entries) for (const s of e.steps) if ((s.kind === 'removeRoad' || s.kind === 'upgradeRoad') && s.edgeId === from) s.edgeId = to;
  }
}
