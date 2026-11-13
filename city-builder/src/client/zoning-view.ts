/**
 * Zonage — état côté navigateur, partagé par le rendu (superposition) et l'interface (outil, jauges).
 * Alimenté par `snapshot.ext.zonage` / `delta.ext.zonage` (module de rendu) et par la commande `state`
 * (panneau, pour la jauge quand aucune zone n'existe encore). Aucun import de three ni du DOM.
 */
import {
  rleDecode, ZONE_DEPTH_DEFAULT,
  type ZonageDelta, type ZonageDemand, type ZonageDemandInputs, type ZonageSettings, type ZonageStats, type ZoneGridInfo, type ZoneType,
} from '../shared/protocol-ext/zonage';

export type ZoningChange = { kind: 'all' } | { kind: 'cells'; cells: number[] } | { kind: 'info' } | { kind: 'tool' } | { kind: 'cursor' };

export class ZoningView {
  grid: ZoneGridInfo | null = null;
  /** Codes transmis (zone | CELL_CONNECTED) par case. */
  codes: Uint8Array = new Uint8Array(0);
  demand: ZonageDemand | null = null;
  inputs: ZonageDemandInputs | null = null;
  stats: ZonageStats | null = null;
  settings: ZonageSettings | null = null;
  /** Outil Zones ouvert : la superposition n'est visible que dans ce cas. */
  toolActive = false;
  /** Zone peinte (null = retirer le zonage) et profondeur de bande (cases). */
  brush: ZoneType | null = 'res_faible';
  depth = ZONE_DEPTH_DEFAULT;
  /** Pinceau sous le pointeur (cercle au sol), null = masqué. */
  cursor: { x: number; z: number; r: number } | null = null;
  private readonly listeners = new Set<(c: ZoningChange) => void>();

  on(fn: (c: ZoningChange) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(c: ZoningChange): void { for (const fn of this.listeners) { try { fn(c); } catch (e) { console.error('[zonage] écouteur :', e); } } }

  /** Instantané (ou absence de module : tout est vidé). */
  reset(p: ZonageDelta | undefined): void {
    this.grid = null;
    this.codes = new Uint8Array(0);
    this.stats = null;
    if (p?.grid && p.rle) {
      this.grid = { ...p.grid };
      try { this.codes = rleDecode(p.rle, new Uint8Array(p.grid.w * p.grid.h)); } catch (e) { console.error('[zonage] grille illisible :', e); this.codes = new Uint8Array(p.grid.w * p.grid.h); }
    }
    if (p) this.mergeInfo(p);
    else { this.demand = null; this.inputs = null; this.settings = null; }
    this.emit({ kind: 'all' });
  }

  merge(p: ZonageDelta): void {
    if (p.grid && p.rle) { this.reset(p); return; }
    if (p.cells && this.grid) {
      const c = p.cells;
      for (let k = 0; k + 1 < c.length; k += 2) if (c[k]! >= 0 && c[k]! < this.codes.length) this.codes[c[k]!] = c[k + 1]!;
      this.emit({ kind: 'cells', cells: c });
    }
    if (this.mergeInfo(p)) this.emit({ kind: 'info' });
  }

  private mergeInfo(p: ZonageDelta): boolean {
    let any = false;
    if (p.demand) { this.demand = { ...p.demand }; any = true; }
    if (p.inputs) { this.inputs = p.inputs; any = true; }
    if (p.stats) { this.stats = p.stats; any = true; }
    if (p.settings) { this.settings = { ...p.settings }; any = true; }
    return any;
  }

  setCursor(c: { x: number; z: number; r: number } | null): void {
    this.cursor = c;
    this.emit({ kind: 'cursor' });
  }

  setToolActive(on: boolean): void {
    if (this.toolActive === on) return;
    this.toolActive = on;
    this.emit({ kind: 'tool' });
  }
}

/** Instance unique (une partie à la fois dans le navigateur). */
export const zoningView = new ZoningView();
