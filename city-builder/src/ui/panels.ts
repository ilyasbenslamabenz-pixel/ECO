/**
 * Panneau d'information de la sélection (bâtiment, route, véhicule). Les valeurs viennent du
 * catalogue et du miroir de la simulation ; ce qui n'existe pas encore dans la simulation
 * (occupants réels, trafic, trajets) est affiché avec sa phase, jamais inventé.
 * Propriétaire : agent construction/caméra/UI.
 */
import type { BuildingRecord } from '../shared/contracts';
import type { BuildingOccupancy } from '../sim/demography';
import { alertMaskOf } from '../render/plugins/alertes';
import { ALERT_BITS, ALERT_KINDS, ALERT_LABELS } from '../shared/protocol-ext/alertes';
import { TILE_SIZE } from '../shared/constants';
import type { PickResult, WorldMirror } from '../client/tools/mirror';
import { roadDef } from '../client/tools/mirror';
import { DEMOLISH_REFUND_RATE } from '../client/tools/machine';
import type { CameraController } from '../input/camera';
import { CATEGORY_FR } from './buildbar';
import { $, el, fmt, money } from './dom';
import type { ThumbnailSource } from './thumbnails';
import { explainBuilding } from './why';

export interface InfoPanelDeps {
  mirror: WorldMirror;
  camera: CameraController;
  thumbs: ThumbnailSource | null;
  demolish(p: PickResult): Promise<boolean>;
  /** Outil Déplacer (facultatif) : le bâtiment suit ensuite le pointeur jusqu'au nouvel emplacement. */
  move?(rec: BuildingRecord): void;
  /** Améliorations des équipements de service (facultatif) : niveau actuel, puis passage au niveau suivant. */
  serviceInfo?(id: number): Promise<{ level: number; max: number; upgradeCost: number | null; radiusFactor: number; capacityFactor: number; extraUpkeep: number } | null>;
  upgradeService?(id: number): Promise<boolean>;
  /** Occupation réelle d'un bâtiment (simulation : habitants, employés, services, habitants suivis). */
  inspect?(id: number): Promise<BuildingOccupancy | null>;
  /** Services : reconstruction d'une ruine (incendie) ; vrai si accepté. */
  rebuild?(id: number): Promise<boolean>;
  close(): void;
}

const dec = (v: number, d = 1): string => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const share = (a: number, b: number): string => (b > 0 ? ` (${Math.round((100 * a) / b)} %)` : '');

const VEHICLE_FR: Record<string, string> = { car: 'Voiture', van: 'Utilitaire', bus: 'Bus', truck: 'Camion', service: 'Véhicule de service' };

export class InfoPanel {
  private root = $('info-panel');
  private kicker = $('info-kicker');
  private title = $('info-title');
  private rows = $('info-rows');
  private actions = $('info-actions');
  private why = $('info-why');
  private thumb = $<HTMLImageElement>('info-thumb');
  /** Bâtiment affiché (réponses asynchrones ignorées si la fiche a changé). */
  private shownBuilding = -1;
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
    this.why.replaceChildren();
    this.thumb.classList.add('hidden');
    const cam = this.d.camera;
    this.shownBuilding = p.kind === 'building' ? p.record.id : -1;
    if (p.kind === 'building') {
      const a = p.asset;
      const rec = p.record;
      const v = a && rec.variant >= 0 ? a.variants[rec.variant] : undefined;
      this.kicker.textContent = a ? CATEGORY_FR[a.category] : 'Bâtiment';
      this.title.textContent = a?.nameFr ?? rec.assetId;
      const pm = alertMaskOf(rec.id);
      this.row('Problèmes', pm ? el('span', { cls: 'neg' }, ALERT_KINDS.filter((k) => pm & ALERT_BITS[k]).map((k) => ALERT_LABELS[k]).join(' · ')) : el('span', { cls: 'pos', text: 'aucun signalé' }));
      if (a) {
        const isService = a.tags.some((t) => t.startsWith('service:'));
        // Occupation réelle (habitants, satisfaction, employés / taux d'utilisation, services), relue à l'ouverture.
        const occRows: { key: string; label: string; node: HTMLElement }[] = [];
        if (a.capacity.residents) occRows.push({ key: 'res', label: 'Habitants', node: el('span', { text: `… / ${fmt(a.capacity.residents)}` }) }, { key: 'happy', label: 'Satisfaction', node: el('span', { text: '…' }) });
        if (a.capacity.jobs) occRows.push({ key: 'jobs', label: isService ? 'Taux d’utilisation' : 'Employés', node: el('span', { text: `… / ${fmt(a.capacity.jobs)}` }) });
        if (this.d.inspect && occRows.length) occRows.push({ key: 'svc', label: 'Services à proximité', node: el('span', { text: '…' }) });
        for (const r of occRows) this.row(r.label, r.node);
        if (!this.d.inspect || !occRows.length) this.row('Capacité', a.capacity.residents ? `${fmt(a.capacity.residents)} habitants` : a.capacity.jobs ? `${fmt(a.capacity.jobs)} emplois` : '—');
        if (this.d.inspect && occRows.length) {
          const shownId = rec.id;
          const node = (k: string): HTMLElement | undefined => occRows.find((r) => r.key === k)?.node;
          void this.d.inspect(rec.id).then((o) => {
            if (!o || this.shownBuilding !== shownId) return;
            this.renderWhy(o, pm, isService);
            const res = node('res'); if (res) res.textContent = `${fmt(o.residents)} / ${fmt(o.residentCapacity)}${share(o.residents, o.residentCapacity)}`;
            const hp = node('happy');
            if (hp) {
              const h = o.occupants.length ? o.occupants.reduce((t, c) => t + c.happiness, 0) / o.occupants.length : null;
              hp.textContent = h === null ? '—' : `${fmt(h)} %`;
              hp.className = h === null ? '' : h >= 60 ? 'pos' : h < 40 ? 'neg' : '';
            }
            const jobs = node('jobs');
            if (jobs) jobs.textContent = isService ? (o.jobCapacity > 0 ? `${Math.round((100 * o.workers) / o.jobCapacity)} % (${fmt(o.workers)} / ${fmt(o.jobCapacity)} agents)` : '—') : `${fmt(o.workers)} / ${fmt(o.jobCapacity)}${share(o.workers, o.jobCapacity)}`;
            const svc = node('svc'); if (svc) svc.textContent = o.services.length ? o.services.join(', ') : 'aucun';
            if (!o.roadAccess) this.row('Accès routier', el('span', { cls: 'neg', text: 'aucun : reliez-le à une route' }));
            // Économie vivante (champs facultatifs) : loyer d'un logement, état de l'entreprise et raison.
            const eco = o.economy;
            if (eco && o.residentCapacity > 0) {
              this.row('Loyer d’un logement', `${money(eco.rent)} / mois · valeur foncière ${fmt(eco.landValue)}`);
              if (eco.householdsInDistress > 0) this.row('Ménages en difficulté', el('span', { cls: 'neg', text: fmt(eco.householdsInDistress) }));
            }
            // Services (champ facultatif) : état (feu, endommagé, ruine), criminalité, risque d'incendie, santé, couverture.
            const sf = o.safety;
            if (sf) {
              const stateTxt = sf.state === 'feu' ? `en feu (dégâts ${Math.round(sf.damage * 100)} %)` : sf.state === 'ruine' ? 'détruit par le feu (ruine)'
                : sf.state === 'endommage' ? 'endommagé par le feu (en réparation)' : '';
              if (stateTxt) this.row('État', el('span', { cls: 'neg', text: stateTxt }));
              const lvl = (v: number, hi: number, mid: number): string => (v >= hi ? 'neg' : v >= mid ? '' : 'pos');
              const cov = (q: number): string => (q > 0 ? 'couvert' : 'non couvert');
              if (o.residentCapacity > 0 || o.jobCapacity > 0) this.row('Criminalité', el('span', { cls: lvl(sf.crime, 45, 20), text: `${fmt(sf.crime)} / 100 · police : ${cov(sf.police)}` }));
              if (sf.state !== 'ruine') this.row('Risque d’incendie', el('span', { cls: lvl(sf.fireRisk, 60, 30), text: `${fmt(sf.fireRisk)} / 100 · pompiers : ${cov(sf.fire)}` }));
              if (sf.health !== null) this.row('Santé des habitants', el('span', { cls: sf.health < 60 ? 'neg' : sf.health >= 80 ? 'pos' : '', text: `${fmt(sf.health)} / 100 · soins : ${cov(sf.care)}${sf.sick ? ` · ${fmt(sf.sick)} malade(s)` : ''}` }));
              if (sf.state === 'ruine') {
                if (sf.rebuildCost !== null && this.d.rebuild) {
                  const cost = sf.rebuildCost;
                  this.action(`Reconstruire · ${money(cost)}`, () => { void this.d.rebuild!(shownId).then((ok) => { if (ok) this.show(p); }); }, '', 'Remettre le bâtiment en état (il accueillera de nouveau habitants et emplois)');
                } else if (sf.rebuildInDays !== null) this.row('Reconstruction', `par son promoteur dans ${fmt(sf.rebuildInDays)} jour(s)`);
              }
            }
            const co = o.company;
            if (co && co.status && co.sector !== 'Service public') {
              const txt = co.status === 'closed' ? `fermée (local vacant)${co.reason ? ` : ${co.reason}` : ''}`
                : co.status === 'difficulty' ? `en difficulté${co.reason ? ` : ${co.reason}` : ''}` : 'en activité';
              this.row('Entreprise', el('span', { cls: co.status === 'active' ? 'pos' : 'neg', text: txt }));
              if (co.status !== 'closed') this.row('Bénéfice · loyer (mois)', `${money(co.profit)} · ${money(co.rent ?? 0)}`);
            }
          }).catch(() => { for (const r of occRows) if (r.node.textContent?.startsWith('…')) r.node.textContent = '—'; });
        }
        if (v) this.row('Variante', v.nameFr);
        this.row('Entretien', `${money(a.upkeepPerMonth)} / mois`);
        this.row('Coût de construction', money(a.cost));
        this.row('Emprise', `${a.footprint.tilesX}×${a.footprint.tilesZ} cases (${a.footprint.tilesX * TILE_SIZE}×${a.footprint.tilesZ * TILE_SIZE} m)`);
        this.row('Hauteur', `${Math.round(a.dimensions.height * (v?.heightScale ?? 1))} m`);
        this.row('Altitude du sol', `${dec(rec.y)} m`);
        this.setThumb(a.id, a.nameFr);
      }
      const refund = Math.round((a?.cost ?? 0) * DEMOLISH_REFUND_RATE);
      this.action('Démolir', () => { void this.d.demolish(p); }, 'danger', `Démolir (remboursement +${money(refund)}) — Suppr`);
      if (this.d.move) this.action('Déplacer', () => { this.d.move!(rec); }, '', 'Déplacer ce bâtiment ailleurs (gratuit, habitants conservés)');
      if (a?.tags.some((t) => t.startsWith('service:')) && this.d.serviceInfo) {
        // Niveau de l'équipement (module améliorations), relu à l'ouverture de la fiche.
        const row = el('span', { text: '…' });
        this.row('Niveau', row);
        const shownId = rec.id;
        void this.d.serviceInfo(rec.id).then((inf) => {
          if (!inf || this.shownBuilding !== shownId) return;
          row.textContent = `${inf.level} / ${inf.max} · rayon ×${dec(inf.radiusFactor, 2)} · capacité ×${dec(inf.capacityFactor)}${inf.extraUpkeep ? ` · entretien +${money(inf.extraUpkeep)}/mois` : ''}`;
          if (inf.upgradeCost !== null && this.d.upgradeService) {
            this.action(`Améliorer · ${money(inf.upgradeCost)}`, () => { void this.d.upgradeService!(rec.id).then((ok) => { if (ok) this.show(p); }); }, '', `Niveau ${inf.level + 1} : rayon +25 %, capacité +50 %, entretien +40 %`);
          }
        }).catch(() => { row.textContent = '—'; });
      }
      this.action('Centrer', () => cam.flyTo({ targetX: rec.x, targetZ: rec.z, distance: Math.max(60, (a?.dimensions.height ?? 20) * 3) }), '', 'Centrer la caméra');
      this.action('Vue rue', () => this.streetViewAt(rec.x, rec.z, a ? Math.max(a.footprint.tilesX, a.footprint.tilesZ) * TILE_SIZE : 16), '', 'Se placer dans la rue devant le bâtiment');
    } else if (p.kind === 'road') {
      const e = p.edge;
      const def = roadDef(e.kindId);
      this.kicker.textContent = 'Route';
      this.title.textContent = def?.nameFr ?? e.kindId;
      this.row('Longueur', `${fmt(e.length)} m`);
      if (def) {
        this.row('Largeur', `${def.width.toLocaleString('fr-FR')} m`);
        this.row('Voies', def.lanesBackward === 0 ? `${def.lanesForward} (sens unique)` : `${def.lanesForward} + ${def.lanesBackward}`);
        this.row('Vitesse limite', `${def.speedKmh} km/h`);
        this.row('Entretien', `${money(e.length * def.upkeepPerMeterMonth)} / mois`);
      }
      this.row('Pente', `${dec((Math.abs(e.by - e.ay) / Math.max(1, e.length)) * 100)} %`);
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
      this.action('Centrer', () => cam.flyTo({ targetX: p.x, targetZ: p.z, distance: 40 }));
    }
  }

  /** Fiche « Pourquoi » : raisons classées par importance, action conseillée pour chacune (src/ui/why.ts). */
  private renderWhy(o: BuildingOccupancy, alertMask: number, isService: boolean): void {
    const sections = explainBuilding(o, alertMask, { isService });
    const nodes: HTMLElement[] = [];
    for (const s of sections) {
      nodes.push(el('section', { cls: 'why-box', attrs: { 'data-why': s.kind } },
        el('p', { cls: 'why-title', text: s.title }),
        el('ul', { cls: 'why-list' }, ...s.items.map((it) => el('li', { cls: it.severity, attrs: { 'data-key': it.key } }, el('span', { cls: 'why-cause', text: it.cause }), ...(it.action ? [el('span', { cls: 'why-act', text: it.action })] : []))))));
    }
    // Logement habité sans raison de mécontentement notable : le dire aussi (le joueur sait que tout va bien).
    if (!sections.length && o.diagnosis && o.residents > 0 && o.diagnosis.factors.length) {
      nodes.push(el('section', { cls: 'why-box ok', attrs: { 'data-why': 'ok' } }, el('p', { cls: 'why-title', text: 'Habitants sans sujet de mécontentement notable' })));
    }
    this.why.replaceChildren(...nodes);
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
