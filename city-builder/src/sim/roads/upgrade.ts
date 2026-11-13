/**
 * Modification d'une route existante SANS la démolir (outil « Améliorer ») : changement de type
 * (rue → avenue → boulevard, sens unique…) et inversion du sens d'une rue à sens unique.
 *
 * Le tracé (nœuds, courbe) est conservé ; le tronçon est remplacé par un tronçon de même géométrie et
 * du nouveau type (nouvel identifiant : le rendu reçoit une suppression + un ajout, comme pour toute
 * modification du réseau). Validation : emprise élargie libre de bâtiments et de routes voisines, pente,
 * rayon de courbure et règles de raccordement du nouveau type. Coût : différence de prix au mètre (ponts
 * compris) ; un déclassement rembourse une part de la différence (même taux que la démolition).
 *
 * `planUpgrade` ne modifie rien (aperçu / dryRun) ; `commitUpgrade` applique un plan valide.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { ArcTable, evalCubic, minRadius, reverseCubic, type Cubic } from './bezier';
import type { RoadNetwork } from './network';
import { MAX_BRIDGE_LENGTH, computeProfile, type RoadProfile } from './profile';
import { ROAD_KINDS, halfWidth, type RoadKindDef, type RoadKindId } from './types';

export interface UpgradeRequest {
  segId: number;
  /** Nouveau type (absent = type actuel, pour une simple inversion de sens). */
  kind?: RoadKindId;
  /** Inverse le sens de circulation (rue à sens unique seulement). */
  reverse?: boolean;
}

export type UpgradeErrorCode = 'INVALID_ARGS' | 'NOT_FOUND' | 'COLLISION' | 'TOO_STEEP' | 'UNDER_WATER' | 'NOT_IMPLEMENTED' | 'OUT_OF_BOUNDS';
export interface UpgradeError { code: UpgradeErrorCode; message: string; phase?: number }

/** Bâtiment qui gêne l'emprise élargie : son nom et la distance qui manque (m). */
export interface UpgradeBlocker { name: string; missing: number }

export interface UpgradeOptions {
  /** Bâtiment le plus gênant pour une emprise de demi-largeur `half` le long de `curve` (null = aucun). */
  blockedBy?: (curve: Cubic, half: number) => UpgradeBlocker | null;
  /** Part de la différence remboursée lors d'un déclassement (défaut 25 %, comme la démolition). */
  refundRate?: number;
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface UpgradePlan {
  segId: number;
  from: RoadKindId;
  kind: RoadKindId;
  reverse: boolean;
  length: number;
  /** Montant facturé (différence de prix, inversion de sens). */
  cost: number;
  /** Montant remboursé (déclassement vers un type moins cher). */
  refund: number;
  /** Courbe du futur tronçon (inversée si `reverse`). */
  curve: Cubic;
  profile: RoadProfile;
  networkVersion: number;
}

export type UpgradeResult = { ok: true; plan: UpgradePlan } | { ok: false; error: UpgradeError };

/** Coût d'une inversion de sens (marquage, panneaux), par mètre. */
export const REVERSE_COST_PER_M = 3;

/** Échelle « montante » proposée par l'outil (cycle) : rue → avenue → boulevard → rue. */
export const UPGRADE_LADDER: readonly RoadKindId[] = ['street', 'avenue', 'boulevard'];

/** Type suivant dans l'échelle rue → avenue → boulevard (les autres types passent en rue). */
export function nextUpgradeKind(k: RoadKindId): RoadKindId {
  const i = UPGRADE_LADDER.indexOf(k);
  return i < 0 ? 'street' : UPGRADE_LADDER[(i + 1) % UPGRADE_LADDER.length]!;
}

const err = (code: UpgradeErrorCode, message: string, phase?: number): { ok: false; error: UpgradeError } =>
  ({ ok: false, error: phase === undefined ? { code, message } : { code, message, phase } });

/** Prix de construction d'un tronçon de ce type (ponts compris), identique au planificateur. */
export function roadPrice(k: RoadKindDef, length: number, bridgeLength: number): number {
  return length * k.costPerMeter + bridgeLength * k.costPerMeter * (k.bridgeCostFactor - 1);
}

const fmtM = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export function planUpgrade(net: RoadNetwork, req: UpgradeRequest, opts: UpgradeOptions = {}): UpgradeResult {
  if (!net.hasSegment(req.segId)) return err('NOT_FOUND', 'Tronçon introuvable');
  const from = net.kindOf(req.segId);
  const to = req.kind ?? from;
  const kind = ROAD_KINDS[to];
  if (!kind) return err('INVALID_ARGS', 'Type de route inconnu');
  const reverse = req.reverse === true;
  if (to === from && !reverse) return err('INVALID_ARGS', `Ce tronçon est déjà : ${kind.nameFr}`);
  if (reverse && kind.lanesBackward !== 0) return err('INVALID_ARGS', 'Seule une rue à sens unique a un sens de circulation à inverser');

  const [a, b] = net.endpoints(req.segId);
  const old = net.curve(req.segId);
  const curve = reverse ? reverseCubic(old) : old;
  const arc = new ArcTable(curve);
  const length = arc.length;
  const hw = halfWidth(to);

  // Rayon de courbure du nouveau type.
  const r = minRadius(curve);
  if (r < kind.minRadius * 0.95) return err('INVALID_ARGS', `Virage trop serré pour ce type : rayon ${Math.round(r)} m, minimum ${kind.minRadius} m`);

  // Limites de la carte (emprise élargie).
  if (opts.bounds && hw > halfWidth(from)) {
    const bd = opts.bounds;
    const p = new Float64Array(2);
    for (let i = 0; i <= 32; i++) {
      evalCubic(curve, i / 32, p);
      if (p[0]! < bd.minX + hw || p[1]! < bd.minZ + hw || p[0]! > bd.maxX - hw || p[1]! > bd.maxZ - hw) return err('OUT_OF_BOUNDS', 'Emprise élargie hors de la carte');
    }
  }

  // Règles de raccordement : une autoroute ne se raccorde à niveau qu'à une autoroute.
  for (const n of [a, b]) {
    for (const sid of net.incident(n)) {
      if (sid === req.segId) continue;
      const ok = net.kindOf(sid);
      if ((!kind.atGradeCrossing || !ROAD_KINDS[ok].atGradeCrossing) && ok !== to) {
        return err('NOT_IMPLEMENTED', `Impossible : ce tronçon est raccordé à niveau à une ${ROAD_KINDS[ok].nameFr.toLowerCase()} (échangeurs : phase 4)`, 4);
      }
    }
  }

  // Emprise élargie : routes voisines (hors voisinage des carrefours d'extrémité).
  if (hw > halfWidth(from)) {
    const pa = net.nodePos(a), pb = net.nodePos(b);
    const p = new Float64Array(2);
    const n = Math.max(2, Math.ceil(length / 3));
    const tmp: number[] = [];
    for (let i = 0; i <= n; i++) {
      evalCubic(curve, arc.tAt((i / n) * length), p);
      const px = p[0]!, pz = p[1]!;
      net.segmentsIn(px - hw, pz - hw, px + hw, pz + hw, tmp);
      for (const sid of tmp) {
        if (sid === req.segId) continue;
        const ohw = halfWidth(net.kindOf(sid));
        const clear = (hw + ohw) * 1.7 + 4;
        if (Math.hypot(pa.x - px, pa.z - pz) < clear || Math.hypot(pb.x - px, pb.z - pz) < clear) continue;
        const hit = net.segmentNear(px, pz, hw + ohw - 0.5, (id) => id !== sid);
        if (hit) return err('COLLISION', `Élargissement impossible : une route voisine est trop proche (il manque ${fmtM(hw + ohw - hit.d)} m)`);
      }
    }
  }

  // Emprise élargie : bâtiments riverains. Ils restent en place s'ils ne gênent pas.
  if (opts.blockedBy && hw > halfWidth(from)) {
    const blk = opts.blockedBy(curve, hw);
    if (blk) {
      return err('COLLISION', `Élargissement impossible : « ${blk.name} » empiète de ${fmtM(Math.max(0.1, blk.missing))} m sur la nouvelle emprise (${fmtM(hw * 2)} m). Démolissez-le ou choisissez un type plus étroit.`);
    }
  }

  // Profil en long avec les règles du nouveau type (pente, ponts).
  const ya = net.nodePos(reverse ? b : a).y, yb = net.nodePos(reverse ? a : b).y;
  const profile = computeProfile(curve, arc, ya, yb, kind.maxGrade, net.env);
  if (profile.maxGrade > kind.maxGrade * 1.05) return err('TOO_STEEP', `Pente trop forte pour ce type : ${Math.round(profile.maxGrade * 100)} % (maximum ${Math.round(kind.maxGrade * 100)} %)`);
  if (profile.longestBridge > MAX_BRIDGE_LENGTH) return err('UNDER_WATER', `Pont trop long pour ce type (${Math.round(profile.longestBridge)} m, maximum ${MAX_BRIDGE_LENGTH} m)`);
  if (profile.wet) return err('UNDER_WATER', 'Le tracé passerait sous le niveau de l\'eau avec ce type');

  // Coût : différence de prix (ponts compris), remboursement partiel en cas de déclassement.
  const oldBridge = net.profile(req.segId).bridgeLength;
  const diff = roadPrice(kind, length, profile.bridgeLength) - roadPrice(ROAD_KINDS[from], length, oldBridge);
  let cost = diff > 0 ? Math.round(diff) : 0;
  const refund = diff < 0 ? Math.round(-diff * (opts.refundRate ?? 0.25)) : 0;
  if (reverse) cost += Math.round(length * REVERSE_COST_PER_M);
  return { ok: true, plan: { segId: req.segId, from, kind: to, reverse, length, cost, refund, curve, profile, networkVersion: net.version } };
}

/** Applique un plan valide (calculé sur la même version du réseau). Renvoie l'identifiant du nouveau tronçon. */
export function commitUpgrade(net: RoadNetwork, plan: UpgradePlan): { edgeId: number } {
  if (plan.networkVersion !== net.version) throw new Error('Plan de modification périmé : le réseau a changé');
  const [a, b] = net.endpoints(plan.segId);
  // Les deux nœuds gardent leurs autres tronçons : on empêche leur suppression pendant le remplacement.
  const ia = net.nodeIndex(a), ib = net.nodeIndex(b);
  net.nodeDegree[ia]!++; net.nodeDegree[ib]!++;
  net.removeSegment(plan.segId);
  net.nodeDegree[net.nodeIndex(a)]!--; net.nodeDegree[net.nodeIndex(b)]!--;
  const edgeId = plan.reverse ? net.addSegment(b, a, plan.kind, plan.curve) : net.addSegment(a, b, plan.kind, plan.curve);
  return { edgeId };
}
