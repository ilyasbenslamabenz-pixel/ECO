/**
 * Texture du champ de trames du quadrillage (src/shared/grid-field.ts) autour du curseur : 256 × 256 texels de 2 m
 * (512 m de côté, plus que la zone visible du quadrillage, 220 m autour du curseur). Calcul étalé sur plusieurs images
 * (budget de quelques millisecondes par image) dans un tampon de réserve ; la texture affichée n'est remplacée qu'une
 * fois le nouveau champ complet (jamais de quadrillage à moitié faux). Recalcul quand le curseur s'éloigne du centre
 * ou quand les routes / bâtiments changent.
 */
import * as THREE from 'three';
import type { GridField } from '../../shared/grid-field';

const N = 256;
const TEXEL = 2;
const SIZE = N * TEXEL;
/** Recentrage quand le curseur s'éloigne de plus de cette distance (m) du centre. */
const RECENTER = 40;

export class GridFieldTexture {
  readonly texture: THREE.DataTexture;
  private front = new Float32Array(N * N * 4);
  private back = new Float32Array(N * N * 4);
  /** Boîte affichée (null : rien encore). */
  box: { x0: number; z0: number; size: number } | null = null;
  private job: { field: GridField; x0: number; z0: number; row: number; key: string } | null = null;
  private key = '';

  constructor() {
    this.texture = new THREE.DataTexture(this.front, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.flipY = false;
  }

  /**
   * Avance le calcul pour le champ `field` (identifié par `version`) centré près de (cx, cz) ; vrai quand la texture
   * affichée vient de changer. `budgetMs` : temps maximal de calcul pour cette image.
   */
  update(field: GridField, version: number, cx: number, cz: number, budgetMs = 4): boolean {
    const b = this.box;
    const far = !b || Math.abs(cx - (b.x0 + SIZE / 2)) > RECENTER || Math.abs(cz - (b.z0 + SIZE / 2)) > RECENTER;
    const wantKey = `${version}`;
    if (!this.job && (far || this.key !== wantKey)) {
      const x0 = far || !b ? Math.round((cx - SIZE / 2) / TEXEL) * TEXEL : b.x0;
      const z0 = far || !b ? Math.round((cz - SIZE / 2) / TEXEL) * TEXEL : b.z0;
      this.job = { field, x0, z0, row: 0, key: wantKey };
    }
    // Si le monde change pendant un calcul, celui-ci se termine (le suivant repart avec le nouveau champ) : une ville
    // qui pousse sans cesse ne bloque jamais l'affichage.
    const j = this.job;
    if (!j) return false;
    const t0 = performance.now();
    // Premier calcul (rien d'affiché) : budget plus large, le quadrillage n'attend pas plusieurs images.
    const budget = this.box ? budgetMs : Math.max(budgetMs, 40);
    while (j.row < N && performance.now() - t0 < budget) {
      const r1 = Math.min(N, j.row + 8);
      j.field.fill(this.back, j.x0, j.z0, N, TEXEL, j.row, r1);
      j.row = r1;
    }
    if (j.row < N) return false;
    [this.front, this.back] = [this.back, this.front];
    this.texture.image.data = this.front;
    this.texture.needsUpdate = true;
    this.box = { x0: j.x0, z0: j.z0, size: SIZE };
    this.key = j.key;
    this.job = null;
    return true;
  }

  dispose(): void { this.texture.dispose(); }
}
