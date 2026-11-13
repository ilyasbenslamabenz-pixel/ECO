/**
 * Contrôleur d'outils (implémente IToolController et PointerToolSink).
 * Relie les gestes (souris, tactile, clavier) à la machine à états pure
 * `ConstructionTools` (src/client/tools/machine.ts) et affiche ses aperçus 3D.
 * Les outils n'appliquent jamais rien eux-mêmes : tout passe par des commandes au worker.
 *
 * Souris : clic = action (poser, sélectionner, démolir) ; route = clic départ puis clic arrivée
 *          (ou glisser) ; clic droit / Échap = étape précédente puis retour à la Sélection.
 * Tactile: le doigt déplace l'aperçu (décalé au-dessus du doigt pour rester visible) ; le
 *          relâcher ouvre la barre de confirmation (Construire / Pivoter / Annuler).
 * Clavier: R = pivoter, X = variante, G = alignement auto, Ctrl+Z = annuler, Suppr = démolir la
 *          sélection, Échap = annuler l'étape, Maj (route) = angle magnétique 15°.
 * Sans `attach()` (amorçage de fondation), seul l'outil Sélection existe et ne fait rien.
 * Propriétaire : agent construction/caméra/UI.
 */
import type * as THREE from 'three';
import type { IToolController, RoadKindId, ToolId } from '../shared/contracts';
import { footprintGroundY } from '../client/tools/geometry';
import { TOOL_PHASE, type ConstructionTools, type ToolPreview } from '../client/tools/machine';
import { roadWidth, type PickResult } from '../client/tools/mirror';
import type { CameraController, PointerToolSink } from './camera';
import { COLORS, GhostPreview, RoadPreview, SelectionMarker, type ModelSource } from './previews';

export { TOOL_PHASE };

export interface ToolDeps {
  scene: THREE.Scene;
  camera: CameraController;
  machine: ConstructionTools;
  models: ModelSource;
  heightAt: (x: number, z: number) => number;
}

/** Ce que l'interface affiche autour des outils (fourni par src/ui). */
export interface ToolUiHooks {
  /** Étiquette qui suit le curseur (coût, longueur, refus) ; null = masquée. */
  cursorTag(text: string | null, kind: 'ok' | 'error' | 'pending' | 'info', sx: number, sy: number): void;
  /** Barre de confirmation tactile ; null = masquée. */
  touchConfirm(o: { label: string; canRotate: boolean } | null): void;
  /** Sélection courante (panneau d'information). */
  selection(p: PickResult | null): void;
}

const TOUCH_LIFT_PX = 70;
const fmt = (n: number): string => new Intl.NumberFormat('fr-FR').format(Math.round(n));

export class ToolController implements IToolController, PointerToolSink {
  private deps: ToolDeps | null = null;
  private hooks: ToolUiHooks | null = null;
  private ghost: GhostPreview | null = null;
  private road: RoadPreview | null = null;
  private hoverMarker: SelectionMarker | null = null;
  private selMarker: SelectionMarker | null = null;
  private selected: PickResult | null = null;
  private lastScreen = { x: 0, y: 0 };
  private lastType = 'mouse';
  private roadStartedThisGesture = false;
  private pendingTouchConfirm = false;
  private disposers: (() => void)[] = [];

  get activeTool(): ToolId { return this.deps?.machine.tool ?? 'select'; }
  get machine(): ConstructionTools | null { return this.deps?.machine ?? null; }
  get selection(): PickResult | null { return this.selected; }

  isAvailable(tool: ToolId): boolean { return !!this.deps && TOOL_PHASE[tool] === null; }

  attach(deps: ToolDeps, hooks: ToolUiHooks): void {
    this.deps = deps;
    this.hooks = hooks;
    this.ghost = new GhostPreview(deps.scene, deps.models, deps.heightAt);
    this.road = new RoadPreview(deps.scene, deps.heightAt);
    this.hoverMarker = new SelectionMarker(deps.scene, deps.heightAt, COLORS.select);
    this.selMarker = new SelectionMarker(deps.scene, deps.heightAt, COLORS.select);
    deps.camera.toolSink = this;
    deps.machine.onPreview((p) => this.render(p));
    deps.machine.onSelect = (p) => this.select(p);
    deps.machine.mirror.onChange(() => this.revalidateSelection());
    const key = (e: KeyboardEvent): void => this.keydown(e);
    const keyup = (e: KeyboardEvent): void => { if (e.key === 'Shift' && this.deps) { this.deps.machine.angleSnap = false; this.deps.machine.refresh(); } };
    // Phase de capture : les touches d'outil passent avant la caméra et le HUD (Échap, R).
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', keyup, true);
    this.disposers.push(() => window.removeEventListener('keydown', key, true), () => window.removeEventListener('keyup', keyup, true));
  }

  setTool(tool: ToolId, options?: { roadType?: RoadKindId; assetId?: string }): void {
    if (!this.deps) return;
    this.hooks?.touchConfirm(null);
    this.pendingTouchConfirm = false;
    if (this.deps.machine.setTool(tool, options) && tool !== 'select') this.select(null);
  }

  /* ----------------------------- PointerToolSink ----------------------------- */

  capturesPrimary(_type: string): boolean {
    const t = this.activeTool;
    return !!this.deps && (t === 'building' || t === 'road' || t === 'bulldoze');
  }

  private feed(sx: number, sy: number, type: string): void {
    const d = this.deps;
    if (!d) return;
    this.lastType = type;
    // Au doigt, l'aperçu est décalé au-dessus du point de contact pour rester visible.
    const lift = type === 'touch' && this.activeTool !== 'select' ? TOUCH_LIFT_PX : 0;
    this.lastScreen.x = sx; this.lastScreen.y = sy - lift;
    const ray = d.camera.screenRay(sx, sy - lift);
    const g = d.camera.groundAt(sx, sy - lift);
    d.machine.snapRadius = Math.max(5, Math.min(40, d.camera.getPose().distance * 0.035));
    d.machine.hover(g ? { x: g.x, z: g.z } : null, ray);
  }

  /** Survol : mémorisé puis traité une fois par image dans update() (picking + snapping coûtent O(n)). */
  hover(sx: number, sy: number, type: string): void {
    if (this.pendingTouchConfirm) return;
    this.pendingHover = { x: sx, y: sy, type };
  }
  private pendingHover: { x: number; y: number; type: string } | null = null;

  down(sx: number, sy: number, type: string): void {
    const d = this.deps;
    if (!d) return;
    this.hooks?.touchConfirm(null);
    this.pendingTouchConfirm = false;
    this.pendingHover = null;
    this.feed(sx, sy, type);
    this.roadStartedThisGesture = false;
    if (type !== 'touch' && d.machine.tool === 'road' && d.machine.draft.phase === 'idle') {
      this.roadStartedThisGesture = true;
      void d.machine.primary();
    }
  }

  move(sx: number, sy: number, type: string): void { this.pendingHover = { x: sx, y: sy, type }; }

  up(sx: number, sy: number, type: string, tap: boolean): void {
    const d = this.deps;
    if (!d) return;
    this.pendingHover = null;
    this.feed(sx, sy, type);
    const m = d.machine;
    if (type === 'touch' && m.tool !== 'select') {
      // Route : les étapes intermédiaires se posent au relâcher ; l'action finale se confirme.
      if (m.tool === 'road' && (m.draft.phase === 'idle' || (m.draft.mode === 'curve' && m.draft.phase === 'start'))) { void m.primary(); return; }
      if (m.tool === 'bulldoze' && !(m.preview.kind === 'bulldoze' && m.preview.target)) return;
      this.pendingTouchConfirm = true;
      const label = m.tool === 'building' ? 'Construire' : m.tool === 'road' ? 'Tracer la route' : 'Démolir';
      this.hooks?.touchConfirm({ label, canRotate: m.tool === 'building' });
      return;
    }
    if (m.tool === 'road') {
      if (tap && this.roadStartedThisGesture) return; // simple clic de départ
      void m.primary();
      return;
    }
    if (m.tool === 'select' && !tap) return;
    void m.primary();
  }

  cancel(): void {
    this.pendingTouchConfirm = false;
    this.hooks?.touchConfirm(null);
  }

  secondary(): void {
    this.deps?.machine.secondary();
    this.hooks?.touchConfirm(null);
  }

  /** Bouton « Construire » de la barre tactile. */
  confirmTouch(): void {
    if (!this.deps || !this.pendingTouchConfirm) return;
    this.pendingTouchConfirm = false;
    this.hooks?.touchConfirm(null);
    void this.deps.machine.primary();
  }

  /** Bouton « Annuler » de la barre tactile. */
  cancelTouch(): void {
    this.pendingTouchConfirm = false;
    this.hooks?.touchConfirm(null);
    this.deps?.machine.secondary();
  }

  rotate(): void {
    this.deps?.machine.rotate(1);
    if (this.pendingTouchConfirm) this.hooks?.touchConfirm({ label: 'Construire', canRotate: true });
  }

  /* ----------------------------- Clavier ----------------------------- */

  private keydown(e: KeyboardEvent): void {
    const d = this.deps;
    if (!d) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.overlay:not(.hidden)')) return; // menu ouvert
    const m = d.machine;
    const consume = (): void => { e.preventDefault(); e.stopImmediatePropagation(); };
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { consume(); void m.undoLast(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
      case 'Escape':
        if (this.pendingTouchConfirm) { consume(); this.cancelTouch(); return; }
        if (m.tool !== 'select' || m.draft.phase !== 'idle') { consume(); m.secondary(); return; }
        if (this.selected) { consume(); this.select(null); return; }
        return; // laisse le HUD ouvrir le menu
      case 'KeyR':
        if (m.tool === 'building') { consume(); this.rotate(); }
        return;
      case 'KeyX':
        if (m.tool === 'building') { consume(); m.cycleVariant(); }
        return;
      case 'KeyG':
        if (m.tool === 'building') { consume(); m.setAutoAlign(!m.autoAlign); }
        return;
      case 'Delete': case 'Backspace':
        if (this.selected && this.selected.kind !== 'vehicle') { consume(); void this.demolishSelection(); }
        return;
      case 'ShiftLeft': case 'ShiftRight':
        if (m.tool === 'road' && !m.angleSnap) { m.angleSnap = true; m.refresh(); }
        return;
      default: return;
    }
  }

  /* ----------------------------- Sélection ----------------------------- */

  select(p: PickResult | null): void {
    this.selected = p;
    this.showMarker(this.selMarker, p);
    this.hooks?.selection(p);
  }

  async demolishSelection(): Promise<boolean> {
    const s = this.selected;
    if (!s || !this.deps) return false;
    const ok = await this.deps.machine.demolishTarget(s);
    if (ok) this.select(null);
    return ok;
  }

  /** Après un delta : la sélection a pu disparaître (démolie ailleurs). */
  private revalidateSelection(): void {
    const s = this.selected;
    const mirror = this.deps?.machine.mirror;
    if (!s || !mirror) return;
    if ((s.kind === 'building' && !mirror.buildings.has(s.id)) || (s.kind === 'road' && !mirror.edges.has(s.id))) this.select(null);
  }

  private showMarker(mk: SelectionMarker | null, p: PickResult | null): void {
    if (!mk) return;
    if (!p) { mk.hide(); return; }
    const mirror = this.deps!.machine.mirror;
    if (p.kind === 'building') {
      const r = mirror.buildingRect(p.record);
      if (r) mk.showRect(r.minX, r.minZ, r.maxX, r.maxZ, mirror.buildingHeight(p.record)); else mk.hide();
    } else if (p.kind === 'road') {
      mk.showPath(Array.from(p.edge.poly), roadWidth(p.edge.kindId));
    } else mk.showPoint(p.x, p.z, 3.5);
  }

  /* ----------------------------- Rendu des aperçus ----------------------------- */

  private render(p: ToolPreview): void {
    const d = this.deps;
    if (!d || !this.ghost || !this.road || !this.hoverMarker) return;
    const tag = (text: string | null, kind: 'ok' | 'error' | 'pending' | 'info'): void => this.hooks?.cursorTag(text, kind, this.lastScreen.x, this.lastScreen.y);
    if (p.kind !== 'building') this.ghost.hide();
    if (p.kind !== 'road') this.road.hide();
    if (p.kind !== 'select' && p.kind !== 'bulldoze') this.hoverMarker.hide();
    switch (p.kind) {
      case 'building': {
        const y = footprintGroundY(d.heightAt, p.proposal.obb, p.asset.footprint.tilesX, p.asset.footprint.tilesZ);
        this.ghost.show(p.asset, p.proposal.x, y, p.proposal.z, p.proposal.rot, p.variant, p.validity);
        const v = p.variant >= 0 ? p.asset.variants[p.variant] : undefined;
        const head = `${p.asset.nameFr}${v ? ` · ${v.nameFr}` : ''}`;
        const snap = p.proposal.snapped ? ' · façade côté route' : '';
        if (p.validity === 'error') tag(`${head}\n${p.message}`, 'error');
        else tag(`${head}\n${fmt(p.cost)} ¢${snap}`, p.validity === 'ok' ? 'ok' : 'pending');
        break;
      }
      case 'road':
        this.road.show({ points: p.points, width: roadWidth(p.type), validity: p.points ? p.validity : 'ok', start: p.start, control: p.control, hover: p.hover });
        if (!p.points) tag(p.message || null, 'info');
        else if (p.validity === 'error') tag(`${fmt(p.length)} m\n${p.message}`, 'error');
        else tag(`${fmt(p.length)} m · ${fmt(p.cost)} ¢`, p.validity === 'ok' ? 'ok' : 'pending');
        break;
      case 'bulldoze':
        this.hoverMarker.setColor(COLORS.error);
        this.showMarker(this.hoverMarker, p.target);
        if (p.target) {
          const name = p.target.kind === 'building' ? (p.target.asset?.nameFr ?? 'Bâtiment') : 'Tronçon de route';
          tag(`Démolir : ${name}\nRemboursement +${fmt(p.refund)} ¢`, 'error');
        } else tag(null, 'info');
        break;
      case 'select':
        this.hoverMarker.setColor(COLORS.select);
        if (p.hover && this.lastType !== 'touch' && !(this.selected && samePick(p.hover, this.selected))) this.showMarker(this.hoverMarker, p.hover);
        else this.hoverMarker.hide();
        tag(null, 'info');
        break;
      default:
        tag(null, 'info');
    }
  }

  /** À appeler chaque image (animations des aperçus). */
  update(dt: number): void {
    const h = this.pendingHover;
    if (h) { this.pendingHover = null; this.feed(h.x, h.y, h.type); }
    this.ghost?.update(dt);
    this.hoverMarker?.update(dt);
    this.selMarker?.update(dt);
  }

  /** Diagnostic (e2e) : le fantôme affiche-t-il le vrai modèle ? */
  get ghostModelVisible(): boolean { return !!this.ghost?.modelVisible && !!this.ghost.group.visible; }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.ghost?.dispose(); this.road?.dispose(); this.hoverMarker?.dispose(); this.selMarker?.dispose();
    if (this.deps) this.deps.camera.toolSink = null;
  }
}

function samePick(a: PickResult, b: PickResult): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'vehicle' && b.kind === 'vehicle') return a.index === b.index;
  return (a as { id: number }).id === (b as { id: number }).id;
}
