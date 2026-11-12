/**
 * Point d'entrée du Web Worker de simulation (bundle dist/sim.worker.js).
 * Boucle à pas fixe ; envoie un delta par pas d'horloge (100 ms) avec les
 * buffers véhicules en Transferable. Aucun import de three ni du DOM.
 */
import { PROTOCOL_VERSION, SIM_TICKS_PER_SECOND } from '../shared/constants';
import { collectTransferables, type WorkerToMain } from '../shared/protocol';
import { handleCommand } from './handler';
import { Simulation } from './world';

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
const scope = self as unknown as WorkerScope;
const sim = new Simulation();

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
  if (out.snapshot) post(sim.snapshot());
};

const STEP_MS = 1000 / SIM_TICKS_PER_SECOND;
setInterval(() => {
  if (!sim.terrain) return;
  const t0 = performance.now();
  for (let i = 0; i < sim.speed; i++) sim.tick();
  if (sim.speed > 0) sim.tickMs = sim.tickMs * 0.9 + ((performance.now() - t0) / sim.speed) * 0.1;
  post(sim.takeDelta());
}, STEP_MS);

post({ kind: 'ready', protocolVersion: PROTOCOL_VERSION });
