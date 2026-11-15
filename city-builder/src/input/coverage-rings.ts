/**
 * Rayon d'action des services pendant la pose d'un bâtiment de service (école, hôpital, police, pompiers, parcs…) :
 * cercle du nouveau bâtiment (couleur vive) et cercles des bâtiments du MÊME service déjà construits (atténués),
 * pour placer le nouveau là où la ville n'est pas encore couverte. Rayon lu dans le catalogue (`rayon:<m>`,
 * 800 m par défaut, comme la simulation : src/sim/demography.ts). Installations électriques (centrales, poste) :
 * rayon de distribution locale réel de la simulation (FACILITY_SPECS, src/shared/power/model.ts).
 */
import * as THREE from 'three';
import type { CatalogAsset } from '../shared/catalog';
import { FACILITY_SPECS, facilityKindOf } from '../shared/power/model';
import { buildGroundRibbon, type HeightFn } from './previews';

/** Service couvert par un modèle (premier tag `service:*`) ; null si ce n'est pas un équipement de service. */
export function serviceOf(a: Pick<CatalogAsset, 'tags'> | undefined): string | null {
  return a?.tags.find((t) => t.startsWith('service:')) ?? null;
}

/** Rayon d'action (m) d'un équipement de service. */
export function serviceRadius(a: Pick<CatalogAsset, 'tags'>): number {
  // Électricité : la simulation raccorde les bâtiments dans le rayon de distribution de l'installation
  // (src/sim/power/system.ts), pas dans le rayon générique des services.
  const pk = facilityKindOf(a);
  if (pk) return FACILITY_SPECS[pk].radius;
  const t = a.tags.find((x) => x.startsWith('rayon:'));
  const v = t ? Number(t.slice(6)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 800;
}

const MAX_OTHERS = 40;

export class CoverageRings {
  private readonly group = new THREE.Group();
  private readonly main: THREE.Mesh;
  private readonly fill: THREE.Mesh;
  private readonly others: THREE.Mesh[] = [];
  private readonly otherMat = new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private key = '';
  private mainKey = '';

  constructor(scene: THREE.Scene, private readonly heightAt: HeightFn) {
    this.group.name = 'rayons-services';
    this.group.renderOrder = 9;
    this.main = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x4fd18b, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    // Disque très léger : la zone couverte se voit d'un coup d'œil.
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4fd18b, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false }));
    this.main.renderOrder = 9; this.fill.renderOrder = 8;
    this.group.add(this.fill, this.main);
    this.group.visible = false;
    scene.add(this.group);
  }

  private ring(geo: THREE.BufferGeometry, x: number, z: number, r: number, width: number): void {
    const pts: number[] = [];
    const n = Math.max(32, Math.min(128, Math.round(r / 12)));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(x + Math.cos(a) * r, z + Math.sin(a) * r); }
    buildGroundRibbon(geo, pts, width, this.heightAt, 0.6, Math.max(6, r / 40), true);
  }

  /** Cercle du bâtiment en cours de pose et cercles des équipements du même service (`others` : x, z, r). */
  show(x: number, z: number, r: number, others: readonly { x: number; z: number; r: number }[], othersKey: string): void {
    this.group.visible = true;
    const mk = `${Math.round(x)},${Math.round(z)},${r}`;
    if (mk !== this.mainKey) {
      this.mainKey = mk;
      this.ring(this.main.geometry, x, z, r, Math.max(2.5, r / 110));
      this.fill.position.set(x, this.heightAt(x, z) + 1, z);
      this.fill.scale.setScalar(r);
    }
    if (othersKey === this.key) return;
    this.key = othersKey;
    const list = others.slice(0, MAX_OTHERS);
    while (this.others.length < list.length) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.otherMat);
      m.renderOrder = 9;
      this.others.push(m);
      this.group.add(m);
    }
    this.others.forEach((m, i) => {
      const o = list[i];
      m.visible = !!o;
      if (o) this.ring(m.geometry, o.x, o.z, o.r, Math.max(1.6, o.r / 180));
    });
  }

  hide(): void { this.group.visible = false; }

  dispose(): void {
    this.group.removeFromParent();
    this.main.geometry.dispose(); this.fill.geometry.dispose();
    for (const m of this.others) m.geometry.dispose();
    this.otherMat.dispose();
  }
}
