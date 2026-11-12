/**
 * Outils de construction (routes, bâtiments, démolition, terraformation).
 * Fondation : seul l'outil « sélection » est actif. Les autres outils sont
 * affichés désactivés dans l'interface avec leur phase. À réaliser par l'agent
 * construction/caméra/UI en phase 1 (routes, bâtiments, démolition) et 2 (terraformation).
 * Les outils n'appliquent jamais rien eux-mêmes : ils envoient des commandes au worker
 * (SimBridge.send) qui valide (coût, collisions, pente).
 * Implémente IToolController.
 */
import type { IToolController, RoadTypeId, ToolId } from '../shared/contracts';

export const TOOL_PHASE: Record<ToolId, number | null> = {
  select: null,
  road: 1,
  building: 1,
  bulldoze: 1,
  terraform: 2,
};

export class ToolController implements IToolController {
  activeTool: ToolId = 'select';
  options: { roadType?: RoadTypeId; assetId?: string } = {};

  /** Renvoie false si l'outil n'est pas encore disponible. */
  isAvailable(tool: ToolId): boolean { return TOOL_PHASE[tool] === null; }

  setTool(tool: ToolId, options?: { roadType?: RoadTypeId; assetId?: string }): void {
    if (!this.isAvailable(tool)) return;
    this.activeTool = tool;
    this.options = options ?? {};
  }

  dispose(): void { this.activeTool = 'select'; }
}
