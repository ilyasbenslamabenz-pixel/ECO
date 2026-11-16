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
  /**
   * `path` (facultatif) : axe du tracé construit (x/z alternés). Si le tronçon a été découpé depuis (route posée
   * ensuite en travers), l'annulation retire les morceaux plus récents posés sur cet axe.
   */
  | { kind: 'removeRoad'; edgeId: number; path?: number[] }
  /** `restoreToken` : jeton renvoyé par `demolish` (annulation neutre : seul le remboursement perçu est repayé). */
  | { kind: 'placeBuilding'; assetId: string; x: number; z: number; rot: number; variant: number; restoreToken?: number }
  /** Bâtiment déplacé → remis à sa position d'origine. */
  | { kind: 'moveBuilding'; buildingId: number; x: number; z: number; rot: number }
  /** `elevation` : hauteur imposée d'origine (viaduc, tunnel), conservée à la reconstruction. */
  /** `restoreToken` : jeton renvoyé par `removeRoad` (annulation neutre). */
  | { kind: 'buildRoad'; kindId: RoadKindId; points: number[]; c1?: [number, number]; c2?: [number, number]; elevation?: number; restoreToken?: number }
  | { kind: 'upgradeRoad'; edgeId: number; toKind: RoadKindId; reverse: boolean }
  /**
   * Tronçons d'id ≥ minEdgeId posés sur les rues du quadrillage (x0..x1, z0..z1, pas `block`). `lines` : morceaux
   * réellement construits ; un tronçon doit être posé sur l'un d'eux (une rue existante découpée n'est pas retirée).
   */
  | { kind: 'removeGrid'; minEdgeId: number; x0: number; z0: number; x1: number; z1: number; block: number; angle?: number; ox?: number; oz?: number; lines?: number[][] }
  /** Commande d'un module (ligne haute tension retirée, pôle retiré, réglage de carrefour rétabli…). */
  | { kind: 'plugin'; plugin: string; name: string; payload: Record<string, unknown> }
  /**
   * Éditions du terrain de rang ≥ `since` (geste pinceau, pente, barrage, source…) : la simulation restaure relief,
   * eau, forêt et murs d'avant et rembourse le coût (commande étendue `terrainUndo`).
   */
  | { kind: 'terrainUndo'; since: number };

export interface UndoEntry {
  label: string;
  steps: UndoStep[];
  /**
   * Action impossible à annuler (terrain, giratoire) : marque la pile pour que Ctrl+Z n'annule pas par erreur
   * l'action précédente ; le premier Ctrl+Z l'explique et retire la marque.
   */
  irreversible?: boolean;
}

export class UndoStack {
  private entries: UndoEntry[] = [];
  constructor(private readonly max = 50) {}

  push(e: UndoEntry): void {
    if (e.steps.length === 0 && !e.irreversible) return;
    // Deux marques consécutives : une seule suffit.
    if (e.irreversible && this.peek()?.irreversible) { this.entries[this.entries.length - 1] = e; return; }
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.shift();
  }

  pop(): UndoEntry | undefined { return this.entries.pop(); }
  peek(): UndoEntry | undefined { return this.entries[this.entries.length - 1]; }
  get size(): number { return this.entries.length; }
  clear(): void { this.entries.length = 0; }

  /** Après une démolition externe, retire les étapes qui visent un objet disparu. */
  forgetBuilding(id: number): void {
    // Construction ET déplacement du bâtiment disparu : plus rien à annuler pour lui.
    for (const e of this.entries) e.steps = e.steps.filter((s) => !((s.kind === 'demolish' || s.kind === 'moveBuilding') && s.buildingId === id));
    this.entries = this.entries.filter((e) => e.steps.length > 0 || e.irreversible);
  }

  forgetEdge(id: number): void {
    for (const e of this.entries) e.steps = e.steps.filter((s) => !((s.kind === 'removeRoad' || s.kind === 'upgradeRoad') && s.edgeId === id));
    this.entries = this.entries.filter((e) => e.steps.length > 0 || e.irreversible);
  }

  /** Un tronçon modifié (upgradeRoad) change d'identifiant : les étapes qui le visent suivent. */
  renameEdge(from: number, to: number): void {
    for (const e of this.entries) for (const s of e.steps) if ((s.kind === 'removeRoad' || s.kind === 'upgradeRoad') && s.edgeId === from) s.edgeId = to;
  }
}
