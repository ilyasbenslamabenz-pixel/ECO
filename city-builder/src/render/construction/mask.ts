/**
 * Masquage des bâtiments en chantier dans le rendu de BASE (repli) — propriété p2a-chantiers.
 *
 * La simulation envoie le bâtiment dès sa pose : le rendu de base (`InstancedBuildingRenderer`) l'affiche
 * donc achevé alors que le chantier commence à peine. La solution propre est une API de visibilité
 * exposée par le rendu de base aux modules (demande n° 1bis de docs/requests/chantiers.md). Tant qu'elle
 * n'existe pas, ce repli neutralise l'instance du bâtiment SANS modifier aucun fichier du rendu de base :
 * il parcourt le groupe « batiments » de la scène et met à zéro la partie linéaire des matrices
 * d'instance des bâtiments masqués (triangles d'aire nulle, donc invisibles, ombres comprises).
 *
 * Précautions : exécuté après `buildings.update()` (le module de rendu est appelé en dernier dans la
 * boucle d'image), il réécrit son masque à chaque image ; si le groupe, les noms de lots ou la
 * disposition changent, le repli ne fait simplement plus rien (le bâtiment redevient visible) — aucune
 * exception, aucune casse. Il est automatiquement désactivé si le rendu de base publie l'API.
 */
import * as THREE from 'three';

/** API de visibilité éventuellement fournie par le rendu de base (cf. demande). */
export interface BuildingVisibilityApi {
  setBuildingsVisible(ids: readonly number[], visible: boolean): void;
}

interface Saved { mesh: THREE.InstancedMesh; index: number; linear: number[] }
interface Hidden { prefix: string; x: number; y: number; z: number; saved: Saved[] }
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;

export class BuildingMask {
  private readonly hidden = new Map<number, Hidden>();
  /** Instances à rétablir (le rendu de base ne réécrit pas une matrice qu'il croit à jour). */
  private restores: (Saved & { x: number; y: number; z: number })[] = [];
  private group: THREE.Object3D | null = null;
  private searched = false;
  /** Instances neutralisées à la dernière image (diagnostic e2e). */
  masked = 0;
  /** Vrai si le groupe des bâtiments a été trouvé. */
  get attached(): boolean { return this.group !== null; }

  constructor(private readonly scene: THREE.Object3D, private readonly api: BuildingVisibilityApi | null = null) {}

  get usingApi(): boolean { return this.api !== null; }

  /** Déclare qu'un bâtiment doit être masqué (chantier en cours). */
  hide(buildingId: number, assetId: string, variant: number, x: number, y: number, z: number): void {
    if (this.api) { this.api.setBuildingsVisible([buildingId], false); return; }
    if (this.hidden.has(buildingId)) return;
    const v = variant >= 0 ? variant : 0;
    this.hidden.set(buildingId, { prefix: `${assetId}#${v}_lod`, x, y, z, saved: [] });
  }

  /** Le bâtiment redevient visible (chantier achevé ou abandonné). */
  show(buildingId: number): void {
    if (this.api) { this.api.setBuildingsVisible([buildingId], true); return; }
    const h = this.hidden.get(buildingId);
    if (!h) return;
    for (const sv of h.saved) this.restores.push({ ...sv, x: h.x, y: h.y, z: h.z });
    this.hidden.delete(buildingId);
  }

  clear(): void {
    if (this.api && this.hidden.size > 0) this.api.setBuildingsVisible([...this.hidden.keys()], true);
    for (const id of [...this.hidden.keys()]) this.show(id);
    this.restoreAll();
    this.hidden.clear();
    this.masked = 0;
  }

  /** Applique le masque (appelé à chaque image, après la mise à jour du rendu des bâtiments). */
  apply(): void {
    this.masked = 0;
    this.restoreAll();
    if (this.api || this.hidden.size === 0) return;
    if (!this.searched) { this.group = this.scene.getObjectByName('batiments') ?? null; this.searched = true; }
    const group = this.group;
    if (!group) return;
    for (const child of group.children) {
      const mesh = child as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.count === 0 || !mesh.visible) continue;
      let targets: Hidden[] | null = null;
      for (const h of this.hidden.values()) {
        if (!mesh.name.startsWith(h.prefix)) continue;
        (targets ??= []).push(h);
      }
      if (!targets) continue;
      const arr = mesh.instanceMatrix.array as Float32Array;
      let changed = false;
      for (let i = 0; i < mesh.count; i++) {
        const o = i * 16;
        const x = arr[o + 12]!, y = arr[o + 13]!, z = arr[o + 14]!;
        for (const h of targets) {
          if (Math.abs(x - h.x) > 0.05 || Math.abs(z - h.z) > 0.05 || Math.abs(y - h.y) > 0.2) continue;
          if (arr[o] === 0 && arr[o + 5] === 0 && arr[o + 10] === 0) { this.masked++; break; }
          // Partie linéaire conservée pour la restituer à l'achèvement (rotation + échelle de l'instance).
          h.saved = h.saved.filter((sv) => sv.mesh !== mesh || sv.index !== i);
          h.saved.push({ mesh, index: i, linear: LINEAR.map((k) => arr[o + k]!) });
          for (const k of LINEAR) arr[o + k] = 0;
          changed = true;
          this.masked++;
          break;
        }
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Rétablit les instances des bâtiments redevenus visibles, si l'emplacement n'a pas été réattribué. */
  private restoreAll(): void {
    if (this.restores.length === 0) return;
    for (const r of this.restores) {
      const arr = r.mesh.instanceMatrix.array as Float32Array;
      const o = r.index * 16;
      if (o + 15 >= arr.length) continue;
      if (Math.abs(arr[o + 12]! - r.x) > 0.05 || Math.abs(arr[o + 14]! - r.z) > 0.05 || Math.abs(arr[o + 13]! - r.y) > 0.2) continue;
      if (!(arr[o] === 0 && arr[o + 5] === 0 && arr[o + 10] === 0)) continue;
      LINEAR.forEach((k, j) => { arr[o + k] = r.linear[j]!; });
      r.mesh.instanceMatrix.needsUpdate = true;
    }
    this.restores = [];
  }
}
