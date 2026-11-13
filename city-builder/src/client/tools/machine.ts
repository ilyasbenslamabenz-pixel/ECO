/**
 * Machine à états des outils de construction, indépendante du moteur (ni three ni DOM).
 *
 *   select    : survol = surbrillance, clic = sélection (panneau d'info)
 *   road      : idle → départ → [contrôle si courbe] → arrivée = buildRoad ; enchaînement
 *   building  : fantôme qui suit le curseur (snapping façade/route), clic = placeBuilding
 *   bulldoze  : survol = cible en rouge + remboursement, clic = demolish / removeRoad
 *   terraform : non disponible (Phase 2) — la simulation répond NOT_IMPLEMENTED
 *
 * Toute validation passe par la simulation : chaque changement d'aperçu envoie une commande
 * `dryRun` (une seule en vol à la fois, la plus récente gagne) et l'aperçu devient vert ou
 * rouge selon SA réponse, avec son message d'erreur. Rien n'est appliqué localement.
 * Propriétaire : agent construction/caméra/UI.
 */
import { normRot } from '../../shared/footprint';
import type { CatalogAsset } from '../../shared/catalog';
import { isBuildingCategory } from '../../shared/catalog';
import type { CommandError, RoadKindId, ToolId } from '../../shared/contracts';
import { legacyRoadType } from '../../sim/roads/index';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../../shared/protocol';
import type { Ray } from './geometry';
import { roadDef, type PickResult, type WorldMirror } from './mirror';
import { RoadDraft, snapRoadPoint, type RoadMode, type SnapPoint } from './road-draft';
import { proposePlacement, type PlacementProposal } from './snapping';
import { UndoStack, type UndoStep } from './undo';

/** Ce dont les outils ont besoin du pont de simulation (SimBridge l'implémente). */
export interface SimPort {
  send<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<CommandResult<K>>;
  onSnapshot(l: (s: SnapshotMessage) => void): void;
  onDelta(l: (d: DeltaMessage) => void): void;
}

/** Phase prévue des outils non encore disponibles. */
export const TOOL_PHASE: Record<ToolId, number | null> = {
  select: null,
  road: null,
  building: null,
  bulldoze: null,
  terraform: 2,
};

/** Remboursement à la démolition appliqué par la simulation (src/sim/world.ts). Affichage indicatif. */
export const DEMOLISH_REFUND_RATE = 0.25;

export type Validity = 'pending' | 'ok' | 'error';

export type ToolPreview =
  | { kind: 'none' }
  | { kind: 'select'; hover: PickResult | null }
  | { kind: 'building'; asset: CatalogAsset; proposal: PlacementProposal; variant: number; validity: Validity; cost: number; message: string }
  | { kind: 'road'; type: RoadKindId; mode: RoadMode; points: number[] | null; start: SnapPoint | null; control: SnapPoint | null; hover: SnapPoint | null; validity: Validity; cost: number; length: number; message: string; elevation?: number; path?: number[] }
  | { kind: 'bulldoze'; target: PickResult | null; refund: number };

export type Notify = (text: string, kind: 'info' | 'error' | 'ok') => void;

export function errorOf(e: unknown): CommandError {
  const o = e as { error?: CommandError; message?: string } | null;
  if (o && typeof o === 'object' && o.error && typeof o.error.message === 'string') return o.error;
  return { code: 'INVALID_ARGS', message: o && typeof o.message === 'string' ? o.message : String(e) };
}

/** File « la plus récente gagne » pour les requêtes dryRun : jamais plus d'une en vol. */
export class LatestOnly {
  private inFlight = false;
  private next: (() => Promise<void>) | null = null;
  run(job: () => Promise<void>): void {
    if (this.inFlight) { this.next = job; return; }
    this.inFlight = true;
    void job().finally(() => {
      this.inFlight = false;
      const n = this.next;
      this.next = null;
      if (n) this.run(n);
    });
  }
  get busy(): boolean { return this.inFlight; }
}

const fmt = (n: number): string => new Intl.NumberFormat('fr-FR').format(Math.round(n));

export class ConstructionTools {
  tool: ToolId = 'select';
  roadType: RoadKindId = 'street';
  autoAlign = true;
  rot = 0;
  variant = 0;
  asset: CatalogAsset | null = null;
  /** Rayon d'accrochage (m) ; l'appelant l'adapte au zoom. */
  snapRadius = 10;
  angleSnap = false;
  /** Aimantation « droite » (angles et longueurs ronds pour les routes, alignement sur les voisins pour les bâtiments). */
  magnet = true;
  /** Accroche des routes à la grille de construction (cases de 8 m). */
  gridSnap = true;
  readonly draft = new RoadDraft();
  readonly undo = new UndoStack();
  preview: ToolPreview = { kind: 'select', hover: null };
  private dry = new LatestOnly();
  private previewSeq = 0;
  private lastGround: { x: number; z: number } | null = null;
  private lastRay: Ray | null = null;
  private listeners: ((p: ToolPreview) => void)[] = [];
  private toolListeners: ((t: ToolId) => void)[] = [];
  private busy = false;
  onSelect: (p: PickResult | null) => void = () => undefined;
  /** Nombre d'actions réellement appliquées par la simulation (diagnostic e2e). */
  applied = 0;

  constructor(readonly mirror: WorldMirror, readonly sim: SimPort, readonly notify: Notify) {
    mirror.onChange(() => this.refresh());
  }

  onPreview(fn: (p: ToolPreview) => void): void { this.listeners.push(fn); }
  onToolChange(fn: (t: ToolId) => void): void { this.toolListeners.push(fn); }
  private emit(): void { for (const l of this.listeners) l(this.preview); }

  isAvailable(t: ToolId): boolean { return TOOL_PHASE[t] === null; }

  setTool(t: ToolId, opts?: { roadType?: RoadKindId; assetId?: string }): boolean {
    const phase = TOOL_PHASE[t];
    if (phase !== null) { this.notify(`Outil disponible en phase ${phase}`, 'info'); return false; }
    if (t === 'building') {
      const a = opts?.assetId ? this.mirror.asset(opts.assetId) : this.asset;
      if (!a || !isBuildingCategory(a.category)) { this.notify('Choisissez un bâtiment du catalogue', 'error'); return false; }
      if (a !== this.asset) { this.asset = a; this.variant = this.randomVariant(a); }
    }
    if (opts?.roadType && roadDef(opts.roadType)) this.roadType = opts.roadType;
    this.tool = t;
    this.draft.reset();
    this.draft.type = this.roadType;
    this.refresh();
    for (const l of this.toolListeners) l(t);
    return true;
  }

  setRoadType(t: RoadKindId): void { this.roadType = t; this.draft.type = t; this.refresh(); }
  setRoadMode(m: RoadMode): void { this.draft.mode = m; if (this.draft.phase === 'control') this.draft.back(); if (m === 'roundabout') this.draft.reset(); this.refresh(); }
  /** ▲ / ▼ de l'outil Routes : hauteur imposée du tracé par pas de 4 m (aperçu 3D renvoyé par la simulation). */
  setRoadElevation(dir: 1 | -1): void { this.draft.raise(dir); this.refresh(); }
  setRoundaboutSize(size: 'small' | 'large'): void { this.draft.roundaboutSize = size; this.setRoadMode('roundabout'); }

  rotate(dir = 1): void {
    if (this.tool !== 'building') return;
    const cur = this.preview.kind === 'building' ? this.preview.proposal.rot : this.rot;
    this.rot = normRot(Math.round(cur) + dir);
    this.autoAlign = false;
    this.refresh();
  }

  setAutoAlign(on: boolean): void { this.autoAlign = on; this.refresh(); }

  setMagnet(on: boolean): void { this.magnet = on; this.refresh(); }

  cycleVariant(): void {
    if (!this.asset || this.asset.variants.length === 0) return;
    this.variant = (this.variant + 1) % this.asset.variants.length;
    this.refresh();
  }

  private randomVariant(a: CatalogAsset): number {
    return a.variants.length ? Math.floor(Math.random() * a.variants.length) : -1;
  }

  /** Survol : point au sol sous le curseur (ou null) et rayon caméra. */
  hover(ground: { x: number; z: number } | null, ray: Ray | null): void {
    this.lastGround = ground;
    this.lastRay = ray;
    this.refresh();
  }

  /** Recalcule l'aperçu à partir du dernier survol et redemande la validation au worker. */
  refresh(): void {
    const g = this.lastGround;
    switch (this.tool) {
      case 'select':
        this.preview = { kind: 'select', hover: this.lastRay ? this.mirror.pick(this.lastRay, g) : null };
        break;
      case 'bulldoze': {
        const target = this.lastRay ? this.mirror.pick(this.lastRay, g) : null;
        const t = target && target.kind !== 'vehicle' ? target : null;
        this.preview = { kind: 'bulldoze', target: t, refund: t ? this.refundOf(t) : 0 };
        break;
      }
      case 'building': {
        const a = this.asset;
        if (!a || !g) { this.preview = { kind: 'none' }; break; }
        const proposal = proposePlacement(this.mirror, a, g.x, g.z, { rot: this.rot, autoAlign: this.autoAlign, magnet: this.magnet });
        const prev = this.preview;
        const same = prev.kind === 'building' && prev.asset === a && prev.proposal.x === proposal.x && prev.proposal.z === proposal.z && prev.proposal.rot === proposal.rot && prev.variant === this.variant;
        if (same && prev.kind === 'building' && (prev.validity === 'pending' || this.validatedVersion === this.mirror.version)) {
          // Même emplacement : la validation en cours (ou déjà obtenue sur cet état du monde) reste valable.
          this.preview = { ...prev, proposal };
          this.emit();
          return;
        }
        this.preview = { kind: 'building', asset: a, proposal, variant: this.variant, validity: 'pending', cost: a.cost, message: '' };
        this.validateBuilding();
        break;
      }
      case 'road': {
        const d = this.draft;
        d.hover = g ? snapRoadPoint(this.mirror, g.x, g.z, { radius: this.snapRadius, angleSnap: this.angleSnap, magnet: this.magnet, grid: this.gridSnap && this.magnet }, d.phase !== 'idle' ? (d.control ?? d.start ?? undefined) : undefined) : null;
        const points = d.points();
        const def = roadDef(this.roadType);
        const length = d.length();
        this.preview = {
          kind: 'road', type: this.roadType, mode: d.mode, points, start: d.start, control: d.control, hover: d.hover,
          validity: points ? 'pending' : 'ok', cost: def ? Math.round(length * def.costPerMeter) : 0, length,
          message: d.phase === 'idle' ? 'Cliquez pour placer le départ' : d.mode === 'curve' && d.phase === 'start' ? 'Cliquez pour placer le point de courbure' : '',
        };
        if (d.mode === 'roundabout') {
          this.preview = { ...this.preview, message: 'Cliquez sur un carrefour ou sur une route pour poser le giratoire' };
          break;
        }
        if (d.elevation) this.preview = { ...this.preview, elevation: d.elevation };
        if (points) this.validateRoad(points);
        break;
      }
      default:
        this.preview = { kind: 'none' };
    }
    this.emit();
  }

  private validatedVersion = -1;

  private validateBuilding(): void {
    const seq = ++this.previewSeq;
    const p = this.preview;
    if (p.kind !== 'building') return;
    const args = { assetId: p.asset.id, x: p.proposal.x, z: p.proposal.z, rot: p.proposal.rot, variant: p.variant, dryRun: true };
    const version = this.mirror.version;
    this.dry.run(async () => {
      if (seq !== this.previewSeq) return; // un aperçu plus récent attend déjà
      let validity: Validity; let message = ''; let cost = p.cost;
      try {
        const r = await this.sim.send('placeBuilding', args);
        validity = 'ok'; cost = r.cost;
      } catch (e) { validity = 'error'; message = errorOf(e).message; }
      const cur = this.preview;
      if (cur.kind === 'building' && cur.asset.id === args.assetId && cur.proposal.x === args.x && cur.proposal.z === args.z && cur.proposal.rot === args.rot) {
        this.preview = { ...cur, validity, message, cost };
        this.validatedVersion = version;
        this.emit();
      }
    });
  }

  private validateRoad(points: number[]): void {
    const seq = ++this.previewSeq;
    const type = this.roadType;
    this.dry.run(async () => {
      if (seq !== this.previewSeq) return;
      let validity: Validity; let message = ''; let cost = 0; let path: number[] | undefined;
      try {
        const cmd = this.draft.command();
        if (!cmd) throw new Error('Tracé trop court');
        const r = await this.sim.send('buildRoad', { type: legacyRoadType(type), kind: type, ...cmd, dryRun: true });
        validity = 'ok'; cost = r.cost; path = r.path;
      } catch (e) { validity = 'error'; message = errorOf(e).message; }
      const cur = this.preview;
      if (cur.kind === 'road' && cur.points && cur.type === type && sameNumbers(cur.points, points)) {
        this.preview = { ...cur, validity, message, cost: validity === 'ok' ? cost : cur.cost, ...(path ? { path } : {}) };
        this.emit();
      }
    });
  }

  private refundOf(t: PickResult): number {
    if (t.kind === 'building') return Math.round((t.asset?.cost ?? 0) * DEMOLISH_REFUND_RATE);
    if (t.kind === 'road') return Math.round(t.edge.length * (roadDef(t.edge.kindId)?.costPerMeter ?? 0) * DEMOLISH_REFUND_RATE);
    return 0;
  }

  /** Clic principal / tap de validation. */
  async primary(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      switch (this.tool) {
        case 'select': {
          const p = this.preview.kind === 'select' ? this.preview.hover : null;
          this.onSelect(p);
          break;
        }
        case 'building': await this.placeCurrent(); break;
        case 'road': await this.roadClick(); break;
        case 'bulldoze': await this.bulldozeCurrent(); break;
        default: break;
      }
    } finally { this.busy = false; }
  }

  private async placeCurrent(): Promise<void> {
    const p = this.preview;
    if (p.kind !== 'building') return;
    try {
      const r = await this.sim.send('placeBuilding', { assetId: p.asset.id, x: p.proposal.x, z: p.proposal.z, rot: p.proposal.rot, variant: p.variant });
      this.applied++;
      this.undo.push({ label: `Construction : ${p.asset.nameFr}`, steps: [{ kind: 'demolish', buildingId: r.buildingId }] });
      this.notify(`${p.asset.nameFr} construit (−${fmt(r.cost)} ¢)`, 'ok');
      this.variant = this.randomVariant(p.asset);
      this.preview = { kind: 'none' };
      this.refresh();
    } catch (e) {
      this.notify(`Construction refusée : ${errorOf(e).message}`, 'error');
    }
  }

  private async roadClick(): Promise<void> {
    const d = this.draft;
    if (!d.hover) return;
    if (d.mode === 'roundabout') {
      // Giratoire (commande étendue du module routes, même canal que les commandes de base).
      try {
        const send = this.sim.send as unknown as (n: string, a: unknown) => Promise<{ edgeIds: number[]; cost: number }>;
        const r = await send.call(this.sim, 'buildRoundabout', { x: d.hover.x, z: d.hover.z, size: d.roundaboutSize });
        this.applied++;
        this.notify(`Giratoire construit (−${fmt(r.cost)} ¢)`, 'ok');
      } catch (e) { this.notify(`Giratoire refusé : ${errorOf(e).message}`, 'error'); }
      this.refresh();
      return;
    }
    if (d.click(d.hover) !== 'build') { this.refresh(); return; }
    const points = d.points();
    if (!points) { this.refresh(); return; }
    const end = d.hover;
    try {
      const cmd = d.command() ?? { points };
      const r = await this.sim.send('buildRoad', { type: legacyRoadType(this.roadType), kind: this.roadType, ...cmd });
      this.applied++;
      this.undo.push({ label: `Route : ${roadDef(this.roadType)?.nameFr ?? this.roadType}`, steps: r.edgeIds.map((edgeId) => ({ kind: 'removeRoad', edgeId }) as UndoStep) });
      this.notify(`${roadDef(this.roadType)?.nameFr ?? 'Route'} construite : ${fmt(d.length())} m (−${fmt(r.cost)} ¢)`, 'ok');
      d.chainFrom({ x: end.x, z: end.z, snap: 'node' });
    } catch (e) {
      this.notify(`Route refusée : ${errorOf(e).message}`, 'error');
      if (d.phase === 'control' || d.mode === 'straight') { /* on garde le départ pour corriger */ }
    }
    this.refresh();
  }

  private async bulldozeCurrent(): Promise<void> {
    const p = this.preview;
    if (p.kind !== 'bulldoze' || !p.target) return;
    await this.demolishTarget(p.target);
  }

  /** Démolition d'une cible (outil Bulldozer ou bouton « Démolir » d'un panneau). */
  async demolishTarget(t: PickResult): Promise<boolean> {
    try {
      if (t.kind === 'building') {
        const rec = t.record;
        const r = await this.sim.send('demolish', { buildingId: t.id });
        this.applied++;
        this.undo.forgetBuilding(t.id);
        this.undo.push({ label: `Démolition : ${t.asset?.nameFr ?? rec.assetId}`, steps: [{ kind: 'placeBuilding', assetId: rec.assetId, x: rec.x, z: rec.z, rot: rec.rot, variant: rec.variant }] });
        this.notify(`${t.asset?.nameFr ?? 'Bâtiment'} démoli (+${fmt(r.refund)} ¢)`, 'ok');
        return true;
      }
      if (t.kind === 'road') {
        const e = t.edge;
        const r = await this.sim.send('removeRoad', { edgeId: t.id });
        this.applied++;
        this.undo.forgetEdge(t.id);
        this.undo.push({ label: 'Suppression de route', steps: [{ kind: 'buildRoad', kindId: e.kindId, points: [e.ax, e.az, e.bx, e.bz], ...(e.c1 && e.c2 ? { c1: e.c1, c2: e.c2 } : {}) }] });
        this.notify(`Tronçon supprimé (+${fmt(r.refund)} ¢)`, 'ok');
        return true;
      }
    } catch (e) {
      this.notify(`Démolition impossible : ${errorOf(e).message}`, 'error');
    }
    return false;
  }

  /** Clic droit / Échap : recule d'une étape, sinon revient à la sélection. Renvoie false si déjà au repos. */
  secondary(): boolean {
    if (this.tool === 'road' && this.draft.back()) { this.refresh(); return true; }
    if (this.tool !== 'select') { this.setTool('select'); return true; }
    return false;
  }

  /** Annule la dernière action (Ctrl+Z) en envoyant les commandes inverses à la simulation. */
  async undoLast(): Promise<boolean> {
    const e = this.undo.pop();
    if (!e) { this.notify('Rien à annuler', 'info'); return false; }
    let ok = 0;
    let lastErr = '';
    for (const s of e.steps) {
      try {
        if (s.kind === 'demolish') await this.sim.send('demolish', { buildingId: s.buildingId });
        else if (s.kind === 'removeRoad') await this.sim.send('removeRoad', { edgeId: s.edgeId });
        else if (s.kind === 'placeBuilding') await this.sim.send('placeBuilding', { assetId: s.assetId, x: s.x, z: s.z, rot: s.rot, variant: s.variant });
        else await this.sim.send('buildRoad', { type: legacyRoadType(s.kindId), kind: s.kindId, points: s.points });
        ok++;
      } catch (err) { lastErr = errorOf(err).message; }
    }
    if (ok === e.steps.length) this.notify(`Annulé : ${e.label}`, 'ok');
    else this.notify(`Annulation partielle (${ok}/${e.steps.length}) : ${lastErr}`, 'error');
    this.applied += ok;
    return ok > 0;
  }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
