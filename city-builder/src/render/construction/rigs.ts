/**
 * Engins articulés du chantier (rendu) — propriété p2a-chantiers.
 *
 * Ces objets ont des pièces MOBILES : ils ne passent donc pas par les pools d'instances mais par de
 * petits graphes de scène, créés seulement pour les chantiers proches de la caméra (les autres gardent
 * leurs pièces fixes, instanciées). Mouvements : orientation de la grue, va-et-vient du chariot,
 * montée et descente de la moufle (câble étiré), rotation de la tourelle de la pelle et du tambour de
 * la toupie. Tous les mouvements sont lents, déterministes (graine par chantier) et suspendus hors des
 * heures de travail.
 */
import * as THREE from 'three';
import type { ConstructionAssets } from './assets';

/** Petit générateur déterministe [0,1) à partir d'un entier. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Construit un groupe à partir des parties d'un modèle (une Mesh par matériau). */
function meshesOf(assets: ConstructionAssets, id: string, lod: number, castShadow = true): THREE.Group | null {
  const parts = assets.partsOf(id, lod);
  if (!parts || parts.length === 0) return null;
  const g = new THREE.Group();
  g.name = `chantier_${id}`;
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = castShadow && p.role !== 'filet';
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** Grue à tour animée : tête orientable, chariot, moufle et câble. */
export class CraneRig {
  readonly group = new THREE.Group();
  private head: THREE.Group | null = null;
  private trolley: THREE.Group | null = null;
  private hook: THREE.Group | null = null;
  private cable: THREE.Mesh | null = null;
  private lod = -1;
  /** Portée utile de la flèche (m). */
  private jibStart = 1.2;
  private jibLength = 34;
  private railY = 0.82;
  /** État de l'animation. */
  private angle = 0;
  private angleTarget = 0;
  private trolleyPos = 0.5;
  private trolleyTarget = 0.5;
  private hookDrop = 6;
  private hookTarget = 6;
  private phase = 0;

  constructor(private readonly assets: ConstructionAssets, private readonly seed: number) {
    this.group.name = 'grue';
    this.jibStart = this.assets.pivotArray('teteFleche', [1.2, 34])[0] ?? 1.2;
    this.jibLength = this.assets.pivotArray('teteFleche', [1.2, 34])[1] ?? 34;
    this.railY = this.assets.pivot('teteRailY', 0.82);
    this.angle = hash01(seed) * Math.PI * 2;
    this.angleTarget = this.angle;
    this.phase = hash01(seed * 7 + 3);
  }

  /** (Re)construit les pièces au LOD voulu. Renvoie faux tant que les modèles ne sont pas chargés. */
  build(lod: number): boolean {
    if (lod === this.lod && this.head) return true;
    const head = meshesOf(this.assets, 'grue_tete', lod);
    if (!head) return false;
    this.group.clear();
    this.lod = lod;
    this.head = head;
    this.group.add(head);
    this.trolley = meshesOf(this.assets, 'grue_chariot', lod);
    this.hook = meshesOf(this.assets, 'grue_crochet', lod);
    if (this.trolley) head.add(this.trolley);
    if (this.hook) head.add(this.hook);
    const mat = this.assets.sharedMaterial('acier_sombre');
    const geo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true);
    geo.translate(0, -0.5, 0); // origine en haut : l'échelle Y donne la longueur du câble
    this.cable = new THREE.Mesh(geo, mat);
    this.cable.castShadow = false;
    head.add(this.cable);
    return true;
  }

  /** Hauteur du crochet au-dessus du sol du chantier (m), pour poser une charge. */
  get hookHeight(): number { return this.group.position.y + this.railY - this.hookDrop; }

  /**
   * Avance l'animation. `dt` en secondes, `working` faux la nuit (tout s'immobilise),
   * `reach` = distance utile maximale du crochet (rayon du bâtiment + marge).
   */
  update(dt: number, working: boolean, reach: number, topY: number): void {
    const head = this.head;
    if (!head) return;
    if (working) {
      this.phase += dt * 0.055;
      if (this.phase >= 1) {
        this.phase -= 1;
        const k = Math.floor(this.phase * 1000) + this.seed;
        this.angleTarget = hash01(k) * Math.PI * 2;
        this.trolleyTarget = 0.3 + 0.65 * hash01(k * 3 + 1);
        this.hookTarget = 2 + hash01(k * 5 + 2) * Math.max(4, this.group.position.y - topY + 10);
      }
      // Rotation lente vers la cible (chemin le plus court).
      let da = this.angleTarget - this.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.angle += Math.max(-dt * 0.12, Math.min(dt * 0.12, da));
      this.trolleyPos += Math.max(-dt * 0.05, Math.min(dt * 0.05, this.trolleyTarget - this.trolleyPos));
      this.hookDrop += Math.max(-dt * 1.6, Math.min(dt * 1.6, this.hookTarget - this.hookDrop));
    }
    head.rotation.y = this.angle;
    const zMax = this.jibStart + this.jibLength * 0.95;
    const z = Math.min(zMax, Math.max(this.jibStart + 3, reach * this.trolleyPos + 6));
    if (this.trolley) this.trolley.position.set(0, this.railY, z);
    const drop = Math.max(1, this.hookDrop);
    if (this.hook) this.hook.position.set(0, this.railY - drop, z);
    if (this.cable) {
      this.cable.position.set(0, this.railY - 0.5, z);
      this.cable.scale.set(1, Math.max(0.2, drop - 0.5), 1);
    }
  }

  dispose(): void {
    this.cable?.geometry.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}

/** Engin à pièce tournante : pelle (tourelle) ou toupie (tambour). */
export class RotorRig {
  readonly group = new THREE.Group();
  private rotor: THREE.Group | null = null;
  private lod = -1;
  private angle = 0;
  private target = 0;
  private phase = 0;

  /**
   * @param rotorId modèle de la pièce tournante
   * @param axis 'y' (tourelle de pelle) ou 'z' (tambour de toupie)
   * @param offset position locale du pivot
   */
  constructor(
    private readonly assets: ConstructionAssets, private readonly rotorId: string,
    private readonly axis: 'y' | 'z', private readonly offset: readonly number[], private readonly seed: number,
  ) {
    this.group.name = `engin_${rotorId}`;
    this.angle = hash01(seed) * Math.PI * 2;
    this.target = this.angle;
    this.phase = hash01(seed * 13 + 5);
  }

  build(lod: number): boolean {
    if (lod === this.lod && this.rotor) return true;
    const rotor = meshesOf(this.assets, this.rotorId, lod);
    if (!rotor) return false;
    this.group.clear();
    this.lod = lod;
    this.rotor = rotor;
    rotor.position.set(this.offset[0] ?? 0, this.offset[1] ?? 0, this.offset[2] ?? 0);
    if (this.axis === 'z') rotor.rotation.x = -0.26; // tambour incliné
    this.group.add(rotor);
    return true;
  }

  update(dt: number, working: boolean): void {
    const rotor = this.rotor;
    if (!rotor) return;
    if (working) {
      if (this.axis === 'z') {
        this.angle += dt * 1.4;
      } else {
        this.phase += dt * 0.11;
        if (this.phase >= 1) {
          this.phase -= 1;
          this.target = (hash01(Math.floor(this.angle * 97) + this.seed) - 0.5) * 2.4;
        }
        this.angle += Math.max(-dt * 0.5, Math.min(dt * 0.5, this.target - this.angle));
      }
    }
    if (this.axis === 'z') rotor.rotation.z = this.angle;
    else rotor.rotation.y = this.angle;
  }

  dispose(): void {
    this.group.clear();
    this.group.removeFromParent();
  }
}
