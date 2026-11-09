// Pictogrammes de la République d'Ilyas : jeu d'icônes au trait (grille 24, trait 1,5, angles nets), dessinés pour
// le jeu. Les émojis présents dans les données de la simulation (construction, énergie, besoins, événements…)
// restent dans les données mais ne s'affichent jamais : <Icon name={x.icon} /> accepte un nom OU un émoji et le
// convertit vers le pictogramme correspondant (repli : losange neutre).
import type { ReactNode } from 'react';

const P = (d: string) => <path d={d} />;

const ICONS = {
  // --- pôles et ministères ---
  finances: <>{P('M3 9h18L12 4z')}{P('M5.5 9v8M9.8 9v8M14.2 9v8M18.5 9v8')}{P('M3.5 17h17M2.5 20h19')}</>,
  fiscalite: <>{P('M6 3h9l4 4v14H6z')}{P('M15 3v4h4')}{P('M9 17l6-6')}<rect x="8.6" y="10.6" width="1.8" height="1.8" /><rect x="13.6" y="15.6" width="1.8" height="1.8" /></>,
  economie: <>{P('M4 3v17h17')}{P('M7.5 15l3.5-4 3 2.5 5-6')}{P('M15.5 7.5H19V11')}</>,
  baisse: <>{P('M4 3v17h17')}{P('M7.5 8l3.5 4 3-2.5 5 6')}{P('M15.5 15.5H19V12')}</>,
  travail: <>{P('M3 17.5h18')}{P('M5 17.5V15a7 7 0 0 1 14 0v2.5')}{P('M10 8.4V5.5h4v2.9')}{P('M12 11v3')}</>,
  industrie: <>{P('M3 20.5V10.5l5 3v-3l5 3v-3l5 3V3.5h3v17z')}{P('M7 17.5h2M11.5 17.5h2M16 17.5h2')}</>,
  population: <><circle cx="9" cy="8" r="3.2" />{P('M3 20.5c0-3.6 2.7-6.2 6-6.2s6 2.6 6 6.2')}{P('M15.5 4.9a3.1 3.1 0 0 1 0 6.1')}{P('M17.5 14.6c2.2.6 3.5 2.9 3.5 5.9')}</>,
  sante: <>{P('M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9z')}</>,
  education: <>{P('M2 9.5L12 4.5l10 5-10 5z')}{P('M6 11.5v5c0 1.6 2.7 3 6 3s6-1.4 6-3v-5')}{P('M22 9.5v6')}</>,
  logement: <>{P('M3.5 11.5L12 4l8.5 7.5')}{P('M6 9.5v11h12v-11')}{P('M10 20.5v-6h4v6')}</>,
  securite: <>{P('M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z')}{P('M8.8 12.2l2.3 2.3 4.2-4.6')}</>,
  bouclier: <>{P('M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z')}{P('M12 3v18')}</>,
  energie: <>{P('M13.5 2.5L5 14h6.5l-1 7.5L19 10h-6.5z')}</>,
  environnement: <>{P('M4.5 19.5C4.5 10.5 10.5 5 20 4c0 9.5-5.5 15.5-15.5 15.5z')}{P('M4.5 19.5l9-9')}</>,
  transports: <>{P('M6 3h12v14H6z')}{P('M6 11h12')}{P('M9 14h1.5M13.5 14H15')}{P('M8.5 21l1.8-4M15.5 21l-1.8-4')}</>,
  agriculture: <>{P('M12 21V9')}{P('M12 13c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2zM12 13c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2z')}{P('M12 17.5c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2zM12 17.5c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2z')}{P('M12 9C10.6 8 10.6 4.6 12 3c1.4 1.6 1.4 5 0 6z')}</>,
  dechets: <>{P('M4.5 6h15')}{P('M9 6V3.5h6V6')}{P('M6.5 6l1 15h9l1-15')}{P('M10 10v7M14 10v7')}</>,
  recyclage: <>{P('M19.5 13a7.5 7.5 0 0 1-13.4 4.1')}{P('M4.5 11a7.5 7.5 0 0 1 13.4-4.1')}{P('M18.5 3v4.2h-4.2')}{P('M5.5 21v-4.2h4.2')}</>,
  equipements: <>{P('M5 21V3.5')}{P('M5 3.5h15')}{P('M5 7.5l4-4')}{P('M16 3.5V9')}{P('M14 9h4v3.5h-4z')}{P('M2.5 21h8')}{P('M5 11h3M5 15h3')}</>,
  recherche: <>{P('M8.5 3h7')}{P('M10 3v6.2L4.8 20.5h14.4L14 9.2V3')}{P('M7.4 15h9.2')}</>,
  politique: <>{P('M3 20.5h18')}{P('M5 20.5v-7h14v7')}{P('M8.5 13.5v7M12 13.5v7M15.5 13.5v7')}{P('M6.5 13.5a5.5 5.5 0 0 1 11 0')}{P('M12 8V3.5h3')}</>,
  international: <><circle cx="12" cy="12" r="9" />{P('M3 12h18')}{P('M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z')}</>,
  carte: <>{P('M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z')}{P('M9 3.5V18M15 6v14.5')}</>,
  evenements: <>{P('M12 3.5l9.5 17h-19z')}{P('M12 10v5')}{P('M12 17v1.5')}</>,
  objectifs: <>{P('M5.5 21V3.5')}{P('M5.5 4.5h13l-3 4 3 4h-13')}</>,
  trophee: <>{P('M7.5 3.5h9v5.5a4.5 4.5 0 0 1-9 0z')}{P('M7.5 5.5H4c0 3 1.6 4.5 3.8 4.6M16.5 5.5H20c0 3-1.6 4.5-3.8 4.6')}{P('M12 13.5v3.5')}{P('M8 20.5h8M9.5 17h5v3.5')}</>,
  besoins: <><circle cx="12" cy="12" r="9" />{P('M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z')}{P('M12 3v2M12 19v2M3 12h2M19 12h2')}</>,
  stats: <>{P('M3.5 20.5h17')}{P('M6.5 20.5v-6M10.5 20.5V8M14.5 20.5v-9M18.5 20.5V4.5')}</>,
  alertes: <>{P('M6 16.5V11a6 6 0 0 1 12 0v5.5l2 2H4z')}{P('M10 21h4')}</>,
  aide: <><circle cx="12" cy="12" r="9" />{P('M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.9')}{P('M12 16.5v1.5')}</>,
  info: <><circle cx="12" cy="12" r="9" />{P('M12 10.5V17')}{P('M12 7v1.5')}</>,
  menu: <>{P('M4 7h16M4 12h16M4 17h16')}</>,
  reglages: <><circle cx="12" cy="12" r="3" />{P('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1')}</>,
  // --- temps ---
  pause: <>{P('M8.5 5v14M15.5 5v14')}</>,
  lecture: <>{P('M7 4.5l12 7.5-12 7.5z')}</>,
  suivant: <>{P('M5 4.5l10 7.5-10 7.5z')}{P('M18.5 4.5v15')}</>,
  // --- actions ---
  construire: <>{P('M12 4.5v15M4.5 12h15')}</>,
  demolir: <>{P('M3.5 21h8')}{P('M7 21V4.5h10.5')}{P('M7 9l4.5-4.5')}{P('M17.5 4.5V10')}<circle cx="17.5" cy="13.5" r="3.2" /></>,
  agrandir: <>{P('M12 20V6.5')}{P('M6.5 12L12 6.5l5.5 5.5')}{P('M4.5 3.5h15')}</>,
  renover: <>{P('M14.6 3.6a4.8 4.8 0 0 0-4.4 6.6L3.5 16.9l3.6 3.6 6.7-6.7a4.8 4.8 0 0 0 6.6-4.4l-3 3-3.2-.4-.4-3.2z')}</>,
  fermer: <>{P('M6 6l12 12M18 6L6 18')}</>,
  arret: <>{P('M12 3v8.5')}{P('M7 6.2a7.5 7.5 0 1 0 10 0')}</>,
  valide: <>{P('M4.5 12.5l4.8 4.8L19.5 7')}</>,
  case: <>{P('M5 5h14v14H5z')}</>,
  verrou: <>{P('M5.5 11h13v10h-13z')}{P('M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11')}{P('M12 15v2.5')}</>,
  chantier: <>{P('M3 8.5h18v5.5H3z')}{P('M8.5 8.5L5 14M13.5 8.5L10 14M18.5 8.5L15 14')}{P('M6 14v6.5M18 14v6.5')}</>,
  sablier: <>{P('M6 3h12M6 21h12')}{P('M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9')}</>,
  plume: <>{P('M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z')}{P('M13.5 7l3.5 3.5')}</>,
  sauver: <>{P('M4 4h13l3 3v13H4z')}{P('M8 4v5h7V4')}{P('M7.5 20v-6.5h9V20')}</>,
  sortie: <>{P('M13.5 4H4.5v16h9')}{P('M9.5 12h11')}{P('M17 8.5l3.5 3.5-3.5 3.5')}</>,
  parchemin: <>{P('M6 4h12v16H6z')}{P('M9 8.5h6M9 12h6M9 15.5h3.5')}{P('M3.5 4h5M15.5 20h5')}</>,
  coffre: <>{P('M3.5 5h17v13.5h-17z')}<circle cx="12" cy="11.75" r="3.2" />{P('M12 8.5v1.2M6 18.5V21M18 18.5V21')}</>,
  retour: <>{P('M9 13.5L4 8.5l5-5')}{P('M4 8.5h10.5a5.5 5.5 0 0 1 0 11H11')}</>,
  avion: <>{P('M12 3.5v15')}{P('M12 9.5l-9 5v2l9-3 9 3v-2z')}{P('M9 21l3-2.5 3 2.5')}</>,
  urne: <>{P('M4 11h16v10H4z')}{P('M8 11V3.5h8V11')}{P('M10 7h4')}{P('M4 15h16')}</>,
  interdit: <><circle cx="12" cy="12" r="9" />{P('M7 12h10')}</>,
  etoile: <>{P('M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z')}</>,
  fleche: <>{P('M4 12h15')}{P('M13.5 6.5L19 12l-5.5 5.5')}</>,
  // --- équipements et sources d'énergie ---
  ecole: <>{P('M2.5 21h19')}{P('M5 21v-10l7-5 7 5v10')}{P('M10 21v-5h4v5')}{P('M12 6V2.5h3')}{P('M12 12.5v.5')}</>,
  hopital: <>{P('M4 21V7h16v14')}{P('M2 21h20')}{P('M12 10v6M9 13h6')}{P('M9 3h6v4H9z')}</>,
  centrale: <>{P('M2.5 21h19')}{P('M4.5 21c1.6-5 1.6-9.5 0-14h7.5c-1.6 4.5-1.6 9 0 14')}{P('M15 21V10.5h3.5V21')}{P('M7 4.5c0-1.2 1-2 2.2-2M15.5 8c0-1.2 1-2 2.2-2')}</>,
  nucleaire: <><circle cx="12" cy="12" r="1.4" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" /></>,
  eolien: <><circle cx="12" cy="9.5" r="1.3" />{P('M12 8.2V2.5M13.1 10.2l5.6 3.2M10.9 10.2l-5.6 3.2')}{P('M11.3 11l-.8 10M12.7 11l.8 10')}{P('M7.5 21h9')}</>,
  solaire: <>{P('M3.5 14.5l2-8h13l2 8z')}{P('M4.6 10.5h14.8')}{P('M10 6.5l-.8 8M14 6.5l.8 8')}{P('M12 14.5V19M8 19.5h8')}</>,
  soleil: <><circle cx="12" cy="12" r="4" />{P('M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8')}</>,
  flamme: <>{P('M12 2.5c1 3.2 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.4 1-4 2.6-5.3.3 1.7 1 2.7 2.1 3.1-.1-3.2-.3-5.6.8-8.3z')}</>,
  baril: <>{P('M6 3.5h12v17H6z')}{P('M6 9h12M6 15h12')}</>,
  goutte: <>{P('M12 3l5.6 8.2a6.6 6.6 0 1 1-11.2 0z')}</>,
  vague: <>{P('M2.5 8c2.2 0 2.2-2 4.7-2s2.4 2 4.8 2 2.4-2 4.8-2 2.5 2 4.7 2')}{P('M2.5 13c2.2 0 2.2-2 4.7-2s2.4 2 4.8 2 2.4-2 4.8-2 2.5 2 4.7 2')}{P('M2.5 18c2.2 0 2.2-2 4.7-2s2.4 2 4.8 2 2.4-2 4.8-2 2.5 2 4.7 2')}</>,
  volcan: <>{P('M2.5 20.5l6-10h7l6 10z')}{P('M8.5 10.5l3.5 3 3.5-3')}{P('M10 7c0-1.5 1.5-2 1.5-3.5M14 7c0-1.3 1-1.8 1-3')}</>,
  pousse: <>{P('M12 21v-9')}{P('M12 12C12 8 9 6 4.5 6c0 4 3 6 7.5 6z')}{P('M12 14.5c0-3.6 2.6-6 7.5-6 0 4-3.2 6-7.5 6z')}</>,
  arbre: <>{P('M12 21v-4.5')}{P('M12 3l5.5 7h-3l4 6.5h-13l4-6.5h-3z')}</>,
  batterie: <>{P('M3.5 7h15v10h-15z')}{P('M18.5 10h2v4h-2')}{P('M7 10v4M10 10v4M13 10v4')}</>,
  vent: <>{P('M3 8.5h11a3 3 0 1 0-3-3')}{P('M3 12.5h15.5a3 3 0 1 1-3 3')}{P('M3 16.5h7')}</>,
  // --- secteurs ---
  commerce: <>{P('M3 9l2-5h14l2 5')}{P('M3 9h18')}{P('M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0')}{P('M5 12v8.5h14V12')}{P('M10 20.5v-5h4v5')}</>,
  tourisme: <>{P('M4 8h16v12.5H4z')}{P('M9 8V4.5h6V8')}{P('M8 8v12.5M16 8v12.5')}</>,
  technologie: <>{P('M3 4.5h18v11.5H3z')}{P('M8.5 20.5h7M12 16v4.5')}</>,
  services: <>{P('M5 21V3.5h10V21')}{P('M15 9h4.5v12')}{P('M2.5 21h19')}{P('M8 7.5h1.5M11 7.5h1.5M8 11.5h1.5M11 11.5h1.5M8 15.5h1.5M11 15.5h1.5')}</>,
  camion: <>{P('M2.5 6h11.5v10.5H2.5z')}{P('M14 10h4l3 3.5v3H14')}<circle cx="6.5" cy="18.5" r="1.8" /><circle cx="17" cy="18.5" r="1.8" /></>,
  pont: <>{P('M2 15.5h20')}{P('M4 15.5V9M20 15.5V9')}{P('M2 9c4 0 6 4 10 4s6-4 10-4')}{P('M8 11.8v3.7M12 13v2.5M16 11.8v3.7')}</>,
  mallette: <>{P('M3 8h18v12.5H3z')}{P('M9 8V4.5h6V8')}{P('M3 13.5h18')}</>,
  monnaie: <><circle cx="12" cy="12" r="9" />{P('M15.3 8.6a4 4 0 1 0 0 6.8')}{P('M7.5 11h5.5M7.5 13.2h5.5')}</>,
  greve: <>{P('M3.5 10v4h3l8.5 5.5v-15L6.5 10z')}{P('M18 9c1 .8 1.6 1.8 1.6 3s-.6 2.2-1.6 3')}</>,
  ancre: <><circle cx="12" cy="5.5" r="2" />{P('M12 7.5V21')}{P('M5 13.5a7 7 0 0 0 14 0')}{P('M3 13.5h4M17 13.5h4M9 11h6')}</>,
  ampoule: <>{P('M9.5 18h5M10.5 21h3')}{P('M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z')}</>,
  prise: <>{P('M9 3v5M15 3v5')}{P('M6 8h12v3a6 6 0 0 1-12 0z')}{P('M12 17v4.5')}</>,
  briques: <>{P('M3 5.5h18v13H3z')}{P('M3 12h18')}{P('M9 5.5V12M15 12v6.5')}</>,
  voiture: <>{P('M3 16.5v-4.5l2.2-5h13.6l2.2 5v4.5z')}{P('M3 12h18')}{P('M6.5 19.5v-3M17.5 19.5v-3')}</>,
  mobile: <>{P('M7 2.5h10v19H7z')}{P('M11 18h2')}</>,
  adn: <>{P('M7.5 3c0 5 9 7 9 11.5 0 3-1.5 4.8-1.5 6.5M16.5 3c0 5-9 7-9 11.5 0 3 1.5 4.8 1.5 6.5')}{P('M9 7h6M9 17h6')}</>,
  flocon: <>{P('M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9')}{P('M9.8 4.5L12 6.5l2.2-2M9.8 19.5L12 17.5l2.2 2')}</>,
  feuille: <>{P('M5 19c0-8 5.5-14 15-14.5C19.5 14 13 19 5 19z')}{P('M5 19c3-4.5 6.5-7.5 10.5-9.5')}</>,
  nuage: <>{P('M7 18.5h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 11 3.8 3.8 0 0 0 7 18.5z')}</>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

/** Correspondance émoji des données → pictogramme. */
const EMOJI: Record<string, IconName> = {
  '🧭': 'besoins', '🏦': 'finances', '🧾': 'fiscalite', '📈': 'economie', '📉': 'baisse', '👷': 'travail', '👥': 'population', '🏛': 'politique',
  '🌐': 'international', '🌍': 'carte', '⚠': 'evenements', '🏆': 'trophee', '🎯': 'objectifs', '⚡': 'energie', '🌳': 'arbre', '🌲': 'arbre',
  '🚇': 'transports', '🚆': 'transports', '🏭': 'industrie', '🌾': 'agriculture', '♻': 'recyclage', '🏥': 'sante', '🩺': 'sante', '🩻': 'sante',
  '🎓': 'education', '🏫': 'ecole', '🏠': 'logement', '🏘': 'logement', '🏚': 'logement', '🚓': 'securite', '🛡': 'bouclier', '🔬': 'recherche',
  '🏗': 'equipements', '📊': 'stats', '🔔': 'alertes', '❓': 'aide', '⚙': 'reglages', '💶': 'monnaie', '💸': 'monnaie', '🤝': 'population',
  '🛒': 'commerce', '🏖': 'tourisme', '💻': 'technologie', '🏢': 'services', '🚚': 'camion', '🛣': 'pont', '💼': 'mallette', '🧰': 'renover',
  '🔥': 'flamme', '♨': 'flamme', '🛢': 'baril', '⚛': 'nucleaire', '☀': 'soleil', '🌬': 'eolien', '🌊': 'vague', '💧': 'goutte', '🚱': 'goutte',
  '🌋': 'volcan', '🌿': 'pousse', '🌱': 'pousse', '🍃': 'vent', '🔋': 'batterie', '🦆': 'vague', '✊': 'greve', '🌪': 'vent', '⚓': 'ancre',
  '🥖': 'agriculture', '💡': 'ampoule', '🚜': 'agriculture', '👵': 'population', '🔌': 'prise', '🧱': 'briques', '🚗': 'voiture', '📱': 'mobile',
  '🧬': 'adn', '✅': 'valide', '⬜': 'case', '🔒': 'verrou', '🚧': 'chantier', '⏳': 'sablier', '📝': 'plume', '💾': 'sauver', '🚪': 'sortie',
  '📜': 'parchemin', '↩': 'retour', '✈': 'avion', '🗳': 'urne', '⛔': 'interdit', '🔻': 'arret', '⬆': 'agrandir', '🛠': 'renover', '🧨': 'demolir',
  '❄': 'flocon', '🍂': 'feuille', '⛅': 'nuage', '🌧': 'nuage', '⛈': 'nuage', '🌨': 'flocon', '🌫': 'nuage', '★': 'etoile',
};

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{23E9}-\u{23FA}\u{FE0F}\u{200D}\u{24C2}\u{3030}]/gu;

/** Retire les émojis d'un texte venu des données (libellés, notifications…). */
export function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/** Nom d'icône pour un nom déjà valide ou un émoji des données. */
export function iconFor(key: string | undefined): IconName {
  if (!key) return 'case';
  if (key in ICONS) return key as IconName;
  const k = key.replace(/[\u{FE0F}\u{200D}]/gu, '');
  return EMOJI[k] ?? EMOJI[[...k][0] ?? ''] ?? 'case';
}

export function Icon({ name, size = 18, title, className }: { name: IconName | string | undefined; size?: number; title?: string; className?: string }) {
  const n = iconFor(name);
  return (
    <svg className={`ico ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={10} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false">
      {title && <title>{title}</title>}
      {ICONS[n]}
    </svg>
  );
}

/** Armoiries de la République d'Ilyas : écu tranché, tour crénelée sur ondes, étoile ; anneau titré. */
export function Seal({ size = 64, ring = true, className }: { size?: number; ring?: boolean; className?: string }) {
  return (
    <svg className={`seal ${className ?? ''}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Armoiries de la République d'Ilyas">
      <defs>
        <path id="seal-arc" d="M60 60m-45 0a45 45 0 1 1 90 0a45 45 0 1 1-90 0" />
      </defs>
      {ring && <>
        <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="53" fill="none" stroke="currentColor" strokeWidth="0.75" />
        <circle cx="60" cy="60" r="37" fill="none" stroke="currentColor" strokeWidth="0.75" />
        <text fontSize="7.4" letterSpacing="1" fill="currentColor" fontFamily="'IBM Plex Sans', sans-serif" fontWeight="600">
          <textPath href="#seal-arc" startOffset="0" textLength="276" lengthAdjust="spacing">RÉPUBLIQUE D'ILYAS · UNITÉ · TRAVAIL · AVENIR · </textPath>
        </text>
      </>}
      <g transform={ring ? 'translate(60 60) scale(0.62) translate(-60 -60)' : undefined} fill="none" stroke="currentColor" strokeWidth={ring ? 2.6 : 2} strokeLinejoin="miter">
        <path d="M30 22h60v38c0 22-14 34-30 40-16-6-30-18-30-40z" />
        <path d="M44 66V46h-4v-8h8v4h6v-4h12v4h6v-4h8v8h-4v20z" />
        <path d="M56 66v-9a4 4 0 0 1 8 0v9" />
        <path d="M36 74c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" />
        <path d="M40 83c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 6-3 3.5 3 7 3 3.5-3 7-3 3 3 6 3" />
        <path d="M60 26.5l1.6 3.4 3.7.4-2.8 2.5.8 3.7-3.3-1.9-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
