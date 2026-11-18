/**
 * Aller directement là où un problème se règle : ouvre le tiroir de construction (et son onglet) ou le tableau de
 * bord concerné. Utilisé par la fenêtre « Problèmes à régler » (src/ui/problems.ts) et par les conseils de la fiche
 * d'un bâtiment (« Pourquoi… », src/ui/panels.ts).
 */

export interface GoTarget {
  /** Sélecteur du bouton qui ouvre l'outil ou le tableau de bord. */
  open: string;
  /** Onglet du tiroir de construction à choisir ensuite (ex. « securite »). */
  tab?: string;
  /** Libellé court du bouton (« Ouvrir Énergie »). */
  label: string;
}

/** Boutons de la barre d'outils qui ouvrent le tiroir de chaque famille. */
export const BUILD = {
  energy: '#toolbar [data-cat="energy"]', water: '#toolbar [data-cat="water"]', waste: '#toolbar [data-cat="waste"]',
  services: '#toolbar [data-cat="services"]', zones: '#toolbar [data-cat="zones"]', transport: '#toolbar [data-cat="transport"]',
  environment: '#toolbar [data-cat="environment"]', road: '#toolbar [data-tool="road"]',
} as const;
const DASH = (k: string): string => `#sidebar [data-dash="${k}"]`;

/** Conseil de la fiche « Pourquoi » (clé de la raison, src/ui/why.ts) → outil qui le règle ; null si aucun. */
export function whyTarget(key: string): GoTarget | null {
  switch (key) {
    case 'emploi': case 'demandeFaible': case 'personne': case 'diplome': return { open: BUILD.zones, label: 'Zones' };
    case 'logement': case 'sansAcces': case 'route': return { open: BUILD.road, label: 'Routes' };
    case 'electricite': case 'sansElectricite': case 'courant': return { open: BUILD.energy, label: 'Énergie' };
    case 'eau': case 'sansEau': return { open: BUILD.water, label: 'Eau' };
    case 'dechets': return { open: BUILD.waste, label: 'Déchets' };
    case 'sante': return { open: BUILD.services, tab: 'sante', label: 'Santé' };
    case 'police': case 'pompiers': case 'endommage': return { open: BUILD.services, tab: 'securite', label: 'Sécurité' };
    case 'education': case 'qualification': return { open: BUILD.services, tab: 'education', label: 'Éducation' };
    case 'loisirs': return { open: BUILD.services, tab: 'loisirs', label: 'Loisirs' };
    case 'trajet': case 'loin': case 'main-doeuvre': return { open: BUILD.transport, label: 'Transports' };
    case 'impots': case 'charges': return { open: DASH('finance'), label: 'Finances' };
    case 'loyer': case 'loyerEleve': case 'politiques': case 'pollution': return { open: DASH('policy'), label: 'Politiques' };
    default: return null;
  }
}

/** Ouvre la cible (sans refermer un tiroir déjà ouvert sur la bonne famille), puis l'onglet demandé. */
export function goTo(t: { open: string; tab?: string }): void {
  const b = document.querySelector<HTMLElement>(t.open);
  // Les boutons sont des bascules ; un bouton de la barre d'outils peut être « actif » sans tiroir ouvert (outil de
  // pose en cours) : on lit l'état du tiroir lui-même.
  const cat = b?.dataset['cat'];
  const drawer = document.getElementById('build-drawer');
  const isOpen = cat
    ? !!drawer && !drawer.classList.contains('hidden') && drawer.dataset['drawer'] === cat
    : b?.dataset['tool'] === 'road' ? !!drawer && !drawer.classList.contains('hidden') && drawer.dataset['drawer'] === 'road' : !!b?.classList.contains('active');
  if (b && !isOpen) b.click();
  if (t.tab) requestAnimationFrame(() => document.querySelector<HTMLElement>(`#drawer-tabs [data-tab="${t.tab}"]:not(.active)`)?.click());
}
