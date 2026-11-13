/**
 * Rendu du module « Chantiers » — propriété p2a-chantiers.
 *
 * Reçoit `snapshot.ext.chantiers` (état complet) et `delta.ext.chantiers` (horloge de travail,
 * chantiers ouverts et terminés), entretient un `ChantierSite` par chantier et dessine l'ensemble :
 * pièces répétitives instanciées (palissades, échafaudages, mâts de grue, engins à l'arrêt, tas),
 * géométrie à la taille du bâtiment (plateforme, dalle, ossature, vestiges) et pièces animées pour les
 * chantiers proches de la caméra. Le bâtiment achevé est masqué tant que le chantier n'en est pas aux
 * finitions (voir mask.ts).
 */
import * as THREE from 'three';
import type { AssetCatalog, CatalogAsset } from '../../shared/catalog';
import { rotAngle } from '../../shared/footprint';
import { chantierProgress, type ChantierRecord, type ChantiersDelta, type ChantiersSnapshot } from '../../shared/protocol-ext/chantiers';
import { ConstructionAssets } from './assets';
import { InstancePools } from './instanced';
import { BuildingMask, type BuildingVisibilityApi } from './mask';
import { ChantierSite } from './site';

/** Au-delà de cette distance, un chantier garde ses pièces fixes mais perd ses animations. */
const DETAIL_DISTANCE = 420;
/** Nombre maximal de chantiers animés simultanément (grue, pelle, toupie). */
const MAX_DETAILED = 8;
/** Constante de lissage de l'horloge de travail entre deux deltas (s). */
const CLOCK_SMOOTH = 0.35;

export interface ChantiersRenderOptions {
  scene: THREE.Object3D;
  camera: THREE.Camera;
  catalog: AssetCatalog;
  url(file: string): string;
  /** Hauteur du terrain rendu (repli si la position du chantier manque). */
  heightAt(x: number, z: number): number;
  /** API de visibilité des bâtiments si le rendu de base en publie une (sinon repli par masque). */
  visibility?: BuildingVisibilityApi | null;
  castShadow?: boolean;
}

export class ChantiersRenderer {
  readonly group = new THREE.Group();
  readonly assets: ConstructionAssets;
  private readonly pools: InstancePools;
  private readonly mask: BuildingMask;
  private readonly sites = new Map<number, ChantierSite>();
  private readonly byBuilding = new Map<number, ChantierSite>();
  private readonly assetsById: Map<string, CatalogAsset>;
  private readonly camPos = new THREE.Vector3();
  private horloge = 0;
  private horlogeCible = 0;
  private enTravail = false;
  private actif = false;
  private night = 0;
  /** Diagnostic e2e. */
  readonly errors: string[] = [];

  constructor(private readonly opts: ChantiersRenderOptions) {
    this.group.name = 'chantiers';
    opts.scene.add(this.group);
    this.assets = new ConstructionAssets(opts.url);
    this.pools = new InstancePools(this.assets, this.group, opts.castShadow ?? true);
    this.mask = new BuildingMask(opts.scene, opts.visibility ?? null);
    this.assetsById = new Map(opts.catalog.assets.map((a) => [a.id, a]));
  }

  /** Charge le manifeste des modèles de chantier. */
  async load(): Promise<boolean> {
    const ok = await this.assets.load();
    if (!ok) this.errors.push(...this.assets.errors);
    return ok;
  }

  /** Précharge tous les modèles (démo, porte visuelle, captures). */
  async preload(lod = 0): Promise<void> { await this.assets.preload(lod); }

  setNight(n: number): void {
    this.night = n;
    this.assets.setNight(n);
  }

  /* ------------------------------ Messages ------------------------------ */

  applySnapshot(payload: unknown): void {
    const snap = payload as ChantiersSnapshot | undefined;
    for (const s of this.sites.values()) s.dispose();
    this.sites.clear();
    this.byBuilding.clear();
    this.mask.clear();
    this.actif = !!snap?.actif;
    this.horloge = snap?.horloge ?? 0;
    this.horlogeCible = this.horloge;
    this.enTravail = !!snap?.enTravail;
    if (!snap) return;
    for (const rec of snap.chantiers ?? []) this.addSite(rec);
    this.refresh();
  }

  applyDelta(payload: unknown): void {
    const d = payload as ChantiersDelta | undefined;
    if (!d) return;
    this.actif = true;
    if (typeof d.horloge === 'number') this.horlogeCible = d.horloge;
    if (typeof d.enTravail === 'boolean') this.enTravail = d.enTravail;
    for (const rec of d.ajoutes ?? []) this.addSite(rec);
    for (const end of d.termines ?? []) this.removeSite(end.id);
    if (d.ajoutes?.length || d.termines?.length) this.refresh();
  }

  private addSite(rec: ChantierRecord): void {
    if (this.sites.has(rec.id)) return;
    const asset = this.assetsById.get(rec.assetId);
    if (!asset) { this.errors.push(`chantier ${rec.id} : modèle inconnu ${rec.assetId}`); return; }
    const site = new ChantierSite(rec, {
      width: Math.max(2, asset.dimensions.width),
      depth: Math.max(2, asset.dimensions.depth),
      height: Math.max(2.5, asset.dimensions.height),
      angle: rotAngle(rec.rot),
      groundY: Number.isFinite(rec.y) ? rec.y : this.opts.heightAt(rec.x, rec.z),
    }, this.assets, this.group);
    site.setProgress(chantierProgress(rec, this.horloge));
    this.sites.set(rec.id, site);
    if (rec.kind === 'construction') {
      this.byBuilding.set(rec.buildingId, site);
      if (!site.buildingVisible) this.mask.hide(rec.buildingId, rec.assetId, rec.variant, rec.x, rec.y, rec.z);
    }
  }

  private removeSite(id: number): void {
    const site = this.sites.get(id);
    if (!site) return;
    site.dispose();
    this.sites.delete(id);
    if (site.record.kind === 'construction') {
      this.byBuilding.delete(site.buildingId);
      this.mask.show(site.buildingId);
    }
    this.refresh();
  }

  /* -------------------------------- Image -------------------------------- */

  /** Avancement + instances + animations. `dt` en secondes réelles. */
  frame(dt: number): void {
    if (!this.actif && this.sites.size === 0) return;
    // Horloge lissée : les deltas arrivent ~10 fois par seconde, l'avancement doit rester continu.
    const k = Math.min(1, dt / CLOCK_SMOOTH);
    this.horloge += (this.horlogeCible - this.horloge) * k;
    const cam = this.opts.camera;
    cam.getWorldPosition(this.camPos);
    let detailed = 0;
    const ordered = [...this.sites.values()];
    for (const s of ordered) {
      s.setProgress(chantierProgress(s.record, this.horloge));
      s.distance = Math.hypot(s.record.x - this.camPos.x, s.record.z - this.camPos.z);
    }
    ordered.sort((a, b) => a.distance - b.distance);
    this.pools.begin();
    for (const s of ordered) {
      const lodOf = (id: string): number => this.assets.lodFor(id, s.distance);
      s.collect(this.pools, lodOf);
      const wantDetail = s.distance < DETAIL_DISTANCE && detailed < MAX_DETAILED;
      if (wantDetail) detailed++;
      s.update(dt, wantDetail, this.enTravail, lodOf);
      // Masquage du bâtiment de base selon l'avancement.
      if (s.record.kind === 'construction') {
        if (s.buildingVisible) this.mask.show(s.buildingId);
        else this.mask.hide(s.buildingId, s.record.assetId, s.record.variant, s.record.x, s.record.y, s.record.z);
      }
    }
    this.pools.end();
    this.mask.apply();
  }

  /** Recalcule immédiatement instances et masque (après un changement de liste). */
  private refresh(): void { this.frame(0); }

  /** Diagnostic (tests e2e, porte visuelle). */
  debug(): Record<string, unknown> {
    const inst = this.pools.stats();
    return {
      actif: this.actif, horloge: Math.round(this.horloge * 100) / 100, enTravail: this.enTravail,
      chantiers: this.sites.size, modeles: this.assets.models.length, chargements: this.assets.pending,
      instances: inst.instances, maillages: inst.meshes, masques: this.mask.masked, masqueApi: this.mask.usingApi,
      masqueAttache: this.mask.attached, nuit: Math.round(this.night * 100) / 100,
      erreurs: [...this.errors, ...this.assets.errors],
      sites: [...this.sites.values()].sort((a, b) => a.id - b.id).map((s) => s.debug()),
    };
  }

  dispose(): void {
    for (const s of this.sites.values()) s.dispose();
    this.sites.clear();
    this.byBuilding.clear();
    this.mask.clear();
    this.pools.dispose();
    this.assets.dispose();
    this.group.removeFromParent();
  }
}
