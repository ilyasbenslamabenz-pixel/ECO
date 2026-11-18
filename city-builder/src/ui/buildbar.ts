/**
 * Barre de construction : outils + tiroir de catalogue par catégories, avec les vignettes rendues
 * des vrais modèles et leurs coûts. Les catégories sans fonction réelle sont désactivées avec
 * leur phase (Zones, Terrain, placement de décors).
 * Propriétaire : agent construction/caméra/UI.
 */
import { progressionView } from '../client/progression-view';
import type { AssetCatalog, AssetCategory, CatalogAsset } from '../shared/catalog';
import { TILE_SIZE } from '../shared/constants';
import type { RoadKindId, ToolId } from '../shared/contracts';
import { roadDef } from '../client/tools/mirror';
import { ROAD_KINDS, ROAD_KIND_ORDER } from '../sim/roads/types';
import type { ConstructionTools, RoadSubTool, UpgradeTarget } from '../client/tools/machine';
import { JUNCTION_LABELS, PARALLEL_DISTANCES } from '../client/tools/machine';
import { GRID_BLOCK_SIZES } from '../client/tools/grid';
import type { ToolController } from '../input/tools';
import { $, el, fmt, money, phaseBadge } from './dom';
import { iconEl } from './icons';
import type { ThumbnailSource } from './thumbnails';
import { zonageDrawer } from './panels/zonage';
import { busEditor } from './bus-editor';
import { cardInfo } from './card-info';
import { groupAssets } from './build-groups';
import { CardDetail } from './card-detail';
import { renderTerrainDrawer, terrainHint, terrainToolActions } from './terrain-drawer';

export type DrawerId = 'road' | 'building' | 'services' | 'transport' | 'environment' | 'zones' | 'energy' | 'water' | 'waste' | 'terrain';
type CatalogDrawer = 'building' | 'services' | 'transport' | 'environment' | 'energy' | 'water' | 'waste';
/** Sous-barres sans fonction simulée : aperçu des outils prévus, grisés avec leur phase. */
type PlannedDrawer = 'zones' | 'terrain';

interface Tab { id: string; label: string; cats: AssetCategory[]; placeable: boolean; icon: string; color: string; filter?: (a: CatalogAsset) => boolean }

const isTransport = (a: CatalogAsset): boolean => a.tags.includes('transport');
const isHub = (a: CatalogAsset): boolean => a.tags.includes('hub');
const isGreen = (a: CatalogAsset): boolean => a.tags.includes('espace_vert') || a.tags.includes('parc');
/** Équipement de service du tiroir Services (hors gares et parcs, qui ont leur tiroir). */
const isService = (a: CatalogAsset): boolean => !isTransport(a) && !isGreen(a);
const hasSvc = (a: CatalogAsset, ...keys: string[]): boolean => keys.some((k) => a.tags.includes(`service:${k}`));
/** Familles qui ont leur propre onglet dans le tiroir Services (le reste va dans « Culte et autres »). */
const SERVICE_TAB_KEYS = ['education', 'petite_enfance', 'sante', 'police', 'incendie', 'eau', 'assainissement', 'dechets', 'culture', 'sport', 'loisirs'];

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
  // Services : un onglet par famille d'équipements (étiquettes `service:*` du catalogue) au lieu d'une seule rangée.
  services: [
    { id: 'education', label: 'Éducation', cats: ['public'], placeable: true, icon: 'school', color: '#ffb14a', filter: (a) => isService(a) && hasSvc(a, 'education', 'petite_enfance') },
    { id: 'sante', label: 'Santé', cats: ['public'], placeable: true, icon: 'hospital', color: '#ff7a7a', filter: (a) => isService(a) && hasSvc(a, 'sante') },
    { id: 'securite', label: 'Sécurité', cats: ['public'], placeable: true, icon: 'police', color: '#6ea8ff', filter: (a) => isService(a) && hasSvc(a, 'police', 'incendie') },
    { id: 'eau', label: 'Eau', cats: ['public'], placeable: true, icon: 'water', color: '#4aa8ff', filter: (a) => isService(a) && hasSvc(a, 'eau', 'assainissement') },
    { id: 'dechets', label: 'Déchets', cats: ['public'], placeable: true, icon: 'waste', color: '#8fcf5a', filter: (a) => isService(a) && hasSvc(a, 'dechets') },
    { id: 'energie', label: 'Énergie', cats: ['industrial'], placeable: true, icon: 'energy', color: '#ffc531', filter: (a) => a.id.startsWith('elec_') },
    { id: 'loisirs', label: 'Loisirs et culture', cats: ['public'], placeable: true, icon: 'museum', color: '#c08bff', filter: (a) => isService(a) && hasSvc(a, 'culture', 'sport', 'loisirs') },
    { id: 'autres', label: 'Culte et autres', cats: ['public'], placeable: true, icon: 'church', color: '#d9b77a', filter: (a) => isService(a) && !SERVICE_TAB_KEYS.some((k) => hasSvc(a, k)) },
  ],
  transport: [
    { id: 'station', label: 'Gares et dépôts', cats: ['public'], placeable: true, icon: 'station', color: '#4fd1e8', filter: isTransport },
    // Pôles de transport (module hubs) : seules les entrées `hub` du catalogue (Port, Aéroport), pas leurs pièces.
    { id: 'hubs', label: 'Port et aéroport', cats: ['transport'], placeable: true, icon: 'anchor', color: '#4aa8ff', filter: isHub },
  ],
  // Modules électricité et eau : leurs installations sont des bâtiments du catalogue (reconnus par la simulation).
  energy: [{ id: 'power', label: 'Centrales et postes', cats: ['industrial'], placeable: true, icon: 'energy', color: '#ffc531', filter: (a) => a.id.startsWith('elec_') }],
  waste: [{ id: 'dechets', label: 'Collecte et traitement', cats: ['public'], placeable: true, icon: 'waste', color: '#8fcf5a', filter: (a) => a.id.startsWith('dechets_') }],
  water: [{ id: 'eau', label: 'Eau et égouts', cats: ['public'], placeable: true, icon: 'water', color: '#4aa8ff', filter: (a) => a.id.startsWith('eau_') }],
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
    { label: 'Forêt', icon: 'tree', color: '#2f8f7a', phase: '2B', tip: 'Exploitation forestière sur la forêt naturelle (bois)' },
    { label: 'Agricole', icon: 'wheat', color: '#d8a24a', phase: '2B', tip: 'Zone agricole sur sol fertile et plat (nourriture)' },
    { label: 'Mixte', icon: 'building', color: '#3fd0d4', phase: '2B', tip: 'Commerces au rez-de-chaussée, logements au-dessus' },
    { label: 'Spécial', icon: 'star', color: '#ffd23f', phase: '2B', tip: 'Zones spéciales (quartiers à thème)' },
  ],
  terrain: [
    { label: 'Élever', icon: 'raise', color: '#d9b77a', phase: '2B', tip: 'Élever le terrain' },
    { label: 'Abaisser', icon: 'lower', color: '#b08d5a', phase: '2B', tip: 'Abaisser le terrain' },
    { label: 'Niveler', icon: 'flatten', color: '#c9c2a8', phase: '2B', tip: 'Niveler une zone' },
    { label: 'Adoucir', icon: 'smooth', color: '#9fc98a', phase: '2B', tip: 'Adoucir les pentes' },
  ],
  transport: [
    { label: 'Tramway', icon: 'tram', color: '#4fd1e8', phase: '2C', tip: 'Réseau de tramway' },
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
  transport: 'Transport (port, aéroport)',
};

export function assetsForTab(cat: AssetCatalog, tab: Tab): CatalogAsset[] {
  return cat.assets.filter((a) => tab.cats.includes(a.category) && (a.category !== 'transport' || isHub(a)) && (!tab.filter || tab.filter(a))).sort((a, b) => a.cost - b.cost);
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

/**
 * Tiroir fourni par un module (phase 2B) : remplace l'aperçu « prévu » d'une catégorie de la barre.
 * `render` remplit les onglets et le corps du tiroir ; `closed` est appelé quand le tiroir se ferme ou qu'un
 * autre s'ouvre (l'outil du module doit alors rendre la main).
 */
export interface DrawerProvider {
  /** Info-bulle du bouton de la barre d'outils. */
  readonly tip: string;
  render(o: { tabs: HTMLElement; body: HTMLElement; deps: BuildBarDeps; close(): void; rerender(): void }): void;
  closed?(): void;
}

/** Tiroirs fournis par les modules (une ligne par module). */
const DRAWER_PROVIDERS: Partial<Record<DrawerId, DrawerProvider>> = {
  zones: zonageDrawer,
};

export interface BuildBarDeps {
  catalog: AssetCatalog;
  tools: ToolController;
  machine: ConstructionTools;
  thumbs: ThumbnailSource | null;
  notify: (t: string, k?: 'info' | 'error' | 'ok') => void;
  /** Un tiroir s'ouvre : les tableaux de bord se ferment (un seul panneau à la fois). */
  onDrawerOpen?(): void;
}

/** Actions de l'outil « Améliorer » (barre d'options). */
const UPGRADE_LABELS = { lanes: 'Plus de voies', next: 'Gamme +', prev: 'Gamme −', oneway: 'Sens unique', reverse: 'Inverser' } as const;
const UPGRADE_TIPS = {
  lanes: 'Plus de voies SANS élargir (rue 2 → 4 voies, avenue 4 → 6, boulevard 6 → 8) : trottoirs ou terre-plein réduits, aucun bâtiment à démolir',
  next: 'Type supérieur : rue → avenue → boulevard (la différence de prix est facturée)',
  prev: 'Type inférieur : boulevard → avenue → rue (25 % de la différence remboursés)',
  oneway: 'Passer en sens unique (sur un sens unique : inverse le sens)',
  reverse: 'Inverser le sens d’une rue à sens unique',
} as const;

const PLANNED_IDS: readonly string[] = ['zones'];

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
  /** Bouton flottant « Terminer » (tracé enchaîné ou quadrillage en cours), bien visible au doigt. */
  private finishBtn = $<HTMLButtonElement>('road-finish');
  private wasDrawing = false;
  private lastJunction = -2;
  private open: DrawerId | null = null;
  private tab: Record<string, string> = {};
  /** Onglet « Lignes de bus » ajouté après les onglets du catalogue du tiroir Transports. */
  private pendingBusChip: HTMLButtonElement | null = null;
  /** Fiche détaillée au survol d'une carte (tout ce que la carte tronque, variantes cliquables). */
  private detail = new CardDetail(() => ({
    thumb: (id) => this.d.thumbs?.get(id) ?? null,
    place: (a, v) => { this.d.tools.setTool('building', { assetId: a.id }); this.d.machine.setVariant(v); this.closeDrawer(); },
    lock: (id) => progressionView.assetLock(id),
    category: this.detailCategory,
  }));
  private detailCategory = '';

  constructor(private d: BuildBarDeps) {
    // Active les outils réellement disponibles ; les catégories prévues ouvrent un aperçu grisé (avec leur phase).
    const tips: Record<string, string> = {
      road: `Routes : ${ROAD_KIND_ORDER.length} types (rue, avenue, boulevard, sens unique, piétonne, autoroute, versions à plus de voies), droites ou courbes`, building: 'Bâtiments : maisons, immeubles, tours, commerces, industrie',
      services: 'Services publics : mairie, école, hôpital, pompiers, police…', environment: 'Nature : parcs ; arbres, végétation, mobilier (bientôt)',
      transport: 'Transports : lignes de bus et dépôts, gare de voyageurs, port et aéroport ; tramway (bientôt)',
      bulldoze: 'Démolir : bâtiments et routes (touche B, remboursement 25 %)', select: 'Sélection : cliquer un bâtiment, une route ou un véhicule',
      zones: 'Zones : résidentiel, commercial, industriel, bureaux, forêt exploitée, agricole, mixte', energy: 'Énergie : posez la centrale au bord d’une route, le courant suit les routes jusqu’aux bâtiments ; lignes haute tension facultatives (site éloigné)',
      water: 'Eau et égouts : pompage, potabilisation, château d’eau, épuration (canalisations le long des routes)', waste: 'Déchets : dépôt de camions-bennes, centre de tri, incinérateur, décharge (aucun branchement : les camions collectent par les routes)', terrain: 'Terrain : défricher, quais et remblais, bassins et canaux',
    };
    for (const b of Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool], button[data-cat]'))) {
      const tool = b.dataset['tool'] as ToolId | undefined;
      const cat = b.dataset['cat'];
      const enable = tool ? d.tools.isAvailable(tool) : true;
      if (!enable) continue;
      b.disabled = false;
      const provided = cat ? DRAWER_PROVIDERS[cat as DrawerId] : undefined;
      if (!cat || !PLANNED_IDS.includes(cat) || provided) { b.querySelector('.phase')?.remove(); b.classList.remove('soon'); }
      b.dataset['tip'] = provided?.tip ?? tips[tool ?? cat ?? ''] ?? b.dataset['tip'] ?? '';
      if (cat === 'terrain') b.classList.remove('soon');
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
    // Panneau « Bus » du tableau de bord : ouvre l'éditeur de lignes.
    window.addEventListener('ui:open-bus-editor', () => { this.tab['transport'] = 'bus'; if (this.open === 'transport') this.renderDrawer(); else this.openDrawer('transport'); });
    d.machine.onToolChange(() => this.sync());
    d.machine.onPreview(() => {
      this.syncUndo();
      if (this.d.machine.tool !== 'select') this.showHint();
      this.syncFinish();
    });
    this.finishBtn.addEventListener('click', () => { d.tools.cancel(); d.machine.finishRoad(); this.sync(); });
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
    if (this.open && this.open !== id) DRAWER_PROVIDERS[this.open]?.closed?.();
    if (this.open === 'transport' && id !== 'transport') busEditor.closed();
    this.open = id;
    this.d.onDrawerOpen?.();
    this.drawer.classList.remove('hidden');
    this.drawer.dataset['drawer'] = id;
    document.body.classList.add('drawer-open');
    this.renderDrawer();
    this.sync();
  }

  closeDrawer(): void {
    this.detail.hide();
    if (this.open) DRAWER_PROVIDERS[this.open]?.closed?.();
    busEditor.closed();
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
    this.body.classList.toggle('road-body', id === 'road');
    this.body.classList.remove('bus-body');
    if (id === 'road') { this.renderRoads(); return; }
    // Transports › Lignes de bus : éditeur du module « bus » (src/ui/bus-editor.ts) à la place des cartes.
    if (id === 'transport') {
      const bus = el('button', { cls: `chip-tab${this.tab[id] === 'bus' ? ' active' : ''}`, attrs: { role: 'tab', type: 'button', 'aria-selected': String(this.tab[id] === 'bus'), 'data-tab': 'bus', style: '--ic:#ffb14a' } }, iconEl('busstop'), el('span', { text: 'Lignes de bus' }));
      bus.dataset['tip'] = 'Tracer des lignes de bus : arrêts sur les routes, dans l’ordre ; fréquence, tarif, couleur';
      bus.addEventListener('click', () => { this.tab[id] = 'bus'; this.renderDrawer(); });
      if (this.tab[id] === 'bus') {
        const others = DRAWER_TABS.transport.filter((t) => assetsForTab(this.d.catalog, t).length > 0);
        for (const t of others) {
          const b = el('button', { cls: 'chip-tab', attrs: { role: 'tab', type: 'button', 'aria-selected': 'false', 'data-tab': t.id, style: `--ic:${t.color}` } }, iconEl(t.icon), el('span', { text: t.label }));
          b.addEventListener('click', () => { busEditor.closed(); this.tab[id] = t.id; this.renderDrawer(); });
          this.tabsEl.append(b);
        }
        this.tabsEl.append(bus);
        busEditor.render({ tabs: this.tabsEl, body: this.body, deps: { tools: this.d.tools, machine: this.d.machine, notify: this.d.notify, openDepots: () => { busEditor.closed(); this.tab[id] = 'station'; this.renderDrawer(); } } });
        return;
      }
      busEditor.closed();
      this.pendingBusChip = bus;
    }
    const provider = DRAWER_PROVIDERS[id];
    if (provider) {
      provider.render({ tabs: this.tabsEl, body: this.body, deps: this.d, close: () => this.closeDrawer(), rerender: () => { if (this.open === id) this.renderDrawer(); } });
      return;
    }
    if (id === 'terrain') { renderTerrainDrawer(this.tabsEl, this.body, this.d.machine, this.d.tools, PLANNED.terrain.map((p) => this.plannedTile(p)), () => this.closeDrawer()); return; }
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
          if (!t.placeable) b.append(el('span', { cls: 'phase', text: 'Bientôt' }));
          b.addEventListener('click', () => { this.tab[id] = t.id; this.renderDrawer(); });
          this.tabsEl.append(b);
        }
      }
      if (id === 'energy' || id === 'water' || id === 'waste') this.tabsEl.append(this.dashboardChip(id));
      if (id === 'energy') {
        const ln = el('button', { cls: 'chip-tab', attrs: { type: 'button', 'data-powerline': '1' } }, iconEl('pylon'), el('span', { text: 'Ligne haute tension' }));
        ln.dataset['tip'] = 'Facultatif — le courant suit déjà les routes. Pour relier une centrale éloignée (ou un hameau) sans route : touchez une installation, puis une autre ; coût affiché avant de construire';
        ln.addEventListener('click', () => { this.closeDrawer(); this.d.machine.setPowerSub('ht'); this.d.tools.setTool('powerline'); });
        this.tabsEl.append(ln);
        // Câble souterrain : même tracé point à point, sans pylône, invisible hors du calque Électricité.
        const cb = el('button', { cls: 'chip-tab', attrs: { type: 'button', 'data-cable': '1' } }, iconEl('cable'), el('span', { text: 'Câble souterrain' }));
        cb.dataset['tip'] = 'Relier une éolienne ou un parc éloigné à une route (ou à une autre installation) par un câble enterré : sans pylône, passe sous les routes, les bâtiments et l’eau ; plus cher au mètre qu’une ligne HT. Visible en tirets dans le calque Électricité';
        cb.addEventListener('click', () => { this.closeDrawer(); this.d.machine.setPowerSub('cable'); this.d.tools.setTool('powerline'); });
        this.tabsEl.append(cb);
      }
      // Sous-catégories : groupes titrés dans la rangée (une seule rangée sans titre si l'onglet n'en a pas).
      for (const g of groupAssets(current.id, assetsForTab(this.d.catalog, current))) {
        this.detailCategory = current.label;
        const cards = g.assets.map((a) => this.card(a, current.placeable, current.color));
        if (!g.label) { this.body.append(...cards); continue; }
        this.body.append(el('section', { cls: 'card-grp', attrs: { 'aria-label': g.label, style: `--ic:${current.color}` } },
          el('h5', { cls: 'grp-h' }, el('span', { text: g.label }), el('span', { cls: 'n', text: String(g.assets.length) })),
          el('div', { cls: 'grp-cards' }, ...cards)));
      }
    }
    if (id === 'transport' && this.pendingBusChip) { this.tabsEl.append(this.pendingBusChip); this.pendingBusChip = null; }
    if (id === 'transport') for (const p of PLANNED.transport) this.body.append(this.plannedTile(p));
    this.body.scrollLeft = 0;
  }

  /** Ouvre le tableau de bord du module (panneau existant) en fermant le tiroir : pas de chevauchement. */
  private dashboardChip(id: 'energy' | 'water' | 'waste'): HTMLButtonElement {
    const b = el('button', { cls: 'chip-tab', attrs: { type: 'button', 'data-dashboard': id } }, iconEl(id), el('span', { text: id === 'energy' ? 'Tableau de bord et lignes' : 'Tableau de bord' }));
    b.addEventListener('click', () => {
      this.closeDrawer();
      // Même panneau que le menu latéral (tableau de bord unique, un seul panneau ouvert à la fois).
      window.dispatchEvent(new CustomEvent('ui:open-dash', { detail: id }));
    });
    return b;
  }

  private plannedTile(p: { label: string; icon: string; color: string; phase: string; tip: string }): HTMLButtonElement {
    const b = el('button', { cls: 'tile soon', attrs: { disabled: '', style: `--ic:${p.color}`, 'data-planned': p.label } },
      el('span', { cls: 'tile-ico' }, iconEl(p.icon)), el('span', { cls: 'nm', text: p.label }), phaseBadge(p.phase));
    b.dataset['tip'] = `${p.tip} — bientôt disponible`;
    return b;
  }

  private card(a: CatalogAsset, placeable: boolean, color: string): HTMLButtonElement {
    const thumb = el('div', { cls: 'thumb' }, el('span', { cls: 'spin' }));
    const fp = a.footprint.tilesX > 0 ? `${a.footprint.tilesX}×${a.footprint.tilesZ} cases · ${Math.round(a.dimensions.height)} m` : `${Math.round(a.dimensions.height)} m de haut`;
    const cap = a.capacity.residents ? `${fmt(a.capacity.residents)} hab.` : a.capacity.jobs ? `${fmt(a.capacity.jobs)} emplois` : '';
    // L'essentiel : puissance, capacité, rayon, dépendances (catalogue et modèles partagés de la simulation).
    const info = cardInfo(a);
    // Chiffres clés en pastilles : habitants et emplois d'abord, puis ceux du module (puissance, capacité, rayon).
    const stats = [
      ...(a.capacity.residents ? [{ icon: 'people', text: `${fmt(a.capacity.residents)} hab.` }] : []),
      ...(a.capacity.jobs && !info.stats.length ? [{ icon: 'office', text: `${fmt(a.capacity.jobs)} emplois` }] : []),
      ...info.stats,
    ];
    // Empreinte en badge sur la vignette (repère rapide de la taille).
    if (a.footprint.tilesX > 0) thumb.append(el('span', { cls: 'fp-badge', text: `${a.footprint.tilesX}×${a.footprint.tilesZ}` }));
    if (a.variants.length > 1) thumb.append(el('span', { cls: 'var-badge', text: `${a.variants.length} variantes` }));
    const b = el('button', { cls: 'card', attrs: { 'data-asset': a.id, style: `--ic:${color}` } }, thumb,
      el('div', { cls: 'cap' }, el('span', { cls: 'nm', text: a.nameFr }),
        placeable ? el('span', { cls: 'price' }, el('span', { cls: 'ct', text: money(a.cost) }), a.upkeepPerMonth ? el('span', { cls: 'up', text: `${money(a.upkeepPerMonth)}/mois` }) : null) : null,
        stats.length ? el('span', { cls: 'kf' }, ...stats.map((x) => el('span', { cls: 'st' }, iconEl(x.icon), el('span', { text: x.text })))) : null,
        el('span', { cls: 'sz', text: fp }),
        info.depends ? el('span', { cls: 'dep' }, iconEl('info'), el('span', { text: info.depends })) : null));
    // Fiche détaillée : survol (souris) ou focus (clavier) ; elle reste ouverte quand la souris passe dessus.
    b.addEventListener('mouseenter', () => this.detail.show(a, b, placeable));
    b.addEventListener('focus', () => this.detail.show(a, b, placeable));
    b.addEventListener('mouseleave', () => this.detail.hideSoon());
    b.addEventListener('blur', () => this.detail.hideSoon());
    const lockAt = placeable ? progressionView.assetLock(a.id) : null;
    if (lockAt) {
      // Déblocages progressifs : modèle encore verrouillé (la simulation refuse aussi la pose).
      b.classList.add('locked');
      thumb.append(el('span', { cls: 'lock-badge' }, iconEl('lock'), lockAt));
      b.dataset['tip'] = `${a.nameFr} — débloqué au palier « ${lockAt} » (Progression › Paliers)`;
      b.addEventListener('click', () => this.d.notify(`${a.nameFr} : débloqué au palier « ${lockAt} » — voir Progression › Paliers`, 'info'));
    } else if (!placeable) {
      b.disabled = true;
      b.dataset['tip'] = 'Placement libre des décors : bientôt disponible (ils décorent déjà les routes et la démo).';
      thumb.append(el('span', { cls: 'badge' }, phaseBadge(DECOR_PLACEMENT_PHASE)));
      // Pas de transparence sur la vignette elle-même : le modèle reste lisible.
    } else {
      // Pas d'info-bulle : la fiche détaillée (survol) montre tout, l'info-bulle s'affichait en double par-dessus.
      b.setAttribute('aria-label', `${a.nameFr} — ${money(a.cost)}, entretien ${money(a.upkeepPerMonth)}/mois${cap ? ` · ${cap}` : ''}`);
      b.addEventListener('click', () => {
        this.d.tools.setTool('building', { assetId: a.id });
        // On libère la vue pour viser (le tiroir se rouvre d'un clic ; la barre d'options de l'outil prend le relais).
        this.closeDrawer();
      });
    }
    if (this.d.thumbs) {
      const thumbs = this.d.thumbs;
      const load = (): void => {
        thumbs.get(a.id).then((url) => {
          const img = el('img', { attrs: { alt: a.nameFr, src: url, draggable: 'false' } });
          thumb.querySelector('.spin')?.remove();
          thumb.prepend(img);
        }).catch(() => { thumb.querySelector('.spin')?.remove(); thumb.prepend(el('span', { text: 'Modèle indisponible' })); });
      };
      // Vignette (et chargement du modèle) seulement quand la carte devient visible : sur téléphone, ouvrir le
      // tiroir ne charge plus d'un coup tous les modèles de la catégorie.
      if (typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '0px 120px' });
        io.observe(b);
      } else load();
    } else thumb.querySelector('.spin')?.remove();
    return b;
  }

  private renderRoads(): void {
    const m = this.d.machine;
    // Cartes des types de route sur une rangée défilante ; outils (forme, quadrillage, parallèle, carrefour) dans
    // une rangée à part qui passe à la ligne : tout reste dans l'écran du téléphone.
    const cards = el('div', { cls: 'road-cards' });
    for (const id of ROAD_KIND_ORDER) {
      const def = roadDef(id)!;
      const k = ROAD_KINDS[id];
      const lanes = !k.vehicles ? 'piétons' : k.lanesBackward === 0 ? `${k.lanesForward} voies, sens unique` : `${k.lanesForward}×2 voies`;
      const extra = id === 'highway' ? ' · sans carrefour à niveau' : '';
      const b = el('button', { cls: `card road-card${m.roadType === def.id ? ' active' : ''}`, attrs: { 'data-road': def.id, style: '--ic:#9fb3c8' } },
        el('div', { cls: 'thumb' }, roadSvg(def.id)),
        el('div', { cls: 'cap' }, el('span', { cls: 'nm', text: def.nameFr }), el('span', { cls: 'ct', text: `${fmt(def.costPerMeter)} CHF / m` }),
          el('span', { cls: 'sz', text: `${def.width.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m · ${lanes} · ${def.speedKmh} km/h${extra}` })));
      b.dataset['tip'] = `${def.nameFr} : ${fmt(def.costPerMeter)} CHF/m, entretien ${def.upkeepPerMeterMonth.toLocaleString('fr-FR')} CHF/m/mois${id === 'highway' ? ' — ne croise pas les autres routes à niveau (échangeurs : bientôt)' : ''}`;
      b.addEventListener('click', () => { this.d.tools.setTool('road', { roadType: def.id }); this.closeDrawer(); });
      cards.append(b);
    }
    const mode = el('div', { cls: 'seg', attrs: { role: 'group', 'aria-label': 'Forme du tracé' } });
    for (const [id, label] of [['straight', 'Droite'], ['curve', 'Courbe']] as const) {
      const b = el('button', { cls: m.draft.mode === id ? 'active' : '', text: label });
      b.dataset['tip'] = id === 'curve' ? 'Courbe : départ, point de courbure, arrivée' : 'Droite : départ puis arrivée (ou glisser)';
      b.addEventListener('click', () => { m.setRoadMode(id); this.renderDrawer(); this.sync(); });
      mode.append(b);
    }
    const more = el('div', { cls: 'seg', attrs: { role: 'group', 'aria-label': 'Outils de voirie' } });
    for (const [id, label, tip] of [['grid', 'Quadrillage', 'Quadrillage : tracez un rectangle, un îlot de rues est créé sur la grille de 8 m'], ['upgrade', 'Améliorer', 'Améliorer : touchez une route pour changer son type ou son sens sans la démolir'], ['parallel', 'Parallèle', 'Route parallèle : touchez à côté d’une route, sa copie décalée (32 à 96 m) est proposée de ce côté'], ['junction', 'Carrefour', 'Carrefour : touchez un carrefour pour choisir automatique, feux, stop ou priorité']] as const) {
      const b = el('button', { cls: m.roadSub === id ? 'active' : '', text: label, attrs: { 'data-road-sub': id } });
      b.dataset['tip'] = tip;
      b.addEventListener('click', () => { this.d.tools.setTool('road'); m.setRoadSub(id); this.closeDrawer(); });
      more.append(b);
    }
    this.tabsEl.append(el('span', { cls: 'drawer-note' }, el('span', { text: `${ROAD_KIND_ORDER.length} types · droites ou courbes · quadrillage · carrefours et ponts automatiques` })));
    this.body.append(el('div', { cls: 'drawer-opts' }, mode, more, el('span', { cls: 'hint', text: 'Maj : angle magnétique 15°' }), el('span', { cls: 'hint', text: `Lignes guides parallèles à ${m.gridBlock} m (taille d'îlot)` })));
    this.body.prepend(cards);
  }

  private markActive(): void {
    for (const c of Array.from(this.body.querySelectorAll<HTMLElement>('.card[data-asset]'))) c.classList.toggle('active', this.d.machine.tool === 'building' && c.dataset['asset'] === this.d.machine.asset?.id);
  }

  private syncUndo(): void {
    this.undoBtn.disabled = this.d.machine.undo.size === 0;
    const top = this.d.machine.undo.peek();
    this.undoBtn.dataset['tip'] = top ? `Annuler : ${top.label} (Ctrl+Z)` : 'Rien à annuler (Ctrl+Z)';
  }

  /** Aide de l'outil : première ligne (outil, coût) et, après un saut de ligne, une astuce sur sa propre ligne. */
  private showHint(): void {
    const [main = '', tip] = this.hintText().split('\n');
    this.hint.textContent = main;
    if (tip) this.hint.append(el('span', { cls: 'hint-tip', text: ` ${tip}` }));
  }

  private hintText(): string {
    const m = this.d.machine;
    if (m.tool === 'building' && m.moving) return `Déplacer : ${m.moving.name} — touchez le nouvel emplacement (gratuit, habitants conservés ; Échap : annuler)`;
    if (m.tool === 'building' && m.asset) {
      const v = m.variant >= 0 ? m.asset.variants[m.variant] : undefined;
      return `${m.asset.nameFr}${v ? ` · ${v.nameFr}` : ''} — ${money(m.asset.cost)} · ${m.asset.footprint.tilesX * TILE_SIZE}×${m.asset.footprint.tilesZ * TILE_SIZE} m\nAstuce : un bâtiment collé à la route empêchera plus tard de l’élargir (laissez une marge)`;
    }
    if (m.tool === 'powerline' && m.powerSub === 'cable') return 'Câble souterrain — touchez une éolienne, une centrale ou un poste, puis une route (ou une autre installation) ; coût affiché, sans pylône\nAstuce : le câble est invisible en vue normale, en tirets dans le calque Électricité';
    if (m.tool === 'powerline') return 'Ligne haute tension — touchez une centrale ou un poste, puis l’installation d’arrivée (coût affiché) ; le courant suit ensuite les routes';
    if (m.tool === 'road' && m.draft.mode === 'roundabout') return `${m.draft.roundaboutSize === 'large' ? 'Grand giratoire' : 'Giratoire'} — cliquez sur un carrefour ou sur une route`;
    if (m.tool === 'road') {
      if (m.roadSub === 'grid') return `Quadrillage · ${ROAD_KINDS[m.roadType].nameFr} · îlots de ${m.gridBlock} m — premier coin, puis coin opposé (coût affiché avant validation)`;
      if (m.roadSub === 'junction') return m.junction ? `Carrefour (${m.junction.legs} branches) — choisissez son réglage ci-dessous (actuel : ${JUNCTION_LABELS[m.junctionModeOf(m.junction.id)]})` : 'Carrefour : touchez un carrefour (3 branches ou plus) pour choisir feux, stop ou priorité';
      if (m.roadSub === 'parallel') return `Route parallèle à ${m.parallelDist} m — touchez à côté d’une route, du côté voulu (type : ${ROAD_KINDS[m.roadType as RoadKindId]?.nameFr ?? m.roadType})`;
      if (m.roadSub === 'upgrade') return `Améliorer · ${UPGRADE_LABELS[m.upgradeTarget as keyof typeof UPGRADE_LABELS] ?? ROAD_KINDS[m.upgradeTarget as RoadKindId]?.nameFr ?? ''} — désignez une route (coût de la différence)`;
      const chain = m.draft.chained > 0 ? ` · ${m.draft.chained} tronçon${m.draft.chained > 1 ? 's' : ''} — le tracé continue, « Terminer » pour arrêter` : ' — le tracé continue depuis l’extrémité';
      return `${ROAD_KINDS[m.roadType].nameFr}${m.draft.elevation ? ` · ${m.draft.elevation > 0 ? '+' : ''}${m.draft.elevation} m` : ''} · ${m.draft.mode === 'curve' ? 'courbe : départ, courbure, arrivée' : 'départ puis arrivée'}${chain}`;
    }
    if (m.tool === 'bulldoze' && m.bulldozeArea) return m.hasAreaStart ? 'Démolir par zone : choisissez le coin opposé du rectangle (Échap : annuler)' : `Démolir par zone : touchez un coin, puis le coin opposé — ${m.bulldozeRoads ? 'bâtiments et routes' : 'bâtiments seulement'} (remboursement 25 %)`;
    if (m.tool === 'bulldoze') return 'Démolir : cliquez un bâtiment ou un tronçon de route (remboursement 25 %)';
    if (m.tool === 'terraform') return terrainHint(m);
    return '';
  }

  /** Catégorie de la barre d'outils qui correspond à l'outil bâtiment courant. */
  private buildingCat(): string {
    const a = this.d.machine.asset;
    if (!a) return 'building';
    if (a.category === 'transport') return 'transport';
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
      else active = (bt === t && (t === 'select' || t === 'bulldoze' || t === 'road')) || (t === 'building' && ((bt === 'building' && bcat === 'building') || (bc !== undefined && bc === bcat))) || (t === 'terraform' && bc === 'terrain');
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    // Familles du téléphone (Réseaux, Paysage) : surlignées quand l'une de leurs catégories est active.
    const fam: Record<string, string[]> = { reseaux: ['energy', 'water', 'waste', 'transport'], paysage: ['environment', 'terrain'] };
    for (const b of Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>('button[data-family]'))) {
      const cats = fam[b.dataset['family'] ?? ''] ?? [];
      const on = cats.some((c) => this.toolbar.querySelector(`button[data-cat="${c}"]`)?.classList.contains('active'));
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
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
      const sub = m.roadSub;
      act('Droite', 'Tracé droit (le tracé continue depuis l’extrémité)', () => m.setRoadMode('straight'), sub === 'draw' && m.draft.mode === 'straight');
      act('Courbe', 'Tracé courbe : départ, point de courbure, arrivée', () => m.setRoadMode('curve'), sub === 'draw' && m.draft.mode === 'curve');
      act('Quadrillage', 'Quadrillage : un rectangle devient un îlot de rues sur la grille de 8 m', () => m.setRoadSub(sub === 'grid' ? 'draw' : 'grid'), sub === 'grid');
      act('Améliorer', 'Améliorer : changer le type ou le sens d’une route sans la démolir', () => m.setRoadSub(sub === 'upgrade' ? 'draw' : 'upgrade'), sub === 'upgrade');
      // Parallèle et Carrefour : toujours à portée dans la barre d'options (aussi dans le tiroir Routes).
      act('Parallèle', 'Route parallèle : touchez à côté d’une route existante, sa copie décalée est proposée de ce côté', () => m.setRoadSub(sub === 'parallel' ? 'draw' : 'parallel'), sub === 'parallel');
      act('Carrefour', 'Carrefour : touchez un carrefour pour choisir automatique, feux, stop ou priorité', () => m.setRoadSub(sub === 'junction' ? 'draw' : 'junction'), sub === 'junction');
      if (sub === 'junction' && m.junction) {
        this.actions.append(el('span', { cls: 'ta-break', attrs: { 'aria-hidden': 'true' } }));
        const cur = m.junctionModeOf(m.junction.id);
        for (const c of ['auto', 'signal', 'stop', 'priority'] as const) act(JUNCTION_LABELS[c], c === 'auto' ? 'Choix automatique selon les routes (feux, cédez-le-passage ou priorité)' : c === 'signal' ? 'Feux tricolores (phases par direction)' : c === 'stop' ? 'Toutes les branches cèdent le passage' : 'Axe principal prioritaire, les autres branches cèdent le passage', () => { void m.setJunctionMode(c).then(() => this.sync()); }, cur === c);
      }
      this.actions.append(el('span', { cls: 'ta-break', attrs: { 'aria-hidden': 'true' } }));
      if (sub === 'grid' || sub === 'draw') {
        for (const b of GRID_BLOCK_SIZES) act(`${b} m`, `Taille d’îlot ${b} m (quadrillage et lignes guides parallèles)`, () => m.setGridBlock(b), m.gridBlock === b);
      }
      if (sub === 'parallel') {
        for (const d of PARALLEL_DISTANCES) act(`${d} m`, `Distance entre les deux routes (d’axe à axe) : ${d} m`, () => m.setParallelDist(d), m.parallelDist === d);
      }
      if (sub === 'draw') act('Guides', `Lignes guides parallèles aux routes, à ${m.gridBlock} m (avec l’aimantation)`, () => m.setGuides(!m.guides), m.guides && m.magnet);
      if (sub === 'upgrade') {
        for (const [id, label] of Object.entries(UPGRADE_LABELS) as [UpgradeTarget, string][]) act(label, UPGRADE_TIPS[id as keyof typeof UPGRADE_TIPS] ?? label, () => m.setUpgradeTarget(id), m.upgradeTarget === id);
        // Élargir une rue bordée de maisons : sans cette option, le premier bâtiment riverain bloque tout.
        act('Démolir les gênants', 'Gamme + : les bâtiments qui empiètent sur la nouvelle emprise sont démolis (nombre affiché avant de valider ; les lots du zonage repoussent en retrait). Désactivé : l\'élargissement est refusé', () => m.setUpgradeDemolish(!m.upgradeDemolish), m.upgradeDemolish);
      }
      if (sub === 'draw') {
        // Hauteur du tracé (pas de 4 m) : viaduc / passage supérieur au-dessus, tranchée / tunnel en dessous.
        const h = m.draft.elevation;
        act('▼', 'Descendre le tracé de 4 m (tranchée, tunnel)', () => { if (m.draft.mode === 'roundabout') m.setRoadMode('straight'); m.setRoadElevation(-1); });
        act(h === 0 ? '0 m' : `${h > 0 ? '+' : ''}${h} m`, 'Hauteur du tracé par rapport au terrain', () => { while (m.draft.elevation !== 0) m.setRoadElevation(m.draft.elevation > 0 ? -1 : 1); }, h !== 0);
        act('▲', 'Monter le tracé de 4 m (viaduc, passage supérieur)', () => { if (m.draft.mode === 'roundabout') m.setRoadMode('straight'); m.setRoadElevation(1); });
        // Boutons de hauteur : cible tactile de 40 px au moins (classe ta-elev).
        for (const b of Array.from(this.actions.children).slice(-3)) b.classList.add('ta-elev');
        // Ouvrage sur un lac ou une retenue créés en jeu (tracé sans hauteur imposée).
        const wc = m.draft.waterCrossing;
        act('Pont', 'Sur un lac ou une retenue : pont bas, 3 m au-dessus de l\'eau', () => m.setWaterCrossing('pont'), wc === 'pont');
        act('Viaduc', 'Sur un lac ou une retenue : viaduc haut, 12 m au-dessus de l\'eau', () => m.setWaterCrossing('viaduc'), wc === 'viaduc');
        act('Tunnel', 'Sur un lac ou une retenue : tunnel sous le fond du lac', () => m.setWaterCrossing('tunnel'), wc === 'tunnel');
        act('Digue', 'Sur un lac ou une retenue : route sur un remblai qui coupe la retenue (coût selon le volume de remblai, 30 m de profondeur au plus)', () => m.setWaterCrossing('digue'), wc === 'digue');
        // Giratoire : un bouton à trois états (petit Ø 36 m → grand Ø 56 m → retour au tracé droit).
        const rb = m.draft.mode === 'roundabout' ? m.draft.roundaboutSize : null;
        act(rb === 'large' ? 'Grand giratoire' : 'Giratoire', 'Giratoire posé d\'un clic sur un carrefour ou une route (cliquer à nouveau : grand modèle, puis tracé droit)',
          () => { if (rb === null) m.setRoundaboutSize('small'); else if (rb === 'small') m.setRoundaboutSize('large'); else m.setRoadMode('straight'); }, rb !== null);
      }
    } else if (t === 'terraform') {
      terrainToolActions(m, act);
    } else if (t === 'bulldoze') {
      act('Un par un', 'Démolir un bâtiment ou un tronçon à la fois', () => m.setBulldozeArea(false), !m.bulldozeArea);
      act('Zone', 'Démolir tout ce qui est dans un rectangle (une seule annulation)', () => m.setBulldozeArea(true), m.bulldozeArea);
      if (m.bulldozeArea) act('Routes aussi', 'Inclure les tronçons de route entièrement dans la zone', () => m.setBulldozeRoads(!m.bulldozeRoads), m.bulldozeRoads);
    }
    this.showHint();
    act('Terminer', t === 'road' ? 'Terminer le tracé en cours ; sinon revenir à la sélection (Échap)' : 'Revenir à la sélection (Échap)', () => {
      if ((t === 'road' || t === 'terraform') && m.finishRoad()) { this.d.tools.cancel(); return; }
      this.d.tools.setTool('select'); this.closeDrawer();
    });
    this.syncFinish();
  }

  /** Bouton flottant « Terminer » : visible tant qu'un tracé enchaîné ou un quadrillage est en cours. */
  private syncFinish(): void {
    const on = this.d.machine.drawing;
    this.finishBtn.classList.toggle('hidden', !on);
    if (this.d.machine.tool === 'terraform' || this.d.machine.tool === 'bulldoze') this.showHint();
    // Outil Carrefour : les boutons de réglage suivent le carrefour choisi.
    const jid = this.d.machine.tool === 'road' && this.d.machine.roadSub === 'junction' ? (this.d.machine.junction?.id ?? -1) : -2;
    if (jid !== this.lastJunction) { this.lastJunction = jid; if (jid !== -2) { this.sync(); return; } }
    document.body.classList.toggle('road-drawing', on);
    if (on !== this.wasDrawing) {
      this.wasDrawing = on;
      // La barre d'options suit (libellés « Terminer » et indications).
      // Routes : les boutons suivent aussi (hauteur ▲▼ remise à 0 m à la fin du tracé).
      if (this.d.machine.tool === 'road' || this.d.machine.tool === 'terraform') this.sync();
    }
  }
}
