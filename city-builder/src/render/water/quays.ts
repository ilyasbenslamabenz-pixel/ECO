/**
 * Murs de quai (éditions du joueur : Quai / remblai, Creuser) : un seul maillage fusionné, reconstruit quand la
 * liste change (instantané, ou patch du delta qui porte `quays`).
 *
 * Chaque mur (src/sim/terrain/edits.ts, QUAY_STRIDE nombres) est posé exactement sur la ligne tracée :
 *  - parement vertical en pierre, du pied (sous l'eau) jusqu'au dessus du quai, avancé de FRONT m dans l'eau ;
 *  - plateforme pavée de DECK m côté terre (elle recouvre la bande de 1,5 case que la carte de hauteurs ne peut
 *    pas rendre verticale) avec une margelle claire au bord de l'eau, jupe arrière et joues aux extrémités.
 * Couleurs de sommets + MeshStandardMaterial : ni texture, ni canevas, ni contexte WebGL supplémentaire ;
 * mémoire GPU stable (un seul tampon, libéré à chaque reconstruction).
 */
import * as THREE from 'three';

/** Nombres par mur (miroir de QUAY_STRIDE de la simulation). */
const STRIDE = 8;
/** Avancée du parement dans l'eau (m) et profondeur de la plateforme côté terre (m). */
export const QUAY_FRONT = 2.8;
export const QUAY_DECK = 12.5;
/** Plateforme au-dessus du dessus du quai simulé (m) : légèrement en saillie, sous la chaussée d'une route posée dessus. */
const DECK_LIFT = 0.03;

const C_FACE = new THREE.Color(0x8d8578);
const C_FACE_LOW = new THREE.Color(0x4d4a43);
const C_DECK = new THREE.Color(0xa59d8f);
const C_COPING = new THREE.Color(0xd2cbbd);

export class QuayRenderer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private readonly material = new THREE.MeshStandardMaterial({
    name: 'quai', vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
    // Devant le terrain coplanaire (pas de scintillement) ; les marquages routiers (décalage -2) restent devant.
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  private walls: number[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'quais';
    scene.add(this.group);
  }

  /** Nombre de murs affichés. */
  get count(): number { return this.walls.length / STRIDE; }

  /** Liste des murs (copie) : diagnostic et tests. */
  list(): number[] { return this.walls.slice(); }

  /** Remplace tous les murs (liste à plat). */
  set(walls: readonly number[] | undefined): void {
    const next = walls ? Array.from(walls) : [];
    if (next.length === this.walls.length && next.every((v, i) => v === this.walls[i])) return;
    this.walls = next;
    this.rebuild();
  }

  private rebuild(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    const n = Math.floor(this.walls.length / STRIDE);
    if (n === 0) return;
    const pos: number[] = [];
    const col: number[] = [];
    const nrm: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], ca: THREE.Color, cb: THREE.Color, normal: number[]): void => {
      // a-b en bas, d-c en haut ; deux triangles (a, b, c) (a, c, d).
      const verts: [number[], THREE.Color][] = [[a, ca], [b, ca], [c, cb], [a, ca], [c, cb], [d, cb]];
      for (const [p, k] of verts) {
        pos.push(p[0]!, p[1]!, p[2]!);
        col.push(k.r, k.g, k.b);
        nrm.push(normal[0]!, normal[1]!, normal[2]!);
      }
    };
    for (let w = 0; w < n; w++) {
      const o = w * STRIDE;
      const ax = this.walls[o]!, az = this.walls[o + 1]!, bx = this.walls[o + 2]!, bz = this.walls[o + 3]!;
      const top = this.walls[o + 4]! + DECK_LIFT, bottom = this.walls[o + 5]!;
      const nx = this.walls[o + 6]!, nz = this.walls[o + 7]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const F = QUAY_FRONT, D = QUAY_DECK, cope = 0.7;
      // Coins : f = front (eau), k = arrière (terre).
      const fA = [ax + nx * F, az + nz * F], fB = [bx + nx * F, bz + nz * F];
      const cA = [ax + nx * (F - cope), az + nz * (F - cope)], cB = [bx + nx * (F - cope), bz + nz * (F - cope)];
      const kA = [ax - nx * D, az - nz * D], kB = [bx - nx * D, bz - nz * D];
      const P = (xz: number[], y: number): number[] => [xz[0]!, y, xz[1]!];
      // Parement (normale vers l'eau) : orienté pour être vu depuis l'eau (a -> b vu de face).
      const faceA = P(fA, bottom), faceB = P(fB, bottom);
      if (tx * nz - tz * nx > 0) quad(faceA, faceB, P(fB, top), P(fA, top), C_FACE_LOW, C_FACE, [nx, 0, nz]);
      else quad(faceB, faceA, P(fA, top), P(fB, top), C_FACE_LOW, C_FACE, [nx, 0, nz]);
      // Margelle (bande claire au bord de l'eau) puis plateforme.
      const up = [0, 1, 0];
      const flat = (p0: number[], p1: number[], p2: number[], p3: number[], c: THREE.Color): void => {
        // p0-p1 côté eau, p3-p2 côté terre ; sens tel que la normale pointe vers le haut.
        const ux = p1[0]! - p0[0]!, uz = p1[1]! - p0[1]!, vx = p3[0]! - p0[0]!, vz = p3[1]! - p0[1]!;
        const ccw = uz * vx - ux * vz > 0;
        if (ccw) quad(P(p0, top), P(p1, top), P(p2, top), P(p3, top), c, c, up);
        else quad(P(p1, top), P(p0, top), P(p3, top), P(p2, top), c, c, up);
      };
      flat(fA, fB, cB, cA, C_COPING);
      flat(cA, cB, kB, kA, C_DECK);
      // Jupe arrière (masque l'écart avec le terrain derrière la plateforme).
      const skirt = top - 1.6;
      if (tx * -nz - tz * -nx > 0) quad(P(kA, skirt), P(kB, skirt), P(kB, top), P(kA, top), C_FACE_LOW, C_DECK, [-nx, 0, -nz]);
      else quad(P(kB, skirt), P(kA, skirt), P(kA, top), P(kB, top), C_FACE_LOW, C_DECK, [-nx, 0, -nz]);
      // Joues aux extrémités (du pied au dessus, de l'avant à l'arrière).
      quad(P(kA, bottom), P(fA, bottom), P(fA, top), P(kA, top), C_FACE_LOW, C_FACE, [-tx, 0, -tz]);
      quad(P(fB, bottom), P(kB, bottom), P(kB, top), P(fB, top), C_FACE_LOW, C_FACE, [tx, 0, tz]);
    }
    if (pos.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'quais_murs';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  dispose(): void {
    if (this.mesh) this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
