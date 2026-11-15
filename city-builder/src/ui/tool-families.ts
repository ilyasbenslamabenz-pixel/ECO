/**
 * Familles d'outils du téléphone (barre d'outils sur une rangée) : « Réseaux » (énergie, eau, déchets, transports)
 * et « Paysage » (nature, terrain) ouvrent un petit choix au-dessus de la barre ; chaque choix déclenche le bouton
 * d'origine (masqué sur téléphone), donc mêmes tiroirs et mêmes outils qu'avant.
 */
import { $, el } from './dom';
import { iconEl } from './icons';

const FAMILIES: Record<string, { cat: string; label: string; icon: string; color: string }[]> = {
  reseaux: [
    { cat: 'energy', label: 'Énergie', icon: 'energy', color: '#ffc531' },
    { cat: 'water', label: 'Eau', icon: 'water', color: '#4aa8ff' },
    { cat: 'waste', label: 'Déchets', icon: 'waste', color: '#d9b77a' },
    { cat: 'transport', label: 'Transports', icon: 'transport', color: '#5ad1e8' },
  ],
  paysage: [
    { cat: 'environment', label: 'Nature', icon: 'tree', color: '#5fd38a' },
    { cat: 'terrain', label: 'Terrain', icon: 'terrain', color: '#d9b77a' },
  ],
};

export function initToolFamilies(): void {
  const pop = $('family-pop');
  let open: string | null = null;
  const close = (): void => { pop.classList.add('hidden'); open = null; };
  for (const fb of Array.from(document.querySelectorAll<HTMLButtonElement>('#toolbar [data-family]'))) {
    fb.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = fb.dataset['family']!;
      if (open === id) { close(); return; }
      open = id;
      pop.replaceChildren(...FAMILIES[id]!.map((f) => {
        const b = el('button', { attrs: { type: 'button', role: 'menuitem', 'data-family-cat': f.cat, style: `--ic:${f.color}` } }, iconEl(f.icon), el('span', { text: f.label }));
        b.addEventListener('click', () => { close(); (document.querySelector(`#toolbar button[data-cat="${f.cat}"]`) as HTMLButtonElement | null)?.click(); });
        return b;
      }));
      pop.classList.remove('hidden');
    });
  }
  document.addEventListener('pointerdown', (e) => { if (open && !pop.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-family]')) close(); });
  // Aide d'outil repliée sur une ligne : un toucher la déplie.
  $('tool-hint').addEventListener('click', () => $('tool-hint').classList.toggle('open'));
}
