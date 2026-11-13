/**
 * Aperçu 3D des outils du tiroir Terrain (Défricher, Quai / remblai, Creuser) : anneau du pinceau, tracé et
 * contour de la zone validée par la simulation, en vert / orange / rouge. Posé sur la surface de l'eau quand le
 * tracé est dans l'eau (sinon il disparaîtrait sous la surface). Réutilise les rubans de SelectionMarker.
 */
import type * as THREE from 'three';
import type { TerrainPreview } from '../client/tools/terrain-tool';
import type { TerrainData } from '../shared/contracts';
import { COLORS, SelectionMarker, type HeightFn } from './previews';

export class TerrainEditPreview {
  private readonly ring: SelectionMarker;
  private readonly zone: SelectionMarker;

  constructor(scene: THREE.Scene, heightAt: HeightFn, terrain: () => (TerrainData & { waterSurface?: Float32Array }) | null) {
    // Hauteur du ruban : terrain, ou surface de l'eau si elle le recouvre.
    const surfaceAt: HeightFn = (x, z) => {
      const h = heightAt(x, z);
      const t = terrain();
      const ws = t?.waterSurface;
      if (!t || !ws) return h;
      const i = Math.round((x - t.originX) / t.spacing), j = Math.round((z - t.originZ) / t.spacing);
      if (i < 0 || j < 0 || i >= t.samplesX || j >= t.samplesZ) return h;
      const w = ws[j * t.samplesX + i]!;
      return w > h ? w : h;
    };
    this.ring = new SelectionMarker(scene, surfaceAt, COLORS.pending);
    this.zone = new SelectionMarker(scene, surfaceAt, COLORS.pending);
  }

  show(p: TerrainPreview): void {
    const c = p.validity === 'ok' ? COLORS.ok : p.validity === 'error' ? COLORS.error : COLORS.pending;
    this.ring.setColor(c);
    this.zone.setColor(c);
    const h = p.hover;
    if (p.mode === 'clear') {
      this.zone.hide();
      if (h) this.ring.showPoint(h.x, h.z, p.radius); else this.ring.hide();
      return;
    }
    if (!p.start) {
      this.zone.hide();
      if (h) this.ring.showPoint(h.x, h.z, 3); else this.ring.hide();
      return;
    }
    // Tracé : ligne du quai (ou axe du canal), puis contour de la zone touchée quand la simulation l'a validée.
    if (h) this.ring.showPath([p.start.x, p.start.z, h.x, h.z], p.mode === 'dig' ? Math.max(1, p.width - 1.2) : 1.4);
    else this.ring.hide();
    if (p.outline && p.outline.length >= 6) this.zone.showPath(p.outline, 0.6); else this.zone.hide();
  }

  hide(): void { this.ring.hide(); this.zone.hide(); }

  update(dt: number): void { this.ring.update(dt); this.zone.update(dt); }

  dispose(): void { this.ring.dispose(); this.zone.dispose(); }
}
