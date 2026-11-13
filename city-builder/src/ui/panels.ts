/**
 * Panneau d'information de la sélection (bâtiment, route, véhicule). Les valeurs viennent du
 * catalogue et du miroir de la simulation ; ce qui n'existe pas encore dans la simulation
 * (occupants réels, trafic, trajets) est affiché avec sa phase, jamais inventé.
 * Propriétaire : agent construction/caméra/UI.
 */
import { TILE_SIZE } from '../shared/constants';
import type { PickResult, WorldMirror } from '../client/tools/mirror';
import { roadDef } from '../client/tools/mirror';
import { DEMOLISH_REFUND_RATE } from '../client/tools/machine';
import type { CameraController } from '../input/camera';
import { CATEGORY_FR } from './buildbar';
import { $, el, fmt, money, phaseBadge } from './dom';
import type { ThumbnailSource } from './thumbnails';

export interface InfoPanelDeps {
  mirror: WorldMirror;
  camera: CameraController;
  thumbs: ThumbnailSource | null;
  demolish(p: PickResult): Promise<boolean>;
  close(): void;
}

const VEHICLE_FR: Record<string, string> = { car: 'Voiture', van: 'Utilitaire', bus: 'Bus', truck: 'Camion', service: 'Véhicule de service' };

export class InfoPanel {
  private root = $('info-panel');
  private kicker = $('info-kicker');
  private title = $('info-title');
  private rows = $('info-rows');
  private actions = $('info-actions');
  private thumb = $<HTMLImageElement>('info-thumb');
  current: PickResult | null = null;

  constructor(private d: InfoPanelDeps) {
    $('info-close').addEventListener('click', () => d.close());
    $('info-fold').addEventListener('click', () => this.root.classList.toggle('folded'));
  }

  private row(label: string, value: string | Node): void {
    this.rows.append(el('dt', { text: label }), el('dd', {}, value));
  }

  private action(label: string, fn: () => void, cls = '', tip = ''): void {
    const b = el('button', { cls, text: label });
    if (tip) b.dataset['tip'] = tip;
    b.addEventListener('click', fn);
    this.actions.append(b);
  }

  hide(): void { this.current = null; this.root.classList.add('hidden'); }

  show(p: PickResult | null): void {
    this.current = p;
    if (!p) { this.hide(); return; }
    this.root.classList.remove('hidden');
    this.root.classList.remove('folded');
    this.rows.replaceChildren();
    this.actions.replaceChildren();
    this.thumb.classList.add('hidden');
    const cam = this.d.camera;
    if (p.kind === 'building') {
      const a = p.asset;
      const rec = p.record;
      const v = a && rec.variant >= 0 ? a.variants[rec.variant] : undefined;
      this.kicker.textContent = a ? CATEGORY_FR[a.category] : 'Bâtiment';
      this.title.textContent = a?.nameFr ?? rec.assetId;
      if (a) {
        if (v) this.row('Variante', v.nameFr);
        this.row('Capacité', a.capacity.residents ? `${fmt(a.capacity.residents)} habitants` : a.capacity.jobs ? `${fmt(a.capacity.jobs)} emplois` : '—');
        if (a.capacity.residents && a.capacity.jobs) this.row('Emplois', fmt(a.capacity.jobs));
        this.row('Occupants', el('span', {}, '— ', phaseBadge(2)));
        this.row('Entretien', `${money(a.upkeepPerMonth)} / mois`);
        this.row('Coût de construction', money(a.cost));
        this.row('Emprise', `${a.footprint.tilesX}×${a.footprint.tilesZ} cases (${a.footprint.tilesX * TILE_SIZE}×${a.footprint.tilesZ * TILE_SIZE} m)`);
        this.row('Hauteur', `${Math.round(a.dimensions.height * (v?.heightScale ?? 1))} m`);
        this.row('Altitude du sol', `${rec.y.toFixed(1)} m`);
        this.row('Modèle', a.license.source.startsWith('http') ? 'Poly Haven (CC0)' : 'Généré par le projet (CC0)');
        this.setThumb(a.id, a.nameFr);
      }
      const refund = Math.round((a?.cost ?? 0) * DEMOLISH_REFUND_RATE);
      this.action('Démolir', () => { void this.d.demolish(p); }, 'danger', `Démolir (remboursement +${money(refund)}) — Suppr`);
      this.action('Centrer', () => cam.flyTo({ targetX: rec.x, targetZ: rec.z, distance: Math.max(60, (a?.dimensions.height ?? 20) * 3) }), '', 'Centrer la caméra');
      this.action('Vue rue', () => this.streetViewAt(rec.x, rec.z, a ? Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE : 16), '', 'Se placer dans la rue devant le bâtiment');
    } else if (p.kind === 'road') {
      const e = p.edge;
      const def = roadDef(e.kindId);
      this.kicker.textContent = 'Route';
      this.title.textContent = def?.nameFr ?? e.kindId;
      this.row('Longueur', `${fmt(e.length)} m`);
      if (def) {
        this.row('Largeur', `${def.width} m`);
        this.row('Voies', def.lanesBackward === 0 ? `${def.lanesForward} (sens unique)` : `${def.lanesForward} + ${def.lanesBackward}`);
        this.row('Vitesse limite', `${def.speedKmh} km/h`);
        this.row('Entretien', `${money(e.length * def.upkeepPerMeterMonth)} / mois`);
      }
      this.row('Pente', `${((Math.abs(e.by - e.ay) / Math.max(1, e.length)) * 100).toFixed(1)} %`);
      this.row('Trafic', el('span', {}, '— ', phaseBadge(3)));
      const refund = Math.round(e.length * (def?.costPerMeter ?? 0) * DEMOLISH_REFUND_RATE);
      this.action('Supprimer', () => { void this.d.demolish(p); }, 'danger', `Supprimer le tronçon (remboursement +${money(refund)}) — Suppr`);
      this.action('Centrer', () => cam.flyTo({ targetX: (e.ax + e.bx) / 2, targetZ: (e.az + e.bz) / 2, distance: Math.max(80, e.length * 1.2) }));
      this.action('Vue rue', () => { cam.setStreetPosition((e.ax + e.bx) / 2, (e.az + e.bz) / 2, Math.atan2(-(e.bx - e.ax), -(e.bz - e.az))); cam.setMode('street'); });
    } else {
      const a = p.asset;
      this.kicker.textContent = 'Véhicule';
      this.title.textContent = a?.nameFr ?? `Véhicule n° ${p.index + 1}`;
      if (a?.vehicle) {
        this.row('Type', VEHICLE_FR[a.vehicle.kind] ?? a.vehicle.kind);
        this.row('Vitesse maximale', `${a.vehicle.maxSpeedKmh} km/h`);
        this.row('Longueur', `${a.vehicle.lengthM.toLocaleString('fr-FR')} m`);
        this.setThumb(a.id, a.nameFr);
      }
      this.row('Trajet', el('span', {}, '— ', phaseBadge(3)));
      this.action('Centrer', () => cam.flyTo({ targetX: p.x, targetZ: p.z, distance: 40 }));
    }
  }

  private setThumb(assetId: string, alt: string): void {
    if (!this.d.thumbs) return;
    const want = this.current;
    this.d.thumbs.get(assetId).then((url) => {
      if (this.current !== want) return;
      this.thumb.src = url; this.thumb.alt = alt; this.thumb.classList.remove('hidden');
    }).catch(() => undefined);
  }

  /** Place la caméra piéton sur le trottoir côté façade, regard vers le bâtiment. */
  private streetViewAt(x: number, z: number, size: number): void {
    const m = this.d.mirror;
    const near = m.nearestEdge(x, z, size + 40);
    let sx = x; let sz = z + size / 2 + 6;
    if (near) {
      sx = near.px;
      sz = near.pz;
    }
    const yaw = Math.atan2(-(x - sx), -(z - sz));
    this.d.camera.setStreetPosition(sx, sz, yaw);
    this.d.camera.setMode('street');
  }
}
