/**
 * Aperçu 3D des outils du tiroir Terrain : anneau du pinceau (et anneau intérieur du plein effet, forme dure ou
 * douce), tracé et contour de la zone validée par la simulation (quai, canal, pente, barrage), sources et barrages
 * existants (modes d'eau), en vert / orange / rouge. Posé sur la surface de l'eau quand le tracé est dans l'eau
 * (sinon il disparaîtrait sous la surface). Réutilise les rubans de SelectionMarker (aucun matériau nouveau).
 */
import type * as THREE from 'three';
import type { TerrainPreview } from '../client/tools/terrain-tool';
import type { TerrainData } from '../shared/contracts';
import { COLORS, SelectionMarker, type HeightFn } from './previews';

/** Marqueurs de sources / barrages affichés au plus (modes d'eau). */
const MAX_MARKERS = 48;

export class TerrainEditPreview {
  private readonly ring: SelectionMarker;
  private readonly inner: SelectionMarker;
  private readonly zone: SelectionMarker;
  /** Col par où l'eau contourne le barrage prévu (repère rouge). */
  private readonly spill: SelectionMarker;
  private readonly markers: SelectionMarker[] = [];
  private markerKey = '';

  constructor(private readonly scene: THREE.Scene, heightAt: HeightFn, terrain: () => (TerrainData & { waterSurface?: Float32Array }) | null) {
    // Hauteur du ruban : terrain, ou surface de l'eau si elle le recouvre.
    this.surfaceAt = (x, z) => {
      const h = heightAt(x, z);
      const t = terrain();
      const ws = t?.waterSurface;
      if (!t || !ws) return h;
      const i = Math.round((x - t.originX) / t.spacing), j = Math.round((z - t.originZ) / t.spacing);
      if (i < 0 || j < 0 || i >= t.samplesX || j >= t.samplesZ) return h;
      const w = ws[j * t.samplesX + i]!;
      return w > h ? w : h;
    };
    this.ring = new SelectionMarker(scene, this.surfaceAt, COLORS.pending);
    this.inner = new SelectionMarker(scene, this.surfaceAt, COLORS.pending);
    this.zone = new SelectionMarker(scene, this.surfaceAt, COLORS.pending);
    this.spill = new SelectionMarker(scene, this.surfaceAt, COLORS.error);
  }
  private readonly surfaceAt: HeightFn;

  show(p: TerrainPreview): void {
    const c = p.validity === 'ok' ? COLORS.ok : p.validity === 'error' ? COLORS.error : COLORS.pending;
    this.ring.setColor(c);
    this.inner.setColor(c);
    this.zone.setColor(c);
    this.showMarkers(p);
    if (p.spill) this.spill.showPoint(p.spill.x, p.spill.z, 10); else this.spill.hide();
    const h = p.hover;
    if (p.mode === 'clear' || p.mode === 'raise' || p.mode === 'lower' || p.mode === 'flatten' || p.mode === 'smooth') {
      this.zone.hide();
      if (h) this.ring.showPoint(h.x, h.z, p.radius); else this.ring.hide();
      // Plein effet du pinceau (forme dure : large ; douce : petit cœur).
      if (h && p.mode !== 'clear' && p.innerRadius > 2) this.inner.showPoint(h.x, h.z, p.innerRadius); else this.inner.hide();
      return;
    }
    this.inner.hide();
    if (p.mode === 'source') {
      this.zone.hide();
      if (h) this.ring.showPoint(h.x, h.z, p.removing ? 30 : 8); else this.ring.hide();
      return;
    }
    if (p.mode === 'river') {
      if (p.path && p.path.length >= 4) this.ring.showPath(p.path, Math.max(1, p.width - 1.2));
      else if (h) this.ring.showPoint(h.x, h.z, 3); else this.ring.hide();
      if (p.outline && p.outline.length >= 6) this.zone.showPath(p.outline, 0.6); else this.zone.hide();
      return;
    }
    if (!p.start) {
      this.zone.hide();
      if (h) this.ring.showPoint(h.x, h.z, 3); else this.ring.hide();
      return;
    }
    // Tracé : ligne du quai, axe du canal, de la pente ou du barrage, puis contour validé par la simulation.
    const w = p.mode === 'dig' || p.mode === 'slope' || p.mode === 'dam' ? Math.max(1, p.width - 1.2) : 1.4;
    if (h) this.ring.showPath([p.start.x, p.start.z, h.x, h.z], w);
    else this.ring.hide();
    if (p.outline && p.outline.length >= 6) this.zone.showPath(p.outline, 0.6); else this.zone.hide();
  }

  /** Sources (cercles bleus, taille selon le débit) et barrages (repère au centre) existants. */
  private showMarkers(p: TerrainPreview): void {
    const key = JSON.stringify([p.sources, p.dams]);
    if (key === this.markerKey) return;
    this.markerKey = key;
    const items = [...p.sources.map((s) => ({ x: s.x, z: s.z, r: 4 + Math.sqrt(s.q) })), ...p.dams.map((d) => ({ x: d.x, z: d.z, r: 6 }))].slice(0, MAX_MARKERS);
    while (this.markers.length < items.length) this.markers.push(new SelectionMarker(this.scene, this.surfaceAt, COLORS.select));
    this.markers.forEach((m, i) => { const it = items[i]; if (it) m.showPoint(it.x, it.z, it.r); else m.hide(); });
  }

  hide(): void {
    this.ring.hide(); this.inner.hide(); this.zone.hide(); this.spill.hide();
    for (const m of this.markers) m.hide();
    this.markerKey = '';
  }

  update(dt: number): void { this.ring.update(dt); this.inner.update(dt); this.zone.update(dt); this.spill.update(dt); for (const m of this.markers) m.update(dt); }

  dispose(): void { this.ring.dispose(); this.inner.dispose(); this.zone.dispose(); this.spill.dispose(); for (const m of this.markers) m.dispose(); }
}
