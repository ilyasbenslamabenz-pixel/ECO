/**
 * Rendu du module « Eau et assainissement » (phase 2B.5) : calque souterrain de la vue « eau »
 * (src/render/water-network/overlay.ts) et montage provisoire du panneau « Eau & égouts » (src/ui/panels/eau.ts).
 *
 * Montage du panneau : l'interface ne monte pas encore les panneaux du registre (refonte §1bis) ; en attendant, ce
 * module ajoute un bouton « Eau » visible en jeu et monte `eauPanel` dans un conteneur flottant, avec une
 * `UiPanelApi` adaptée (commandes via `window.__aube.send('pluginCommand', …)`, deltas reçus par ce module).
 * À remplacer par le montage officiel dès qu'il existe (docs/requests/eau.md).
 */
import type { EauDelta, EauSnapshot } from '../../shared/protocol-ext/eau';
import { eauPanel } from '../../ui/panels/eau';
import type { UiPanelApi } from '../../ui/panels/types';
import { WaterOverlay } from '../water-network/overlay';
import { waterView, type WaterViewMode } from '../water-network/view';
import type { RenderPlugin, RenderPluginContext } from './types';

const STYLE = `
#eau-ui{position:fixed;left:calc(12px + var(--safe-l,0px));top:calc(112px + var(--safe-t,0px));z-index:6;display:flex;flex-direction:column;gap:8px;align-items:flex-start;pointer-events:none}
#eau-ui.hidden{display:none}
#eau-btn{pointer-events:auto;display:flex;align-items:center;gap:6px;height:38px;padding:0 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--panel);color:var(--text);font:600 13px/1 system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(8px)}
#eau-btn[aria-pressed=true]{background:rgba(79,179,255,.22);border-color:#4fb3ff}
#eau-btn .drop{color:#4fb3ff;font-size:15px}
#eau-panel{pointer-events:auto;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 240px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius,12px);box-shadow:var(--shadow);padding:10px 12px 12px;color:var(--text);font:13px/1.35 system-ui,sans-serif;backdrop-filter:blur(10px)}
#eau-panel.hidden{display:none}
#eau-panel .eau-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
#eau-panel .eau-head h3{margin:0;font-size:15px}
#eau-panel h4{margin:12px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
#eau-panel .eau-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
#eau-panel .eau-row .eau-k{color:var(--muted)}
#eau-panel .eau-row.bad .eau-v{color:var(--danger,#ff6b6b)}
#eau-panel .eau-gauge{height:5px;border-radius:3px;background:var(--panel-2);overflow:hidden;margin:2px 0 4px}
#eau-panel .eau-gauge i{display:block;height:100%;background:var(--ok,#5fd39a)}
#eau-panel .eau-gauge.blue i{background:#4fb3ff}
#eau-panel .eau-gauge.warn i{background:#f2c230}
#eau-panel .eau-modes{display:flex;gap:4px;flex-wrap:wrap}
#eau-panel .eau-modes button{flex:1;min-width:64px;height:30px;border-radius:8px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text);cursor:pointer;font:600 12px system-ui,sans-serif}
#eau-panel .eau-modes button.on{background:rgba(79,179,255,.25);border-color:#4fb3ff}
#eau-panel .eau-legend{display:flex;flex-wrap:wrap;gap:4px 10px;margin:6px 0 2px;font-size:11px;color:var(--muted)}
#eau-panel .eau-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
#eau-panel .eau-slider{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0}
#eau-panel .eau-slider input{grid-column:1/3;width:100%}
#eau-panel .eau-check{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:12px}
#eau-panel .eau-fac,#eau-panel .eau-alerts{margin:0;padding-left:16px}
#eau-panel .eau-fac li{margin:3px 0}
#eau-panel .eau-fac li span{display:block;color:var(--muted);font-size:12px}
#eau-panel .eau-alerts li{color:#f2c230;margin:2px 0}
#eau-panel .small{font-size:11px}
#eau-panel .icon-x{border:0;background:none;color:var(--muted);font-size:16px;cursor:pointer}
`;

interface AubeDebug { send?: (name: string, args: unknown) => Promise<unknown>; eau?: unknown }

let overlay: WaterOverlay | null = null;
let rctx: RenderPluginContext | null = null;
let last: EauDelta | EauSnapshot | undefined;
const listeners = new Set<(p: unknown) => void>();
let ui: { root: HTMLElement; btn: HTMLButtonElement; panel: HTMLElement; unmount: (() => void) | null; obs: MutationObserver | null } | null = null;
let offView: (() => void) | null = null;

function emit(p: unknown): void { for (const l of [...listeners]) l(p); }

function toast(message: string): void {
  // L'interface n'expose pas son bandeau aux modules : message bref dans le panneau.
  const p = ui?.panel;
  if (!p) return;
  const t = document.createElement('div');
  t.className = 'muted small';
  t.textContent = message;
  p.querySelector('.eau-toast')?.remove();
  t.classList.add('eau-toast');
  p.prepend(t);
  setTimeout(() => t.remove(), 3500);
}

function makeApi(): UiPanelApi {
  return {
    command: async (name, payload) => {
      const dbg = (window as unknown as { __aube?: AubeDebug }).__aube;
      if (!dbg?.send) throw new Error('Simulation non démarrée');
      const r = await dbg.send('pluginCommand', { plugin: 'eau', name, payload }) as { data?: unknown };
      return r?.data;
    },
    onDeltaExt: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshotExt: () => last,
    toast: (m) => toast(m),
  };
}

function setOpen(open: boolean): void {
  if (!ui) return;
  ui.panel.classList.toggle('hidden', !open);
  ui.btn.setAttribute('aria-pressed', String(open));
  if (open && !ui.unmount) {
    const host = ui.panel.querySelector<HTMLElement>('.eau-host')!;
    ui.unmount = eauPanel.mount?.(host, makeApi()) ?? null;
    // Ouverture du panneau : calque « desserte » par défaut.
    if (waterView.mode === 'off') waterView.set('desserte');
  }
  if (!open) {
    ui.unmount?.(); ui.unmount = null;
    waterView.set('off');
  }
}

function mountUi(): void {
  if (typeof document === 'undefined' || document.getElementById('eau-ui')) return;
  const style = document.createElement('style');
  style.id = 'eau-style';
  style.textContent = STYLE;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'eau-ui';
  const btn = document.createElement('button');
  btn.id = 'eau-btn';
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Eau & égouts : panneau du service et vue souterraine des canalisations';
  btn.innerHTML = '<span class="drop" aria-hidden="true">💧</span>Eau';
  const panel = document.createElement('section');
  panel.id = 'eau-panel';
  panel.className = 'hidden';
  panel.setAttribute('aria-label', eauPanel.title);
  panel.innerHTML = `<div class="eau-head"><h3>${eauPanel.title}</h3><button class="icon-x" type="button" aria-label="Fermer">✕</button></div><div class="eau-host"></div>`;
  root.append(btn, panel);
  document.body.append(root);
  ui = { root, btn, panel, unmount: null, obs: null };
  btn.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
  panel.querySelector('.icon-x')!.addEventListener('click', () => setOpen(false));
  // Visible seulement en jeu (même visibilité que la barre supérieure).
  const hud = document.getElementById('hud');
  const sync = (): void => {
    const inGame = !!hud && !hud.classList.contains('hidden');
    root.classList.toggle('hidden', !inGame);
    if (!inGame && !panel.classList.contains('hidden')) setOpen(false);
  };
  if (hud) { ui.obs = new MutationObserver(sync); ui.obs.observe(hud, { attributes: true, attributeFilter: ['class'] }); }
  sync();
}

export const eauRenderPlugin: RenderPlugin = {
  id: 'eau',

  init(ctx) {
    rctx = ctx;
    overlay = new WaterOverlay(ctx.heightAt);
    ctx.scene.add(overlay.group);
    offView = waterView.subscribe((m: WaterViewMode) => overlay?.setMode(m));
    mountUi();
    if (typeof window !== 'undefined') {
      const dbg = (window as unknown as { __aube?: AubeDebug }).__aube;
      if (dbg) {
        dbg.eau = {
          stats: () => overlay?.stats(),
          setMode: (m: WaterViewMode) => waterView.set(m),
          open: (o: boolean) => setOpen(o),
          last: () => (last ? { version: last.version, balance: last.balance, facilities: last.facilities, alerts: last.alerts } : null),
        };
      }
    }
  },

  applySnapshotExt(payload) {
    const p = payload as EauSnapshot | undefined;
    last = p;
    if (!overlay) return;
    if (!p) { overlay.clear(); emit(undefined); return; }
    overlay.setPipes(p.pipes);
    overlay.setRiver(p.river);
    overlay.setLayer(p.layer);
    emit(p);
  },

  applyDeltaExt(payload) {
    const p = payload as EauDelta;
    const prev = last;
    const river = p.river ?? (prev && 'river' in prev ? prev.river : undefined);
    const pipes = p.pipes ?? (prev && 'pipes' in prev ? prev.pipes : undefined);
    last = river && pipes ? { ...p, pipes, river: { ...river, pollution: p.riverPollution } } as EauSnapshot : p;
    if (!overlay) return;
    if (p.pipes) overlay.setPipes(p.pipes);
    if (p.river) overlay.setRiver(p.river);
    overlay.setLayer(p.layer);
    overlay.setRiverPollution(p.riverPollution);
    emit(last);
  },

  frame() {
    if (overlay && rctx) overlay.frame(rctx.camera);
  },

  dispose() {
    offView?.(); offView = null;
    if (overlay && rctx) rctx.scene.remove(overlay.group);
    overlay?.dispose(); overlay = null;
    if (ui) { ui.unmount?.(); ui.obs?.disconnect(); ui.root.remove(); document.getElementById('eau-style')?.remove(); ui = null; }
    listeners.clear();
    last = undefined;
  },
};
