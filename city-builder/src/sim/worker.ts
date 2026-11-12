/**
 * Point d'entrée du Web Worker de simulation (bundle dist/sim.worker.js).
 * Boucle à pas fixe découplée du rendu (loop.ts) ; un delta par pas exécuté, buffers
 * véhicules en Transferable ; rapport économie/démographie joint au delta ≈ 1 fois/s
 * (clé `report`, cf. sim-protocol.ts). Aucun import de three ni du DOM.
 */
import { PROTOCOL_VERSION, SIM_TICKS_PER_SECOND } from '../shared/constants';
import { collectTransferables, type WorkerToMain } from '../shared/protocol';
import { handleCommand } from './handler';
import { FixedStepLoop, STEP_MS } from './loop';
import type { DeltaMessageExt } from './sim-protocol';
import { Simulation } from './world';

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
const scope = self as unknown as WorkerScope;
const sim = new Simulation();
const loop = new FixedStepLoop(sim, () => performance.now());
let deltasSinceReport = SIM_TICKS_PER_SECOND;

function post(msg: WorkerToMain): void {
  scope.postMessage(msg, collectTransferables(msg));
}

scope.onmessage = (ev) => {
  let out;
  try {
    out = handleCommand(sim, ev.data);
  } catch (e) {
    post({ kind: 'log', level: 'error', message: `Erreur simulation : ${e instanceof Error ? e.message : String(e)}` });
    const reqId = (ev.data as { reqId?: number })?.reqId ?? -1;
    post({ kind: 'result', reqId, ok: false, error: { code: 'INVALID_ARGS', message: 'Erreur interne de simulation' } });
    return;
  }
  post(out.result);
  if (out.snapshot) { post(sim.snapshot()); deltasSinceReport = SIM_TICKS_PER_SECOND; }
};

setInterval(() => {
  if (!sim.terrain) return;
  let steps = 0;
  try {
    steps = loop.pump();
  } catch (e) {
    post({ kind: 'log', level: 'error', message: `Erreur de tick : ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (steps === 0) return;
  const d: DeltaMessageExt = sim.takeDelta();
  if (++deltasSinceReport >= SIM_TICKS_PER_SECOND && sim.demography) {
    deltasSinceReport = 0;
    try { d.report = sim.report(false); } catch (e) {
      post({ kind: 'log', level: 'warn', message: `Rapport indisponible : ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  post(d);
}, STEP_MS / 2);

post({ kind: 'ready', protocolVersion: PROTOCOL_VERSION });
