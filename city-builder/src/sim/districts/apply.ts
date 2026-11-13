/**
 * Quartiers — EXÉCUTION d'un plan par les opérations du joueur.
 *
 * `DistrictActions` reprend exactement les signatures de `Simulation.buildRoad / placeBuilding / demolish` :
 * un plan n'est jamais appliqué « en force », il passe par les validations et les coûts de la simulation.
 * Tant que le cœur n'expose pas d'API d'écriture aux modules (voir docs/requests/batiments.md), l'adaptateur
 * est fourni par l'appelant : le thread principal (commandes du protocole) ou un test.
 * Les routes sont construites d'abord (l'accès route conditionne les bâtiments), puis les lots.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { CommandError } from '../../shared/contracts';
import type { CommandArgs, CommandResult } from '../../shared/protocol';
import type { EvolutionProposal } from './evolution';
import type { DistrictPlan } from './types';

export type ActionOutcome<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export interface DistrictActions {
  buildRoad(a: CommandArgs<'buildRoad'>): ActionOutcome<CommandResult<'buildRoad'>>;
  placeBuilding(a: CommandArgs<'placeBuilding'>): ActionOutcome<CommandResult<'placeBuilding'>>;
  demolish(a: CommandArgs<'demolish'>): ActionOutcome<CommandResult<'demolish'>>;
}

export interface ApplyReport {
  roadsOk: number;
  roadsRefused: number;
  lotsOk: number;
  lotsRefused: number;
  /** Lots non tentés parce que la voie qu'ils bordent n'a pas pu être construite (eau, pente). */
  lotsSkipped: number;
  /** Identifiants des bâtiments posés (ordre des lots retenus). */
  buildingIds: number[];
  cost: number;
  /** Premiers messages de refus (diagnostic, au plus 8). */
  errors: string[];
}

const MAX_ERRORS = 8;

export function applyPlan(plan: DistrictPlan, actions: DistrictActions): ApplyReport {
  const rep: ApplyReport = { roadsOk: 0, roadsRefused: 0, lotsOk: 0, lotsRefused: 0, lotsSkipped: 0, buildingIds: [], cost: 0, errors: [] };
  const note = (m: string): void => { if (rep.errors.length < MAX_ERRORS) rep.errors.push(m); };
  const roadOk = new Array<boolean>(plan.roads.length).fill(false);
  for (let i = 0; i < plan.roads.length; i++) {
    const r = plan.roads[i]!;
    const args: CommandArgs<'buildRoad'> = {
      type: r.kind === 'boulevard' || r.kind === 'avenue' ? r.kind : 'street',
      kind: r.kind, points: [...r.points],
    };
    if (r.control) args.control = [...r.control] as [number, number];
    const out = actions.buildRoad(args);
    if (out.ok) { rep.roadsOk++; roadOk[i] = true; rep.cost += out.data.cost; } else { rep.roadsRefused++; note(`route ${r.kind} : ${out.error.message}`); }
  }
  for (const l of plan.lots) {
    // Sans la voie qu'il borde, le lot n'aurait pas d'accès route : on ne le pose pas.
    if (l.road >= 0 && l.road < roadOk.length && !roadOk[l.road]) { rep.lotsSkipped++; continue; }
    const out = actions.placeBuilding({ assetId: l.assetId, x: l.x, z: l.z, rot: l.rot, variant: l.variant, planned: true });
    if (out.ok) { rep.lotsOk++; rep.cost += out.data.cost; rep.buildingIds.push(out.data.buildingId); }
    else { rep.lotsRefused++; note(`${l.assetId} : ${out.error.message}`); }
  }
  return rep;
}

export interface ProposalOutcome {
  ok: boolean;
  /** Identifiant du bâtiment créé (0 si échec). */
  buildingId: number;
  /** Coût net (construction - remboursement de la démolition). */
  cost: number;
  message?: string;
}

/**
 * Applique une proposition d'évolution : démolition puis construction du remplaçant au même endroit.
 * Si la construction échoue (fonds, pente, collision), l'ancien bâtiment est REPOSÉ à l'identique
 * (même modèle, même variante, même position) ; l'identifiant change alors, ce que signale `buildingId`.
 */
export function applyProposal(p: EvolutionProposal, actions: DistrictActions): ProposalOutcome {
  const dem = actions.demolish({ buildingId: p.buildingId });
  if (!dem.ok) return { ok: false, buildingId: 0, cost: 0, message: dem.error.message };
  const built = actions.placeBuilding({ assetId: p.toAsset, x: p.x, z: p.z, rot: p.rot, variant: p.variant, planned: true });
  if (built.ok) return { ok: true, buildingId: built.data.buildingId, cost: built.data.cost - dem.data.refund };
  const back = actions.placeBuilding({ assetId: p.fromAsset, x: p.x, z: p.z, rot: p.rot, variant: p.fromVariant });
  return {
    ok: false,
    buildingId: back.ok ? back.data.buildingId : 0,
    cost: (back.ok ? back.data.cost : 0) - dem.data.refund,
    message: built.error.message,
  };
}
