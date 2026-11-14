/**
 * Outils du tiroir « Terrain » (outil `terraform` de la barre), indépendants du moteur (ni three ni DOM) :
 *
 *   clear (Défricher)      : pinceau circulaire ; clic = retire les arbres du disque (petit coût).
 *   quay  (Quai / remblai) : clic départ, clic arrivée : ligne droite tracée DANS l'eau, le long de la rive ;
 *                            l'eau côté terre est remblayée jusqu'à la ligne, mur de quai droit sur la ligne.
 *   dig   (Creuser)        : clic départ, clic arrivée : bassin ou canal droit de largeur réglable.
 *   river (Rivière)        : un clic par point de passage (tracé lissé) ; « Terminer » (ou un clic sur le dernier
 *                            point) creuse la rivière, berges en pente et mise en eau raccordée à l'eau voisine.
 *
 * Comme les autres outils, rien n'est appliqué localement : chaque aperçu est validé par la simulation
 * (commande étendue `terrainEdit` en dryRun, la plus récente gagne), qui renvoie coût, contour et refus éventuel.
 */
import { EDIT_LIMITS, riverCenterline, type TerrainEdit } from '../../sim/terrain/edits';
import type { TerrainEditResult } from '../../sim/sim-protocol';

export type TerrainToolMode = 'clear' | 'quay' | 'dig' | 'river' | 'raise' | 'lower' | 'flatten';

/** Modes « pinceau » : un clic applique sur un disque (pas de point de départ). */
export const isBrushMode = (m: TerrainToolMode): boolean => m === 'clear' || m === 'raise' || m === 'lower' || m === 'flatten';

export const TERRAIN_MODES: readonly { id: TerrainToolMode; nameFr: string; tip: string }[] = [
  { id: 'clear', nameFr: 'Défricher', tip: 'Défricher : retire les arbres d\'une zone (pinceau, petit coût)' },
  { id: 'quay', nameFr: 'Quai / remblai', tip: 'Quai / remblai : tracez une ligne droite dans l\'eau le long de la rive ; l\'eau côté terre est remblayée jusqu\'à un quai droit. Une ligne en travers d\'une rivière la comble.' },
  { id: 'dig', nameFr: 'Creuser', tip: 'Creuser : bassin ou canal droit (clic départ, clic arrivée), mis en eau au niveau de l\'eau voisine' },
  { id: 'river', nameFr: 'Rivière', tip: 'Rivière : un clic par point de passage (tracé courbe), puis « Terminer » ; lit creusé, berges en pente, eau raccordée aux lacs, rivières ou à la mer touchés' },
  { id: 'raise', nameFr: 'Élever', tip: 'Élever : monte le terrain sous le pinceau (bord adouci) ; appuyez et glissez pour modeler, une passe par palier' },
  { id: 'lower', nameFr: 'Abaisser', tip: 'Abaisser : creuse le terrain sous le pinceau (bord adouci) ; appuyez et glissez ; l\'eau ne s\'étend pas' },
  { id: 'flatten', nameFr: 'Niveler', tip: 'Niveler : aplanit à la hauteur du premier point touché ; glissez pour étendre le plat (pour bâtir sur une pente)' },
];

/** Rayons du pinceau Défricher et largeurs de canal proposés (m). */
export const CLEAR_RADII = [16, 30, 50, 80] as const;
export const DIG_WIDTHS = [16, 24, 40, 64] as const;
/** Largeurs de rivière proposées (m). */
export const RIVER_WIDTHS = [16, 24, 40, 64] as const;
/** Paliers des pinceaux Élever / Abaisser (m par clic). */
export const RELIEF_STEPS = [1, 2, 4] as const;

export type TerrainValidity = 'pending' | 'ok' | 'error';

export interface TerrainPreview {
  kind: 'terrain';
  mode: TerrainToolMode;
  /** Point de départ (quai, creuser) ; null tant qu'il n'est pas posé. */
  start: { x: number; z: number } | null;
  hover: { x: number; z: number } | null;
  radius: number;
  width: number;
  /** Contour renvoyé par la simulation (x, z alternés) ; null sans validation. */
  outline: number[] | null;
  validity: TerrainValidity;
  cost: number;
  /** Longueur du tracé (m). */
  length: number;
  /** Rivière : axe lissé (points posés + survol), x/z alternés ; null sinon. */
  path: number[] | null;
  /** Rivière : nombre de points posés. */
  points: number;
  message: string;
}

/** Ce dont l'outil a besoin de la simulation. */
export interface TerrainEditPort {
  terrainEdit(args: { edit: TerrainEdit; dryRun?: boolean }): Promise<TerrainEditResult>;
}

const fmt = (n: number): string => new Intl.NumberFormat('fr-FR').format(Math.round(n));

export class TerrainTool {
  mode: TerrainToolMode = 'clear';
  radius: number = CLEAR_RADII[1];
  width: number = DIG_WIDTHS[1];
  step: number = RELIEF_STEPS[1];
  riverWidth: number = RIVER_WIDTHS[1];
  /** Rivière : points de passage posés (x, z alternés). */
  private pts: number[] = [];
  /** Angle magnétique (15°) pour les tracés droits. */
  angleSnap = false;
  private start: { x: number; z: number } | null = null;
  private hover: { x: number; z: number } | null = null;
  private result: { key: string; validity: TerrainValidity; cost: number; outline: number[] | null; message: string } | null = null;
  private inFlight = false;
  private queued: (() => Promise<void>) | null = null;
  private busy = false;

  constructor(private readonly port: TerrainEditPort, private readonly notify: (t: string, k: 'info' | 'error' | 'ok') => void, private readonly changed: () => void) {}

  setMode(m: TerrainToolMode): void { this.mode = m; this.reset(); }
  setRadius(r: number): void { this.radius = r; this.result = null; this.changed(); }
  setWidth(w: number): void { this.width = w; this.result = null; this.changed(); }
  setStep(d: number): void { this.step = d; this.result = null; this.changed(); }
  setRiverWidth(w: number): void { this.riverWidth = w; this.result = null; this.changed(); }
  reset(): void { this.start = null; this.pts = []; this.result = null; this.changed(); }
  get hasStart(): boolean { return this.start !== null || this.pts.length > 0; }
  /** Rivière : nombre de points posés. */
  get riverPoints(): number { return this.pts.length / 2; }
  /** Point survolé (aimanté) ; null hors carte. */
  get hoverPoint(): { x: number; z: number } | null { return this.hover; }

  /** Geste « pinceau » en cours (glisser) : passes appliquées, coût cumulé, première erreur, hauteur de nivellement. */
  private stroke: { n: number; cost: number; err: string | null; h?: number; label: string } | null = null;
  get painting(): boolean { return this.stroke !== null; }

  /** Début d'un geste pinceau : les passes suivent le doigt (ou la souris) jusqu'à endStroke(). */
  beginStroke(): void { this.stroke = { n: 0, cost: 0, err: null, label: '' }; }

  /** Une passe du pinceau au point survolé ; faux si rien n'a été appliqué (occupé, refus). */
  async dab(): Promise<boolean> {
    const st = this.stroke;
    if (!st || this.busy || !isBrushMode(this.mode)) return false;
    let e = this.edit();
    if (!e) return false;
    if (e.k === 'flatten' && st.h !== undefined) e = { ...e, h: st.h };
    st.label = label(e);
    this.busy = true;
    try {
      const r = await this.port.terrainEdit({ edit: e });
      st.n++;
      st.cost += r.cost;
      if (st.h === undefined && r.h !== undefined) st.h = r.h;
      return true;
    } catch (err) {
      if (!st.err) st.err = errMessage(err);
      return false;
    } finally {
      this.busy = false;
      this.result = null;
      this.changed();
    }
  }

  /** Fin du geste : un seul message (passes et coût total, ou la raison du refus). */
  async endStroke(): Promise<number> {
    const st = this.stroke;
    if (!st) return 0;
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
    this.stroke = null;
    if (st.n > 0) this.notify(`${st.label} : ${st.n} passe${st.n > 1 ? 's' : ''} · ${fmt(st.cost)} CHF`, 'ok');
    else if (st.err) this.notify(`${st.label || 'Terrain'} impossible : ${st.err}`, 'error');
    return st.n;
  }

  /** Survol : point au sol. */
  setHover(g: { x: number; z: number } | null): void {
    this.hover = g ? this.snap(g) : null;
  }

  /** Extrémité aimantée : angle par pas de 15° (Maj), longueur au mètre. */
  private snap(g: { x: number; z: number }): { x: number; z: number } {
    const s = this.start;
    if (!s || isBrushMode(this.mode) || this.mode === 'river') return { x: Math.round(g.x * 2) / 2, z: Math.round(g.z * 2) / 2 };
    let dx = g.x - s.x, dz = g.z - s.z;
    let L = Math.hypot(dx, dz);
    if (L < 1e-6) return { ...s };
    let a = Math.atan2(dz, dx);
    if (this.angleSnap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    L = Math.round(L);
    dx = Math.cos(a) * L; dz = Math.sin(a) * L;
    return { x: s.x + dx, z: s.z + dz };
  }

  /** Édition décrite par l'état courant ; null si incomplète. */
  edit(): TerrainEdit | null {
    const h = this.hover;
    if (!h) return null;
    if (this.mode === 'clear') return { k: 'clear', x: h.x, z: h.z, r: this.radius };
    if (this.mode === 'raise' || this.mode === 'lower') return { k: this.mode, x: h.x, z: h.z, r: this.radius, d: this.step };
    if (this.mode === 'flatten') return { k: 'flatten', x: h.x, z: h.z, r: this.radius };
    if (this.mode === 'river') {
      if (this.pts.length < 2) return null;
      const n = this.pts.length;
      const onLast = Math.hypot(h.x - this.pts[n - 2]!, h.z - this.pts[n - 1]!) < 2;
      if (n < 4 && onLast) return null;
      const pts = onLast || n / 2 >= EDIT_LIMITS.maxRiverPoints ? this.pts.slice() : [...this.pts, h.x, h.z];
      return { k: 'river', pts, w: this.riverWidth };
    }
    const s = this.start;
    if (!s) return null;
    if (this.mode === 'quay') return { k: 'quay', ax: s.x, az: s.z, bx: h.x, bz: h.z };
    return { k: 'dig', ax: s.x, az: s.z, bx: h.x, bz: h.z, w: this.width };
  }

  /** Aperçu courant ; lance la validation (dryRun) si l'édition a changé. */
  preview(): TerrainPreview {
    const e = this.edit();
    const key = e ? JSON.stringify(e) : '';
    const path = e?.k === 'river' ? riverCenterline(e.pts) : null;
    let length = e && (e.k === 'quay' || e.k === 'dig') ? Math.hypot(e.bx - e.ax, e.bz - e.az) : 0;
    if (path) for (let i = 2; i < path.length; i += 2) length += Math.hypot(path[i]! - path[i - 2]!, path[i + 1]! - path[i - 1]!);
    if (e && this.result?.key !== key) {
      this.result = { key, validity: 'pending', cost: 0, outline: null, message: '' };
      this.validate(e, key);
    }
    const r = e ? this.result : null;
    const idle = !isBrushMode(this.mode) && !this.hasStart;
    return {
      kind: 'terrain', mode: this.mode, start: this.start, hover: this.hover, radius: this.radius, width: this.mode === 'river' ? this.riverWidth : this.width,
      outline: r?.outline ?? null, validity: r?.validity ?? 'ok', cost: r?.cost ?? 0, length, path, points: this.pts.length / 2,
      message: idle ? (this.mode === 'quay' ? 'Cliquez dans l\'eau, le long de la rive, pour le début du quai' : this.mode === 'river' ? 'Cliquez pour la source de la rivière (ou au bord d\'un lac, d\'une rivière, de la mer)' : 'Cliquez pour le début du bassin ou du canal') : r?.message ?? '',
    };
  }

  private validate(e: TerrainEdit, key: string): void {
    const job = async (): Promise<void> => {
      if (this.result?.key !== key) return; // un aperçu plus récent attend
      let res: { validity: TerrainValidity; cost: number; outline: number[] | null; message: string };
      try {
        const r = await this.port.terrainEdit({ edit: e, dryRun: true });
        res = { validity: 'ok', cost: r.cost, outline: r.outline, message: describe(e, r) };
      } catch (err) {
        res = { validity: 'error', cost: 0, outline: null, message: errMessage(err) };
      }
      if (this.result?.key === key) { this.result = { key, ...res }; this.changed(); }
    };
    if (this.inFlight) { this.queued = job; return; }
    const run = (j: () => Promise<void>): void => {
      this.inFlight = true;
      void j().finally(() => {
        this.inFlight = false;
        const n = this.queued;
        this.queued = null;
        if (n) run(n);
      });
    };
    run(job);
  }

  /** Clic principal : pose le départ, ou applique l'édition. Renvoie vrai si la simulation l'a appliquée. */
  async click(): Promise<boolean> {
    if (this.busy) return false;
    if (this.mode === 'river') {
      const h = this.hover;
      if (!h) return false;
      const n = this.pts.length;
      const onLast = n >= 2 && Math.hypot(h.x - this.pts[n - 2]!, h.z - this.pts[n - 1]!) < 6;
      // Clic sur le dernier point (ou nombre maximal atteint) : la rivière est creusée.
      if (onLast && n >= 4) return this.finishRiver();
      if (onLast) return false;
      if (n / 2 >= EDIT_LIMITS.maxRiverPoints) return this.finishRiver();
      this.pts.push(h.x, h.z);
      this.result = null;
      this.changed();
      return false;
    }
    if (!isBrushMode(this.mode) && !this.start) {
      if (!this.hover) return false;
      this.start = { ...this.hover };
      this.result = null;
      this.changed();
      return false;
    }
    const e = this.edit();
    if (!e) return false;
    this.busy = true;
    try {
      const r = await this.port.terrainEdit({ edit: e });
      this.notify(`${label(e)} : ${describe(e, r)}`, 'ok');
      this.start = null;
      this.result = null;
      this.changed();
      return true;
    } catch (err) {
      this.notify(`${label(e)} impossible : ${errMessage(err)}`, 'error');
      return false;
    } finally { this.busy = false; }
  }

  /** Rivière : creuse le tracé posé (sans le point survolé). */
  async finishRiver(): Promise<boolean> {
    if (this.busy || this.pts.length < 4) { if (this.pts.length < 4) this.notify('Rivière : posez au moins deux points', 'error'); return false; }
    const e: TerrainEdit = { k: 'river', pts: this.pts.slice(), w: this.riverWidth };
    this.busy = true;
    try {
      const r = await this.port.terrainEdit({ edit: e });
      this.notify(`${label(e)} : ${describe(e, r)}`, 'ok');
      this.pts = [];
      this.result = null;
      this.changed();
      return true;
    } catch (err) {
      this.notify(`${label(e)} impossible : ${errMessage(err)}`, 'error');
      return false;
    } finally { this.busy = false; }
  }

  /** Clic droit / Échap : retire le point de départ (rivière : le dernier point). Renvoie faux s'il n'y avait rien à annuler. */
  back(): boolean {
    if (this.pts.length) {
      this.pts.length -= 2;
      this.result = null;
      this.changed();
      return true;
    }
    if (!this.start) return false;
    this.start = null;
    this.result = null;
    this.changed();
    return true;
  }
}

function label(e: TerrainEdit): string {
  return e.k === 'clear' ? 'Défrichage' : e.k === 'quay' ? 'Quai / remblai' : e.k === 'dig' ? 'Creusement' : e.k === 'river' ? 'Rivière' : e.k === 'raise' ? 'Élévation' : e.k === 'lower' ? 'Abaissement' : 'Nivellement';
}

function describe(e: TerrainEdit, r: TerrainEditResult): string {
  const parts = [`${fmt(r.cost)} CHF`];
  if (e.k === 'clear') parts.push(r.forestM2 > 0 ? `${fmt(r.forestM2)} m² de forêt` : 'peu d\'arbres ici');
  else {
    if (r.volume > 0) parts.push(`${fmt(r.volume)} m³ de terre`);
    if (r.wallLength > 0) parts.push(`${fmt(r.wallLength)} m de quai`);
  }
  return parts.join(' · ');
}

function errMessage(e: unknown): string {
  const o = e as { error?: { message?: string }; message?: string } | null;
  if (o && typeof o === 'object' && o.error && typeof o.error.message === 'string') return o.error.message;
  return o && typeof o.message === 'string' ? o.message : String(e);
}
