/**
 * Worker de la scène de test du trafic (bundle séparé, utilisé par src/render/vehicles/demo) :
 * exécute TrafficSystem à pas fixe (100 ms) et transfère chaque trame (Float32Array des positions,
 * identifiants, variantes, états) au thread principal, avec l'état des feux et, chaque seconde, la
 * densité par tronçon. Montre l'architecture cible : simulation en worker, rendu par instantanés.
 * TypeScript pur (aucun import de three ni du DOM).
 */
import type { AssetCatalog } from '../../shared/catalog';
import type { TrafficNetworkInput } from './network';
import { TrafficSystem, type TrafficBuilding } from './system';

interface Scope { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((ev: { data: unknown }) => void) | null }
const scope = self as unknown as Scope;

type InMsg =
  | { type: 'init'; catalog: AssetCatalog; network: TrafficNetworkInput; buildings: TrafficBuilding[]; seed: number; demandScale: number; maxVehicles: number; hour: number; speed: number; warmup: number }
  | { type: 'hour'; hour: number }
  | { type: 'speed'; speed: number };

let sys: TrafficSystem | null = null;
let hour = 8;
let speed = 1;
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

function post(): void {
  if (!sys) return;
  const frame = sys.takeFrame();
  const sig = sys.signalStates();
  const signals = new Uint8Array(sig.length);
  sig.forEach((s, i) => { signals[i] = s.state; });
  const msg: Record<string, unknown> = { type: 'frame', frame, signals, stats: { ...sys.stats } };
  const transfer: Transferable[] = [frame.positions.buffer, frame.assetIndices.buffer, frame.ids.buffer, frame.variants.buffer, frame.flags.buffer, signals.buffer] as Transferable[];
  if (tick % 10 === 0) {
    const d = sys.densityFrame();
    msg['density'] = d;
    transfer.push(d.edgeIds.buffer as Transferable, d.density.buffer as Transferable, d.speed.buffer as Transferable);
  }
  scope.postMessage(msg, transfer);
}

scope.onmessage = (ev) => {
  const m = ev.data as InMsg;
  if (m.type === 'init') {
    sys = new TrafficSystem({ seed: m.seed, demandScale: m.demandScale, maxVehicles: m.maxVehicles, spawnPerStep: 40 });
    sys.setCatalog(m.catalog);
    sys.setNetwork(m.network);
    sys.setBuildings(m.buildings);
    hour = m.hour; speed = m.speed;
    // préchauffage : la ville est déjà animée à l'ouverture
    for (let k = 0; k < m.warmup; k++) sys.step(0.1, hour);
    const g = sys.graph!;
    // positions des têtes de feux (bord droit de chaque bras régulé) — envoyées une fois
    const heads: number[] = [];
    const out = new Float32Array(4);
    for (const s of sys.signalStates()) {
      const arc = s.arc;
      const lane = g.arcFirstLane[arc]! + g.arcLaneCount[arc]! - 1;
      g.linkPoint(lane, g.linkLen[lane]!, 3.2, out, 0);
      heads.push(out[0]!, out[1]!, out[2]!, out[3]!);
    }
    scope.postMessage({ type: 'ready', heads: new Float32Array(heads), edgeCount: g.edgeCount, lanes: g.laneCount, connectors: g.linkCount - g.laneCount });
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (!sys) return;
      for (let k = 0; k < speed; k++) sys.step(0.1, hour);
      tick++;
      post();
    }, 100);
    post();
  } else if (m.type === 'hour') hour = m.hour;
  else if (m.type === 'speed') speed = Math.max(0, Math.min(8, Math.round(m.speed)));
};
