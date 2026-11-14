/**
 * Rendu du module « Déchets » (phase 2B.6) — propriété de la branche p2b-dechets.
 * Camions-bennes, tumulus des décharges, panache de l'incinérateur, conteneurs de tri, calque « déchets »
 * (src/render/waste/layers.ts). Les installations elles-mêmes sont des bâtiments du catalogue, dessinées par
 * le rendu des bâtiments.
 *
 * Montage PROVISOIRE du panneau « Déchets » (src/ui/panels/dechets.ts) tant que la refonte d'interface ne monte
 * pas le registre UI_PANELS (docs/requests/dechets.md) : touche J (panneau), Maj+J (calque), et
 * `window.__dechets` (diagnostic e2e : camions, tumulus, calque, ouverture du panneau).
 */
import type { DechetsDelta, DechetsSnapshot } from '../../shared/protocol-ext/dechets';
import type { WasteSummary } from '../../shared/waste/types';
import { DECHETS_LAYER_EVENT, dechetsPanel } from '../../ui/panels/dechets';
import type { UiPanelApi } from '../../ui/panels/types';
import { ContainerLayer, FacilityLayer, TruckLayer, WasteOverlay } from '../waste/layers';
import type { RenderPlugin, RenderPluginContext } from './types';

interface DechetsDebug {
  trucks(): number;
  truckPositions(): number[];
  containers(): number;
  moundScale(buildingId: number): number | null;
  layerVisible(): boolean;
  setLayer(visible: boolean): void;
  layerStats(): { bins: number; cells: number };
  summary(): WasteSummary | null;
  openPanel(): HTMLElement | null;
  closePanel(): void;
}
declare global { interface Window { __dechets?: DechetsDebug } }

let trucks: TruckLayer | null = null;
let facilities: FacilityLayer | null = null;
let containers: ContainerLayer | null = null;
let overlay: WasteOverlay | null = null;
let summary: WasteSummary | null = null;
let snapshotPayload: DechetsSnapshot | undefined;
const listeners = new Set<(p: unknown) => void>();
let panelEl: HTMLElement | null = null;
let unmount: (() => void) | null = null;

function setLayer(v: boolean): void {
  overlay?.setVisible(v);
  window.dispatchEvent(new CustomEvent(`${DECHETS_LAYER_EVENT}:etat`, { detail: { visible: v } }));
}

function panelApi(): UiPanelApi {
  return {
    command: async (name, payload) => {
      const send = window.__aube?.send;
      if (!send) throw new Error('Simulation non démarrée');
      const r = await send('pluginCommand', { plugin: 'dechets', name, payload }) as { data?: unknown } | undefined;
      return r && typeof r === 'object' && 'data' in r ? r.data : r;
    },
    onDeltaExt: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshotExt: () => snapshotPayload,
    toast: (m) => { console.log(`[déchets] ${m}`); },
  };
}

function openPanel(): HTMLElement | null {
  if (panelEl) return panelEl;
  const root = document.createElement('aside');
  root.className = 'panel';
  root.id = 'dechets-panel';
  root.setAttribute('aria-label', dechetsPanel.title);
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = '<div><div class="kicker">Services urbains</div><h3>Déchets</h3></div>';
  const close = document.createElement('button');
  close.className = 'icon-btn'; close.textContent = '✕'; close.setAttribute('aria-label', 'Fermer');
  close.addEventListener('click', closePanel);
  head.append(close);
  const body = document.createElement('div');
  body.className = 'panel-body';
  root.append(head, body);
  document.body.append(root);
  const u = dechetsPanel.mount?.(body, panelApi());
  root.classList.add('dechets-panel');
  unmount = typeof u === 'function' ? u : null;
  panelEl = root;
  setLayer(overlay?.visible ?? false);
  return root;
}

function closePanel(): void {
  unmount?.(); unmount = null;
  panelEl?.remove(); panelEl = null;
}

const onKey = (e: KeyboardEvent): void => {
  if (e.code !== 'KeyJ' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (document.querySelector('.overlay:not(.hidden)')) return;
  if (e.shiftKey) setLayer(!(overlay?.visible ?? false));
  else if (panelEl) closePanel(); else openPanel();
};
const onLayerEvent = (e: Event): void => { overlay?.setVisible(!!(e as CustomEvent<{ visible: boolean }>).detail?.visible); };

function applyPayload(p: DechetsDelta | DechetsSnapshot): void {
  if (p.trucks) trucks?.apply(p.trucks);
  if (p.summary) { summary = p.summary; facilities?.apply(p.summary.facilities); }
  if (p.layer) overlay?.apply(p.layer);
  if (p.containers) containers?.apply(p.containers);
}

export const dechetsRenderPlugin: RenderPlugin = {
  id: 'dechets',
  init(ctx: RenderPluginContext) {
    trucks = new TruckLayer(ctx);
    facilities = new FacilityLayer(ctx);
    containers = new ContainerLayer(ctx);
    overlay = new WasteOverlay(ctx);
    window.addEventListener('keydown', onKey);
    window.addEventListener(DECHETS_LAYER_EVENT, onLayerEvent);
    window.__dechets = {
      trucks: () => trucks?.count ?? 0,
      truckPositions: () => trucks?.positions() ?? [],
      containers: () => containers?.count ?? 0,
      moundScale: (id) => facilities?.moundScale(id) ?? null,
      layerVisible: () => overlay?.visible ?? false,
      setLayer,
      layerStats: () => ({ bins: overlay?.binCount ?? 0, cells: overlay?.cellsShown ?? 0 }),
      summary: () => summary,
      openPanel,
      closePanel,
    };
  },
  applySnapshotExt(payload) {
    const p = payload as DechetsSnapshot | undefined;
    snapshotPayload = p;
    if (!p) {
      trucks?.apply(new Float32Array(0));
      facilities?.apply([]);
      containers?.apply(new Float32Array(0));
      summary = null;
      return;
    }
    applyPayload(p);
    for (const l of listeners) l(p);
  },
  applyDeltaExt(payload) {
    const p = payload as DechetsDelta;
    applyPayload(p);
    for (const l of listeners) l(p);
  },
  frame(dt) {
    trucks?.frame();
    facilities?.frame(dt);
  },
  dispose() {
    closePanel();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener(DECHETS_LAYER_EVENT, onLayerEvent);
    trucks?.dispose(); facilities?.dispose(); containers?.dispose(); overlay?.dispose();
    trucks = null; facilities = null; containers = null; overlay = null;
    delete window.__dechets;
  },
};
