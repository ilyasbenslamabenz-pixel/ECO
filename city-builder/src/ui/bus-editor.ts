/**
 * Outil « Lignes de bus » (module « bus », docs/TRANSPORTS_COMMUN.md) : éditeur affiché dans le tiroir Transports.
 *
 *  - Liste des lignes (pastille de couleur, nom, voyages par jour) et bouton « Nouvelle ligne ».
 *  - Tracé : chaque toucher sur une route pose l'arrêt suivant (dans l'ordre) ; l'aperçu de la boucle (plus court
 *    chemin calculé par la simulation, commande `preview`) s'affiche avant de valider ; un arrêt se déplace en le
 *    faisant glisser, se sélectionne d'un toucher (puis « Retirer »).
 *  - Ligne existante : ajout d'arrêt (inséré là où il allonge le moins la boucle), déplacement, suppression, nom,
 *    couleur, nombre de bus (fréquence), tarif, suppression de la ligne ; fiche d'arrêt (montées, descentes, desserte).
 *  - Chaque modification passe par la simulation et empile son inverse dans l'historique d'annulation existant
 *    (`ConstructionTools.undo`, étapes `plugin`) : Ctrl+Z / bouton Annuler.
 *  - Tramway : « + Ligne de tram » (mêmes gestes, arrêts sur les routes équipées de voies) et « Voies de tram » : chaque
 *    toucher sur une route pose la voie du tronçon (voie partagée ou site propre) ou la retire ; annulable.
 * Au doigt : cibles d'au moins 44 px ; un doigt sur la carte la déplace, sauf s'il commence sur un arrêt (glisser) ;
 * un toucher bref pose un arrêt ; deux doigts gardent la caméra (`ToolController.setPointerOverride`).
 */
import { BUS_COLORS, BUS_FARE_MAX, BUS_MAX_BUSES_PER_LINE, type BusLineView, type BusState, type BusStopCard, type TransitMode } from '../shared/protocol-ext/bus';
import type { PointerToolSink } from '../input/camera';
import type { ToolController } from '../input/tools';
import type { ConstructionTools } from '../client/tools/machine';
import type { UndoStep } from '../client/tools/undo';
import { setBusDraft } from '../render/plugins/bus';
import { el, fmt, money } from './dom';

type AubeSend = (name: string, args: unknown) => Promise<unknown>;
type Notify = (t: string, k?: 'info' | 'error' | 'ok') => void;

/** Commande du module de simulation « bus » (rejet : erreur lisible). */
export async function busCommand<T = unknown>(name: string, payload?: unknown): Promise<T> {
  const send = (globalThis as unknown as { __aube?: { send?: AubeSend } }).__aube?.send;
  if (!send) throw new Error('Simulation non démarrée');
  const r = await send('pluginCommand', { plugin: 'bus', name, payload }) as { data?: unknown };
  return r?.data as T;
}
const errText = (e: unknown): string => {
  const o = e as { error?: { message?: string }; message?: string } | null;
  return o?.error?.message ?? o?.message ?? String(e);
};

const CSS = `
.drawer-body.bus-body { flex-direction: column; overflow-x: hidden; overflow-y: auto; scroll-snap-type: none; gap: 8px; align-items: stretch; }
#build-drawer[data-drawer="transport"].bus-mode { max-height: 60dvh; }
.bus-ed { display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.bus-ed .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bus-ed button { min-height: 44px; min-width: 44px; border-radius: 12px; padding: 0 14px; font-size: 15px; }
.bus-ed button.primary { background: var(--accent, #3d8bfd); color: #fff; font-weight: 600; }
.bus-ed button.danger { background: rgba(229,83,75,.18); color: #ff8a80; border: 1px solid rgba(229,83,75,.5); }
.bus-ed button.line-chip { display: inline-flex; align-items: center; gap: 8px; }
.bus-ed .dot { width: 16px; height: 16px; border-radius: 50%; display: inline-block; flex: none; border: 2px solid rgba(255,255,255,.7); }
.bus-ed .sw { width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 3px solid transparent; }
.bus-ed .row.swatches { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
.bus-ed .sw { flex: none; }
.bus-ed .sw.on { border-color: #fff; }
.bus-ed input.name { min-height: 44px; font-size: 16px; border-radius: 10px; padding: 0 10px; flex: 1 1 140px; min-width: 120px; }
.bus-ed .stepper { display: inline-flex; align-items: center; gap: 6px; }
.bus-ed .stepper b { min-width: 64px; text-align: center; }
.bus-ed .note { opacity: .8; font-size: 13px; }
.bus-ed .warn { color: #ffb14a; font-size: 13px; }
.bus-ed .err { color: #ff8a80; font-size: 13px; }
.bus-ed dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: 13px; }
.bus-ed dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.bus-ed .card { border: 1px solid var(--line, #444); border-radius: 12px; padding: 8px 10px; }
`;
let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  document.head.append(el('style', { text: CSS, attrs: { 'data-bus-editor': '' } }));
}

interface DraftStop { x: number; z: number; ok: boolean }
type Mode =
  | { kind: 'list' }
  | { kind: 'draft'; stops: DraftStop[]; selected: number; color: string; name: string; mode: TransitMode }
  | { kind: 'edit'; lineId: number; selected: number | null; confirmDelete: boolean }
  | { kind: 'tracks'; dedicated: boolean; remove: boolean };

export interface BusEditorDeps {
  tools: ToolController;
  machine: ConstructionTools;
  notify: Notify;
  /** Ouvre l'onglet des gares et dépôts du tiroir Transports. */
  openDepots(): void;
}

const kmMin = (m: number): string => (m >= 1000 ? `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km` : `${fmt(m)} m`);
const minutes = (v: number): string => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} min`;
const fare = (v: number): string => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`;

/** Éditeur de lignes (une instance, rendue dans le tiroir Transports quand l'onglet « Lignes de bus » est choisi). */
export class BusEditor implements PointerToolSink {
  private mode: Mode = { kind: 'list' };
  private state: BusState | null = null;
  private deps: BusEditorDeps | null = null;
  private host: HTMLElement | null = null;
  private active = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private drag: { index: number; stopId: number; x: number; z: number; moved: boolean } | null = null;
  private previewSeq = 0;
  private preview: { points: number[]; lengthM: number; cycleMin: number; problem: string | null; cost: number } | null = null;
  private card: BusStopCard | null = null;
  private busy = false;

  /* ------------------------------ Tiroir ------------------------------ */

  render(o: { tabs: HTMLElement; body: HTMLElement; deps: BusEditorDeps }): void {
    ensureCss();
    this.deps = o.deps;
    o.body.classList.add('bus-body');
    o.body.closest('#build-drawer')?.classList.add('bus-mode');
    this.host = el('div', { cls: 'bus-ed', attrs: { 'data-bus-editor': '1' } });
    o.body.append(this.host);
    this.activate();
    this.draw();
    void this.refresh();
  }

  closed(): void {
    if (!this.active) return;
    this.active = false;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.host?.closest('#build-drawer')?.classList.remove('bus-mode');
    this.host = null;
    this.drag = null;
    setBusDraft(null);
    const t = this.deps?.tools;
    if (t && t.pointerOverride === this) t.setPointerOverride(null);
  }

  private activate(): void {
    if (this.active) return;
    this.active = true;
    this.deps!.tools.setPointerOverride(this, () => { if (this.active) { this.active = false; this.mode = { kind: 'list' }; setBusDraft(null); if (this.poll) clearInterval(this.poll); this.poll = null; } });
    this.poll = setInterval(() => { void this.refresh(); }, 1500);
  }

  private async refresh(): Promise<void> {
    try {
      this.state = await busCommand<BusState>('state');
      if (this.mode.kind === 'edit') {
        const m = this.mode;
        if (!this.state.lines.some((l) => l.id === m.lineId)) this.mode = { kind: 'list' };
        else if (m.selected !== null) this.card = await busCommand<BusStopCard>('stop', { stopId: m.selected }).catch(() => null);
      }
      this.syncDraftView();
      this.draw();
    } catch { /* hors partie */ }
  }

  private line(id: number): BusLineView | undefined { return this.state?.lines.find((l) => l.id === id); }

  private pushUndo(label: string, steps: UndoStep[]): void {
    const m = this.deps?.machine;
    if (!m) return;
    m.undo.push({ label, steps });
    m.refresh();
  }

  /* ------------------------------ Affichage ------------------------------ */

  private btn(text: string, on: () => void, cls = '', attrs: Record<string, string> = {}): HTMLButtonElement {
    const b = el('button', { cls, text, attrs: { type: 'button', ...attrs } });
    b.addEventListener('click', (e) => { e.stopPropagation(); on(); });
    return b;
  }

  private draw(): void {
    const h = this.host;
    if (!h) return;
    const s = this.state;
    const parts: HTMLElement[] = [];
    if (this.mode.kind === 'list') {
      parts.push(el('div', { cls: 'note', text: 'Lignes de bus et de tram : posez les arrêts sur les routes, dans l’ordre ; la ligne revient au premier arrêt par le plus court chemin. Le tram ne roule que sur les routes équipées de voies.' }));
      const row = el('div', { cls: 'row' });
      row.append(this.btn('+ Nouvelle ligne', () => this.startDraft('bus'), 'primary', { 'data-bus': 'new' }));
      row.append(this.btn('+ Ligne de tram', () => this.startDraft('tram'), '', { 'data-bus': 'new-tram' }));
      row.append(this.btn('Voies de tram', () => { this.mode = { kind: 'tracks', dedicated: false, remove: false }; this.syncDraftView(); this.draw(); }, '', { 'data-bus': 'tracks' }));
      for (const l of s?.lines ?? []) {
        const b = this.btn('', () => { this.mode = { kind: 'edit', lineId: l.id, selected: null, confirmDelete: false }; this.card = null; this.syncDraftView(); this.draw(); }, 'line-chip', { 'data-bus-line': String(l.id) });
        b.append(el('span', { cls: 'dot', attrs: { style: `background:${l.color}` } }), el('span', { text: `${l.mode === 'tram' ? 'Tram · ' : ''}${l.name} · ${fmt(l.stats.ridersDay)} voy./j` }));
        row.append(b);
      }
      parts.push(row);
      if (s) { parts.push(this.depotLine('bus')); if (s.lines.some((l) => l.mode === 'tram') || (s.summary.tram?.trackM ?? 0) > 0) parts.push(this.depotLine('tram')); }
    } else if (this.mode.kind === 'tracks') {
      const m = this.mode;
      const tr = s?.summary.tram;
      parts.push(el('div', { cls: 'note', text: 'Voies de tram : touchez une route pour équiper le tronçon (ni rue piétonne, ni autoroute). En site propre, les rames ne subissent pas les bouchons.' }));
      parts.push(el('div', { cls: 'row', attrs: { role: 'radiogroup', 'aria-label': 'Type de voie' } },
        this.btn('Voie partagée', () => { m.dedicated = false; m.remove = false; this.draw(); }, !m.remove && !m.dedicated ? 'primary' : '', { 'data-bus': 'track-shared' }),
        this.btn('Site propre', () => { m.dedicated = true; m.remove = false; this.draw(); }, !m.remove && m.dedicated ? 'primary' : '', { 'data-bus': 'track-dedicated' }),
        this.btn('Retirer', () => { m.remove = true; this.draw(); }, m.remove ? 'danger' : '', { 'data-bus': 'track-remove' })));
      if (tr) parts.push(el('div', { cls: 'note', attrs: { 'data-bus': 'track-stats' }, text: `Voies posées : ${kmMin(tr.trackM)}${tr.dedicatedM ? ` (dont ${kmMin(tr.dedicatedM)} en site propre)` : ''}` }));
      parts.push(el('div', { cls: 'row' }, this.btn('Terminer', () => { this.mode = { kind: 'list' }; this.syncDraftView(); this.draw(); }, 'primary', { 'data-bus': 'done' })));
      if (s) parts.push(this.depotLine('tram'));
    } else if (this.mode.kind === 'draft') {
      const m = this.mode;
      parts.push(el('div', { cls: 'row' }, el('span', { cls: 'dot', attrs: { style: `background:${m.color}` } }), el('b', { text: m.name }), el('span', { cls: 'note', text: `${m.stops.length} arrêt${m.stops.length > 1 ? 's' : ''} · touchez une ${m.mode === 'tram' ? 'route équipée de voies de tram' : 'route'} pour poser l’arrêt suivant` })));
      parts.push(this.swatches(m.color, (c) => { m.color = c; this.syncDraftView(); this.draw(); }));
      const p = this.preview;
      if (p && m.stops.length >= 2) {
        parts.push(el('div', { cls: p.problem ? 'err' : 'note', attrs: { 'data-bus-preview': p.problem ? 'ko' : 'ok' }, text: p.problem ?? `Boucle de ${kmMin(p.lengthM)} · un tour en ${minutes(p.cycleMin)} · coût des ${m.mode === 'tram' ? 'quais' : 'abribus'} ${money(p.cost)}` }));
      } else if (p?.problem) parts.push(el('div', { cls: 'warn', text: p.problem }));
      const row = el('div', { cls: 'row' });
      row.append(this.btn('Valider la ligne', () => void this.commitDraft(), 'primary', { 'data-bus': 'validate', ...(m.stops.length < 2 || p?.problem ? { disabled: '' } : {}) }));
      if (m.selected >= 0) row.append(this.btn('Retirer l’arrêt', () => { m.stops.splice(m.selected, 1); m.selected = -1; void this.updatePreview(); }, 'danger', { 'data-bus': 'remove-draft-stop' }));
      else if (m.stops.length) row.append(this.btn('Retirer le dernier', () => { m.stops.pop(); void this.updatePreview(); }, '', { 'data-bus': 'pop' }));
      row.append(this.btn('Abandonner', () => { this.mode = { kind: 'list' }; this.preview = null; this.syncDraftView(); this.draw(); }, '', { 'data-bus': 'cancel' }));
      parts.push(row);
      if (s) parts.push(this.depotLine(m.mode));
    } else {
      const m = this.mode;
      const l = this.line(m.lineId);
      if (!l) { this.mode = { kind: 'list' }; this.draw(); return; }
      const name = el('input', { cls: 'name', attrs: { type: 'text', value: l.name, maxlength: '40', 'aria-label': 'Nom de la ligne', 'data-bus': 'name' } });
      name.addEventListener('change', () => void this.update(l, { name: name.value }, 'Nom de la ligne'));
      parts.push(el('div', { cls: 'row' }, el('span', { cls: 'dot', attrs: { style: `background:${l.color}` } }), name));
      parts.push(this.swatches(l.color, (c) => void this.update(l, { color: c }, 'Couleur de la ligne')));
      const tram = l.mode === 'tram';
      const unit = tram ? (l.buses > 1 ? 'rames' : 'rame') : 'bus';
      const buses = el('div', { cls: 'stepper' },
        this.btn('−', () => void this.update(l, { buses: Math.max(0, l.buses - 1) }, tram ? 'Rames de la ligne' : 'Bus de la ligne'), '', { 'aria-label': tram ? 'Une rame de moins' : 'Un bus de moins', 'data-bus': 'buses-minus' }),
        el('b', { text: `${l.buses} ${unit}`, attrs: { 'data-bus': 'buses' } }),
        this.btn('+', () => void this.update(l, { buses: Math.min(BUS_MAX_BUSES_PER_LINE, l.buses + 1) }, tram ? 'Rames de la ligne' : 'Bus de la ligne'), '', { 'aria-label': tram ? 'Une rame de plus' : 'Un bus de plus', 'data-bus': 'buses-plus' }));
      const fares = el('div', { cls: 'stepper' },
        this.btn('−', () => void this.update(l, { fare: Math.max(0, l.fare - 0.25) }, 'Tarif de la ligne'), '', { 'aria-label': 'Tarif plus bas', 'data-bus': 'fare-minus' }),
        el('b', { text: fare(l.fare), attrs: { 'data-bus': 'fare' } }),
        this.btn('+', () => void this.update(l, { fare: Math.min(BUS_FARE_MAX, l.fare + 0.25) }, 'Tarif de la ligne'), '', { 'aria-label': 'Tarif plus haut', 'data-bus': 'fare-plus' }));
      parts.push(el('div', { cls: 'row' }, el('span', { cls: 'note', text: tram ? 'Rames' : 'Bus' }), buses, el('span', { cls: 'note', text: 'Tarif' }), fares));
      parts.push(el('dl', {},
        el('dt', { text: 'Fréquence' }), el('dd', { text: l.headwayMin > 0 ? `${tram ? 'une rame' : 'un bus'} toutes les ${minutes(l.headwayMin)} (${l.activeBuses} en service)` : 'ne roule pas' }),
        el('dt', { text: 'Boucle' }), el('dd', { text: `${kmMin(l.lengthM)}, ${l.stopIds.length} arrêts, un tour en ${minutes(l.cycleMin)}` }),
        el('dt', { text: 'Voyages par jour' }), el('dd', { text: `${fmt(l.stats.ridersDay)}${l.stats.refusedDay ? ` (${fmt(l.stats.refusedDay)} refusés : ${tram ? 'rames pleines' : 'bus pleins'})` : ''}` }),
        el('dt', { text: 'Charge à la pointe' }), el('dd', { text: `${Math.round(l.stats.load * 100)} %` }),
        el('dt', { text: 'Recettes / coût du mois' }), el('dd', { text: `${money(l.stats.revenueMonth)} / ${money(l.stats.costMonth)}` })));
      if (l.problem) parts.push(el('div', { cls: 'warn', attrs: { 'data-bus-problem': '1' }, text: l.problem }));
      parts.push(el('div', { cls: 'note', text: 'Touchez une route pour ajouter un arrêt · glissez un arrêt pour le déplacer · touchez-le pour sa fiche' }));
      if (m.selected !== null && this.card && this.card.stop.id === m.selected) parts.push(this.stopCard(l, this.card));
      const row = el('div', { cls: 'row' });
      row.append(this.btn('Terminer', () => { this.mode = { kind: 'list' }; this.card = null; this.syncDraftView(); this.draw(); }, 'primary', { 'data-bus': 'done' }));
      row.append(this.btn(m.confirmDelete ? 'Confirmer la suppression' : 'Supprimer la ligne', () => {
        if (!m.confirmDelete) { m.confirmDelete = true; this.draw(); return; }
        void this.deleteLine(l);
      }, 'danger', { 'data-bus': 'delete-line' }));
      row.append(this.btn('Tableau de bord', () => window.dispatchEvent(new CustomEvent('ui:open-dash', { detail: 'transport' })), '', { 'data-bus': 'dash' }));
      parts.push(row);
    }
    h.replaceChildren(...parts);
  }

  private depotLine(mode: TransitMode = 'bus'): HTMLElement {
    const s = this.state!.summary;
    if (mode === 'tram') {
      const t = s.tram;
      if (t && t.depots > 0) return el('div', { cls: 'note', text: `Dépôts de tram : ${t.depots} (${t.vehiclesActive} rames en service sur ${t.depotCapacity} places) · ${fmt(t.ridersDay)} voyages par jour` });
      const box = el('div', { cls: 'row' }, el('span', { cls: 'warn', text: 'Aucun dépôt de tram : les lignes de tram ne rouleront pas.' }));
      box.append(this.btn('Poser un dépôt', () => this.deps?.openDepots(), '', { 'data-bus': 'depots-tram' }));
      return box;
    }
    if (s.depots > 0) return el('div', { cls: 'note', text: `Dépôts : ${s.depots} (${s.busesActive} bus en service sur ${s.depotCapacity} places) · ${fmt(s.ridersDay)} voyages par jour` });
    const box = el('div', { cls: 'row' }, el('span', { cls: 'warn', text: 'Aucun dépôt de bus : les lignes ne rouleront pas.' }));
    box.append(this.btn('Poser un dépôt', () => this.deps?.openDepots(), '', { 'data-bus': 'depots' }));
    return box;
  }

  private swatches(current: string, pick: (c: string) => void): HTMLElement {
    const row = el('div', { cls: 'row swatches', attrs: { role: 'radiogroup', 'aria-label': 'Couleur de la ligne' } });
    for (const c of BUS_COLORS) {
      const b = this.btn('', () => pick(c), `sw${c === current ? ' on' : ''}`, { style: `background:${c}`, 'aria-label': `Couleur ${c}`, 'data-color': c });
      row.append(b);
    }
    return row;
  }

  private stopCard(l: BusLineView, c: BusStopCard): HTMLElement {
    const name = el('input', { cls: 'name', attrs: { type: 'text', value: c.stop.name, maxlength: '40', 'aria-label': 'Nom de l’arrêt', 'data-bus': 'stop-name' } });
    name.addEventListener('change', () => {
      const id = c.stop.id;
      void busCommand<{ previous: string }>('renameStop', { stopId: id, name: name.value }).then((r) => {
        this.pushUndo('Nom de l’arrêt', [{ kind: 'plugin', plugin: 'bus', name: 'renameStop', payload: { stopId: id, name: r.previous } }]);
        void this.refresh();
      }).catch((e: unknown) => this.deps?.notify(errText(e), 'error'));
    });
    return el('div', { cls: 'card', attrs: { 'data-bus-card': String(c.stop.id) } },
      el('div', { cls: 'row' }, el('span', { cls: 'dot', attrs: { style: `background:${l.color}` } }), name),
      el('dl', {},
        el('dt', { text: 'Position' }), el('dd', { text: `arrêt ${c.index} sur ${c.count}` }),
        el('dt', { text: 'Montées / descentes par jour' }), el('dd', { text: `${fmt(c.stop.boardings)} / ${fmt(c.stop.alightings)}` }),
        el('dt', { text: 'À 400 m à pied' }), el('dd', { text: `${fmt(c.residentsCovered)} habitants, ${fmt(c.jobsCovered)} emplois` }),
        el('dt', { text: 'Attente moyenne' }), el('dd', { text: c.headwayMin > 0 ? minutes(c.headwayMin / 2) : 'ligne arrêtée' })),
      el('div', { cls: 'row' },
        this.btn('Retirer l’arrêt', () => void this.removeStop(c.stop.id), 'danger', { 'data-bus': 'remove-stop' }),
        this.btn('Fermer', () => { if (this.mode.kind === 'edit') this.mode.selected = null; this.card = null; this.syncDraftView(); this.draw(); }, '', { 'data-bus': 'close-card' })));
  }

  /* ------------------------------ Aperçu ------------------------------ */

  private startDraft(mode: TransitMode = 'bus'): void {
    const used = new Set((this.state?.lines ?? []).map((l) => l.color));
    const color = BUS_COLORS.find((c) => !used.has(c)) ?? BUS_COLORS[0]!;
    const n = (this.state?.lines.length ?? 0) + 1;
    this.mode = { kind: 'draft', stops: [], selected: -1, color, name: mode === 'tram' ? `Tram ${n}` : `Ligne ${n}`, mode };
    this.preview = null;
    this.syncDraftView();
    this.draw();
  }

  /** Arrêts affichés en anneaux (aperçu ou ligne en cours d'édition) et tracé d'aperçu. */
  private syncDraftView(): void {
    const m = this.mode;
    if (m.kind === 'draft') { setBusDraft({ points: this.preview?.points ?? [], stops: m.stops, color: m.color, selected: m.selected }); return; }
    if (m.kind === 'edit') {
      const l = this.line(m.lineId);
      const stops = l ? l.stopIds.map((id) => this.state!.stops.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s) : [];
      const pts = stops.map((s) => ({ x: s.x, z: s.z, ok: s.ok }));
      if (this.drag) { const d = pts[this.drag.index]; if (d) { d.x = this.drag.x; d.z = this.drag.z; } }
      setBusDraft({ points: [], stops: pts, color: l?.color ?? '#ffffff', selected: m.selected !== null ? stops.findIndex((s) => s.id === m.selected) : -1 });
      return;
    }
    setBusDraft(null);
  }

  private async updatePreview(): Promise<void> {
    const m = this.mode;
    if (m.kind !== 'draft') return;
    const seq = ++this.previewSeq;
    try {
      const r = await busCommand<{ points: number[]; stops: DraftStop[]; lengthM: number; cycleMin: number; problem: string | null; cost: number }>('preview', { mode: m.mode, stops: m.stops.map((s) => ({ x: s.x, z: s.z })) });
      if (seq !== this.previewSeq || this.mode !== m) return;
      this.preview = r;
      r.stops.forEach((s, i) => { const d = m.stops[i]; if (d) { d.x = s.x; d.z = s.z; d.ok = s.ok; } });
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
    this.syncDraftView();
    this.draw();
  }

  private async commitDraft(): Promise<void> {
    const m = this.mode;
    if (m.kind !== 'draft' || this.busy) return;
    this.busy = true;
    try {
      const r = await busCommand<{ line: BusLineView; cost: number; warning: string | null }>('createLine', { mode: m.mode, name: m.name, color: m.color, stops: m.stops.map((s) => ({ x: s.x, z: s.z })) });
      this.pushUndo(`${m.mode === 'tram' ? 'Ligne de tram' : 'Ligne de bus'} : ${r.line.name}`, [{ kind: 'plugin', plugin: 'bus', name: 'deleteLine', payload: { id: r.line.id } }]);
      this.deps?.notify(r.warning ?? `${r.line.name} créée : ${r.line.stopIds.length} arrêts (${money(r.cost)})`, r.warning ? 'info' : 'ok');
      this.mode = { kind: 'edit', lineId: r.line.id, selected: null, confirmDelete: false };
      this.preview = null;
      await this.refresh();
    } catch (e) { this.deps?.notify(errText(e), 'error'); } finally { this.busy = false; }
  }

  /* ------------------------------ Édition ------------------------------ */

  private async update(l: BusLineView, patch: Record<string, unknown>, label: string): Promise<void> {
    try {
      const r = await busCommand<{ previous: Record<string, unknown> }>('updateLine', { id: l.id, ...patch });
      const prev: Record<string, unknown> = { id: l.id };
      for (const k of Object.keys(patch)) prev[k] = r.previous[k];
      this.pushUndo(label, [{ kind: 'plugin', plugin: 'bus', name: 'updateLine', payload: prev }]);
      await this.refresh();
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
  }

  private async deleteLine(l: BusLineView): Promise<void> {
    try {
      const r = await busCommand<{ record: unknown }>('deleteLine', { id: l.id });
      this.pushUndo(`Suppression : ${l.name}`, [{ kind: 'plugin', plugin: 'bus', name: 'restoreLine', payload: { line: r.record } }]);
      this.deps?.notify(`${l.name} supprimée`, 'ok');
      this.mode = { kind: 'list' };
      this.card = null;
      await this.refresh();
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
  }

  private async removeStop(stopId: number): Promise<void> {
    try {
      const r = await busCommand<{ lineId: number; index: number; x: number; z: number }>('removeStop', { stopId });
      this.pushUndo('Arrêt retiré', [{ kind: 'plugin', plugin: 'bus', name: 'addStop', payload: { lineId: r.lineId, x: r.x, z: r.z, index: r.index } }]);
      if (this.mode.kind === 'edit') this.mode.selected = null;
      this.card = null;
      await this.refresh();
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
  }

  /* ------------------------------ Gestes ------------------------------ */

  /** Mètres par pixel autour du point visé (cibles tactiles en pixels, quel que soit le zoom). */
  private metersPerPx(sx: number, sy: number): number {
    const t = this.deps?.tools;
    const a = t?.groundAt(sx, sy), b = t?.groundAt(sx + 40, sy);
    return a && b ? Math.max(0.05, Math.hypot(a.x - b.x, a.z - b.z) / 40) : 1;
  }

  private shownStops(): { x: number; z: number; id: number }[] {
    const m = this.mode;
    if (m.kind === 'draft') return m.stops.map((s, i) => ({ x: s.x, z: s.z, id: i }));
    if (m.kind === 'edit') {
      const l = this.line(m.lineId);
      return l ? l.stopIds.flatMap((id) => { const s = this.state!.stops.find((q) => q.id === id); return s ? [{ x: s.x, z: s.z, id }] : []; }) : [];
    }
    return [];
  }

  /** Arrêt sous le doigt (rang dans la liste affichée), -1 sinon : rayon de 32 px au moins 6 m. */
  private hit(sx: number, sy: number, type: string): number {
    const g = this.deps?.tools.groundAt(sx, sy);
    if (!g) return -1;
    const r = Math.max(6, (type === 'touch' ? 32 : 18) * this.metersPerPx(sx, sy));
    let best = -1, bd = r;
    this.shownStops().forEach((s, i) => { const d = Math.hypot(s.x - g.x, s.z - g.z); if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  capturesPrimary(): boolean { return this.mode.kind !== 'list'; }
  /** Le geste n'est pris que s'il commence sur un arrêt (glisser) ; ailleurs, la carte se déplace et un toucher pose. */
  capturesAt(sx: number, sy: number, type: string): boolean { return this.mode.kind !== 'tracks' && this.hit(sx, sy, type) >= 0; }

  hover(): void { /* rien : les arrêts sont toujours visibles */ }

  down(sx: number, sy: number, type: string): void {
    const i = this.hit(sx, sy, type);
    const s = this.shownStops()[i];
    this.drag = s ? { index: i, stopId: s.id, x: s.x, z: s.z, moved: false } : null;
  }

  move(sx: number, sy: number): void {
    const d = this.drag;
    const g = this.deps?.tools.groundAt(sx, sy);
    if (!d || !g) return;
    if (Math.hypot(g.x - d.x, g.z - d.z) > 0.5) d.moved = true;
    d.x = g.x; d.z = g.z;
    if (this.mode.kind === 'draft') { const st = this.mode.stops[d.index]; if (st) { st.x = g.x; st.z = g.z; } }
    this.syncDraftView();
  }

  up(sx: number, sy: number, type: string, tap: boolean): void {
    const d = this.drag;
    this.drag = null;
    const m = this.mode;
    if (d && d.moved && !tap) {
      if (m.kind === 'draft') { m.selected = d.index; void this.updatePreview(); }
      else if (m.kind === 'edit') void this.moveStop(d.stopId, d.x, d.z);
      return;
    }
    if (!tap) return;
    if (m.kind === 'tracks') {
      const g = this.deps?.tools.groundAt(sx, sy);
      if (g) void this.toggleTrack(g.x, g.z, m);
      return;
    }
    const i = d ? d.index : this.hit(sx, sy, type);
    if (i >= 0) {
      // Toucher sur un arrêt : sélection (fiche ou « Retirer »).
      if (m.kind === 'draft') { m.selected = m.selected === i ? -1 : i; this.syncDraftView(); this.draw(); }
      else if (m.kind === 'edit') {
        const id = this.shownStops()[i]!.id;
        m.selected = m.selected === id ? null : id;
        this.card = null;
        this.syncDraftView();
        if (m.selected !== null) void busCommand<BusStopCard>('stop', { stopId: id }).then((c) => { this.card = c; this.draw(); }).catch(() => undefined);
        this.draw();
      }
      return;
    }
    const g = this.deps?.tools.groundAt(sx, sy);
    if (!g) return;
    if (m.kind === 'draft') void this.addDraftStop(g.x, g.z);
    else if (m.kind === 'edit') void this.addStop(m.lineId, g.x, g.z);
  }

  cancel(): void { this.drag = null; this.syncDraftView(); }
  secondary(): void {
    const m = this.mode;
    if (m.kind === 'draft' && m.stops.length) { m.stops.pop(); void this.updatePreview(); }
  }

  /** Voie de tram du tronçon touché : pose (partagée / site propre) ou retrait ; l'inverse est empilé (annulation). */
  private async toggleTrack(x: number, z: number, m: { dedicated: boolean; remove: boolean }): Promise<void> {
    try {
      const r = await busCommand<{ segId: number; on: boolean; dedicated: boolean; lengthM: number; cost: number; previous: { on: boolean; dedicated: boolean } }>('track', { x, z, on: !m.remove, dedicated: m.dedicated });
      if (r.previous.on !== r.on || r.previous.dedicated !== r.dedicated) {
        this.pushUndo(r.on ? 'Voie de tram' : 'Voie de tram retirée', [{ kind: 'plugin', plugin: 'bus', name: 'track', payload: { segId: r.segId, on: r.previous.on, dedicated: r.previous.dedicated } }]);
      }
      this.deps?.notify(r.on ? `Voie de tram ${r.dedicated ? 'en site propre' : 'partagée'} : ${kmMin(r.lengthM)}${r.cost ? ` (${money(r.cost)})` : ''}` : `Voie de tram retirée (${kmMin(r.lengthM)})`, 'ok');
      await this.refresh();
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
  }

  private async addDraftStop(x: number, z: number): Promise<void> {
    const m = this.mode;
    if (m.kind !== 'draft') return;
    try {
      const s = await busCommand<{ x: number; z: number }>('snap', { x, z, mode: m.mode });

      if (this.mode !== m) return;
      m.stops.push({ x: s.x, z: s.z, ok: true });
      m.selected = -1;
      await this.updatePreview();
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
  }

  private async addStop(lineId: number, x: number, z: number): Promise<void> {
    try {
      const r = await busCommand<{ stop: { id: number; name: string }; cost: number }>('addStop', { lineId, x, z });
      this.pushUndo('Arrêt ajouté', [{ kind: 'plugin', plugin: 'bus', name: 'removeStop', payload: { stopId: r.stop.id } }]);
      this.deps?.notify(`${r.stop.name} ajouté (${money(r.cost)})`, 'ok');
      await this.refresh();
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
  }

  private async moveStop(stopId: number, x: number, z: number): Promise<void> {
    try {
      const r = await busCommand<{ previous: { x: number; z: number } }>('moveStop', { stopId, x, z });
      this.pushUndo('Arrêt déplacé', [{ kind: 'plugin', plugin: 'bus', name: 'moveStop', payload: { stopId, x: r.previous.x, z: r.previous.z } }]);
    } catch (e) { this.deps?.notify(errText(e), 'error'); }
    await this.refresh();
  }
}

export const busEditor = new BusEditor();
