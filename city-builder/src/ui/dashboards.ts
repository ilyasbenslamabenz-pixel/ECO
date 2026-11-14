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
import { clearLog, markAllRead, notifyLog, onNotify, unreadCount } from './notify';

export type DashId = 'city' | 'services' | 'transport' | 'environment' | 'stats' | 'notifications' | 'policy' | 'research';

const META: Record<DashId, { title: string; icon: string; cls: string; kicker: string }> = {
  city: { title: 'Vue ville', icon: 'home', cls: 't-city', kicker: 'Tableau de bord' },
  services: { title: 'Services publics', icon: 'services', cls: 't-services', kicker: 'Tableau de bord' },
  transport: { title: 'Transports', icon: 'transport', cls: 't-transport', kicker: 'Tableau de bord' },
  environment: { title: 'Environnement', icon: 'leaf', cls: 't-nature', kicker: 'Tableau de bord' },
  stats: { title: 'Statistiques', icon: 'stats', cls: 't-stats', kicker: 'Historique mensuel' },
  notifications: { title: 'Notifications', icon: 'bell', cls: 't-notif', kicker: 'Journal' },
  policy: { title: 'Politiques', icon: 'policy', cls: 't-city', kicker: 'Gouvernance' },
  research: { title: 'Recherche', icon: 'research', cls: 't-city', kicker: 'Progression' },
};

/** Tableau de bord hôte de chaque module de phase 2. */
const MODULE_DASH: Record<string, DashId> = { circulation: 'transport', pietons: 'transport', batiments: 'city', chantiers: 'city', politiques: 'policy', recherche: 'research' };

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

  constructor(private d: DashDeps) {
    for (const b of Array.from(this.sidebar.querySelectorAll<HTMLButtonElement>('button[data-dash]'))) {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const id = b.dataset['dash'] ?? '';
        if (id === 'finance') d.openFinance();
        else if (id === 'population') d.openPop();
        // Modules électricité et eau : leur propre tableau de bord (le même que dans les tiroirs de construction).
        else if (id === 'waste') { this.hide(); window.dispatchEvent(new Event('dechets:open')); }
        else if (id === 'energy' || id === 'water') { this.hide(); document.getElementById(id === 'energy' ? 'elec-launcher' : 'eau-btn')?.click(); }
        else this.toggle(id as DashId);
        document.body.classList.remove('sidebar-open');
        $('btn-sidebar').setAttribute('aria-expanded', 'false');
        this.syncSidebar();
      });
    }
    $('dash-close').addEventListener('click', () => this.close());
    $('dash-fold').addEventListener('click', () => this.panel.classList.toggle('folded'));
    $('btn-stats').addEventListener('click', () => this.toggle('stats'));
    $('btn-notif').addEventListener('click', () => this.toggle('notifications'));
    onNotify(() => { this.syncBadge(); if (this.current === 'notifications') { markAllReadSoon(); this.render(true); } });
    this.syncBadge();
    window.addEventListener('resize', () => { if (this.current === 'stats') this.render(true); });
  }

  private syncBadge(): void {
    const n = unreadCount();
    const b = $('notif-badge');
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', n === 0);
    $('btn-notif').setAttribute('aria-label', n ? `Notifications (${n} non lues)` : 'Notifications');
  }

  /** Bouton actif de la barre latérale = panneau ouvert. */
  syncSidebar(): void {
    const open = !$('finance-panel').classList.contains('hidden') ? 'finance' : !$('pop-panel').classList.contains('hidden') ? 'population' : this.current;
    for (const b of Array.from(this.sidebar.querySelectorAll<HTMLButtonElement>('button[data-dash]'))) b.classList.toggle('active', b.dataset['dash'] === open);
    $('btn-stats').classList.toggle('active', this.current === 'stats');
    $('btn-notif').classList.toggle('active', this.current === 'notifications');
  }

  toggle(id: DashId): void { if (this.current === id && !this.panel.classList.contains('hidden')) this.close(); else this.open(id); }

  open(id: DashId, tab?: string): void {
    this.d.opened('dash');
    this.current = id;
    if (tab) this.tab[id] = tab;
    const m = META[id];
    $('dash-title').textContent = m.title;
    $('dash-kicker').textContent = m.kicker;
    const ico = $('dash-ico');
    ico.className = `ph-ico ${m.cls}`;
    ico.replaceChildren(iconEl(m.icon));
    this.panel.classList.remove('hidden', 'folded');
    this.panel.dataset['dash'] = id;
    if (id === 'notifications') markAllRead();
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
      stats: [{ id: 'pop', label: 'Habitants' }, { id: 'money', label: 'Trésorerie' }, { id: 'happy', label: 'Satisfaction' }, { id: 'jobs', label: 'Emploi' }],
      notifications: [{ id: 'log', label: 'Journal' }],
      policy: [], research: [],
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
      case 'policy': case 'research': return []; // contenu : panneau du module (politiques / recherche)
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
    // Modules de phase 2 enregistrés sans panneau livré.
    const pending = UI_PANELS.filter((p) => typeof p.mount !== 'function');
    if (pending.length) {
      out.push(...this.section('Modules de phase 2', el('ul', { cls: 'mod-list' }, ...pending.map((p) => el('li', {}, el('span', { text: p.title }), el('span', { cls: 'phase', text: `Phase ${p.phase}` }))))));
      out.push(el('p', { cls: 'muted small', text: 'Leur panneau apparaîtra ici (ou dans Transports) dès que le module le fournit.' }));
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
      el('p', { cls: 'muted small', text: 'Bus, tramway, port et aéroport : phase 2C. La gare se construit depuis la barre d’outils Transports.' }),
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
      el('p', { cls: 'muted small', text: 'Pollution : indice moyen subi par les habitants (sources industrielles, rayon 400 m). Qualité de l’air, de l’eau et du bruit détaillée : phase 2B.' }),
    ];
  }

  private buildStats(r: SimReport | null, tab: string): HTMLElement[] {
    const titles: Record<string, string> = { pop: 'Habitants en fin de mois', money: 'Trésorerie en fin de mois (CHF)', happy: 'Satisfaction moyenne (0 à 100)', jobs: 'Taux de chômage (%)' };
    const out: HTMLElement[] = [el('div', { cls: 'chart-wrap' }, el('div', { cls: 'chart-title', text: titles[tab] ?? '' }), el('canvas', { cls: 'chart', attrs: { id: 'stats-chart', height: '190', role: 'img', 'aria-label': titles[tab] ?? '' } }))];
    const h = r?.economy.history ?? [];
    out.push(el('p', { cls: 'muted small', text: h.length ? `${h.length} mois clos (24 derniers au plus).` : 'Les statistiques mensuelles apparaissent à la clôture du premier mois (le 1er du mois suivant).' }));
    return out;
  }

  private drawStats(tab: string): void {
    const c = document.getElementById('stats-chart') as HTMLCanvasElement | null;
    if (!c) return;
    const h = (this.d.report()?.economy.history ?? []).slice(-24);
    const pick: Record<string, { v: number[]; kind: 'bar' | 'line'; color: string; unit: string }> = {
      pop: { v: h.map((x) => x.population), kind: 'line', color: '#7cc4ff', unit: 'hab.' },
      money: { v: h.map((x) => x.moneyEnd), kind: 'line', color: '#3ddc84', unit: 'CHF' },
      happy: { v: h.map((x) => x.happiness), kind: 'line', color: '#ffd166', unit: '/100' },
      jobs: { v: h.map((x) => x.unemploymentRate * 100), kind: 'bar', color: '#ff8f6b', unit: '%' },
    };
    const p = pick[tab] ?? pick['pop']!;
    drawChart(c, { labels: h.map((x) => MONTHS_SHORT[x.month - 1] ?? ''), series: [{ kind: p.kind, axis: 'left', name: tab, values: p.v, color: p.color }], leftUnit: p.unit, empty: 'Aucun mois clos pour l’instant' });
  }

  private buildNotifications(): HTMLElement[] {
    if (!notifyLog.length) return [el('p', { cls: 'muted small', text: 'Aucune notification pour l’instant.' })];
    const clear = el('button', { cls: 'chip', attrs: { 'data-act': 'clear' } }, iconEl('close'), el('span', { text: 'Tout effacer' }));
    clear.addEventListener('click', () => { clearLog(); this.render(true); });
    const fmtT = (t: number): string => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return [
      el('ul', { cls: 'notif-list' }, ...notifyLog.slice().reverse().map((n) => el('li', { cls: n.kind },
        el('span', { cls: 'nico' }, iconEl(n.kind === 'error' ? 'alert' : n.kind === 'ok' ? 'check' : 'info')),
        el('span', { cls: 'ntext', text: n.count > 1 ? `${n.text} (×${n.count})` : n.text }), el('span', { cls: 'ntime', text: fmtT(n.at) })))),
      el('div', { cls: 'chips' }, clear),
    ];
  }
}

let pendingRead = false;
function markAllReadSoon(): void {
  if (pendingRead) return;
  pendingRead = true;
  queueMicrotask(() => { pendingRead = false; markAllRead(); });
}
