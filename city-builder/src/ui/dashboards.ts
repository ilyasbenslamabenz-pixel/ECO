/**
 * Tableaux de bord (barre latérale gauche = CONSULTER / RÉGLER) et panneaux génériques de droite :
 * Vue ville, Services, Transports, Environnement, Statistiques, Notifications. Les tableaux Finances
 * et Population sont dans city-panels.ts. Énergie, Eau & égouts, Déchets (2B), Politiques et
 * Recherche (2C) restent grisés avec leur phase dans la barre latérale : aucun chiffre inventé.
 *
 * Modules de phase 2 : les panneaux du registre `ui/panels/index` (UiPanel) qui fournissent `mount`
 * sont montés comme onglets du tableau de bord correspondant (circulation, piétons → Transports ;
 * bâtiments, chantiers et autres → Vue ville). Ceux qui n'ont pas encore de panneau sont listés.
 * Propriétaire : agent UI (refonte).
 */
import type { SimReport } from '../sim/sim-protocol';
import type { SimStats } from '../shared/contracts';
import type { WorldMirror } from '../client/tools/mirror';
import { roadDef } from '../client/tools/mirror';
import type { CameraController } from '../input/camera';
import { ROAD_KIND_ORDER } from '../sim/roads/types';
import { UI_PANELS, type UiPanel, type UiPanelApi } from './panels/index';
import { barRow } from './city-panels';
import { drawChart, MONTHS_SHORT } from './charts';
import { $, el, fmt, money, moneyShort, pct, signedMoney } from './dom';
import { iconEl } from './icons';
import { goTo } from './goto';
import { clearLog, journal, markAllRead, markEntryRead, markSeverityRead, notifyLog, onNotify, unreadCount, type NotifyEntry, type Severity } from './notify';
import { SEVERITY_FR, SEVERITY_ORDER } from './notify-log';
import { HistoryView, type HistTab } from './history-view';

export type DashId = 'city' | 'services' | 'transport' | 'environment' | 'stats' | 'notifications' | 'policy' | 'research' | 'energy' | 'water' | 'waste' | 'progression';

/** Tableau de bord → menu de construction du même service (bouton « Construire › » de l'en-tête). */
const DASH_BUILD: Partial<Record<DashId, { open: string; tab?: string }>> = {
  services: { open: '#toolbar [data-cat="services"]' }, transport: { open: '#toolbar [data-cat="transport"]' },
  environment: { open: '#toolbar [data-cat="environment"]' }, energy: { open: '#toolbar [data-cat="energy"]' },
  water: { open: '#toolbar [data-cat="water"]' }, waste: { open: '#toolbar [data-cat="waste"]' },
};
const META: Record<DashId, { title: string; icon: string; cls: string; kicker: string }> = {
  city: { title: 'Vue ville', icon: 'home', cls: 't-city', kicker: 'Tableau de bord' },
  services: { title: 'Services publics', icon: 'services', cls: 't-services', kicker: 'Tableau de bord' },
  transport: { title: 'Transports', icon: 'transport', cls: 't-transport', kicker: 'Tableau de bord' },
  environment: { title: 'Environnement', icon: 'leaf', cls: 't-nature', kicker: 'Tableau de bord' },
  stats: { title: 'Statistiques', icon: 'stats', cls: 't-stats', kicker: 'Évolution de la ville' },
  notifications: { title: 'Notifications', icon: 'bell', cls: 't-notif', kicker: 'Journal' },
  policy: { title: 'Politiques', icon: 'policy', cls: 't-city', kicker: 'Gouvernance' },
  research: { title: 'Recherche', icon: 'research', cls: 't-city', kicker: 'Progression' },
  energy: { title: 'Énergie', icon: 'energy', cls: 't-energy', kicker: 'Services urbains' },
  water: { title: 'Eau & égouts', icon: 'water', cls: 't-water', kicker: 'Services urbains' },
  waste: { title: 'Déchets', icon: 'waste', cls: 't-waste', kicker: 'Services urbains' },
  progression: { title: 'Progression', icon: 'flag', cls: 't-city', kicker: 'Paliers, objectifs, événements' },
};

/** Tableau de bord hôte de chaque module de phase 2. */
const MODULE_DASH: Record<string, DashId> = { circulation: 'transport', pietons: 'transport', bus: 'transport', connexions: 'transport', batiments: 'city', chantiers: 'city', politiques: 'policy', recherche: 'research', paliers: 'progression', developpement: 'progression', objectifs: 'progression', evenements: 'progression', secteurs: 'policy', electricite: 'energy', eau: 'water', dechets: 'waste' };

/** Ferme les anciens panneaux flottants des modules (Énergie, Eau, Déchets) : un seul panneau à la fois. */
export function closeFloatingModulePanels(): void {
  const elec = document.getElementById('elec-panel');
  if (elec && !elec.classList.contains('hidden')) elec.dispatchEvent(new CustomEvent('elec-close', { bubbles: true }));
  const eau = document.getElementById('eau-panel');
  if (eau && !eau.classList.contains('hidden')) (eau.querySelector('.icon-x') as HTMLButtonElement | null)?.click();
  (window as unknown as { __dechets?: { closePanel?: () => void } }).__dechets?.closePanel?.();
}

export interface ModuleBridge { pluginCommand(plugin: string, name: string, payload?: unknown): Promise<unknown> }

/** Services offerts aux panneaux des modules (UiPanelApi). */
export class ModuleHost {
  private snap: Record<string, unknown> = {};
  private subs = new Map<string, Set<(p: unknown) => void>>();
  bridge: ModuleBridge | null = null;
  constructor(private toast: (t: string, k?: 'info' | 'ok' | 'error') => void) {}
  setSnapshot(ext: Record<string, unknown> | undefined): void { this.snap = ext ?? {}; }
  pushDelta(ext: Record<string, unknown> | undefined): void {
    if (!ext) return;
    for (const [id, p] of Object.entries(ext)) for (const l of this.subs.get(id) ?? []) { try { l(p); } catch (e) { console.error(`[ui] panneau ${id}`, e); } }
  }
  api(id: string): UiPanelApi {
    return {
      command: (name, payload) => { if (!this.bridge) return Promise.reject(new Error('Simulation non démarrée')); return this.bridge.pluginCommand(id, name, payload); },
      onDeltaExt: (l) => { let s = this.subs.get(id); if (!s) { s = new Set(); this.subs.set(id, s); } s.add(l); return () => { s.delete(l); }; },
      snapshotExt: () => this.snap[id],
      toast: (m, k) => this.toast(m, k),
    };
  }
}

export interface DashDeps {
  report(): SimReport | null;
  stats(): SimStats | null;
  mirror(): WorldMirror | null;
  camera(): CameraController | null;
  cityName(): string;
  toggleCamera(): void;
  openFinance(): void;
  openPop(): void;
  /** Ferme les autres panneaux de droite (id = panneau qui s'ouvre). */
  opened(id: string): void;
  /** Referme le menu latéral (tiroir du téléphone) en gardant son état synchronisé. */
  closeSidebar(): void;
  modules: ModuleHost;
}

export class Dashboards {
  private panel = $('dash-panel');
  private body = $('dash-body');
  private tabsEl = $('dash-tabs');
  private sidebar = $('sidebar');
  current: DashId | null = null;
  private tab: Record<string, string> = {};
  private unmount: (() => void) | null = null;
  private mountedKey = '';
  private renderedKey = '';

  /** Graphiques d'évolution (module « historique »). */
  private readonly history: HistoryView;

  constructor(private d: DashDeps) {
    this.history = new HistoryView(
      async () => (d.modules.bridge ? await d.modules.bridge.pluginCommand('historique', 'etat') as { today: number; state: import('../shared/protocol-ext/historique').HistoriqueState } | null : null),
      () => { if (this.current === 'stats') this.render(true); },
    );
    for (const b of Array.from(this.sidebar.querySelectorAll<HTMLButtonElement>('button[data-dash]'))) {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const id = b.dataset['dash'] ?? '';
        if (id === 'finance') d.openFinance();
        else if (id === 'population') d.openPop();
        // Énergie, Eau, Déchets : panneau du module monté dans le même panneau que les autres tableaux de bord.
        else this.toggle(id as DashId);
        d.closeSidebar();
        this.syncSidebar();
      });
    }
    $('dash-close').addEventListener('click', () => this.close());
    // « Construire › » : du tableau de bord d'un service au menu de construction correspondant (et l'onglet).
    $('dash-build').addEventListener('click', () => { const t = this.current ? DASH_BUILD[this.current] : undefined; if (t) goTo(t); });
    // Bouton ✕ intégré au panneau Énergie : ferme le tableau de bord qui l'héberge.
    this.body.addEventListener('elec-close', () => this.close());
    // Tiroirs de construction (Énergie, Eau, Déchets) : « Tableau de bord » ouvre le même panneau.
    window.addEventListener('ui:open-dash', (e) => { const id = (e as CustomEvent<DashId>).detail; if (id && id in META) this.open(id); });
    $('dash-fold').addEventListener('click', () => this.panel.classList.toggle('folded'));
    $('btn-stats').addEventListener('click', () => this.toggle('stats'));
    $('btn-notif').addEventListener('click', () => this.toggle('notifications'));
    onNotify(() => { this.syncBadge(); if (this.current === 'notifications') { markInfoReadSoon(); this.render(true); } });
    this.syncBadge();
    window.addEventListener('resize', () => { if (this.current === 'stats') this.render(true); });
  }

  private syncBadge(): void {
    const n = unreadCount();
    const b = $('notif-badge');
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', n === 0);
    // Barre compacte du téléphone : pastille sur le bouton du menu latéral et compteur dans le menu.
    $('btn-sidebar').classList.toggle('has-notif', n > 0);
    const sb = document.getElementById('sb-notif-badge');
    if (sb) { sb.textContent = b.textContent; sb.classList.toggle('hidden', n === 0); }
    $('btn-notif').setAttribute('aria-label', n ? `Notifications (${n} importante${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''})` : 'Notifications');
  }

  /** Bouton actif de la barre latérale = panneau ouvert. */
  syncSidebar(): void {
    const open = !$('finance-panel').classList.contains('hidden') ? 'finance' : !$('pop-panel').classList.contains('hidden') ? 'population' : this.current;
    for (const b of Array.from(this.sidebar.querySelectorAll<HTMLButtonElement>('button[data-dash]'))) b.classList.toggle('active', b.dataset['dash'] === open);
    $('btn-stats').classList.toggle('active', this.current === 'stats');
    $('btn-notif').classList.toggle('active', this.current === 'notifications');
    // Raccourcis du menu latéral (téléphone) : même état actif que le bouton de la barre du haut.
    for (const b of Array.from(this.sidebar.querySelectorAll<HTMLButtonElement>('button[data-proxy]'))) {
      const p = b.dataset['proxy'];
      b.classList.toggle('active', (p === 'btn-stats' && this.current === 'stats') || (p === 'btn-notif' && this.current === 'notifications'));
    }
  }

  toggle(id: DashId): void { if (this.current === id && !this.panel.classList.contains('hidden')) this.close(); else this.open(id); }

  open(id: DashId, tab?: string): void {
    this.d.opened('dash');
    closeFloatingModulePanels();
    if (this.current && this.current !== id) this.unmountModule();
    this.current = id;
    if (tab) this.tab[id] = tab;
    const m = META[id];
    $('dash-title').textContent = m.title;
    $('dash-kicker').textContent = m.kicker;
    const ico = $('dash-ico');
    ico.className = `ph-ico ${m.cls}`;
    ico.replaceChildren(iconEl(m.icon));
    $('dash-build').classList.toggle('hidden', !DASH_BUILD[id]);
    this.panel.classList.remove('hidden', 'folded');
    this.panel.dataset['dash'] = id;
    // Journal : les infos sont lues à l'ouverture ; urgentes et importantes restent signalées jusqu'à « Tout marquer comme lu ».
    if (id === 'notifications') markSeverityRead('info');
    this.render(true);
    this.syncSidebar();
  }

  close(): void {
    this.current = null;
    this.panel.classList.add('hidden');
    this.unmountModule();
    this.renderedKey = '';
    this.syncSidebar();
  }

  /** Masqué par l'ouverture d'un autre panneau. */
  hide(): void { if (this.current) this.close(); }

  private unmountModule(): void {
    if (this.unmount) { try { this.unmount(); } catch (e) { console.error(e); } }
    this.unmount = null;
    this.mountedKey = '';
  }

  /** Rafraîchissement périodique (rapport de la simulation) : seulement si ouvert. */
  render(force = false): void {
    const id = this.current;
    if (!id || this.panel.classList.contains('hidden')) return;
    const tabs = this.tabsFor(id);
    const cur = tabs.find((t) => t.id === this.tab[id]) ?? tabs[0]!;
    this.tab[id] = cur.id;
    // Onglets (affichés seulement s'il y en a plusieurs).
    if (tabs.length > 1) {
      this.tabsEl.classList.remove('hidden');
      const sig = tabs.map((t) => t.id).join('|') + cur.id;
      if (this.tabsEl.dataset['sig'] !== sig) {
        this.tabsEl.dataset['sig'] = sig;
        this.tabsEl.style.setProperty('--n', String(tabs.length));
        this.tabsEl.classList.toggle('many', tabs.length > 4);
        this.tabsEl.replaceChildren(...tabs.map((t) => {
          const b = el('button', { cls: t.id === cur.id ? 'active' : '', text: t.label.replace(/\s*\(.*\)\s*$/, ''), attrs: { role: 'tab', 'aria-selected': String(t.id === cur.id), 'data-dtab': t.id } });
          b.addEventListener('click', () => { this.tab[id] = t.id; this.render(true); });
          return b;
        }));
      }
    } else { this.tabsEl.classList.add('hidden'); this.tabsEl.dataset['sig'] = ''; }
    // Onglet d'un module : monté une fois, il se met à jour lui-même.
    const mod = cur.module;
    if (mod) {
      const key = `${id}:${mod.id}`;
      if (this.mountedKey !== key) {
        this.unmountModule();
        this.body.replaceChildren();
        const root = el('div', { cls: 'module-root', attrs: { 'data-module': mod.id } });
        this.body.append(root);
        try { const u = mod.mount?.(root, this.d.modules.api(mod.id)); this.unmount = typeof u === 'function' ? u : null; } catch (e) {
          root.replaceChildren(el('p', { cls: 'muted', text: `Panneau « ${mod.title} » indisponible : ${e instanceof Error ? e.message : String(e)}` }));
        }
        this.mountedKey = key;
      }
      return;
    }
    this.unmountModule();
    const key = `${id}:${cur.id}`;
    if (!force && this.renderedKey === key && (id === 'notifications')) return;
    this.renderedKey = key;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...this.build(id, cur.id));
    this.body.scrollTop = scroll;
    if (id === 'stats') this.drawStats(cur.id);
  }

  private tabsFor(id: DashId): { id: string; label: string; module?: UiPanel }[] {
    const base: Record<DashId, { id: string; label: string }[]> = {
      city: [{ id: 'summary', label: 'Synthèse' }],
      services: [{ id: 'coverage', label: 'Couverture' }, { id: 'equip', label: 'Équipements' }],
      transport: [{ id: 'traffic', label: 'Trafic' }, { id: 'network', label: 'Réseau' }],
      environment: [{ id: 'env', label: 'Qualité' }],
      stats: [{ id: 'pop', label: 'Habitants' }, { id: 'money', label: 'Trésorerie' }, { id: 'jobs', label: 'Emploi' }, { id: 'happy', label: 'Satisfaction' }],
      notifications: [{ id: 'log', label: 'Journal' }],
      policy: [], research: [], energy: [], water: [], waste: [], progression: [],
    };
    const mods = UI_PANELS.filter((p) => typeof p.mount === 'function' && (MODULE_DASH[p.id] ?? 'city') === id).map((p) => ({ id: `mod:${p.id}`, label: p.title, module: p }));
    return [...base[id], ...mods];
  }

  /* ------------------------------ Contenus ------------------------------ */

  private kpi(label: string, value: string, cls = ''): HTMLElement {
    return el('div', { cls: `kpi ${cls}` }, el('span', { cls: 'lbl', text: label }), el('b', { text: value }));
  }

  private section(title: string, ...children: (Node | null)[]): HTMLElement[] {
    return [el('div', { cls: 'sec-title', text: title }), ...children.filter((c): c is Node => !!c) as HTMLElement[]];
  }

  private waiting(): HTMLElement { return el('p', { cls: 'muted small', text: 'En attente du premier rapport de la simulation…' }); }

  private build(id: DashId, tab: string): HTMLElement[] {
    const r = this.d.report(); const s = this.d.stats(); const m = this.d.mirror();
    switch (id) {
      case 'city': return this.buildCity(r, s, m);
      case 'services': return this.buildServices(r, m, tab);
      case 'transport': return this.buildTransport(r, s, m, tab);
      case 'environment': return this.buildEnvironment(r, m);
      case 'stats': return this.buildStats(r, tab);
      case 'notifications': return this.buildNotifications();
      case 'policy': case 'research': case 'energy': case 'water': case 'waste': case 'progression': return []; // contenu : panneau du module
    }
  }

  private buildCity(r: SimReport | null, s: SimStats | null, m: WorldMirror | null): HTMLElement[] {
    const out: HTMLElement[] = [];
    out.push(el('div', { cls: 'city-hero' }, el('span', { cls: 'kicker', text: 'Ville' }), el('b', { text: this.d.cityName() || '—' }), el('span', { cls: 'muted small', text: r ? r.dateFr : '' })));
    if (s) {
      out.push(el('div', { cls: 'kpis kpis3' },
        this.kpi('Habitants', fmt(s.population)), this.kpi('Emplois', fmt(s.jobs)), this.kpi('Trésorerie', moneyShort(s.money), s.money < 0 ? 'neg' : ''),
        this.kpi('Bâtiments', fmt(m ? m.buildings.size : s.buildings)), this.kpi('Routes', `${(s.roadLengthM / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km`), this.kpi('Véhicules', fmt(s.vehicles))));
      out.push(el('dl', { cls: 'rows' }, el('dt', { text: 'Solde mensuel prévu' }), el('dd', { cls: s.monthlyBalance < 0 ? 'neg' : 'pos', text: signedMoney(s.monthlyBalance) }),
        el('dt', { text: 'Satisfaction' }), el('dd', { text: r && r.demography.population > 0 ? `${fmt(Math.round(r.demography.happiness))} %` : '—' }),
        el('dt', { text: 'Chômage' }), el('dd', { text: r ? pct(r.demography.unemploymentRate, 1) : '—' })));
    } else out.push(this.waiting());
    // Caméra : actions réelles sur le contrôleur.
    const cam = this.d.camera();
    if (cam) {
      const act = (label: string, icon: string, fn: () => void, tip: string, idAttr: string): HTMLButtonElement => {
        const b = el('button', { cls: 'chip', attrs: { 'data-act': idAttr } }, iconEl(icon), el('span', { text: label }));
        b.dataset['tip'] = tip;
        b.addEventListener('click', fn);
        return b;
      };
      out.push(...this.section('Caméra', el('div', { cls: 'chips' },
        act('Recentrer', 'target', () => cam.setView('home'), 'Revenir à la vue de départ de la ville (touche H)', 'home'),
        act('Vue de dessus', 'topview', () => cam.setView('top'), 'Vue de dessus (touche T)', 'top'),
        act('Nord en haut', 'compass', () => cam.setView('north'), 'Orienter la vue vers le nord (touche N)', 'north'),
        act(cam.mode === 'street' ? 'Vue aérienne' : 'Vue rue', 'walk', () => { this.d.toggleCamera(); this.render(true); }, 'Basculer vue aérienne / vue rue (touche V)', 'street'),
        act('Survol', 'plane', () => cam.toggleCinematic(), 'Survol cinématique (touche C)', 'cine'))));
    }
    // Modules enregistrés sans panneau livré.
    const pending = UI_PANELS.filter((p) => typeof p.mount !== 'function');
    if (pending.length) {
      out.push(...this.section('Bientôt disponible', el('ul', { cls: 'mod-list' }, ...pending.map((p) => el('li', {}, el('span', { text: p.title }))))));
    }
    return out;
  }

  private publicCounts(m: WorldMirror | null): Map<string, { name: string; n: number; tags: string[] }> {
    const out = new Map<string, { name: string; n: number; tags: string[] }>();
    if (!m) return out;
    for (const b of m.buildings.values()) {
      const a = m.asset(b.assetId);
      if (!a || a.category !== 'public') continue;
      const e = out.get(a.id) ?? { name: a.nameFr, n: 0, tags: a.tags ?? [] };
      e.n++;
      out.set(a.id, e);
    }
    return out;
  }

  private buildServices(r: SimReport | null, m: WorldMirror | null, tab: string): HTMLElement[] {
    if (tab === 'equip') {
      const counts = Array.from(this.publicCounts(m).values()).sort((a, b) => b.n - a.n);
      if (!counts.length) return [el('p', { cls: 'muted small', text: 'Aucun équipement public construit. Barre d’outils : Services.' })];
      const max = Math.max(...counts.map((c) => c.n));
      const out: HTMLElement[] = [el('div', { cls: 'act-bars' }, ...counts.map((c) => barRow(c.name, c.n, max, fmt(c.n))))];
      if (r) out.push(el('dl', { cls: 'rows' }, el('dt', { text: 'Salaires des services (part communale)' }), el('dd', { text: `${money(r.economy.forecast.expenses.salaries)} / mois` })));
      return out;
    }
    if (!r) return [this.waiting()];
    const sv = Object.entries(r.demography.services);
    return [
      el('p', { cls: 'muted small', text: 'Part des habitants desservis par chaque service (rayon d’action des équipements construits).' }),
      el('div', { cls: 'act-bars cover' }, ...sv.map(([k, v]) => barRow(k, v, 1, pct(v)))),
      el('dl', { cls: 'rows' }, el('dt', { text: 'Habitants' }), el('dd', { text: fmt(r.demography.population) }),
        el('dt', { text: 'Élèves' }), el('dd', { text: fmt(r.demography.pupils) })),
    ];
  }

  private buildTransport(r: SimReport | null, s: SimStats | null, m: WorldMirror | null, tab: string): HTMLElement[] {
    if (tab === 'network') {
      if (!m) return [this.waiting()];
      const len = new Map<string, number>();
      for (const e of m.edges.values()) { const k = e.kind ?? e.type; len.set(k, (len.get(k) ?? 0) + e.length); }
      const rows = ROAD_KIND_ORDER.filter((k) => len.has(k)).map((k) => ({ name: roadDef(k)?.nameFr ?? k, v: len.get(k) ?? 0 }));
      const total = rows.reduce((a, b) => a + b.v, 0);
      if (!rows.length) return [el('p', { cls: 'muted small', text: 'Aucune route construite. Barre d’outils : Routes.' })];
      return [
        el('div', { cls: 'kpis' }, this.kpi('Réseau routier', `${(total / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km`), this.kpi('Tronçons', fmt(m.edges.size))),
        el('div', { cls: 'act-bars' }, ...rows.map((x) => barRow(x.name, x.v, total, `${fmt(x.v)} m`))),
      ];
    }
    if (!r) return [this.waiting()];
    const t = r.traffic;
    return [
      el('div', { cls: 'kpis' }, this.kpi('Véhicules en circulation', fmt(t.vehicles)), this.kpi('Vitesse moyenne', `${fmt(Math.round(t.meanSpeedKmh))} km/h`)),
      el('dl', { cls: 'rows' },
        el('dt', { text: 'Trajets arrivés' }), el('dd', { text: fmt(t.arrived) }),
        el('dt', { text: 'Bâtiments reliés au réseau' }), el('dd', { text: `${fmt(t.connectedBuildings)}${s ? ` / ${fmt(s.buildings)}` : ''}` }),
        el('dt', { text: 'Trajets des habitants vers le trafic' }), el('dd', { text: fmt(t.tripsFromCitizens) })),
      el('p', { cls: 'muted small', text: 'La gare, le port et l’aéroport se construisent depuis la barre d’outils Transports. Bus et tramway : bientôt.' }),
    ];
  }

  private buildEnvironment(r: SimReport | null, m: WorldMirror | null): HTMLElement[] {
    if (!r) return [this.waiting()];
    const d = r.demography;
    const parks = Array.from(this.publicCounts(m).values()).filter((c) => c.tags.includes('espace_vert') || c.tags.includes('parc')).reduce((a, c) => a + c.n, 0);
    const leisure = d.services['Loisirs'];
    return [
      el('div', { cls: 'kpis' }, this.kpi('Attractivité', pct(d.attractiveness)), this.kpi('Pollution moyenne', d.pollution.toLocaleString('fr-FR', { maximumFractionDigits: 2 }))),
      el('div', { cls: 'act-bars' }, barRow('Attractivité', d.attractiveness, 1, pct(d.attractiveness)), ...(leisure !== undefined ? [barRow('Accès aux loisirs', leisure, 1, pct(leisure))] : [])),
      el('dl', { cls: 'rows' }, el('dt', { text: 'Parcs et espaces verts' }), el('dd', { text: fmt(parks) })),
      el('p', { cls: 'muted small', text: 'Pollution : indice moyen subi par les habitants (sources industrielles, rayon 400 m).' }),
    ];
  }

  private buildStats(_r: SimReport | null, tab: string): HTMLElement[] {
    // Évolution sur 3 mois, 1 an ou toute la partie (relevés quotidiens sauvegardés : module « historique »).
    this.history.refresh();
    return this.history.build(tab as HistTab, this.d.stats());
  }

  private drawStats(tab: string): void {
    this.history.draw(tab as HistTab, this.d.stats());
  }

  /** Filtre du journal (toutes les gravités ou une seule). */
  private notifFilter: Severity | 'all' = 'all';

  private buildNotifications(): HTMLElement[] {
    if (!notifyLog.length) return [el('p', { cls: 'muted small', text: 'Aucune notification pour l’instant.' })];
    const chip = (label: string, icon: string, act: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', { cls: 'chip', attrs: { 'data-act': act, type: 'button' } }, iconEl(icon), el('span', { text: label }));
      b.addEventListener('click', fn);
      return b;
    };
    const readAll = chip('Tout marquer comme lu', 'check', 'read-all', () => { markAllRead(); this.render(true); });
    readAll.disabled = journal.unreadCount() === 0;
    const clear = chip('Tout effacer', 'close', 'clear', () => { clearLog(); this.render(true); });
    // Date de jeu (jour, mois, an) ; à défaut, date réelle complète (jamais une heure seule, ambiguë).
    const fmtT = (n: NotifyEntry): string => n.gameDate || new Date(n.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const item = (n: NotifyEntry): HTMLElement => {
      // Regroupement : le texte est déjà un résumé (« 12 constructions ») ; sinon compteur ×n.
      const summarized = n.count > 1 && n.text !== n.last;
      const li = el('li', { cls: `${n.kind} ${n.severity}${n.unread ? ' unread' : ''}`, attrs: { 'data-sev': n.severity, 'data-key': n.key, 'data-count': String(n.count) } },
        el('span', { cls: 'nico' }, iconEl(n.kind === 'error' ? 'alert' : n.kind === 'ok' ? 'check' : 'info')),
        el('span', { cls: 'ntext' }, el('span', { cls: 'nsev', text: SEVERITY_FR[n.severity] }), n.text, ...(n.count > 1 && !summarized ? [el('span', { cls: 'ncount', text: `×${n.count}` })] : [])),
        el('span', { cls: 'ntime', text: fmtT(n) }));
      if (summarized) li.dataset['tip'] = `Dernier : ${n.last}`;
      if (n.unread) li.addEventListener('click', () => { markEntryRead(n); this.render(true); });
      return li;
    };
    const counts = SEVERITY_ORDER.map((sv) => journal.unreadCount(sv));
    const summary = counts[0]! + counts[1]! > 0
      ? `${counts[0] ? `${counts[0]} urgente${counts[0] > 1 ? 's' : ''}` : ''}${counts[0] && counts[1] ? ' · ' : ''}${counts[1] ? `${counts[1]} importante${counts[1] > 1 ? 's' : ''}` : ''} non lue${counts[0]! + counts[1]! > 1 ? 's' : ''}`
      : 'Rien d’urgent ni d’important à traiter.';
    const out: HTMLElement[] = [el('div', { cls: 'notif-head' }, el('span', { cls: 'muted small', attrs: { 'data-notif-summary': '' }, text: summary }), el('div', { cls: 'chips' }, readAll, clear))];
    const filters = el('div', { cls: 'notif-filters', attrs: { role: 'tablist', 'aria-label': 'Gravité' } });
    for (const f of ['all', ...SEVERITY_ORDER] as const) {
      const n = f === 'all' ? notifyLog.length : notifyLog.filter((e) => e.severity === f).length;
      const b = el('button', { cls: this.notifFilter === f ? 'on' : '', text: `${f === 'all' ? 'Toutes' : SEVERITY_FR[f]} (${n})`, attrs: { type: 'button', 'data-filter': f, role: 'tab', 'aria-selected': String(this.notifFilter === f) } });
      b.addEventListener('click', () => { this.notifFilter = f; this.render(true); });
      filters.append(b);
    }
    out.push(filters);
    // Classement par gravité (urgent, important, info), du plus récent au plus ancien dans chaque groupe.
    for (const sev of SEVERITY_ORDER) {
      if (this.notifFilter !== 'all' && this.notifFilter !== sev) continue;
      const list = journal.bySeverity(sev);
      if (!list.length) continue;
      out.push(el('div', { cls: 'sec-title', text: `${SEVERITY_FR[sev]} (${list.length})` }), el('ul', { cls: 'notif-list', attrs: { 'data-sev-list': sev } }, ...list.map(item)));
    }
    return out;
  }
}

let pendingRead = false;
function markInfoReadSoon(): void {
  if (pendingRead) return;
  pendingRead = true;
  queueMicrotask(() => { pendingRead = false; markSeverityRead('info'); });
}
