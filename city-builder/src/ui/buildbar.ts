/**
 * Barre de construction : outils + tiroir de catalogue par catégories, avec les vignettes rendues
 * des vrais modèles et leurs coûts. Les catégories sans fonction réelle sont désactivées avec
 * leur phase (Zones, Terrain, placement de décors).
 * Propriétaire : agent construction/caméra/UI.
 */
import type { AssetCatalog, AssetCategory, CatalogAsset } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import type { RoadKindId, ToolId } from '../shared/contracts';
import { roadDef } from '../client/tools/mirror';
import { ROAD_KINDS, ROAD_KIND_ORDER } from '../sim/roads/types';
import type { ConstructionTools } from '../client/tools/machine';
import type { ToolController } from '../input/tools';
import { $, el, fmt, money, phaseBadge } from './dom';
import { iconEl } from './icons';
import type { ThumbnailSource } from './thumbnails';

export type DrawerId = 'road' | 'building' | 'services' | 'transport' | 'environment' | 'zones' | 'energy' | 'water' | 'waste' | 'terrain';
type CatalogDrawer = 'building' | 'services' | 'transport' | 'environment';
/** Sous-barres sans fonction simulée : aperçu des outils prévus, grisés avec leur phase. */
type PlannedDrawer = 'zones' | 'energy' | 'water' | 'waste' | 'terrain';

interface Tab { id: string; label: string; cats: AssetCategory[]; placeable: boolean; icon: string; color: string; filter?: (a: CatalogAsset) => boolean }

const isTransport = (a: CatalogAsset): boolean => a.tags.includes('transport');
const isGreen = (a: CatalogAsset): boolean => a.tags.includes('espace_vert') || a.tags.includes('parc');

export const DRAWER_TABS: Record<CatalogDrawer, Tab[]> = {
  building: [
    { id: 'house', label: 'Maisons', cats: ['house'], placeable: true, icon: 'house', color: '#5fd38a' },
    { id: 'townhouse', label: 'Mitoyennes', cats: ['townhouse'], placeable: true, icon: 'townhouse', color: '#8fdc6a' },
    { id: 'apartment', label: 'Immeubles', cats: ['apartment_low', 'apartment_mid'], placeable: true, icon: 'apartment', color: '#f2b45a' },
    { id: 'high', label: 'Grande hauteur', cats: ['apartment_high'], placeable: true, icon: 'tower', color: '#ff9f5a' },
    { id: 'sky', label: 'Gratte-ciel', cats: ['skyscraper'], placeable: true, icon: 'skyscraper', color: '#9fb8ff' },
    { id: 'commercial', label: 'Commerces & bureaux', cats: ['commercial'], placeable: true, icon: 'shop', color: '#5ab8ff' },
    { id: 'industrial', label: 'Industrie', cats: ['industrial'], placeable: true, icon: 'factory', color: '#ffcf4a' },
  ],
  services: [{ id: 'public', label: 'Services publics', cats: ['public'], placeable: true, icon: 'services', color: '#ff7a7a', filter: (a) => !isTransport(a) && !isGreen(a) }],
  transport: [{ id: 'station', label: 'Gares', cats: ['public'], placeable: true, icon: 'station', color: '#4fd1e8', filter: isTransport }],
  environment: [
    { id: 'park', label: 'Parcs', cats: ['public'], placeable: true, icon: 'park', color: '#5fd38a', filter: isGreen },
    { id: 'tree', label: 'Arbres', cats: ['tree'], placeable: false, icon: 'tree', color: '#46c46e' },
    { id: 'vegetation', label: 'Végétation', cats: ['vegetation'], placeable: false, icon: 'flower', color: '#e58ad6' },
    { id: 'furniture', label: 'Mobilier urbain', cats: ['street_furniture'], placeable: false, icon: 'bench', color: '#c9a36b' },
    { id: 'prop', label: 'Décors', cats: ['prop'], placeable: false, icon: 'rock', color: '#a7b0ba' },
  ],
};

/** Outils prévus (non simulés) : affichés grisés avec leur phase dans la sous-barre. */
export const PLANNED: Record<PlannedDrawer | 'transport', { label: string; icon: string; color: string; phase: string; tip: string }[]> = {
  zones: [
    { label: 'Résidentiel', icon: 'house', color: '#4fd16f', phase: '2B', tip: 'Zone résidentielle : croissance automatique de logements' },
    { label: 'Commercial', icon: 'shop', color: '#4aa8ff', phase: '2B', tip: 'Zone commerciale' },
    { label: 'Industriel', icon: 'factory', color: '#ffc531', phase: '2B', tip: 'Zone industrielle' },
    { label: 'Bureaux', icon: 'office', color: '#a77bff', phase: '2B', tip: 'Zone de bureaux' },
    { label: 'Agricole', icon: 'wheat', color: '#9bd84a', phase: '2B', tip: 'Zone agricole (5e secteur fiscal)' },
    { label: 'Spécial', icon: 'star', color: '#ffd23f', phase: '2B', tip: 'Zones spéciales (quartiers à thème)' },
  ],
  energy: [
    { label: 'Centrale thermique', icon: 'plant', color: '#ff8a5c', phase: '2B', tip: 'Production électrique thermique' },
    { label: 'Éolienne', icon: 'wind', color: '#9fe1ff', phase: '2B', tip: 'Production éolienne' },
    { label: 'Solaire', icon: 'solar', color: '#ffd23f', phase: '2B', tip: 'Centrale solaire' },
    { label: 'Hydroélectrique', icon: 'dam', color: '#4aa8ff', phase: '2B', tip: 'Barrage hydroélectrique' },
    { label: 'Lignes électriques', icon: 'pylon', color: '#c7ccd4', phase: '2B', tip: 'Réseau, délestage et pannes' },
  ],
  water: [
    { label: 'Pompage', icon: 'pump', color: '#4aa8ff', phase: '2B', tip: 'Captage et pompage' },
    { label: 'Château d’eau', icon: 'watertower', color: '#7cc4ff', phase: '2B', tip: 'Stockage et pression' },
    { label: 'Canalisations', icon: 'pipe', color: '#a0b4c8', phase: '2B', tip: 'Réseau d’eau potable' },
    { label: 'Égouts', icon: 'sewer', color: '#9b8a6a', phase: '2B', tip: 'Réseau d’assainissement' },
    { label: 'Épuration', icon: 'treatment', color: '#5fd3c4', phase: '2B', tip: 'Station d’épuration (pollution aval)' },
  ],
  waste: [
    { label: 'Collecte', icon: 'truck', color: '#8fcf5a', phase: '2B', tip: 'Camions de collecte dans le trafic' },
    { label: 'Tri et recyclage', icon: 'recycle', color: '#4fd16f', phase: '2B', tip: 'Centre de tri' },
    { label: 'Incinérateur', icon: 'fire', color: '#ff7a4a', phase: '2B', tip: 'Incinération' },
    { label: 'Décharge', icon: 'landfill', color: '#b89a6a', phase: '2B', tip: 'Décharge contrôlée' },
  ],
  terrain: [
    { label: 'Élever', icon: 'raise', color: '#d9b77a', phase: '2B', tip: 'Élever le terrain' },
    { label: 'Abaisser', icon: 'lower', color: '#b08d5a', phase: '2B', tip: 'Abaisser le terrain' },
    { label: 'Niveler', icon: 'flatten', color: '#c9c2a8', phase: '2B', tip: 'Niveler une zone' },
    { label: 'Adoucir', icon: 'smooth', color: '#9fc98a', phase: '2B', tip: 'Adoucir les pentes' },
  ],
  transport: [
    { label: 'Arrêt de bus', icon: 'busstop', color: '#ffb14a', phase: '2C', tip: 'Lignes de bus' },
    { label: 'Tramway', icon: 'tram', color: '#4fd1e8', phase: '2C', tip: 'Réseau de tramway' },
    { label: 'Port', icon: 'anchor', color: '#4aa8ff', phase: '2C', tip: 'Port de commerce' },
    { label: 'Aéroport', icon: 'airport', color: '#c7ccd4', phase: '2C', tip: 'Aéroport' },
  ],
};

const DRAWER_META: Record<DrawerId, { title: string; icon: string; cls: string }> = {
  road: { title: 'Routes', icon: 'road', cls: 't-road' },
  building: { title: 'Bâtiments', icon: 'building', cls: 't-building' },
  services: { title: 'Services', icon: 'services', cls: 't-services' },
  transport: { title: 'Transports', icon: 'transport', cls: 't-transport' },
  environment: { title: 'Nature', icon: 'tree', cls: 't-nature' },
  zones: { title: 'Zones', icon: 'zones', cls: 't-zones' },
  energy: { title: 'Énergie', icon: 'energy', cls: 't-energy' },
  water: { title: 'Eau', icon: 'water', cls: 't-water' },
  waste: { title: 'Déchets', icon: 'waste', cls: 't-waste' },
  terrain: { title: 'Terrain', icon: 'terrain', cls: 't-terrain' },
};

/** Phase prévue pour le placement libre des décors (la simulation ne les accepte pas encore). */
export const DECOR_PLACEMENT_PHASE = '2C';

export const CATEGORY_FR: Record<AssetCategory, string> = {
  house: 'Maison individuelle', townhouse: 'Maisons mitoyennes', apartment_low: 'Petit immeuble', apartment_mid: 'Immeuble moyen',
  apartment_high: 'Haute densité', skyscraper: 'Gratte-ciel', commercial: 'Commerce / bureaux', industrial: 'Industrie', public: 'Service public',
  vehicle: 'Véhicule', tree: 'Arbre', vegetation: 'Végétation', street_furniture: 'Mobilier urbain', prop: 'Décor',
};

export function assetsForTab(cat: AssetCatalog, tab: Tab): CatalogAsset[] {
  return cat.assets.filter((a) => tab.cats.includes(a.category) && (!tab.filter || tab.filter(a))).sort((a, b) => a.cost - b.cost);
}

/** Coupe en travers d'un type de route (SVG), dessinée d'après le profil de la simulation. */
function roadSvg(type: RoadKindId): SVGSVGElement {
  const k = ROAD_KINDS[type];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('class', 'road-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  const lanes = k.lanesForward + k.lanesBackward;
  const W = lanes * k.laneWidth + 2 * k.shoulder + k.medianWidth + 2 * k.sidewalk;
  const sx = 96 / 32;
  const x0 = 50 - (W * sx) / 2;
  const rect = (x: number, w: number, fill: string): void => {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x)); r.setAttribute('y', '0'); r.setAttribute('width', String(w)); r.setAttribute('height', '40'); r.setAttribute('fill', fill);
    svg.appendChild(r);
  };
  const line = (x: number, color: string, dashed: boolean, w = 0.8): void => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', String(x)); l.setAttribute('x2', String(x)); l.setAttribute('y1', '0'); l.setAttribute('y2', '40');
    l.setAttribute('stroke', color); l.setAttribute('stroke-width', String(w));
    if (dashed) l.setAttribute('stroke-dasharray', '4 4');
    svg.appendChild(l);
  };
  rect(0, 100, '#2c3b2a');
  const walk = k.sidewalk * sx;
  rect(x0, W * sx, k.surface === 'pavers' ? '#9a8a76' : '#8d8a83');
  if (k.surface === 'pavers') {
    for (let y = 4; y < 40; y += 6) { const r = document.createElementNS(ns, 'line'); r.setAttribute('x1', String(x0)); r.setAttribute('x2', String(x0 + W * sx)); r.setAttribute('y1', String(y)); r.setAttribute('y2', String(y)); r.setAttribute('stroke', '#7d6f60'); r.setAttribute('stroke-width', '0.6'); svg.appendChild(r); }
    return svg;
  }
  const roadX = x0 + walk, roadW = W * sx - 2 * walk;
  rect(roadX, roadW, k.surface === 'asphalt_worn' ? '#45474b' : '#3a3d42');
  const med = k.medianWidth * sx;
  const laneW = k.laneWidth * sx, sh = k.shoulder * sx;
  if (med) rect(50 - med / 2, med, k.median === 'planted' ? '#4f7a3c' : '#a9a9a3');
  // Voies sens inverse (à gauche) puis sens direct (à droite du terre-plein).
  let x = roadX + sh;
  for (let i = 1; i < k.lanesBackward; i++) line(x + i * laneW, '#d9d9d9', true);
  x += k.lanesBackward * laneW;
  if (!med && k.lanesBackward > 0) line(x, '#e8d27a', false);
  x += med;
  for (let i = 1; i < k.lanesForward; i++) line(x + i * laneW, '#d9d9d9', true);
  if (sh > 1) { line(roadX + sh, '#e6e6e6', false, 0.6); line(roadX + roadW - sh, '#e6e6e6', false, 0.6); }
  if (k.lanesBackward === 0) {
    // Flèches de sens unique.
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M50 30 L50 12 M44 18 L50 10 L56 18');
    p.setAttribute('stroke', '#f2f2f2'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('fill', 'none');
    svg.appendChild(p);
  }
  return svg;
}

export interface BuildBarDeps {
  catalog: AssetCatalog;
  tools: ToolController;
  machine: ConstructionTools;
  thumbs: ThumbnailSource | null;
  notify: (t: string, k?: 'info' | 'error' | 'ok') => void;
}

const PLANNED_IDS: readonly string[] = ['zones', 'energy', 'water', 'waste', 'terrain'];

export class BuildBar {
  private drawer = $('build-drawer');
  private tabsEl = $('drawer-tabs');
  private body = $('drawer-body');
  private titleEl = $('drawer-title');
  private toolbar = $('toolbar');
  private opts = $('tool-options');
  private hint = $('tool-hint');
  private actions = $('tool-actions');
  private undoBtn = $<HTMLButtonElement>('btn-undo');
  private open: DrawerId | null = null;
  private tab: Record<string, string> = {};

  constructor(private d: BuildBarDeps) {
    // Active les outils réellement disponibles ; les catégories prévues ouvrent un aperçu grisé (avec leur phase).
    const tips: Record<string, string> = {
      road: 'Routes : 6 types (rue, avenue, boulevard, sens unique, piétonne, autoroute), droites ou courbes', building: 'Bâtiments : maisons, immeubles, tours, commerces, industrie',
      services: 'Services publics : mairie, école, hôpital, pompiers, police…', environment: 'Nature : parcs (constructibles) ; arbres, végétation, mobilier (phase 2C)',
      transport: 'Transports : gare de voyageurs ; bus, tramway, port, aéroport (phase 2C)',
      bulldoze: 'Démolir : bâtiments et routes (touche B, remboursement 25 %)', select: 'Sélection : cliquer un bâtiment, une route ou un véhicule',
      zones: 'Zones (résidentiel, commercial, industriel, bureaux, agricole) : aperçu — phase 2B', energy: 'Énergie : aperçu des équipements — phase 2B',
      water: 'Eau et assainissement : aperçu — phase 2B', waste: 'Déchets : aperçu — phase 2B', terrain: 'Terraformation : aperçu — phase 2B',
    };
    for (const b of Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool], button[data-cat]'))) {
      const tool = b.dataset['tool'] as ToolId | undefined;
      const cat = b.dataset['cat'];
      const enable = tool ? d.tools.isAvailable(tool) : true;
      if (!enable) continue;
      b.disabled = false;
      if (!cat || !PLANNED_IDS.includes(cat)) b.querySelector('.phase')?.remove();
      b.dataset['tip'] = tips[tool ?? cat ?? ''] ?? b.dataset['tip'] ?? '';
    }
    this.toolbar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.id === 'btn-undo') { void d.machine.undoLast().then(() => this.sync()); return; }
      const tool = b.dataset['tool'] as ToolId | undefined;
      const cat = b.dataset['cat'];
      if (tool === 'select' || tool === 'bulldoze') { this.closeDrawer(); d.tools.setTool(tool); return; }
      const drawer = (tool === 'road' ? 'road' : tool === 'building' ? 'building' : cat) as DrawerId | undefined;
      if (!drawer) return;
      if (this.open === drawer) { this.closeDrawer(); return; }
      this.openDrawer(drawer);
      if (drawer === 'road') d.tools.setTool('road');
    });
    $('drawer-close').addEventListener('click', () => this.closeDrawer());
    d.machine.onToolChange(() => this.sync());
    d.machine.onPreview(() => { this.syncUndo(); if (this.d.machine.tool !== 'select') this.hint.textContent = this.hintText(); });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.overlay:not(.hidden)') || this.toolbar.classList.contains('hidden')) return;
      if (e.code === 'KeyB') { this.closeDrawer(); d.tools.setTool(d.machine.tool === 'bulldoze' ? 'select' : 'bulldoze'); }
    });
    this.sync();
  }

  get openDrawerId(): DrawerId | null { return this.open; }

  openDrawer(id: DrawerId): void {
    this.open = id;
    this.drawer.classList.remove('hidden');
    this.drawer.dataset['drawer'] = id;
    document.body.classList.add('drawer-open');
    this.renderDrawer();
    this.sync();
  }

  closeDrawer(): void {
    this.open = null;
    this.drawer.classList.add('hidden');
    document.body.classList.remove('drawer-open');
    this.sync();
  }

  private renderDrawer(): void {
    const id = this.open;
    this.tabsEl.replaceChildren();
    this.body.replaceChildren();
    if (!id) return;
    const meta = DRAWER_META[id];
    this.titleEl.className = `drawer-title ${meta.cls}`;
    this.titleEl.replaceChildren(iconEl(meta.icon), el('span', { text: meta.title }));
    if (id === 'road') { this.renderRoads(); return; }
    if ((PLANNED_IDS as readonly string[]).includes(id)) {
      this.tabsEl.append(el('span', { cls: 'drawer-note' }, el('span', { text: 'Aperçu des outils prévus' }), phaseBadge(PLANNED[id as PlannedDrawer][0]!.phase)));
      for (const p of PLANNED[id as PlannedDrawer]) this.body.append(this.plannedTile(p));
      this.body.scrollLeft = 0;
      return;
    }
    const tabs = DRAWER_TABS[id as CatalogDrawer].filter((t) => assetsForTab(this.d.catalog, t).length > 0);
    if (!tabs.length && id !== 'transport') { this.body.append(el('div', { cls: 'slot-empty', text: 'Aucun modèle de cette catégorie dans le catalogue.' })); return; }
    const current = tabs.find((t) => t.id === this.tab[id]) ?? tabs[0];
    if (current) {
      this.tab[id] = current.id;
      if (tabs.length > 1) {
        for (const t of tabs) {
          const b = el('button', { cls: `chip-tab${t.id === current.id ? ' active' : ''}`, attrs: { role: 'tab', 'aria-selected': String(t.id === current.id), 'data-tab': t.id, style: `--ic:${t.color}` } },
            iconEl(t.icon), el('span', { text: t.label }), el('span', { cls: 'n', text: String(assetsForTab(this.d.catalog, t).length) }));
          if (!t.placeable) b.append(el('span', { cls: 'phase', text: DECOR_PLACEMENT_PHASE }));
          b.addEventListener('click', () => { this.tab[id] = t.id; this.renderDrawer(); });
          this.tabsEl.append(b);
        }
      }
      for (const a of assetsForTab(this.d.catalog, current)) this.body.append(this.card(a, current.placeable, current.color));
    }
    if (id === 'transport') for (const p of PLANNED.transport) this.body.append(this.plannedTile(p));
    this.body.scrollLeft = 0;
  }

  private plannedTile(p: { label: string; icon: string; color: string; phase: string; tip: string }): HTMLButtonElement {
    const b = el('button', { cls: 'tile soon', attrs: { disabled: '', style: `--ic:${p.color}`, 'data-planned': p.label } },
      el('span', { cls: 'tile-ico' }, iconEl(p.icon)), el('span', { cls: 'nm', text: p.label }), phaseBadge(p.phase));
    b.dataset['tip'] = `${p.tip} — phase ${p.phase} (non simulé pour l’instant)`;
    return b;
  }

  private card(a: CatalogAsset, placeable: boolean, color: string): HTMLButtonElement {
    const thumb = el('div', { cls: 'thumb' }, el('span', { cls: 'spin' }));
    const fp = a.footprint.tilesX > 0 ? `${a.footprint.tilesX}×${a.footprint.tilesZ} cases · ${Math.round(a.dimensions.height)} m` : `${Math.round(a.dimensions.height)} m de haut`;
    const cap = a.capacity.residents ? `${fmt(a.capacity.residents)} hab.` : a.capacity.jobs ? `${fmt(a.capacity.jobs)} emplois` : '';
    const b = el('button', { cls: 'card', attrs: { 'data-asset': a.id, style: `--ic:${color}` } }, thumb,
      el('div', { cls: 'cap' }, el('span', { cls: 'nm', text: a.nameFr }), el('span', { cls: 'ct', text: placeable ? money(a.cost) : '' }), el('span', { cls: 'sz', text: [fp, cap].filter(Boolean).join(' · ') })));
    if (!placeable) {
      b.disabled = true;
      b.dataset['tip'] = `Placement libre des décors : phase ${DECOR_PLACEMENT_PHASE} (la simulation ne gère pas encore ces objets ; ils décorent déjà les routes et la démo).`;
      thumb.append(el('span', { cls: 'badge' }, phaseBadge(DECOR_PLACEMENT_PHASE)));
      // Pas de transparence sur la vignette elle-même : le modèle reste lisible.
    } else {
      b.dataset['tip'] = `${a.nameFr} — ${money(a.cost)}, entretien ${money(a.upkeepPerMonth)}/mois${a.variants.length > 1 ? ` · ${a.variants.length} variantes` : ''}`;
      b.addEventListener('click', () => {
        this.d.tools.setTool('building', { assetId: a.id });
        // On libère la vue pour viser (le tiroir se rouvre d'un clic ; la barre d'options de l'outil prend le relais).
        this.closeDrawer();
      });
    }
    if (this.d.thumbs) {
      this.d.thumbs.get(a.id).then((url) => {
        const img = el('img', { attrs: { alt: a.nameFr, src: url, draggable: 'false' } });
        thumb.querySelector('.spin')?.remove();
        thumb.prepend(img);
      }).catch(() => { thumb.querySelector('.spin')?.remove(); thumb.prepend(el('span', { text: 'Modèle indisponible' })); });
    } else thumb.querySelector('.spin')?.remove();
    return b;
  }

  private renderRoads(): void {
    const m = this.d.machine;
    for (const id of ROAD_KIND_ORDER) {
      const def = roadDef(id)!;
      const k = ROAD_KINDS[id];
      const lanes = !k.vehicles ? 'piétons' : k.lanesBackward === 0 ? `${k.lanesForward} voies, sens unique` : `${k.lanesForward}×2 voies`;
      const extra = id === 'highway' ? ' · sans carrefour à niveau' : '';
      const b = el('button', { cls: `card road-card${m.roadType === def.id ? ' active' : ''}`, attrs: { 'data-road': def.id, style: '--ic:#9fb3c8' } },
        el('div', { cls: 'thumb' }, roadSvg(def.id)),
        el('div', { cls: 'cap' }, el('span', { cls: 'nm', text: def.nameFr }), el('span', { cls: 'ct', text: `${fmt(def.costPerMeter)} CHF / m` }),
          el('span', { cls: 'sz', text: `${def.width.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m · ${lanes} · ${def.speedKmh} km/h${extra}` })));
      b.dataset['tip'] = `${def.nameFr} : ${fmt(def.costPerMeter)} CHF/m, entretien ${def.upkeepPerMeterMonth.toLocaleString('fr-FR')} CHF/m/mois${id === 'highway' ? ' — ne croise pas les autres routes à niveau (échangeurs : phase 4)' : ''}`;
      b.addEventListener('click', () => { this.d.tools.setTool('road', { roadType: def.id }); this.closeDrawer(); });
      this.body.append(b);
    }
    const mode = el('div', { cls: 'seg', attrs: { role: 'group', 'aria-label': 'Forme du tracé' } });
    for (const [id, label] of [['straight', 'Droite'], ['curve', 'Courbe']] as const) {
      const b = el('button', { cls: m.draft.mode === id ? 'active' : '', text: label });
      b.dataset['tip'] = id === 'curve' ? 'Courbe : départ, point de courbure, arrivée' : 'Droite : départ puis arrivée (ou glisser)';
      b.addEventListener('click', () => { m.setRoadMode(id); this.renderDrawer(); this.sync(); });
      mode.append(b);
    }
    this.tabsEl.append(el('span', { cls: 'drawer-note' }, el('span', { text: '6 types · droites ou courbes · carrefours et ponts automatiques' })));
    this.body.append(el('div', { cls: 'drawer-opts' }, mode, el('span', { cls: 'hint', text: 'Maj : angle magnétique 15°' }), el('span', { cls: 'hint', text: 'Extrémités aimantées aux carrefours' })));
  }

  private markActive(): void {
    for (const c of Array.from(this.body.querySelectorAll<HTMLElement>('.card[data-asset]'))) c.classList.toggle('active', this.d.machine.tool === 'building' && c.dataset['asset'] === this.d.machine.asset?.id);
  }

  private syncUndo(): void {
    this.undoBtn.disabled = this.d.machine.undo.size === 0;
    const top = this.d.machine.undo.peek();
    this.undoBtn.dataset['tip'] = top ? `Annuler : ${top.label} (Ctrl+Z)` : 'Rien à annuler (Ctrl+Z)';
  }

  private hintText(): string {
    const m = this.d.machine;
    if (m.tool === 'building' && m.asset) {
      const v = m.variant >= 0 ? m.asset.variants[m.variant] : undefined;
      return `${m.asset.nameFr}${v ? ` · ${v.nameFr}` : ''} — ${money(m.asset.cost)} · ${m.asset.footprint.tilesX * TILE_SIZE}×${m.asset.footprint.tilesZ * TILE_SIZE} m`;
    }
    if (m.tool === 'road') return `${ROAD_KINDS[m.roadType].nameFr} · ${m.draft.mode === 'curve' ? 'courbe : départ, courbure, arrivée' : 'clic départ, clic arrivée'} — clic droit : étape précédente`;
    if (m.tool === 'bulldoze') return 'Démolir : cliquez un bâtiment ou un tronçon de route (remboursement 25 %)';
    return '';
  }

  /** Catégorie de la barre d'outils qui correspond à l'outil bâtiment courant. */
  private buildingCat(): string {
    const a = this.d.machine.asset;
    if (!a) return 'building';
    if (a.category !== 'public') return 'building';
    return isTransport(a) ? 'transport' : isGreen(a) ? 'environment' : 'services';
  }

  /** Met à jour boutons actifs, barre d'options de l'outil et bouton Annuler. */
  sync(): void {
    const m = this.d.machine;
    const t = m.tool;
    const bcat = this.buildingCat();
    for (const b of Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool], button[data-cat]'))) {
      const bt = b.dataset['tool']; const bc = b.dataset['cat'];
      let active = false;
      if (this.open) active = (this.open === 'road' && bt === 'road') || (this.open === 'building' && bt === 'building') || this.open === bc;
      else active = (bt === t && (t === 'select' || t === 'bulldoze' || t === 'road')) || (t === 'building' && ((bt === 'building' && bcat === 'building') || (bc !== undefined && bc === bcat)));
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    this.markActive();
    this.syncUndo();
    this.actions.replaceChildren();
    const act = (label: string, tip: string, fn: () => void, active = false): void => {
      const b = el('button', { cls: active ? 'active' : '', text: label });
      b.dataset['tip'] = tip;
      b.addEventListener('click', () => { fn(); this.sync(); });
      this.actions.append(b);
    };
    if (t === 'select') { this.opts.classList.add('hidden'); document.body.classList.remove('tool-opts'); return; }
    this.opts.classList.remove('hidden');
    document.body.classList.add('tool-opts');
    if (t === 'building' && m.asset) {
      act('Pivoter', 'Pivoter d’un quart de tour (R)', () => this.d.tools.rotate());
      if (m.asset.variants.length > 1) act('Variante', `Variante suivante (X) — ${m.asset.variants.length} disponibles`, () => m.cycleVariant());
      act('Façade → route', 'Alignement automatique de la façade côté route (G)', () => m.setAutoAlign(!m.autoAlign), m.autoAlign);
    } else if (t === 'road') {
      act('Droite', 'Tracé droit', () => m.setRoadMode('straight'), m.draft.mode === 'straight');
      act('Courbe', 'Tracé courbe', () => m.setRoadMode('curve'), m.draft.mode === 'curve');
    }
    this.hint.textContent = this.hintText();
    act('Terminer', 'Revenir à la sélection (Échap)', () => { this.d.tools.setTool('select'); this.closeDrawer(); });
  }
}
