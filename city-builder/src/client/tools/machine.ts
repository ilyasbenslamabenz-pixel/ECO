/**
 * Machine à états des outils de construction, indépendante du moteur (ni three ni DOM).
 *
 *   select    : survol = surbrillance, clic = sélection (panneau d'info)
 *   road      : trois sous-outils —
 *               « Tracer »      idle → départ → [contrôle si courbe] → arrivée = buildRoad ; le tracé repart de
 *                               l'extrémité (enchaînement) jusqu'à « Terminer » ; lignes guides parallèles
 *               « Quadrillage » coin → coin opposé = îlot de rues sur la grille de 8 m (taille d'îlot réglable),
 *                               coût total chiffré par la simulation avant validation
 *               « Améliorer »   survol d'une route = coût / refus (dryRun upgradeRoad), clic = changement de type
 *                               ou de sens sans démolir
 *   building  : fantôme qui suit le curseur (snapping façade/route), clic = placeBuilding
 *   bulldoze  : survol = cible en rouge + remboursement, clic = demolish / removeRoad
 *   terraform : tiroir Terrain — Défricher, Quai / remblai, Creuser (src/client/tools/terrain-tool.ts)
 *
 * Toute validation passe par la simulation : chaque changement d'aperçu envoie une commande
 * `dryRun` (une seule en vol à la fois, la plus récente gagne) et l'aperçu devient vert ou
 * rouge selon SA réponse, avec son message d'erreur. Rien n'est appliqué localement.
 * Propriétaire : agent construction/caméra/UI.
 */
import { normRot } from '../../shared/footprint';
import type { CatalogAsset } from '../../shared/catalog';
import { isBuildingCategory } from '../../shared/catalog';
import type { CommandError, RoadEdgeRecord, RoadKindId, ToolId } from '../../shared/contracts';
import { legacyRoadType } from '../../sim/roads/index';
import type { CommandArgs, CommandName, CommandResult, DeltaMessage, SnapshotMessage } from '../../shared/protocol';
import type { Ray } from './geometry';
import { roadDef, type PickResult, type WorldMirror } from './mirror';
import { RoadDraft, angleLabel, snapRoadPoint, type RoadMode, type SnapPoint } from './road-draft';
import { DEFAULT_GRID_BLOCK, edgeOnGrid, gridCorner, gridLayout, type GridLayout } from './grid';
import { nextUpgradeKind, prevUpgradeKind } from '../../sim/roads/upgrade';
import type { RoadEdgeView } from './mirror';
import { proposePlacement, type PlacementProposal } from './snapping';
import { UndoStack, type UndoStep } from './undo';
import { TerrainTool, type TerrainPreview } from './terrain-tool';
import type { ExtCommandArgs, ExtCommandName, ExtCommandResult } from '../../sim/sim-protocol';

/**
 * Pôles de transport (module `hubs`, phase 2C) — ajout minimal à l'outil de pose : une entrée du catalogue
 * portant le tag `hub` (Port, Aéroport) se pose par la commande `pluginCommand hubs.place` (validée par la
 * simulation : littoral / cours d'eau navigable, terrain plat, servitudes) au lieu de `placeBuilding`,
 * en placement libre (pas d'aimantation aux routes), rotation par huitièmes de tour (orientation de la piste).
 * Les bâtiments ordinaires passent en plus le contrôle des servitudes aéronautiques (`hubs.checkBuilding`)
 * quand le module est présent. Voir docs/HUBS.md.
 */
export const isHubAsset = (a: CatalogAsset | null | undefined): boolean => !!a && a.tags.includes('hub');

/** Ce dont les outils ont besoin du pont de simulation (SimBridge l'implémente). */
export interface SimPort {
  send<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<CommandResult<K>>;
  onSnapshot(l: (s: SnapshotMessage) => void): void;
  onDelta(l: (d: DeltaMessage) => void): void;
  /** Commandes étendues (SimBridge.sendExt) : éditions du terrain. Absent = outil Terrain indisponible. */
  sendExt?<K extends ExtCommandName>(name: K, args: ExtCommandArgs<K>): Promise<ExtCommandResult<K>>;
}

/** Phase prévue des outils non encore disponibles. */
export const TOOL_PHASE: Record<ToolId, number | null> = {
  select: null,
  road: null,
  building: null,
  bulldoze: null,
  terraform: null,
};

/** Remboursement à la démolition appliqué par la simulation (src/sim/world.ts). Affichage indicatif. */
export const DEMOLISH_REFUND_RATE = 0.25;

export type Validity = 'pending' | 'ok' | 'error';

/** Sous-outil de l'outil Routes. */
export type RoadSubTool = 'draw' | 'grid' | 'upgrade';
/** Action de l'outil « Améliorer » : type suivant (rue → avenue → boulevard), type précis, ou inversion du sens. */
export type UpgradeTarget = 'next' | 'prev' | 'reverse' | RoadKindId;

export type ToolPreview =
  | { kind: 'none' }
  | { kind: 'select'; hover: PickResult | null }
  | { kind: 'building'; asset: CatalogAsset; proposal: PlacementProposal; variant: number; validity: Validity; cost: number; message: string }
  | { kind: 'road'; type: RoadKindId; mode: RoadMode; points: number[] | null; start: SnapPoint | null; control: SnapPoint | null; hover: SnapPoint | null; validity: Validity; cost: number; length: number; message: string; angle: string; chained: number; elevation?: number; path?: number[] }
  | { kind: 'grid'; type: RoadKindId; start: { x: number; z: number } | null; hover: { x: number; z: number } | null; layout: GridLayout | null; validity: Validity; cost: number; message: string }
  | { kind: 'upgrade'; target: RoadEdgeView | null; toKind: RoadKindId | null; reverse: boolean; validity: Validity; cost: number; refund: number; message: string }
  | { kind: 'bulldoze'; target: PickResult | null; refund: number }
  | TerrainPreview;

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
  /** Sous-outil de l'outil Routes. */
  roadSub: RoadSubTool = 'draw';
  /** Taille d'îlot (m) : pas du quadrillage et distance des lignes guides parallèles. */
  gridBlock = DEFAULT_GRID_BLOCK;
  /** Lignes guides parallèles aux routes existantes, à distance d'îlot (avec l'aimantation). */
  guides = true;
  upgradeTarget: UpgradeTarget = 'next';
  private gridStart: { x: number; z: number } | null = null;
  private gridKey = '';
  private upgradeKey = '';
  /** Orientation du quadrillage en cours (0 = nord / est). */
  private gridAngle = 0;
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

  /** Outils du tiroir Terrain (Défricher, Quai / remblai, Creuser). */
  readonly terrain: TerrainTool;

  constructor(readonly mirror: WorldMirror, readonly sim: SimPort, readonly notify: Notify) {
    mirror.onChange(() => this.refresh());
    // Nouvelle partie ou partie chargée : les identifiants repartent de 1, l'historique d'annulation de l'ancienne
    // ville détruirait des objets de la nouvelle.
    sim.onSnapshot(() => { this.undo.clear(); this.draft.reset(); });
    this.terrain = new TerrainTool({
      terrainEdit: (args) => (sim.sendExt ? sim.sendExt('terrainEdit', args) : Promise.reject(new Error('Éditions du terrain indisponibles'))),
    }, notify, () => { if (this.tool === 'terraform') this.refresh(); });
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
      if (!a || (!isBuildingCategory(a.category) && !isHubAsset(a))) { this.notify('Choisissez un bâtiment du catalogue', 'error'); return false; }
      if (a !== this.asset) { this.asset = a; this.variant = this.randomVariant(a); }
    }
    if (opts?.roadType && roadDef(opts.roadType)) this.roadType = opts.roadType;
    this.tool = t;
    this.draft.reset();
    this.gridStart = null;
    this.draft.type = this.roadType;
    this.refresh();
    for (const l of this.toolListeners) l(t);
    return true;
  }

  setRoadType(t: RoadKindId): void { this.roadType = t; this.draft.type = t; this.refresh(); }
  setRoadMode(m: RoadMode): void {
    this.draft.mode = m;
    if (this.draft.phase === 'control') this.draft.back();
    if (m === 'roundabout') this.draft.reset();
    if (this.roadSub !== 'draw') this.setRoadSub('draw');
    else this.refresh();
  }

  /** Change de sous-outil Routes (Tracer / Quadrillage / Améliorer) ; le tracé en cours est abandonné. */
  setRoadSub(sub: RoadSubTool): void {
    this.roadSub = sub;
    this.draft.reset();
    this.gridStart = null;
    this.gridKey = ''; this.upgradeKey = '';
    this.refresh();
  }

  setGridBlock(b: number): void { this.gridBlock = b; this.gridKey = ''; this.refresh(); }
  setGuides(on: boolean): void { this.guides = on; this.refresh(); }
  setUpgradeTarget(t: UpgradeTarget): void { this.upgradeTarget = t; this.upgradeKey = ''; this.refresh(); }

  /** Vrai si un tracé (ou un quadrillage) est en cours : le bouton « Terminer » l'arrête. */
  get drawing(): boolean { return this.tool === 'road' && (this.draft.phase !== 'idle' || this.gridStart !== null); }

  /** « Terminer » : arrête l'enchaînement en cours sans quitter l'outil. Renvoie false si rien n'était en cours. */
  finishRoad(): boolean {
    if (!this.drawing) return false;
    const n = this.draft.chained;
    this.draft.reset();
    this.gridStart = null;
    this.gridKey = '';
    if (n > 0) this.notify(`Tracé terminé : ${n} tronçon${n > 1 ? 's' : ''}`, 'info');
    this.refresh();
    return true;
  }
  /** ▲ / ▼ de l'outil Routes : hauteur imposée du tracé par pas de 4 m (aperçu 3D renvoyé par la simulation). */
  setRoadElevation(dir: 1 | -1): void { this.draft.raise(dir); this.refresh(); }
  setRoundaboutSize(size: 'small' | 'large'): void { this.draft.roundaboutSize = size; this.setRoadMode('roundabout'); }

  rotate(dir = 1): void {
    if (this.tool !== 'building') return;
    const cur = this.preview.kind === 'building' ? this.preview.proposal.rot : this.rot;
    // Pôles : huitièmes de tour (piste orientable) ; bâtiments : quarts de tour.
    const step = isHubAsset(this.asset) ? 0.5 : 1;
    this.rot = normRot(Math.round(cur / step) * step + dir * step);
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
        const hub = isHubAsset(a);
        const proposal = proposePlacement(this.mirror, a, g.x, g.z, hub ? { rot: this.rot, autoAlign: false, reach: -1e9 } : { rot: this.rot, autoAlign: this.autoAlign, magnet: this.magnet });
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
        if (this.roadSub === 'grid') { if (this.refreshGrid(g)) return; break; }
        if (this.roadSub === 'upgrade') { if (this.refreshUpgrade(g)) return; break; }
        const d = this.draft;
        d.hover = g ? snapRoadPoint(this.mirror, g.x, g.z, { radius: this.snapRadius, angleSnap: this.angleSnap, magnet: this.magnet, grid: this.gridSnap && this.magnet, guideSpacing: this.guides ? this.gridBlock : 0 }, d.phase !== 'idle' ? (d.control ?? d.start ?? undefined) : undefined) : null;
        const points = d.points();
        const def = roadDef(this.roadType);
        const length = d.length();
        this.preview = {
          kind: 'road', type: this.roadType, mode: d.mode, points, start: d.start, control: d.control, hover: d.hover,
          validity: points ? 'pending' : 'ok', cost: def ? Math.round(length * def.costPerMeter) : 0, length,
          message: d.phase === 'idle' ? 'Placez le départ' : d.mode === 'curve' && d.phase === 'start' ? 'Placez le point de courbure' : '',
          angle: points && d.start && d.hover ? angleLabel(this.mirror, d.start, d.hover) : '', chained: d.chained,
        };
        if (d.mode === 'roundabout') {
          this.preview = { ...this.preview, message: 'Cliquez sur un carrefour ou sur une route pour poser le giratoire' };
          break;
        }
        if (d.elevation) this.preview = { ...this.preview, elevation: d.elevation };
        if (points) this.validateRoad(points);
        break;
      }
      case 'terraform':
        this.terrain.angleSnap = this.angleSnap;
        this.terrain.setHover(g);
        this.preview = this.terrain.preview();
        break;
      default:
        this.preview = { kind: 'none' };
    }
    this.emit();
  }

  private validatedVersion = -1;

  /** Aperçu du quadrillage. Renvoie true si l'aperçu précédent (même disposition, validation en cours ou faite) est conservé. */
  private refreshGrid(g: { x: number; z: number } | null): boolean {
    const corner = g ? gridCorner(g.x, g.z) : null;
    const def = roadDef(this.roadType);
    if (!this.gridStart) {
      this.gridKey = '';
      this.preview = { kind: 'grid', type: this.roadType, start: null, hover: corner, layout: null, validity: 'ok', cost: 0, message: 'Placez un premier coin de l\'îlot' };
      return false;
    }
    if (!g) { this.preview = { kind: 'grid', type: this.roadType, start: this.gridStart, hover: null, layout: null, validity: 'ok', cost: 0, message: 'Placez le coin opposé' }; return false; }
    const layout = gridLayout(this.gridStart, g, this.gridBlock, this.mirror, this.gridAngle);
    const key = `${this.roadType}|${this.mirror.version}|${layout.lines.map((l) => l.join(',')).join(';')}`;
    const prev = this.preview;
    if (key === this.gridKey && prev.kind === 'grid' && prev.layout) {
      this.preview = { ...prev, hover: corner };
      this.emit();
      return true;
    }
    this.gridKey = key;
    const estimate = def ? Math.round(layout.length * def.costPerMeter) : 0;
    this.preview = {
      kind: 'grid', type: this.roadType, start: this.gridStart, hover: corner, layout, validity: layout.lines.length ? 'pending' : 'error', cost: estimate,
      message: layout.lines.length ? (layout.clamped ? `Limité à ${layout.nx}×${layout.nz} îlots` : '') : 'Ces rues existent déjà',
    };
    if (layout.lines.length) this.validateGrid(key, layout);
    return false;
  }

  private validateGrid(key: string, layout: GridLayout): void {
    const seq = ++this.previewSeq;
    const type = this.roadType;
    this.dry.run(async () => {
      if (seq !== this.previewSeq) return;
      let validity: Validity = 'ok'; let message = ''; let cost = 0;
      for (let i = 0; i < layout.lines.length; i++) {
        try {
          const r = await this.sim.send('buildRoad', { type: legacyRoadType(type), kind: type, points: [...layout.lines[i]!], dryRun: true });
          cost += r.cost;
        } catch (e) { validity = 'error'; message = `Rue ${i + 1}/${layout.lines.length} : ${errorOf(e).message}`; break; }
        if (seq !== this.previewSeq) return; // le curseur a bougé : inutile de finir
      }
      // Chaque rue est validée seule : le total doit aussi tenir dans la trésorerie.
      const money = this.mirror.stats?.money;
      if (validity === 'ok' && money !== undefined && cost > money) { validity = 'error'; message = `Fonds insuffisants (${fmt(cost)} ¢ requis)`; }
      const cur = this.preview;
      if (cur.kind === 'grid' && this.gridKey === key) {
        this.preview = { ...cur, validity, message: message || cur.message, cost: validity === 'ok' ? cost : cur.cost };
        this.emit();
      }
    });
  }

  /** Arguments upgradeRoad pour un tronçon selon l'action choisie, ou le motif local d'impossibilité. */
  upgradeArgs(e: RoadEdgeView): { kind?: RoadKindId; reverse?: boolean } | string {
    const t = this.upgradeTarget;
    if (t === 'reverse') return e.kindId === 'oneway' ? { reverse: true } : 'Seule une rue à sens unique a un sens à inverser';
    if (t === 'next') return e.kindId === 'boulevard' ? 'Déjà au plus large (boulevard) : utilisez « Gamme − »' : { kind: nextUpgradeKind(e.kindId) };
    if (t === 'prev') return e.kindId === 'street' ? 'Déjà au plus étroit (rue)' : { kind: prevUpgradeKind(e.kindId) };
    if (t === e.kindId) return t === 'oneway' ? { reverse: true } : `Ce tronçon est déjà : ${roadDef(t)?.nameFr ?? t}`;
    return { kind: t };
  }

  /**
   * Rue entière autour d'un tronçon : on suit les tronçons du même type tant que le nœud n'est qu'un simple coude
   * (deux tronçons), jusqu'aux carrefours ou aux extrémités. Ordre : du tronçon désigné vers l'extérieur.
   */
  streetChain(e: RoadEdgeView): RoadEdgeView[] {
    const byNode = new Map<number, RoadEdgeRecord[]>();
    for (const r of this.mirror.edges.values()) {
      for (const n of [r.a, r.b]) { const l = byNode.get(n); if (l) l.push(r); else byNode.set(n, [r]); }
    }
    const kindOf = (r: RoadEdgeRecord): string => r.kind ?? r.type;
    const seen = new Set<number>([e.id]);
    const out: RoadEdgeView[] = [e];
    for (const start of [e.a, e.b]) {
      let node = start, prev: RoadEdgeRecord = e;
      for (let guard = 0; guard < 200; guard++) {
        const inc = byNode.get(node) ?? [];
        if (inc.length !== 2) break;
        const next = inc[0]!.id === prev.id ? inc[1]! : inc[0]!;
        if (seen.has(next.id) || kindOf(next) !== kindOf(e)) break;
        const v = this.mirror.edgeView(next);
        if (!v) break;
        seen.add(next.id); out.push(v);
        node = next.a === node ? next.b : next.a; prev = next;
      }
    }
    return out;
  }

  private refreshUpgrade(g: { x: number; z: number } | null): boolean {
    let target: RoadEdgeView | null = null;
    const hit = this.lastRay ? this.mirror.pick(this.lastRay, g) : null;
    if (hit && hit.kind === 'road') target = hit.edge;
    else if (g) target = this.mirror.nearestEdge(g.x, g.z, Math.max(4, this.snapRadius * 0.6))?.edge ?? null;
    if (!target) {
      this.upgradeKey = '';
      this.preview = { kind: 'upgrade', target: null, toKind: null, reverse: false, validity: 'ok', cost: 0, refund: 0, message: 'Désignez une route à modifier' };
      return false;
    }
    const args = this.upgradeArgs(target);
    const key = `${target.id}|${this.mirror.version}|${typeof args === 'string' ? args : `${args.kind ?? ''}/${args.reverse ? 1 : 0}`}`;
    if (key === this.upgradeKey && this.preview.kind === 'upgrade') { this.emit(); return true; }
    this.upgradeKey = key;
    if (typeof args === 'string') {
      this.preview = { kind: 'upgrade', target, toKind: null, reverse: false, validity: 'error', cost: 0, refund: 0, message: args };
      return false;
    }
    const toKind = args.kind ?? target.kindId;
    this.preview = { kind: 'upgrade', target, toKind, reverse: !!args.reverse, validity: 'pending', cost: 0, refund: 0, message: '' };
    const seq = ++this.previewSeq;
    const chain = this.streetChain(target);
    this.dry.run(async () => {
      if (seq !== this.previewSeq) return;
      let validity: Validity; let message = ''; let cost = 0; let refund = 0;
      try {
        // Rue entière : somme des devis de chaque tronçon (refus du premier tronçon impossible).
        for (const c of chain) {
          const r = await this.sim.send('upgradeRoad', { edgeId: c.id, ...args, dryRun: true });
          cost += r.cost; refund += r.refund;
        }
        validity = 'ok';
        if (chain.length > 1) message = `Rue entière : ${chain.length} tronçons`;
      } catch (e) { validity = 'error'; message = errorOf(e).message; }
      const cur = this.preview;
      if (cur.kind === 'upgrade' && this.upgradeKey === key) {
        this.preview = { ...cur, validity, message, cost, refund };
        this.emit();
      }
    });
    return false;
  }

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
        if (isHubAsset(p.asset)) {
          const r = await this.sim.send('pluginCommand', { plugin: 'hubs', name: 'place', payload: { assetId: args.assetId, x: args.x, z: args.z, rot: args.rot, dryRun: true } });
          cost = (r.data as { cost: number }).cost;
        } else {
          const r = await this.sim.send('placeBuilding', args);
          cost = r.cost;
          const refusal = await this.easementRefusal(args);
          if (refusal) throw { error: { code: 'INVALID_ARGS', message: refusal } };
        }
        validity = 'ok';
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
        case 'road':
          if (this.roadSub === 'grid') await this.gridClick();
          else if (this.roadSub === 'upgrade') await this.upgradeClick();
          else await this.roadClick();
          break;
        case 'bulldoze': await this.bulldozeCurrent(); break;
        case 'terraform': if (await this.terrain.click()) this.applied++; break;
        default: break;
      }
    } finally { this.busy = false; }
  }

  /** Servitudes aéronautiques (module `hubs`) : message de refus, ou null (module absent = pas de contrainte). */
  private async easementRefusal(a: { assetId: string; x: number; z: number; rot: number; variant: number }): Promise<string | null> {
    try {
      await this.sim.send('pluginCommand', { plugin: 'hubs', name: 'checkBuilding', payload: { assetId: a.assetId, x: a.x, z: a.z, rot: a.rot, variant: a.variant } });
      return null;
    } catch (e) {
      const msg = errorOf(e).message;
      return msg.startsWith('Servitude aéronautique') ? msg : null;
    }
  }

  private async placeCurrent(): Promise<void> {
    const p = this.preview;
    if (p.kind !== 'building') return;
    if (isHubAsset(p.asset)) {
      try {
        const r = await this.sim.send('pluginCommand', { plugin: 'hubs', name: 'place', payload: { assetId: p.asset.id, x: p.proposal.x, z: p.proposal.z, rot: p.proposal.rot } });
        this.applied++;
        this.notify(`${p.asset.nameFr} construit (−${fmt((r.data as { cost: number }).cost)} ¢)`, 'ok');
        this.preview = { kind: 'none' };
        this.refresh();
      } catch (e) { this.notify(`Construction refusée : ${errorOf(e).message}`, 'error'); }
      return;
    }
    const refusal = await this.easementRefusal({ assetId: p.asset.id, x: p.proposal.x, z: p.proposal.z, rot: p.proposal.rot, variant: p.variant });
    if (refusal) { this.notify(`Construction refusée : ${refusal}`, 'error'); return; }
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

  private async gridClick(): Promise<void> {
    const g = this.lastGround;
    if (!this.gridStart) {
      if (!g) return;
      // Aimantation : premier coin posé sur une route proche en biais -> quadrillage aligné sur elle.
      const near = this.magnet ? this.mirror.nearestEdge(g.x, g.z, 12) : null;
      const a = near ? Math.atan2(near.tz, near.tx) : 0;
      const q = a - Math.round(a / (Math.PI / 2)) * (Math.PI / 2); // ramené à ±45°
      if (near && Math.abs(q) > 0.02) { this.gridAngle = q; this.gridStart = { x: Math.round(near.px * 100) / 100, z: Math.round(near.pz * 100) / 100 }; }
      else { this.gridAngle = 0; this.gridStart = gridCorner(g.x, g.z); }
      this.refresh();
      return;
    }
    const p = this.preview;
    if (p.kind !== 'grid' || !p.layout) return;
    if (p.validity === 'error') { this.notify(`Quadrillage refusé : ${p.message}`, 'error'); return; }
    const layout = p.layout;
    const type = this.roadType;
    let built = 0; let spent = 0; let minEdge = Infinity; let lastErr = '';
    for (const l of layout.lines) {
      try {
        const r = await this.sim.send('buildRoad', { type: legacyRoadType(type), kind: type, points: [...l] });
        built++; spent += r.cost;
        for (const id of r.edgeIds) minEdge = Math.min(minEdge, id);
      } catch (e) { lastErr = errorOf(e).message; }
    }
    if (built > 0) {
      this.applied++;
      this.undo.push({ label: `Quadrillage ${layout.nx}×${layout.nz}`, steps: [{ kind: 'removeGrid', minEdgeId: minEdge, x0: layout.x0, z0: layout.z0, x1: layout.x1, z1: layout.z1, block: layout.block, angle: layout.angle, ox: layout.ox, oz: layout.oz }] });
    }
    const blocks = `${layout.nx}×${layout.nz} îlot${layout.nx * layout.nz > 1 ? 's' : ''} de ${layout.block} m`;
    if (built === layout.lines.length) this.notify(`Quadrillage ${blocks} : ${fmt(layout.length)} m de rues (−${fmt(spent)} ¢)`, 'ok');
    else if (built > 0) this.notify(`Quadrillage partiel (${built}/${layout.lines.length} rues, −${fmt(spent)} ¢) : ${lastErr}`, 'error');
    else this.notify(`Quadrillage refusé : ${lastErr}`, 'error');
    this.gridStart = null;
    this.gridKey = '';
    this.refresh();
  }

  private async upgradeClick(): Promise<void> {
    const p = this.preview;
    if (p.kind !== 'upgrade' || !p.target) return;
    const e = p.target;
    const args = this.upgradeArgs(e);
    if (typeof args === 'string') { this.notify(args, 'error'); return; }
    const chain = this.streetChain(e);
    const steps: UndoStep[] = [];
    let cost = 0, refund = 0, kindTo: RoadKindId = e.kindId;
    let failed = '';
    for (const c of chain) {
      try {
        const r = await this.sim.send('upgradeRoad', { edgeId: c.id, ...args });
        this.undo.renameEdge(c.id, r.edgeId);
        steps.push({ kind: 'upgradeRoad', edgeId: r.edgeId, toKind: c.kindId, reverse: !!args.reverse && c.kindId === 'oneway' });
        cost += r.cost; refund += r.refund; kindTo = r.kind;
      } catch (err) { failed = errorOf(err).message; break; }
    }
    if (steps.length) {
      this.applied++;
      const from = roadDef(e.kindId)?.nameFr ?? e.kindId;
      const to = roadDef(kindTo)?.nameFr ?? kindTo;
      this.undo.push({ label: args.kind && args.kind !== e.kindId ? `Modification : ${from} → ${to}` : 'Inversion du sens', steps });
      const money = cost > 0 ? ` (−${fmt(cost)} ¢)` : refund > 0 ? ` (+${fmt(refund)} ¢)` : '';
      const what = args.kind && args.kind !== e.kindId ? `${from} → ${to}` : 'sens de circulation inversé';
      const n = steps.length > 1 ? `Rue modifiée (${steps.length} tronçons)` : 'Tronçon modifié';
      this.notify(`${n} : ${what}${args.kind && args.kind !== e.kindId && args.reverse ? ', sens inversé' : ''}${money}${failed ? ` — arrêt : ${failed}` : ''}`, failed ? 'error' : 'ok');
    } else this.notify(`Modification refusée : ${failed}`, 'error');
    this.upgradeKey = '';
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
    if (this.tool === 'road' && this.gridStart) { this.gridStart = null; this.gridKey = ''; this.refresh(); return true; }
    if (this.tool === 'road' && this.draft.back()) { this.refresh(); return true; }
    if (this.tool === 'terraform' && this.terrain.back()) return true;
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
        else if (s.kind === 'upgradeRoad') {
          const r = await this.sim.send('upgradeRoad', { edgeId: s.edgeId, ...(s.toKind ? { kind: s.toKind } : {}), ...(s.reverse ? { reverse: true } : {}) });
          this.undo.renameEdge(s.edgeId, r.edgeId);
        } else if (s.kind === 'removeGrid') {
          // Tronçons créés par le quadrillage (découpés par ses propres croisements) : résolus maintenant.
          const ids: number[] = [];
          for (const e of this.mirror.edges.values()) {
            if (e.id < s.minEdgeId) continue;
            const v = this.mirror.edgeView(e);
            if (v && edgeOnGrid(v.poly, s)) ids.push(e.id);
          }
          for (const id of ids) { await this.sim.send('removeRoad', { edgeId: id }); this.undo.forgetEdge(id); }
          if (ids.length === 0) throw new Error('Rues du quadrillage introuvables');
        } else {
          // Route courbe : point de contrôle quadratique retrouvé depuis la Bézier cubique stockée (c1 = a + 2/3 (q - a)).
          const [ax, az] = [s.points[0]!, s.points[1]!];
          const control: [number, number] | undefined = s.c1 ? [(3 * s.c1[0] - ax) / 2, (3 * s.c1[1] - az) / 2] : undefined;
          await this.sim.send('buildRoad', { type: legacyRoadType(s.kindId), kind: s.kindId, points: s.points, ...(control ? { control } : {}) });
        }
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
