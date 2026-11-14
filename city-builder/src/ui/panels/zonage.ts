/**
 * Interface du module « Zonage » (phase 2B) :
 *  - `zonageDrawer` : tiroir de l'onglet « Zones » de la barre de construction (src/ui/buildbar.ts) — types de
 *    zones, retrait du zonage, profondeur des bandes (1 à 4 cases de 8 m), croissance, jauge de demande R/C/B/I ;
 *    tant qu'il est ouvert, l'outil capture les gestes (`ToolController.setPointerOverride`) : un doigt ou la
 *    souris peint le long des routes, deux doigts déplacent la caméra ; la superposition n'est visible que là ;
 *  - `zonagePanel` : panneau du registre UI_PANELS (tableau de bord « Ville ») — demande et bâtiments du zonage.
 * Toutes les valeurs viennent de la simulation (`zoningView`, commande `state`) ; les commandes passent par
 * `window.__aube.send('pluginCommand', …)`.
 */
import {
  DEMAND_SECTORS, SECTOR_COLORS, SECTOR_LABELS_FR, ZONE_COLORS, ZONE_DEPTH_MAX, ZONE_DEPTH_MIN, ZONE_LABELS_FR, ZONE_SHORT_FR, ZONE_TYPES,
  type ZonageDemand, type ZonageSnapshot, type ZoneType,
} from '../../shared/protocol-ext/zonage';
import { TILE_SIZE } from '../../shared/constants';
import { zoningView } from '../../client/zoning-view';
import type { PointerToolSink } from '../../input/camera';
import type { ToolController } from '../../input/tools';
import type { BuildBarDeps, DrawerProvider } from '../buildbar';
import { el, phaseBadge } from '../dom';
import { iconEl } from '../icons';
import type { UiPanel } from './types';

/* ------------------------------- Commandes ------------------------------- */

type AubeSend = (name: string, args: unknown) => Promise<unknown>;

async function zonageCommand(name: string, payload?: unknown): Promise<unknown> {
  const send = (globalThis as unknown as { __aube?: { send?: AubeSend } }).__aube?.send;
  if (!send) throw new Error('Simulation non démarrée');
  const r = await send('pluginCommand', { plugin: 'zonage', name, payload }) as { data?: unknown };
  return r?.data;
}

/** Recharge l'état complet (grille, demande) dans la vue. */
async function refreshState(): Promise<void> {
  try {
    const s = await zonageCommand('state') as ZonageSnapshot | undefined;
    if (s?.grid) zoningView.reset(s);
  } catch { /* hors partie : rien à afficher */ }
}

const ZONE_ICONS: Record<ZoneType, string> = {
  res_faible: 'house', res_moyen: 'townhouse', res_dense: 'apartment', commerce: 'shop', bureaux: 'office', industrie: 'factory',
};

const pct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}`;

/* ------------------------------ Jauge R/C/B/I ------------------------------ */

/** Jauge de demande : une barre par secteur, centrée sur zéro (vers le haut = demande, vers le bas = excédent). */
export function demandGauge(d: ZonageDemand | null, compact = false): HTMLElement {
  const g = el('div', { cls: `zn-gauge${compact ? ' compact' : ''}`, attrs: { role: 'group', 'aria-label': 'Demande par secteur' } });
  for (const s of DEMAND_SECTORS) {
    const v = d ? d[s] : 0;
    const h = Math.round(Math.min(1, Math.abs(v)) * 50);
    const bar = el('div', { cls: 'zn-bar' },
      el('i', { attrs: { style: `background:${SECTOR_COLORS[s]};height:${h}%;${v >= 0 ? 'bottom:50%' : 'top:50%'}` } }));
    const col = el('div', { cls: 'zn-col', attrs: { 'data-sector': s, 'data-value': v.toFixed(3), title: `${SECTOR_LABELS_FR[s]} : ${pct(v)} %` } },
      bar, el('b', { text: s, attrs: { style: `color:${SECTOR_COLORS[s]}` } }));
    col.dataset['tip'] = `Demande ${SECTOR_LABELS_FR[s].toLowerCase()} : ${pct(v)} %`;
    g.append(col);
  }
  return g;
}

/* ------------------------------- Pinceau ------------------------------- */

/** Rayon du pinceau (m) : la bande entière des deux côtés d'une rue quand on suit son axe. */
const brushRadius = (): number => (zoningView.depth + 1) * TILE_SIZE;

/**
 * Outil de peinture : capte les gestes primaires, échantillonne le tracé au sol (un point tous les 3 m) et
 * l'envoie par morceaux (une commande en vol à la fois). Les cases changées reviennent dans la réponse.
 */
class ZonePainter implements PointerToolSink {
  private stroke: number[] = [];
  private sent = 0;
  private inflight = false;
  private painting = false;

  constructor(private tools: ToolController, private notify: (t: string, k?: 'info' | 'error' | 'ok') => void) {}

  capturesPrimary(): boolean { return true; }

  private ground(sx: number, sy: number): { x: number; z: number } | null {
    const g = this.tools.groundAt(sx, sy);
    return g ? { x: g.x, z: g.z } : null;
  }

  hover(sx: number, sy: number): void {
    const g = this.ground(sx, sy);
    zoningView.setCursor(g ? { x: g.x, z: g.z, r: brushRadius() } : null);
  }

  down(sx: number, sy: number): void {
    const g = this.ground(sx, sy);
    this.painting = !!g;
    this.stroke = g ? [g.x, g.z] : [];
    this.sent = 0;
    if (g) { zoningView.setCursor({ x: g.x, z: g.z, r: brushRadius() }); this.flush(); }
  }

  move(sx: number, sy: number): void {
    const g = this.ground(sx, sy);
    if (!g) return;
    zoningView.setCursor({ x: g.x, z: g.z, r: brushRadius() });
    if (!this.painting) return;
    const n = this.stroke.length;
    if (n >= 2 && Math.hypot(g.x - this.stroke[n - 2]!, g.z - this.stroke[n - 1]!) < 3) return;
    this.stroke.push(g.x, g.z);
    this.flush();
  }

  up(sx: number, sy: number): void {
    this.move(sx, sy);
    this.painting = false;
    this.flush();
  }

  cancel(): void { this.painting = false; }
  secondary(): void { /* clic droit : rien (la caméra pivote) */ }

  /** Envoie les points non envoyés (avec le dernier point envoyé, pour la continuité du tracé). */
  private flush(): void {
    if (this.inflight) return;
    const from = Math.max(0, this.sent - 2);
    if (this.stroke.length <= this.sent && !(this.sent === 0 && this.stroke.length >= 2)) return;
    const pts = this.stroke.slice(from);
    if (pts.length < 2) return;
    this.sent = this.stroke.length;
    this.inflight = true;
    zonageCommand('paint', { points: pts, zone: zoningView.brush, depth: zoningView.depth })
      .then((r) => {
        const res = r as { changed?: number; cells?: number[] } | undefined;
        if (res?.cells) zoningView.merge({ cells: res.cells });
      })
      .catch((e: unknown) => this.notify(`Zonage : ${e instanceof Error ? e.message : String(e)}`, 'error'))
      .finally(() => { this.inflight = false; if (this.stroke.length > this.sent) this.flush(); });
  }
}

/* -------------------------------- Tiroir -------------------------------- */

const PLANNED_ZONES = [
  { label: 'Agricole', icon: 'wheat', color: '#9bd84a', tip: 'Zone agricole (5e secteur fiscal)' },
  { label: 'Spécial', icon: 'star', color: '#ffd23f', tip: 'Zones spéciales (quartiers à thème)' },
];

class ZonageDrawer implements DrawerProvider {
  readonly tip = 'Zones : peindre le résidentiel, les commerces, les bureaux et l’industrie le long des routes ; les bâtiments poussent selon la demande';
  private painter: ZonePainter | null = null;
  private tools: ToolController | null = null;
  private active = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private gaugeHost: HTMLElement | null = null;
  private rerender: (() => void) | null = null;

  render(o: { tabs: HTMLElement; body: HTMLElement; deps: BuildBarDeps; close(): void; rerender(): void }): void {
    this.rerender = o.rerender;
    this.activate(o.deps);
    const v = zoningView;
    // En-tête : consigne et jauge de demande compacte (toujours visible, même sur téléphone).
    this.gaugeHost = el('div', { cls: 'zn-gauge-host' });
    this.fillGauge();
    o.tabs.append(el('span', { cls: 'drawer-note zn-note' }, el('span', { text: 'Glisser le long des routes · 2 doigts : caméra' })), this.gaugeHost);
    // Types de zones.
    for (const z of ZONE_TYPES) {
      const b = el('button', { cls: `tile zn-tile${v.brush === z ? ' active' : ''}`, attrs: { 'data-zone': z, style: `--ic:${ZONE_COLORS[z]}`, 'aria-pressed': String(v.brush === z) } },
        el('span', { cls: 'tile-ico' }, iconEl(ZONE_ICONS[z])), el('span', { cls: 'nm', text: ZONE_SHORT_FR[z] }));
      b.dataset['tip'] = `${ZONE_LABELS_FR[z]} : glisser le long d’une route`;
      b.addEventListener('click', () => { v.brush = z; o.rerender(); });
      o.body.append(b);
    }
    const erase = el('button', { cls: `tile zn-tile zn-erase${v.brush === null ? ' active' : ''}`, attrs: { 'data-zone': 'retirer', style: '--ic:#ff6b6b', 'aria-pressed': String(v.brush === null) } },
      el('span', { cls: 'tile-ico' }, iconEl('demolish')), el('span', { cls: 'nm', text: 'Retirer' }));
    erase.dataset['tip'] = 'Retirer le zonage (les bâtiments déjà construits restent)';
    erase.addEventListener('click', () => { v.brush = null; o.rerender(); });
    o.body.append(erase);
    // Profondeur et croissance.
    const depth = el('div', { cls: 'seg zn-depth', attrs: { role: 'group', 'aria-label': 'Profondeur des bandes' } });
    for (let d = ZONE_DEPTH_MIN; d <= ZONE_DEPTH_MAX; d++) {
      const b = el('button', { cls: v.depth === d ? 'active' : '', text: String(d), attrs: { 'data-depth': String(d) } });
      b.dataset['tip'] = `Profondeur : ${d} case${d > 1 ? 's' : ''} (${d * TILE_SIZE} m) depuis la route`;
      b.addEventListener('click', () => { v.depth = d; o.rerender(); });
      depth.append(b);
    }
    const growth = v.settings?.growth ?? true;
    const gbtn = el('button', { cls: `zn-growth${growth ? ' active' : ''}`, text: growth ? 'Croissance : oui' : 'Croissance : pause', attrs: { 'data-growth': String(growth) } });
    gbtn.dataset['tip'] = 'Suspendre ou reprendre la croissance automatique des bâtiments';
    gbtn.addEventListener('click', () => {
      void zonageCommand('setGrowth', { enabled: !growth }).then(() => refreshState()).then(() => o.rerender()).catch(() => undefined);
    });
    o.body.append(el('div', { cls: 'drawer-opts zn-opts' }, el('span', { cls: 'hint', text: 'Profondeur (cases)' }), depth, gbtn));
    for (const p of PLANNED_ZONES) {
      const b = el('button', { cls: 'tile soon', attrs: { disabled: '', style: `--ic:${p.color}`, 'data-planned': p.label } },
        el('span', { cls: 'tile-ico' }, iconEl(p.icon)), el('span', { cls: 'nm', text: p.label }), phaseBadge('2B'));
      b.dataset['tip'] = `${p.tip} — à venir (non simulé pour l’instant)`;
      o.body.append(b);
    }
    o.body.scrollLeft = 0;
  }

  private fillGauge(): void {
    const host = this.gaugeHost;
    if (!host) return;
    const s = zoningView.stats;
    const grown = s ? Object.values(s.buildings).reduce((a, b) => a + b, 0) : 0;
    host.replaceChildren(
      el('span', { cls: 'zn-sum', text: 'Demande' }),
      demandGauge(zoningView.demand, true),
    );
    host.dataset['tip'] = s ? `Bâtiments nés du zonage : ${grown} · ${s.residents} habitants · ${s.jobs} emplois` : 'Demande par secteur : résidentiel, commerces, bureaux, industrie';
  }

  private activate(deps: BuildBarDeps): void {
    if (this.active) return;
    this.active = true;
    this.tools = deps.tools;
    this.painter = new ZonePainter(deps.tools, deps.notify);
    deps.tools.setPointerOverride(this.painter, () => this.deactivate());
    zoningView.setToolActive(true);
    void refreshState().then(() => this.fillGauge());
    this.unsub = zoningView.on((c) => { if (c.kind === 'info' || c.kind === 'all') this.fillGauge(); });
    // Jauge vivante même en pause (la demande est recalculée à la demande).
    this.poll = setInterval(() => { void refreshState(); }, 4000);
  }

  private deactivate(): void {
    if (!this.active) return;
    this.active = false;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.unsub?.();
    this.unsub = null;
    zoningView.setCursor(null);
    zoningView.setToolActive(false);
    const t = this.tools;
    this.tools = null;
    if (t && t.pointerOverride === this.painter) t.setPointerOverride(null);
    this.painter = null;
  }

  closed(): void { this.deactivate(); }
}

export const zonageDrawer = new ZonageDrawer();

/* -------------------------------- Panneau -------------------------------- */

export const zonagePanel: UiPanel = {
  id: 'zonage',
  title: 'Zonage',
  phase: '2B',
  mount(root, api) {
    const draw = (): void => {
      const s = zoningView.stats;
      const inp = zoningView.inputs;
      const rows = ZONE_TYPES.map((z) => el('tr', {}, el('td', {}, el('span', { text: '■ ', attrs: { style: `color:${ZONE_COLORS[z]}` } }), ZONE_LABELS_FR[z]),
        el('td', { text: String(s?.cells[z] ?? 0) }), el('td', { text: String(s?.buildings[z] ?? 0) })));
      root.replaceChildren(
        el('div', { cls: 'zn-panel' },
          demandGauge(zoningView.demand),
          inp ? el('p', { cls: 'muted', text: `${inp.population} habitants · ${inp.workforce} actifs · ${inp.jobs} emplois · ${inp.housingFree} logements libres sur ${inp.housingCapacity}` }) : null,
          el('table', {}, el('tr', {}, el('th', { text: 'Zone' }), el('th', { text: 'Cases' }), el('th', { text: 'Bâtiments' })), ...rows),
          el('p', { cls: 'muted', text: s ? `${s.grown} bâtiments nés du zonage, ${s.densified} densifiés · ${s.connected} cases desservies` : 'Aucune zone : ouvrez l’onglet Zones de la barre de construction.' }),
        ),
      );
    };
    const unsub = zoningView.on((c) => { if (c.kind === 'info' || c.kind === 'all') draw(); });
    void api.command('state').then((s) => { const snap = s as ZonageSnapshot | undefined; if (snap?.grid) zoningView.reset(snap); }).catch(() => undefined).finally(draw);
    draw();
    return unsub;
  },
};
