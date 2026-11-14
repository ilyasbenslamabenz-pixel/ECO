/**
 * Tiroir « Terrain » de la barre de construction : outils réels Défricher, Quai / remblai et Creuser
 * (src/client/tools/terrain-tool.ts), réglages (rayon du pinceau, largeur du canal), et outils de relief encore
 * prévus (grisés avec leur phase). Appelé par BuildBar (src/ui/buildbar.ts) ; aucune logique de jeu ici.
 */
import type { ConstructionTools } from '../client/tools/machine';
import { CLEAR_RADII, DIG_WIDTHS, TERRAIN_MODES, type TerrainToolMode } from '../client/tools/terrain-tool';
import { EDIT_COSTS } from '../sim/terrain/edits';
import type { ToolController } from '../input/tools';
import { el, fmt } from './dom';
import { iconEl } from './icons';

const MODE_ICON: Record<TerrainToolMode, string> = { clear: 'tree', quay: 'anchor', dig: 'lower' };
const MODE_COLOR: Record<TerrainToolMode, string> = { clear: '#5fd38a', quay: '#9fb3c8', dig: '#4aa8ff' };
const MODE_COST: Record<TerrainToolMode, string> = {
  clear: `≈ ${fmt(EDIT_COSTS.clearPerM2 * 1000)} CHF / 1 000 m² de forêt`,
  quay: `${EDIT_COSTS.earthPerM3.toLocaleString('fr-FR')} CHF/m³ + ${fmt(EDIT_COSTS.wallPerM)} CHF/m de quai`,
  dig: `${EDIT_COSTS.earthPerM3.toLocaleString('fr-FR')} CHF/m³ + ${fmt(EDIT_COSTS.wallPerM)} CHF/m de quai`,
};

/** Active un outil du tiroir. */
export function pickTerrainTool(machine: ConstructionTools, tools: ToolController, mode: TerrainToolMode): void {
  machine.terrain.setMode(mode);
  tools.setTool('terraform');
}

/** Contenu du tiroir : une carte par outil, réglages, puis les outils de relief prévus. */
export function renderTerrainDrawer(tabs: HTMLElement, body: HTMLElement, machine: ConstructionTools, tools: ToolController, planned: HTMLElement[], close: () => void): void {
  tabs.append(el('span', { cls: 'drawer-note' }, el('span', { text: 'Défricher, quais droits et remblais, bassins et canaux' })));
  for (const m of TERRAIN_MODES) {
    const active = machine.tool === 'terraform' && machine.terrain.mode === m.id;
    const b = el('button', { cls: `tile${active ? ' active' : ''}`, attrs: { style: `--ic:${MODE_COLOR[m.id]}`, 'data-terrain': m.id } },
      el('span', { cls: 'tile-ico' }, iconEl(MODE_ICON[m.id])), el('span', { cls: 'nm', text: m.nameFr }), el('span', { cls: 'ct', text: MODE_COST[m.id] }));
    b.dataset['tip'] = `${m.tip} — ${MODE_COST[m.id]}`;
    b.addEventListener('click', () => { pickTerrainTool(machine, tools, m.id); close(); });
    body.append(b);
  }
  for (const p of planned) body.append(p);
}

/** Boutons de la barre d'options de l'outil Terrain. */
export function terrainToolActions(machine: ConstructionTools, act: (label: string, tip: string, fn: () => void, active?: boolean) => void): void {
  const t = machine.terrain;
  for (const m of TERRAIN_MODES) act(m.nameFr, m.tip, () => { t.setMode(m.id); machine.refresh(); }, t.mode === m.id);
  if (t.mode === 'clear') for (const r of CLEAR_RADII) act(`⌀ ${r * 2} m`, `Pinceau de ${r * 2} m de diamètre`, () => t.setRadius(r), t.radius === r);
  if (t.mode === 'dig') for (const w of DIG_WIDTHS) act(`${w} m`, `Largeur du bassin ou du canal : ${w} m`, () => t.setWidth(w), t.width === w);
}

/** Texte d'aide de l'outil Terrain. */
export function terrainHint(machine: ConstructionTools): string {
  const t = machine.terrain;
  if (t.mode === 'clear') return `Défricher : cliquez sur une zone boisée (pinceau de ${t.radius * 2} m)`;
  if (t.mode === 'quay') return t.hasStart ? 'Quai : cliquez la fin de la ligne (Maj : angle magnétique) — clic droit : annuler' : 'Quai / remblai : tracez une ligne droite dans l\'eau, parallèle à la rive (ou en travers d\'une rivière pour la combler)';
  return t.hasStart ? `Creuser : cliquez la fin du canal (largeur ${t.width} m) — clic droit : annuler` : `Creuser : clic départ, clic arrivée (bassin ou canal de ${t.width} m)`;
}
