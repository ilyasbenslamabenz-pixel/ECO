/**
 * Voies de tram (module « bus », mode tramway, docs/TRANSPORTS_COMMUN.md §9) : ensemble des tronçons de route équipés
 * de rails, en voie partagée avec les voitures ou en site propre.
 *
 * Les identifiants de tronçons changent quand le réseau est modifié (découpe par un nouveau carrefour, changement de
 * type de route) : chaque voie garde donc des échantillons de son axe et, à chaque version du réseau, les tronçons
 * actuels qui suivent un axe équipé (trois points intérieurs à moins de 2,5 m) héritent des rails. Même principe au
 * chargement d'une sauvegarde (échantillons enregistrés, relocalisés sur le réseau reconstruit).
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { evalCubic } from '../roads/bezier';
import { profileHeightAt } from '../roads/profile';
import { ROAD_KINDS, type RoadKindDef } from '../roads/types';
import type { PluginRoads } from '../plugins/types';
import type { TramTrackGeometry, TramTrackRecord } from '../../shared/protocol-ext/bus';
import { rightOffset } from './route';

/** Échantillons gardés par voie, tolérance de relocalisation (m), pas de la géométrie de rendu (m). */
const SAMPLES = 12;
const MATCH_M = 2.5;
const GEOM_STEP_M = 8;

/** Rails admis : routes ouvertes aux véhicules et aux piétons (ni rue piétonne, ni autoroute). */
export function trackAllowed(k: RoadKindDef): boolean { return k.vehicles && k.pedestrians; }

interface Track { dedicated: boolean; pts: number[]; minX: number; minZ: number; maxX: number; maxZ: number }

function withBox(pts: number[], dedicated: boolean): Track {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!, z = pts[i + 1]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { dedicated, pts, minX, minZ, maxX, maxZ };
}

/** Distance d'un point à une polyligne x, z. */
function distToPolyline(pts: readonly number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i]!, az = pts[i + 1]!, bx = pts[i + 2]!, bz = pts[i + 3]!;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

export class TramTracks {
  private map = new Map<number, Track>();
  /** Voies à relocaliser (chargement) ; null quand rien n'est en attente. */
  private pending: Track[] | null = null;
  private version = -1;
  /** Change à chaque modification de l'ensemble (pose, retrait, relocalisation) : clé du graphe du tram, deltas. */
  rev = 0;
  private readonly p = new Float64Array(2);

  get size(): number { return this.map.size + (this.pending?.length ?? 0); }
  has(segId: number): boolean { return this.map.has(segId); }
  dedicated(segId: number): boolean { return this.map.get(segId)?.dedicated ?? false; }
  ids(): number[] { return [...this.map.keys()]; }

  reset(): void { this.map.clear(); this.pending = null; this.version = -1; this.rev++; }

  /** Échantillons de l'axe d'un tronçon (x, z). */
  private sample(roads: PluginRoads, segId: number): number[] {
    const c = roads.curve(segId), out: number[] = [];
    for (let i = 0; i < SAMPLES; i++) { evalCubic(c, i / (SAMPLES - 1), this.p); out.push(Math.round(this.p[0]! * 100) / 100, Math.round(this.p[1]! * 100) / 100); }
    return out;
  }

  /** Recale les voies sur le réseau courant ; vrai si l'ensemble a changé. */
  sync(roads: PluginRoads): boolean {
    if (roads.version === this.version && !this.pending) return false;
    this.version = roads.version;
    const old: Track[] = this.pending ?? [];
    this.pending = null;
    const next = new Map<number, Track>();
    // Tronçons inchangés : même identifiant, même tracé.
    for (const [id, t] of this.map) {
      if (roads.hasSegment(id) && trackAllowed(ROAD_KINDS[roads.kindOf(id)]) && this.sameAxis(roads, id, t)) next.set(id, t);
      else old.push(t);
    }
    if (old.length) {
      for (const id of roads.segmentIds()) {
        if (next.has(id) || !trackAllowed(ROAD_KINDS[roads.kindOf(id)])) continue;
        const c = roads.curve(id);
        let hit: Track | null = null;
        for (const t of old) {
          let ok = true;
          for (const u of [0.25, 0.5, 0.75]) {
            evalCubic(c, u, this.p);
            const x = this.p[0]!, z = this.p[1]!;
            if (x < t.minX - MATCH_M || x > t.maxX + MATCH_M || z < t.minZ - MATCH_M || z > t.maxZ + MATCH_M || distToPolyline(t.pts, x, z) > MATCH_M) { ok = false; break; }
          }
          if (ok) { hit = t; break; }
        }
        if (hit) next.set(id, withBox(this.sample(roads, id), hit.dedicated));
      }
    }
    const changed = next.size !== this.map.size || [...next.keys()].some((id) => !this.map.has(id) || this.map.get(id)!.dedicated !== next.get(id)!.dedicated);
    this.map = next;
    if (changed || old.length) this.rev++;
    return changed || old.length > 0;
  }

  private sameAxis(roads: PluginRoads, id: number, t: Track): boolean {
    const c = roads.curve(id);
    for (const u of [0, 0.5, 1]) {
      evalCubic(c, u, this.p);
      if (distToPolyline(t.pts, this.p[0]!, this.p[1]!) > 0.5) return false;
    }
    return true;
  }

  /** Pose (ou change le régime de) la voie d'un tronçon existant. */
  set(roads: PluginRoads, segId: number, on: boolean, dedicated: boolean): void {
    if (!on) { if (this.map.delete(segId)) this.rev++; return; }
    const cur = this.map.get(segId);
    if (cur && cur.dedicated === dedicated) return;
    this.map.set(segId, cur ? { ...cur, dedicated } : withBox(this.sample(roads, segId), dedicated));
    this.rev++;
  }

  /** Longueur équipée (m) et part en site propre. */
  lengths(roads: PluginRoads): { total: number; dedicated: number } {
    let total = 0, dedicated = 0;
    for (const [id, t] of this.map) {
      if (!roads.hasSegment(id)) continue;
      const l = roads.length(id);
      total += l; if (t.dedicated) dedicated += l;
    }
    return { total, dedicated };
  }

  /** Axes des tronçons équipés pour le rendu (hauteur de la chaussée, ponts et tunnels compris). */
  geometry(roads: PluginRoads): TramTrackGeometry[] {
    const out: TramTrackGeometry[] = [];
    for (const [id, t] of this.map) {
      if (!roads.hasSegment(id)) continue;
      const c = roads.curve(id), prof = roads.profile(id), len = roads.length(id);
      const k = ROAD_KINDS[roads.kindOf(id)];
      const n = Math.max(1, Math.ceil(len / GEOM_STEP_M));
      const points: number[] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        evalCubic(c, u, this.p);
        const y = profileHeightAt(prof, u * prof.length) + 0.3;
        points.push(Math.round(this.p[0]! * 100) / 100, Math.round(y * 100) / 100, Math.round(this.p[1]! * 100) / 100);
      }
      out.push({ segId: id, points, offset: rightOffset(k, true), oneway: k.lanesBackward === 0 || k.lanesForward === 0, dedicated: t.dedicated });
    }
    return out;
  }

  serialize(): TramTrackRecord[] {
    const all = [...this.map.values(), ...(this.pending ?? [])];
    return all.map((t) => ({ p: [...t.pts], d: t.dedicated ? 1 : 0 }));
  }

  /** Charge des voies sérialisées : relocalisées au prochain `sync`. */
  load(list: readonly TramTrackRecord[]): void {
    this.map.clear();
    this.pending = list.filter((r) => r.p.length >= 4).map((r) => withBox([...r.p], r.d === 1));
    if (!this.pending.length) this.pending = null;
    this.version = -1;
    this.rev++;
  }
}

/** Lecture tolérante d'une liste de voies sérialisées. */
export function readTracks(v: unknown): TramTrackRecord[] {
  if (!Array.isArray(v)) return [];
  const out: TramTrackRecord[] = [];
  for (const r of v) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as { p?: unknown; d?: unknown };
    if (!Array.isArray(o.p) || o.p.length < 4 || o.p.length % 2 !== 0 || o.p.length > 64 || !o.p.every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
    out.push({ p: o.p as number[], d: o.d === 1 ? 1 : 0 });
  }
  return out;
}
