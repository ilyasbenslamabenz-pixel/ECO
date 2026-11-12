/**
 * Profil en long d'un tronçon : la route épouse le terrain avec lissage, respecte la pente
 * maximale de son type, passe en PONT au-dessus de l'eau et des creux marqués.
 * TypeScript pur (aucun import de three / DOM). Utilisé par la simulation (validation, nivellement)
 * et par le rendu (hauteurs de la chaussée) : même calcul des deux côtés.
 */
import { ArcTable, evalCubic, type Cubic } from './bezier';

export type HeightFn = (x: number, z: number) => number;

export interface ProfileEnv {
  heightAt: HeightFn;
  waterLevel: number;
  /**
   * Surface d'eau locale (rivières, lacs d'altitude) ou -Infinity si sec. Facultatif : sans elle, seule la mer
   * (`waterLevel`) compte comme eau. Ajouté par l'intégration pour les ponts au-dessus des rivières.
   */
  waterAt?: HeightFn;
}

/** Niveau d'eau local en (x, z) : max(mer, surface locale). */
export function localWaterLevel(env: ProfileEnv, x: number, z: number): number {
  if (!env.waterAt) return env.waterLevel;
  const w = env.waterAt(x, z);
  return w > env.waterLevel ? w : env.waterLevel;
}

/** Tirant d'air minimal d'un pont au-dessus de l'eau (m). */
export const BRIDGE_CLEARANCE = 5.5;
/** Hauteur au-dessus du terrain à partir de laquelle la route devient un pont (sinon remblai). */
export const BRIDGE_MIN_HEIGHT = 3.2;
/** Pas d'échantillonnage du profil (m). */
export const PROFILE_STEP = 4;
/** Longueur de pont maximale (m). */
export const MAX_BRIDGE_LENGTH = 600;
/** Espacement cible des piles de pont (m). */
export const PIER_SPACING = 32;

export interface RoadProfile {
  /** Longueur du tronçon (m). */
  length: number;
  /** Nombre d'échantillons (>= 2), régulièrement espacés en abscisse curviligne. */
  count: number;
  step: number;
  /** Hauteur de la chaussée à chaque échantillon. */
  heights: Float32Array;
  /** Hauteur du terrain naturel à chaque échantillon. */
  ground: Float32Array;
  /** 1 si l'échantillon est sur un pont. */
  bridge: Uint8Array;
  /** Pente maximale atteinte (valeur absolue). */
  maxGrade: number;
  /** Longueur totale en pont (m). */
  bridgeLength: number;
  /** Longueur de la plus longue travée continue en pont (m). */
  longestBridge: number;
  /** Abscisses (m) des piles de pont. */
  piers: number[];
  /** Vrai si un échantillon hors pont est sous l'eau (ne devrait pas arriver). */
  wet: boolean;
}

/**
 * Calcule le profil d'un tronçon de courbe `curve`, extrémités fixées aux hauteurs hA et hB.
 * `maxGrade` : pente maximale du type de route.
 */
export function computeProfile(curve: Cubic, arc: ArcTable, hA: number, hB: number, maxGrade: number, env: ProfileEnv): RoadProfile {
  const length = arc.length;
  const count = Math.max(2, Math.ceil(length / PROFILE_STEP) + 1);
  const step = length / (count - 1);
  const ground = new Float32Array(count);
  const wl = new Float64Array(count);
  const p = new Float64Array(2);
  for (let i = 0; i < count; i++) {
    evalCubic(curve, arc.tAt(i * step), p);
    ground[i] = env.heightAt(p[0]!, p[1]!);
    wl[i] = localWaterLevel(env, p[0]!, p[1]!);
  }
  // 1) Lissage du terrain (moyenne glissante pondérée sur ~±16 m) : la route n'épouse pas chaque bosse.
  const radius = Math.max(1, Math.round(16 / step));
  const smooth = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0, w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(count - 1, Math.max(0, i + k));
      const wk = radius + 1 - Math.abs(k);
      s += ground[j]! * wk; w += wk;
    }
    smooth[i] = s / w;
  }
  // 2) Bornes basses : au-dessus de l'eau, tirant d'air du pont ; propagées en rampes de pente maxGrade.
  const g = maxGrade * step * 0.98;
  const lower = new Float64Array(count).fill(-Infinity);
  for (let i = 0; i < count; i++) if (ground[i]! < wl[i]! + 0.4) lower[i] = wl[i]! + BRIDGE_CLEARANCE;
  for (let i = 1; i < count; i++) lower[i] = Math.max(lower[i]!, lower[i - 1]! - g);
  for (let i = count - 2; i >= 0; i--) lower[i] = Math.max(lower[i]!, lower[i + 1]! - g);
  // Hors eau, la chaussée ne descend pas sous l'eau.
  const h = new Float64Array(count);
  for (let i = 0; i < count; i++) h[i] = Math.max(smooth[i]!, lower[i]!, env.waterLevel + 0.6);
  // 3) Extrémités fixées puis raccord progressif sur ~24 m.
  h[0] = hA; h[count - 1] = hB;
  const blend = Math.max(1, Math.round(24 / step));
  for (let i = 1; i < count - 1; i++) {
    const wa = Math.max(0, 1 - i / blend), wb = Math.max(0, 1 - (count - 1 - i) / blend);
    if (wa > 0) h[i] = h[i]! * (1 - wa) + hA * wa;
    if (wb > 0) h[i] = h[i]! * (1 - wb) + hB * wb;
    if (lower[i]! > -Infinity) h[i] = Math.max(h[i]!, lower[i]!);
  }
  // 4) Limitation de pente : passes avant/arrière (les extrémités restent fixes).
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < count - 1; i++) h[i] = Math.min(h[i - 1]! + g, Math.max(h[i - 1]! - g, h[i]!));
    for (let i = count - 2; i > 0; i--) h[i] = Math.min(h[i + 1]! + g, Math.max(h[i + 1]! - g, h[i]!));
  }
  // 5) Lissage final léger (courbe de raccordement), sans descendre sous les bornes basses atteignables
  //    (si la rampe manque de longueur, la borne n'est pas forcée : le planificateur refusera le tracé).
  for (let i = 0; i < count; i++) lower[i] = Math.min(lower[i]!, h[i]!);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < count - 1; i++) {
      const v = (h[i - 1]! + 2 * h[i]! + h[i + 1]!) / 4;
      h[i] = Math.max(v, lower[i]!);
    }
  }
  const heights = new Float32Array(count);
  const bridge = new Uint8Array(count);
  let maxG = 0, wet = false;
  for (let i = 0; i < count; i++) {
    heights[i] = h[i]!;
    if (i > 0) maxG = Math.max(maxG, Math.abs(h[i]! - h[i - 1]!) / step);
    const gi = ground[i]!;
    if (gi < wl[i]! + 0.4 || h[i]! - gi > BRIDGE_MIN_HEIGHT) bridge[i] = 1;
  }
  // Pont : on comble les trous d'un échantillon et on supprime les ponts d'un seul échantillon (remblai).
  for (let i = 1; i < count - 1; i++) if (!bridge[i] && bridge[i - 1] && bridge[i + 1]) bridge[i] = 1;
  for (let i = 0; i < count; i++) {
    if (bridge[i] && !(bridge[i - 1] ?? 0) && !(bridge[i + 1] ?? 0) && ground[i]! >= wl[i]! + 0.4) bridge[i] = 0;
    if (!bridge[i] && ground[i]! < wl[i]! + 0.4) wet = true;
  }
  const { bridgeLength, longest, piers } = spans(bridge, step, length);
  return { length, count, step, heights, ground, bridge, maxGrade: maxG, bridgeLength, longestBridge: longest, piers, wet };
}

/** Hauteur interpolée du profil à l'abscisse s. */
export function profileHeightAt(p: RoadProfile, s: number): number {
  const f = Math.min(p.count - 1, Math.max(0, s / p.step));
  const i = Math.min(p.count - 2, Math.floor(f));
  const t = f - i;
  return p.heights[i]! * (1 - t) + p.heights[i + 1]! * t;
}

/** Vrai si l'abscisse s est sur un pont. */
export function profileIsBridge(p: RoadProfile, s: number): boolean {
  const i = Math.min(p.count - 1, Math.max(0, Math.round(s / p.step)));
  return p.bridge[i] === 1;
}

/** Hauteur du terrain naturel interpolée à l'abscisse s. */
export function profileGroundAt(p: RoadProfile, s: number): number {
  const f = Math.min(p.count - 1, Math.max(0, s / p.step));
  const i = Math.min(p.count - 2, Math.floor(f));
  const t = f - i;
  return p.ground[i]! * (1 - t) + p.ground[i + 1]! * t;
}

/** Travées de pont et piles d'après les drapeaux par échantillon. */
function spans(bridge: Uint8Array, step: number, length: number): { bridgeLength: number; longest: number; piers: number[] } {
  const count = bridge.length;
  let bridgeLength = 0, longest = 0;
  const piers: number[] = [];
  let runStart = -1;
  for (let i = 0; i <= count; i++) {
    const on = i < count && bridge[i] === 1;
    if (on) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const s0 = Math.max(0, (runStart - 0.5) * step), s1 = Math.min(length, (i - 0.5) * step);
      const len = s1 - s0;
      bridgeLength += len;
      longest = Math.max(longest, len);
      const n = Math.max(1, Math.round(len / PIER_SPACING));
      for (let k = 1; k < n; k++) piers.push(s0 + (len * k) / n);
      runStart = -1;
    }
  }
  return { bridgeLength, longest, piers };
}

/** Plages de pont [début, fin[ (index d'échantillons) d'un profil : forme compacte pour les messages. */
export function bridgeRuns(p: RoadProfile): number[] {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i <= p.count; i++) {
    const on = i < p.count && p.bridge[i] === 1;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push(start, i); start = -1; }
  }
  return out;
}

/**
 * Reconstruit un profil à partir des hauteurs calculées ailleurs (la simulation) : le rendu affiche
 * exactement la chaussée validée, même si le terrain qu'il connaît a été nivelé depuis.
 */
export function profileFromHeights(curve: Cubic, arc: ArcTable, heights: readonly number[], runs: readonly number[], env: ProfileEnv): RoadProfile {
  const length = arc.length;
  const count = Math.max(2, heights.length);
  const step = length / (count - 1);
  const h = new Float32Array(count);
  const ground = new Float32Array(count);
  const bridge = new Uint8Array(count);
  const p = new Float64Array(2);
  for (let i = 0; i < count; i++) {
    h[i] = heights[Math.min(i, heights.length - 1)]!;
    evalCubic(curve, arc.tAt(i * step), p);
    ground[i] = env.heightAt(p[0]!, p[1]!);
  }
  for (let k = 0; k + 1 < runs.length; k += 2) for (let i = Math.max(0, runs[k]!); i < Math.min(count, runs[k + 1]!); i++) bridge[i] = 1;
  let maxG = 0;
  for (let i = 1; i < count; i++) maxG = Math.max(maxG, Math.abs(h[i]! - h[i - 1]!) / step);
  const { bridgeLength, longest, piers } = spans(bridge, step, length);
  return { length, count, step, heights: h, ground, bridge, maxGrade: maxG, bridgeLength, longestBridge: longest, piers, wet: false };
}
