/**
 * Tiroir « Terrain » de la barre de construction (src/client/tools/terrain-tool.ts) : relief (Élever, Abaisser,
 * Niveler, Adoucir, Pente), eau (Source d'eau, Barrage, Rivière, Creuser, Quai / remblai), forêt (Défricher) ;
 * réglages dans la barre d'options : taille, force et forme du pinceau, hauteur cible, débit, hauteur du barrage.
 * Appelé par BuildBar (src/ui/buildbar.ts) ; aucune logique de jeu ici.
 */
import type { ConstructionTools } from '../client/tools/machine';
import { BRUSH_RADII, CLEAR_RADII, DAM_HEIGHTS, DIG_WIDTHS, RIVER_WIDTHS, SOURCE_FLOWS, STRENGTHS, TERRAIN_MODES, groupOf, type TerrainToolMode } from '../client/tools/terrain-tool';
import { EDIT_COSTS } from '../sim/terrain/edits';
import { terrainHeightAt } from '../shared/terrain-gen';
import type { ToolController } from '../input/tools';
import { el, fmt } from './dom';
import { iconEl } from './icons';

const MODE_ICON: Record<TerrainToolMode, string> = { clear: 'tree', quay: 'anchor', dig: 'lower', river: 'water', raise: 'raise', lower: 'lower', flatten: 'flatten', smooth: 'smooth', slope: 'terrain', source: 'pump', dam: 'dam' };
const MODE_COLOR: Record<TerrainToolMode, string> = { clear: '#5fd38a', quay: '#9fb3c8', dig: '#4aa8ff', river: '#3fc1e8', raise: '#d9b77a', lower: '#b08d5a', flatten: '#c9c2a8', smooth: '#c8b48c', slope: '#bfa070', source: '#5cc8ff', dam: '#a8b4c0' };
const earth = `${EDIT_COSTS.earthPerM3.toLocaleString('fr-FR')} CHF/m³ de terre`;
const MODE_COST: Record<TerrainToolMode, string> = {
  clear: `≈ ${fmt(EDIT_COSTS.clearPerM2 * 1000)} CHF / 1 000 m² de forêt`,
  quay: `${EDIT_COSTS.earthPerM3.toLocaleString('fr-FR')} CHF/m³ + ${fmt(EDIT_COSTS.wallPerM)} CHF/m de quai`,
  dig: `${EDIT_COSTS.earthPerM3.toLocaleString('fr-FR')} CHF/m³ + ${fmt(EDIT_COSTS.wallPerM)} CHF/m de quai`,
  river: earth,
  raise: earth,
  lower: earth,
  flatten: earth,
  smooth: earth,
  slope: earth,
  source: `${fmt(EDIT_COSTS.sourceBase)} CHF + ${fmt(EDIT_COSTS.sourcePerM3s)} CHF par m³/s`,
  dam: `${fmt(EDIT_COSTS.damPerM3)} CHF/m³ de béton`,
};
const GROUP_LABEL = { relief: 'Relief', eau: 'Eau', foret: 'Forêt' } as const;

/** Active un outil du tiroir. */
export function pickTerrainTool(machine: ConstructionTools, tools: ToolController, mode: TerrainToolMode): void {
  machine.terrain.setMode(mode);
  tools.setTool('terraform');
}

/** Contenu du tiroir : une carte par outil, réglages, puis les outils de relief prévus. */
export function renderTerrainDrawer(tabs: HTMLElement, body: HTMLElement, machine: ConstructionTools, tools: ToolController, planned: HTMLElement[], close: () => void): void {
  tabs.append(el('span', { cls: 'drawer-note' }, el('span', { text: 'Relief : élever, abaisser, niveler, adoucir, pente — Eau : sources, barrages, rivières, canaux, quais — Défricher' })));
  // Relief d'abord, puis l'eau, puis la forêt.
  const order: TerrainToolMode[] = ['raise', 'lower', 'flatten', 'smooth', 'slope', 'source', 'dam', 'river', 'dig', 'quay', 'clear'];
  for (const id of order) {
    const m = TERRAIN_MODES.find((o) => o.id === id);
    if (!m) continue;
    const active = machine.tool === 'terraform' && machine.terrain.mode === m.id;
    const b = el('button', { cls: `tile${active ? ' active' : ''}`, attrs: { style: `--ic:${MODE_COLOR[m.id]}`, 'data-terrain': m.id } },
      el('span', { cls: 'tile-ico' }, iconEl(MODE_ICON[m.id])), el('span', { cls: 'nm', text: m.nameFr }), el('span', { cls: 'ct', text: MODE_COST[m.id] }));
    b.dataset['tip'] = `${m.tip} — ${MODE_COST[m.id]}`;
    b.addEventListener('click', () => { pickTerrainTool(machine, tools, m.id); close(); });
    body.append(b);
  }
  void planned; // outils de relief désormais réels (Élever, Abaisser, Niveler)
}

/** Boutons de la barre d'options de l'outil Terrain. */
export function terrainToolActions(machine: ConstructionTools, act: (label: string, tip: string, fn: () => void, active?: boolean) => void): void {
  const t = machine.terrain;
  // Outils du groupe courant seulement (barre courte, lisible au doigt).
  const g = groupOf(t.mode);
  for (const m of TERRAIN_MODES) if (groupOf(m.id) === g) act(m.nameFr, `${GROUP_LABEL[g]} — ${m.tip}`, () => { t.setMode(m.id); machine.refresh(); }, t.mode === m.id);
  const relief = t.mode === 'raise' || t.mode === 'lower' || t.mode === 'flatten' || t.mode === 'smooth';
  if (t.mode === 'clear') for (const r of CLEAR_RADII) act(`⌀ ${r * 2} m`, `Pinceau de ${r * 2} m de diamètre`, () => t.setRadius(r), t.radius === r);
  if (relief || t.mode === 'slope') for (const r of BRUSH_RADII) act(`⌀ ${r * 2} m`, t.mode === 'slope' ? `Largeur de la pente : ${r * 2} m` : `Pinceau de ${r * 2} m de diamètre`, () => t.setRadius(r), t.radius === r);
  if (relief) {
    for (const s of STRENGTHS) act(s.nameFr, `Force ${s.nameFr.toLowerCase()} (${Math.round(s.v * 100)} %)${t.mode === 'raise' || t.mode === 'lower' ? ` : ${s.v * 4} m par passe` : ''}`, () => t.setStrength(s.v), t.strength === s.v);
  }
  if (relief || t.mode === 'slope') act(t.hard ? 'Forme dure' : 'Forme douce', t.hard ? 'Pinceau à bord net (plein effet jusqu\'à 75 % du rayon) — toucher pour un bord adouci' : 'Pinceau à bord adouci — toucher pour un bord net', () => t.setHard(!t.hard), t.hard);
  if (t.mode === 'flatten') {
    const tg = t.flattenTarget;
    act('Hauteur du départ', 'Niveler à la hauteur du premier point touché', () => t.setFlattenTarget(null), tg === null);
    const hp = t.hoverPoint, td = machine.mirror.terrain;
    const base = tg ?? t.lastFlattenH ?? (hp && td ? Math.round(terrainHeightAt(td, hp.x, hp.z)) : 0);
    act('−5 m', 'Hauteur cible − 5 m', () => t.setFlattenTarget(base - 5));
    act('−1 m', 'Hauteur cible − 1 m', () => t.setFlattenTarget(base - 1));
    act(tg === null ? 'Cible…' : `Cible ${tg.toLocaleString('fr-FR')} m`, 'Hauteur cible choisie (altitude) : réglez avec −/+ (part de la dernière hauteur nivelée)', () => t.setFlattenTarget(base), tg !== null);
    act('+1 m', 'Hauteur cible + 1 m', () => t.setFlattenTarget(base + 1));
    act('+5 m', 'Hauteur cible + 5 m', () => t.setFlattenTarget(base + 5));
  }
  if (t.mode === 'source') {
    for (const q of SOURCE_FLOWS) act(`${q} m³/s`, `Débit de la source : ${q} m³/s`, () => { t.setSourceRemove(false); t.setSourceFlow(q); }, !t.sourceRemove && t.sourceFlow === q);
    act('Retirer', 'Retirer une source : touchez-la (cercle bleu)', () => t.setSourceRemove(!t.sourceRemove), t.sourceRemove);
  }
  if (t.mode === 'dam') for (const h of DAM_HEIGHTS) act(h === 0 ? 'Hauteur max' : `${h} m`, h === 0 ? 'Crête à la hauteur de la rive la plus basse (60 m au plus)' : `Crête ${h} m au-dessus du fond de la vallée`, () => t.setDamHeight(h), t.damHeight === h);
  if (t.mode === 'river') {
    for (const w of RIVER_WIDTHS) act(`${w} m`, `Largeur de la rivière : ${w} m`, () => t.setRiverWidth(w), t.riverWidth === w);
    if (t.riverPoints >= 1) act('↶ Dernier point', 'Retirer le dernier point posé', () => { t.back(); machine.refresh(); });
  }
  if (t.mode === 'dig') for (const w of DIG_WIDTHS) act(`${w} m`, `Largeur du bassin ou du canal : ${w} m`, () => t.setWidth(w), t.width === w);
}

/** Texte d'aide de l'outil Terrain. */
export function terrainHint(machine: ConstructionTools): string {
  const t = machine.terrain;
  if (t.mode === 'clear') return `Défricher : touchez ou glissez sur une zone boisée (pinceau de ${t.radius * 2} m) — deux doigts : déplacer la carte`;
  if (t.mode === 'raise') return `Élever : appuyez et glissez, +${t.step} m par passe (pinceau de ${t.radius * 2} m) — deux doigts : déplacer la carte`;
  if (t.mode === 'lower') return `Abaisser : appuyez et glissez, −${t.step} m par passe (pinceau de ${t.radius * 2} m) ; l'eau voisine remplit le creux — deux doigts : déplacer la carte`;
  if (t.mode === 'flatten') return t.flattenTarget === null ? `Niveler : appuyez sur la hauteur voulue puis glissez pour étendre le plat (pinceau de ${t.radius * 2} m) — deux doigts : déplacer la carte` : `Niveler à ${t.flattenTarget.toLocaleString('fr-FR')} m : appuyez et glissez (pinceau de ${t.radius * 2} m)`;
  if (t.mode === 'smooth') return `Adoucir : appuyez et glissez sur les bosses et les marches (pinceau de ${t.radius * 2} m) — deux doigts : déplacer la carte`;
  if (t.mode === 'slope') return t.hasStart ? `Pente : touchez l'autre bout (largeur ${t.radius * 2} m) — clic droit : annuler` : `Pente : touchez le premier bout, puis l'autre (largeur ${t.radius * 2} m)`;
  if (t.mode === 'source') return t.sourceRemove ? 'Retirer une source : touchez une source (cercle bleu)' : `Source d'eau : touchez un creux ou un vallon (débit ${t.sourceFlow} m³/s) ; l'eau monte jusqu'au col puis s'écoule. Près du bord de la carte : source de rivière (l'eau entre par le bord et coule vers l'aval)`;
  if (t.mode === 'dam') return t.hasStart ? 'Barrage : touchez la rive d\'en face (en travers de la vallée) — clic droit : annuler' : `Barrage : touchez une rive haute, puis la rive d'en face, en travers de la rivière. ${t.flowHint()}`;
  if (t.mode === 'river') return t.riverPoints === 0 ? `Rivière : touchez la source, puis chaque point de passage (largeur ${t.riverWidth} m)` : t.riverPoints === 1 ? 'Rivière : touchez le point de passage suivant' : `Rivière : ${t.riverPoints} points — continuez, ou « Terminer » (ou touchez le dernier point)`;
  if (t.mode === 'quay') return t.hasStart ? 'Quai : cliquez la fin de la ligne (Maj : angle magnétique) — clic droit : annuler' : 'Quai / remblai : tracez une ligne droite dans l\'eau, parallèle à la rive (ou en travers d\'une rivière pour la combler)';
  return t.hasStart ? `Creuser : cliquez la fin du canal (largeur ${t.width} m) — clic droit : annuler` : `Creuser : clic départ, clic arrivée (bassin ou canal de ${t.width} m)`;
}
