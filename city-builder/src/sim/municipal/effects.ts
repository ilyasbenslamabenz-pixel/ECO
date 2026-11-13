/**
 * Registre d'effets traçable : « cette décision a produit tel effet, de telle ampleur, ici ».
 *
 * Une CAUSE (décision du joueur, événement, politique) est déclarée une fois ; les modules y rattachent des
 * EFFETS mesurés (cible, ampleur signée, unité, lieu). Les effets détaillés sont conservés dans un tampon
 * borné (les plus anciens sortent) ; la synthèse par cause (cumul par cible) est conservée tant que la cause
 * existe (au plus `maxCauses`, les plus anciennes sont oubliées).
 *
 * `measureGrid` aide à mesurer l'effet d'une action sur une grille : instantané avant, action, puis
 * enregistrement de la variation totale et de son barycentre.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { EffectCause, EffectPlace, EffectRecord, EffectSummary } from '../../shared/municipal/types';
import type { IndicatorGrid } from './grid';

export interface EffectQuery {
  cause?: number;
  target?: string;
  /** Zone : effets localisés dont le point est à moins de `radius` (+ leur propre rayon) de (x, z). */
  x?: number;
  z?: number;
  radius?: number;
  district?: string;
  since?: number;
  limit?: number;
}

export class EffectRegistry {
  private causes = new Map<number, EffectCause>();
  private summaries = new Map<number, EffectSummary>();
  private effects: EffectRecord[] = [];
  private nextCause = 1;
  private nextEffect = 1;
  /** Effets enregistrés depuis le dernier `drainRecent` (deltas vers l'interface). */
  private recent: EffectRecord[] = [];
  version = 0;

  constructor(readonly maxEffects = 4096, readonly maxCauses = 1024) {}

  get causeCount(): number { return this.causes.size; }
  get effectCount(): number { return this.effects.length; }
  get isEmpty(): boolean { return this.causes.size === 0; }

  /** Déclare une cause ; renvoie son identifiant. */
  cause(c: Omit<EffectCause, 'id'>): number {
    if (!c.kind || !c.source) throw new Error('effet : cause sans type ou sans source');
    const id = this.nextCause++;
    const rec: EffectCause = { ...c, id };
    this.causes.set(id, rec);
    this.summaries.set(id, { cause: rec, count: 0, byTarget: {} });
    if (this.causes.size > this.maxCauses) {
      const oldest = Math.min(...this.causes.keys());
      this.causes.delete(oldest);
      this.summaries.delete(oldest);
    }
    this.version++;
    return id;
  }

  getCause(id: number): EffectCause | undefined { return this.causes.get(id); }

  /** Enregistre un effet d'une cause existante ; renvoie l'effet (ou null si la cause est inconnue / oubliée). */
  record(cause: number, target: string, magnitude: number, unit: string, at: number, place: EffectPlace = {}, note?: string): EffectRecord | null {
    const sum = this.summaries.get(cause);
    if (!sum) return null;
    if (!target) throw new Error('effet : cible vide');
    if (!Number.isFinite(magnitude)) throw new Error(`effet : ampleur ${magnitude} invalide`);
    const e: EffectRecord = { id: this.nextEffect++, cause, target, magnitude, unit, at, ...place };
    if (note !== undefined) e.note = note;
    this.effects.push(e);
    if (this.effects.length > this.maxEffects) this.effects.splice(0, this.effects.length - this.maxEffects);
    this.recent.push(e);
    if (this.recent.length > 256) this.recent.splice(0, this.recent.length - 256);
    sum.count++;
    sum.byTarget[target] = (sum.byTarget[target] ?? 0) + magnitude;
    this.version++;
    return e;
  }

  /**
   * Mesure l'effet d'une action sur une grille : `before` = copie des valeurs avant (grid.copyValues()).
   * Enregistre la variation totale (somme sur les cellules) localisée au barycentre des variations absolues,
   * avec le rayon qui les englobe. Renvoie null si rien n'a changé.
   */
  measureGrid(cause: number, grid: IndicatorGrid, before: Float32Array, at: number, note?: string): EffectRecord | null {
    if (before.length !== grid.data.length) throw new Error('effet : instantané de taille différente');
    let total = 0, wsum = 0, cx = 0, cz = 0;
    const d = grid.data;
    for (let j = 0; j < grid.rows; j++) {
      for (let i = 0; i < grid.cols; i++) {
        const k = j * grid.cols + i, dv = d[k]! - before[k]!;
        if (dv === 0) continue;
        total += dv;
        const w = Math.abs(dv);
        wsum += w; cx += w * grid.centerX(i); cz += w * grid.centerZ(j);
      }
    }
    if (wsum === 0) return null;
    cx /= wsum; cz /= wsum;
    let radius = 0;
    for (let j = 0; j < grid.rows; j++) {
      for (let i = 0; i < grid.cols; i++) {
        const k = j * grid.cols + i;
        if (d[k]! !== before[k]!) radius = Math.max(radius, Math.hypot(grid.centerX(i) - cx, grid.centerZ(j) - cz));
      }
    }
    return this.record(cause, grid.spec.id, total, `${grid.spec.unit}·cellules`, at, { x: cx, z: cz, radius: radius + grid.cellSize / 2 }, note);
  }

  /** Effets filtrés, du plus récent au plus ancien. */
  query(q: EffectQuery = {}): EffectRecord[] {
    const out: EffectRecord[] = [];
    const limit = q.limit ?? 100;
    for (let k = this.effects.length - 1; k >= 0 && out.length < limit; k--) {
      const e = this.effects[k]!;
      if (q.cause !== undefined && e.cause !== q.cause) continue;
      if (q.target !== undefined && e.target !== q.target) continue;
      if (q.since !== undefined && e.at < q.since) continue;
      if (q.district !== undefined && e.district !== q.district) continue;
      if (q.x !== undefined && q.z !== undefined) {
        if (e.x === undefined || e.z === undefined) continue;
        if (Math.hypot(e.x - q.x, e.z - q.z) > (q.radius ?? 0) + (e.radius ?? 0)) continue;
      }
      out.push({ ...e });
    }
    return out;
  }

  /** Synthèse d'une cause. */
  summary(cause: number): EffectSummary | undefined {
    const s = this.summaries.get(cause);
    return s ? { cause: { ...s.cause }, count: s.count, byTarget: { ...s.byTarget } } : undefined;
  }

  /** Causes classées par ampleur cumulée absolue décroissante (tableau de bord « qu'est-ce qui a compté »). */
  topCauses(limit = 10): EffectSummary[] {
    const all = [...this.summaries.values()].filter((s) => s.count > 0);
    const weight = (s: EffectSummary): number => Object.values(s.byTarget).reduce((a, v) => a + Math.abs(v), 0);
    all.sort((a, b) => weight(b) - weight(a) || a.cause.id - b.cause.id);
    return all.slice(0, limit).map((s) => ({ cause: { ...s.cause }, count: s.count, byTarget: { ...s.byTarget } }));
  }

  /** Effets enregistrés depuis le dernier appel (vide le tampon). */
  drainRecent(): EffectRecord[] {
    const r = this.recent;
    this.recent = [];
    return r;
  }

  toJSON(): { nextCause: number; nextEffect: number; causes: EffectCause[]; summaries: { cause: number; count: number; byTarget: Record<string, number> }[]; effects: EffectRecord[] } {
    return {
      nextCause: this.nextCause, nextEffect: this.nextEffect,
      causes: [...this.causes.values()].map((c) => ({ ...c })),
      summaries: [...this.summaries.values()].map((s) => ({ cause: s.cause.id, count: s.count, byTarget: { ...s.byTarget } })),
      effects: this.effects.map((e) => ({ ...e })),
    };
  }

  static fromJSON(j: ReturnType<EffectRegistry['toJSON']>, maxEffects?: number, maxCauses?: number): EffectRegistry {
    const r = new EffectRegistry(maxEffects, maxCauses);
    for (const c of j.causes) { r.causes.set(c.id, { ...c }); r.summaries.set(c.id, { cause: r.causes.get(c.id)!, count: 0, byTarget: {} }); }
    for (const s of j.summaries) {
      const t = r.summaries.get(s.cause);
      if (t) { t.count = s.count; t.byTarget = { ...s.byTarget }; }
    }
    r.effects = j.effects.map((e) => ({ ...e }));
    r.nextCause = Math.max(j.nextCause, ...[...r.causes.keys()].map((k) => k + 1), 1);
    r.nextEffect = Math.max(j.nextEffect, ...r.effects.map((e) => e.id + 1), 1);
    return r;
  }
}
