/**
 * Rendu du module « services » : cartes d'information drapées sur le terrain (criminalité, risque d'incendie, santé),
 * une seule à la fois, choisie dans le menu Calques. Les icônes (feu, ruine, criminalité élevée) sont dessinées par le
 * module « alertes ». Un seul maillage (couleurs de sommets, sans texture) reconstruit seulement quand la carte change.
 * Le rendu ne modifie jamais l'état du jeu. NOUVEAU fichier : aucun fichier cœur du rendu n'est modifié.
 */
import * as THREE from 'three';
import { SERVICES_NO_DATA, type ServicesDelta, type ServicesLayer, type ServicesLayerKind } from '../../shared/protocol-ext/services';
import type { RenderPlugin, RenderPluginContext } from './types';

/** Échelle 0..1 -> vert, jaune, rouge (couleurs saturées, lisibles de jour comme de nuit). */
function ramp(v: number, out: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, v));
  if (t < 0.5) return out.setRGB(0.12 + t * 1.66, 0.72, 0.12);
  return out.setRGB(0.95, 0.72 - (t - 0.5) * 1.34, 0.06);
}

/** Légende de chaque carte (libellés lus par l'interface). */
export const SERVICES_LEGEND: Record<ServicesLayerKind, { title: string; low: string; high: string }> = {
  crime: { title: 'Criminalité', low: 'faible', high: 'élevée' },
  fire: { title: 'Risque d’incendie', low: 'faible', high: 'élevé (sans caserne)' },
  health: { title: 'Santé des habitants', low: 'bonne', high: 'mauvaise' },
};

class ServicesOverlay {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private readonly mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  layer: ServicesLayer | null = null;
  kind: ServicesLayerKind | null = null;
  cellsShown = 0;

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'services-calque';
    this.group.visible = false;
    ctx.scene.add(this.group);
  }

  /** Valeur 0..1 (1 = problème) d'une cellule, ou -1 sans donnée. */
  private value(l: ServicesLayer, k: number): number {
    const kind = this.kind;
    if (l.state[k]! === 1 || l.state[k]! === 3) return 1; // en feu / ruine : toujours en rouge
    if (kind === 'crime') { const v = l.crime[k]!; return v === SERVICES_NO_DATA ? -1 : Math.min(1, v / 60); }
    if (kind === 'fire') { const v = l.fire[k]!; return v === SERVICES_NO_DATA ? -1 : Math.min(1, v / 75); }
    const v = l.health[k]!;
    return v === SERVICES_NO_DATA ? -1 : Math.min(1, Math.max(0, (90 - v) / 50));
  }

  show(kind: ServicesLayerKind | null): void {
    this.kind = kind;
    this.group.visible = !!kind;
    if (kind && this.layer) this.rebuild();
  }

  apply(l: ServicesLayer): void {
    this.layer = l;
    if (this.group.visible) this.rebuild();
  }

  private rebuild(): void {
    const l = this.layer;
    if (!l) return;
    const { cols, rows, cellSize, originX, originZ } = l;
    const nv = (cols + 1) * (rows + 1);
    let geo = this.mesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geo || geo.getAttribute('position').count !== nv) {
      geo?.dispose();
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 4), 4));
      const idx = new Uint32Array(cols * rows * 6);
      let p = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      if (!this.mesh) { this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.group.add(this.mesh); }
      else this.mesh.geometry = geo;
    }
    const pos = geo.getAttribute('position') as THREE.BufferAttribute, col = geo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    const cell = (i: number, j: number): number => (i < 0 || j < 0 || i >= cols || j >= rows ? -1 : this.value(l, j * cols + i));
    let shown = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      // Sommet : pire des quatre cellules voisines qui ont une donnée.
      const v = Math.max(cell(i - 1, j - 1), cell(i, j - 1), cell(i - 1, j), cell(i, j));
      const x = originX + i * cellSize, z = originZ + j * cellSize;
      const h = this.ctx.heightAt(x, z);
      const k = j * (cols + 1) + i;
      pos.setXYZ(k, x, (Number.isFinite(h) ? h : 0) + 1.5, z);
      ramp(Math.max(0, v), c);
      col.setXYZW(k, c.r, c.g, c.b, v >= 0 ? 0.35 + 0.5 * v : 0);
      if (v >= 0) shown++;
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.cellsShown = shown;
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.mesh?.geometry.dispose();
    this.mat.dispose();
  }
}

let overlay: ServicesOverlay | null = null;
let wanted: ServicesLayerKind | null = null;

/** Carte affichée (menu Calques) ; `layer` = données renvoyées par la commande `calque` (affichage immédiat). */
export function setServicesLayer(kind: ServicesLayerKind | null, layer?: ServicesLayer | null): void {
  wanted = kind;
  if (layer && overlay) overlay.layer = layer;
  overlay?.show(kind);
}
export const servicesLayerKind = (): ServicesLayerKind | null => wanted;

export function createServicesRenderPlugin(): RenderPlugin & { readonly cells: () => number } {
  const apply = (p: unknown): void => {
    const l = (p as ServicesDelta | undefined)?.layer;
    if (l && overlay) overlay.apply(l);
  };
  return {
    id: 'services',
    cells: () => overlay?.cellsShown ?? 0,
    init(ctx) {
      overlay = new ServicesOverlay(ctx);
      overlay.show(wanted);
      // Diagnostic e2e (lecture seule).
      (window as unknown as { __services?: unknown }).__services = { kind: () => wanted, cells: () => overlay?.cellsShown ?? 0, visible: () => overlay?.group.visible ?? false };
    },
    applySnapshotExt(p) { apply(p); },
    applyDeltaExt(p) { apply(p); },
    dispose() { overlay?.dispose(); overlay = null; },
  };
}

export const servicesRenderPlugin = createServicesRenderPlugin();
