/**
 * Rendu des véhicules : InstancedMesh par modèle, positions issues des deltas du worker.
 * Fondation : la simulation de trafic (phase 3) n'émet encore aucun véhicule ;
 * ce module conserve la dernière trame reçue. À compléter par l'agent véhicules/trafic
 * (instancing par asset, interpolation entre trames, LOD).
 * Implémente IVehicleRenderer.
 */
import type { IVehicleRenderer } from '../shared/contracts';

export class VehicleRenderer implements IVehicleRenderer {
  count = 0;
  private positions: Float32Array = new Float32Array(0);
  private assetIndices: Uint16Array = new Uint16Array(0);

  setVehicles(positions: Float32Array, assetIndices: Uint16Array, count: number): void {
    this.positions = positions;
    this.assetIndices = assetIndices;
    this.count = count;
  }

  update(_dt: number): void {
    void this.positions;
    void this.assetIndices;
  }

  dispose(): void { this.count = 0; }
}
