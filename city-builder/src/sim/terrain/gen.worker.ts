/**
 * Worker de génération de terrain (autonome) : reçoit des paramètres, renvoie un WorldTerrain
 * dont les buffers sont transférés (aucune copie). Utilisé pour les aperçus de carte et la démo
 * environnement ; en partie, la génération est appelée par la simulation dans son propre worker
 * (voir docs/requests/terrain.md).
 * Protocole : { kind:'generate', reqId, params } -> { kind:'world', reqId, world } | { kind:'error', reqId, message }.
 */
import { generateWorld, worldTransferables } from './index';
import type { WorldGenParams, WorldTerrain } from './types';

export type GenRequest = { kind: 'generate'; reqId: number; params: Partial<WorldGenParams> };
export type GenResponse = { kind: 'world'; reqId: number; world: WorldTerrain } | { kind: 'error'; reqId: number; message: string };

interface WorkerScope {
  onmessage: ((e: { data: GenRequest }) => void) | null;
  postMessage(m: GenResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (e): void => {
  const m = e.data;
  if (!m || m.kind !== 'generate') return;
  try {
    const world = generateWorld(m.params ?? {});
    scope.postMessage({ kind: 'world', reqId: m.reqId, world }, worldTransferables(world));
  } catch (err) {
    scope.postMessage({ kind: 'error', reqId: m.reqId, message: err instanceof Error ? err.message : String(err) });
  }
};
