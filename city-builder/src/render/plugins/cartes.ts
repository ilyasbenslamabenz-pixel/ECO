/**
 * Rendu du module « cartes » (vague 5) : cartes d'information nouvelles (valeur foncière, pollution, bruit, chômage,
 * éducation, satisfaction, écoles, déchets) drapées sur le terrain, une seule à la fois, choisie dans le menu Cartes.
 * Même principe que les cartes des services : UN maillage (couleurs de sommets, sans texture) reconstruit seulement
 * quand la carte change (au plus une fois par jour de jeu), rien à chaque image. Le rendu ne modifie jamais l'état
 * du jeu. NOUVEAU fichier : aucun fichier cœur du rendu n'est modifié.
 */
import * as THREE from 'three';
import { CARTE_NO_DATA, CARTE_PALETTE, type CarteKind, type CarteLayer, type CartesDelta, type CartePalette } from '../../shared/protocol-ext/cartes';
import type { RenderPlugin, RenderPluginContext } from './types';

/** Couleur d'une valeur 0..1 selon la palette (couleurs saturées, lisibles de jour comme de nuit). */
export function carteColor(palette: CartePalette, v: number, out: { r: number; g: number; b: number }): void {
  const t = Math.min(1, Math.max(0, v));
  if (palette === 'risque') {
    if (t < 0.5) { out.r = 0.12 + t * 1.66; out.g = 0.72; out.b = 0.12; } else { out.r = 0.95; out.g = 0.72 - (t - 0.5) * 1.34; out.b = 0.06; }
    return;
  }
  // Valeur : bleu profond → cyan → jaune.
  if (t < 0.5) { const k = t * 2; out.r = 0.10; out.g = 0.25 + 0.55 * k; out.b = 0.85 - 0.05 * k; } else { const k = (t - 0.5) * 2; out.r = 0.10 + 0.88 * k; out.g = 0.80 + 0.1 * k; out.b = 0.80 - 0.68 * k; }
}

/** Dégradé CSS de la légende (mêmes couleurs que le rendu). */
export function carteGradientCss(palette: CartePalette): string {
  const c = { r: 0, g: 0, b: 0 };
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { carteColor(palette, t, c); return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}) ${t * 100}%`; });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

class CarteOverlay {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private readonly mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  layer: CarteLayer | null = null;
  kind: CarteKind | null = null;
  cellsShown = 0;
  rebuilds = 0;

  constructor(private readonly ctx: RenderPluginContext) {
    this.group.name = 'cartes-calque';
    this.group.visible = false;
    ctx.scene.add(this.group);
  }

  show(kind: CarteKind | null): void {
    this.kind = kind;
    if (this.layer && this.layer.kind !== kind) this.layer = null;
    this.group.visible = !!kind && !!this.layer;
    if (kind && this.layer) this.rebuild();
  }

  apply(l: CarteLayer): void {
    if (l.kind !== this.kind) return;
    this.layer = l;
    this.group.visible = true;
    this.rebuild();
  }

  private rebuild(): void {
    const l = this.layer;
    if (!l) return;
    this.rebuilds++;
    const { cols, rows, cellSize, originX, originZ, values } = l;
    const palette = CARTE_PALETTE[l.kind];
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
    const c = { r: 0, g: 0, b: 0 };
    const avg = palette === 'valeur';
    const cell = (i: number, j: number): number => {
      if (i < 0 || j < 0 || i >= cols || j >= rows) return -1;
      const v = values[j * cols + i]!;
      return v === CARTE_NO_DATA ? -1 : v / 100;
    };
    let shown = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      // Sommet : pire des quatre cellules voisines (cartes de problèmes) ou leur moyenne (valeur foncière).
      const a = cell(i - 1, j - 1), b = cell(i, j - 1), d = cell(i - 1, j), e = cell(i, j);
      let v = -1;
      if (avg) { let s = 0, n = 0; for (const x of [a, b, d, e]) if (x >= 0) { s += x; n++; } v = n ? s / n : -1; } else v = Math.max(a, b, d, e);
      const x = originX + i * cellSize, z = originZ + j * cellSize;
      const h = this.ctx.heightAt(x, z);
      const k = j * (cols + 1) + i;
      pos.setXYZ(k, x, (Number.isFinite(h) ? h : 0) + 1.5, z);
      carteColor(palette, Math.max(0, v), c);
      col.setXYZW(k, c.r, c.g, c.b, v >= 0 ? (avg ? 0.7 : 0.35 + 0.5 * v) : 0);
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

let overlay: CarteOverlay | null = null;
let wanted: CarteKind | null = null;
let lastLayer: CarteLayer | null = null;
const listeners = new Set<(l: CarteLayer | null) => void>();

/** Carte affichée (menu Cartes) ; `layer` = grille renvoyée par la commande `calque` (affichage immédiat). */
export function setCartesLayer(kind: CarteKind | null, layer?: CarteLayer | null): void {
  wanted = kind;
  if (!kind) lastLayer = null;
  overlay?.show(kind);
  if (layer && layer.kind === kind) { lastLayer = layer; overlay?.apply(layer); for (const f of listeners) f(layer); }
}
export const cartesLayerKind = (): CarteKind | null => wanted;
/** Dernière grille reçue pour la carte affichée (résumé de la légende). */
export const cartesLastLayer = (): CarteLayer | null => lastLayer;
/** Abonnement aux nouvelles grilles (légende du menu Cartes). */
export function onCartesLayer(f: (l: CarteLayer | null) => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

export function createCartesRenderPlugin(): RenderPlugin {
  const apply = (p: unknown): void => {
    const l = (p as CartesDelta | undefined)?.layer;
    if (!l || l.kind !== wanted) return;
    lastLayer = l;
    overlay?.apply(l);
    for (const f of listeners) f(l);
  };
  return {
    id: 'cartes',
    init(ctx) {
      overlay = new CarteOverlay(ctx);
      overlay.show(wanted);
      if (lastLayer) overlay.apply(lastLayer);
      // Diagnostic e2e (lecture seule).
      (window as unknown as { __cartes?: unknown }).__cartes = { kind: () => wanted, cells: () => overlay?.cellsShown ?? 0, visible: () => overlay?.group.visible ?? false, rebuilds: () => overlay?.rebuilds ?? 0, layer: () => lastLayer };
    },
    applySnapshotExt(p) { apply(p); },
    applyDeltaExt(p) { apply(p); },
    dispose() { overlay?.dispose(); overlay = null; },
  };
}

export const cartesRenderPlugin = createCartesRenderPlugin();
