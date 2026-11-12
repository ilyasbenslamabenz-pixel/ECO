/**
 * Répartiteur de commandes : message validé -> appel de Simulation -> réponse.
 * Séparé du worker pour être testé en Node. TypeScript pur.
 * Gère les commandes du protocole de base (shared/protocol.ts) et les commandes étendues
 * économie/démographie (sim-protocol.ts, mêmes enveloppes).
 */
import { PROTOCOL_VERSION } from '../shared/constants';
import type { CommandError } from '../shared/contracts';
import { validateCommandMessage, type MainToWorker, type WorkerToMain } from '../shared/protocol';
import { isExtCommandName, validateExtCommand, type ExtCommandMessage } from './sim-protocol';
import type { Simulation } from './world';

export interface HandlerOutput {
  /** Réponse à la commande (toujours présente). */
  result: WorkerToMain;
  /** Instantané complet à envoyer ensuite (newGame / load). */
  snapshot: boolean;
}

export function handleCommand(sim: Simulation, raw: unknown): HandlerOutput {
  const reqId = typeof raw === 'object' && raw !== null && typeof (raw as { reqId?: unknown }).reqId === 'number'
    ? (raw as { reqId: number }).reqId : -1;
  const failure = (error: CommandError): HandlerOutput => ({ result: { kind: 'result', reqId, ok: false, error }, snapshot: false });
  const success = (data: unknown, snapshot = false): HandlerOutput => ({ result: { kind: 'result', reqId, ok: true, data }, snapshot });

  // Commandes étendues (économie, démographie, LOD de simulation).
  if (typeof raw === 'object' && raw !== null && isExtCommandName((raw as { name?: unknown }).name)) {
    const e = validateExtCommand(raw);
    if (e) return failure(e);
    const m = raw as ExtCommandMessage;
    const r = sim.runExt(m.name, m.args as never);
    // Une ville construite d'un coup : instantané complet plutôt qu'un delta géant.
    return r.ok ? success(r.data, m.name === 'buildCity') : failure(r.error);
  }

  const err = validateCommandMessage(raw);
  if (err) return failure(err);
  const msg = raw as MainToWorker;
  switch (msg.name) {
    case 'init':
      sim.setCatalog(msg.args.catalog);
      return success({ protocolVersion: PROTOCOL_VERSION });
    case 'newGame':
      if (!sim.catalog) return failure({ code: 'NO_GAME', message: 'Catalogue non initialisé (init requis)' });
      sim.newGame(msg.args);
      return success({ seed: msg.args.seed }, true);
    case 'buildRoad': { const r = sim.buildRoad(msg.args); return r.ok ? success(r.data) : failure(r.error); }
    case 'removeRoad': { const r = sim.removeRoad(msg.args); return r.ok ? success(r.data) : failure(r.error); }
    case 'placeBuilding': { const r = sim.placeBuilding(msg.args); return r.ok ? success(r.data) : failure(r.error); }
    case 'demolish': { const r = sim.demolish(msg.args); return r.ok ? success(r.data) : failure(r.error); }
    case 'setSpeed':
      sim.speed = msg.args.speed;
      return success({ speed: sim.speed });
    case 'terraform':
      return failure({ code: 'NOT_IMPLEMENTED', message: 'Terraformation : prévue en phase 2', phase: 2 });
    case 'save':
      if (!sim.terrain) return failure({ code: 'NO_GAME', message: 'Aucune partie en cours' });
      return success({ slot: msg.args.slot, data: sim.toSave() });
    case 'load': {
      const e = sim.fromSave(msg.args.data);
      return e ? failure(e) : success({ buildings: sim.buildings.count }, true);
    }
  }
}
