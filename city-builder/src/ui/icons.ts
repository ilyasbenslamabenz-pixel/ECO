/**
 * Jeu d'icônes ORIGINAL de l'interface (SVG en ligne, 24 × 24, trait 1,8 px, extrémités arrondies).
 * Style « duotone » : les formes de classe `f` sont remplies de la couleur courante à faible opacité,
 * le trait suit `currentColor` ; la couleur d'une icône vient donc du CSS (variable `--ic` des tuiles).
 * Aucun emoji, aucune police d'icônes externe.
 * Usage : `icon('home')` (chaîne SVG) ou `<i data-icon="home"></i>` dans markup.html (hydraté par `hydrateIcons`).
 */

const P: Record<string, string> = {
  /* --- Identité --- */
  logo: '<rect class="f" x="2.5" y="2.5" width="19" height="19" rx="5"/><path d="M6 18.5v-6.5a6 6 0 0112 0v6.5"/><path d="M9 18.5v-5a3 3 0 016 0v5"/><path d="M4 18.5h16"/><path d="M12 3.5v2.5"/>',
  /* --- Barre supérieure --- */
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.2v13.6a.8.8 0 001.2.7l10.6-6.8a.8.8 0 000-1.4L9.2 4.5A.8.8 0 008 5.2z" fill="currentColor" stroke="none"/>',
  sun: '<circle class="f" cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
  people: '<circle class="f" cx="9" cy="8" r="3.3"/><path d="M2.8 20c0-3.4 2.8-6.2 6.2-6.2s6.2 2.8 6.2 6.2"/><circle cx="17" cy="8.8" r="2.6"/><path d="M15.8 13.9c3 .3 5.4 2.8 5.4 6.1"/>',
  smile: '<circle class="f" cx="12" cy="12" r="9"/><path d="M8.3 14.2c2 2.4 5.4 2.4 7.4 0"/><path d="M9 9.6v.6M15 9.6v.6"/>',
  meh: '<circle class="f" cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.6v.6M15 9.6v.6"/>',
  frown: '<circle class="f" cx="12" cy="12" r="9"/><path d="M8.3 16.2c2-2.4 5.4-2.4 7.4 0"/><path d="M9 9.6v.6M15 9.6v.6"/>',
  cash: '<rect class="f" x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/>',
  stats: '<path d="M4 4v16h16"/><rect class="f" x="7" y="12" width="3" height="5" rx=".8"/><rect class="f" x="12" y="8" width="3" height="9" rx=".8"/><rect class="f" x="17" y="10.5" width="2.5" height="6.5" rx=".8"/>',
  bell: '<path class="f" d="M6 16.5V11a6 6 0 0112 0v5.5l1.6 1.8H4.4z"/><path d="M10 20.6a2.1 2.1 0 004 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path class="f" d="M10.3 3h3.4l.5 2.4 1.7.9 2.3-.9 1.7 2.9-1.8 1.6v2.2l1.8 1.6-1.7 2.9-2.3-.9-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.9-1.7-2.9 1.8-1.6v-2.2L3.9 9.3l1.7-2.9 2.3.9 1.7-.9z"/>',
  save: '<path class="f" d="M5 3.5h11.2L19.5 7v13.5h-14.5z"/><path d="M8.5 3.5v4.5h6.5V3.5"/><rect x="8.5" y="13" width="7" height="5.5" rx="1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sidebar: '<rect class="f" x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/><path d="M5.5 8h1.5M5.5 11h1.5M5.5 14h1.5"/>',
  /* --- Tableaux de bord --- */
  home: '<path class="f" d="M5 10.5V20h5v-5.5h4V20h5v-9.5"/><path d="M3 11.5l9-7.5 9 7.5"/>',
  finance: '<rect class="f" x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9.5h18"/><path d="M7 14.5h4"/><circle cx="16.5" cy="14.5" r="1.5"/>',
  services: '<rect class="f" x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.2A1.2 1.2 0 0110.2 4h3.6A1.2 1.2 0 0115 5.2V7"/><path d="M12 10.5v6M9 13.5h6"/>',
  energy: '<path class="f" d="M13.2 2.5L5 13.5h6l-1.2 8 8.2-11h-6z"/>',
  water: '<path class="f" d="M12 3c3.6 4.5 6.5 8 6.5 11.5a6.5 6.5 0 01-13 0C5.5 11 8.4 7.5 12 3z"/><path d="M9 15a3 3 0 003 3"/>',
  waste: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path class="f" d="M6 7l1.1 13h9.8L18 7"/><path d="M10 11v5.5M14 11v5.5"/>',
  transport: '<rect class="f" x="4.5" y="3.5" width="15" height="14.5" rx="3"/><path d="M4.5 11h15"/><path d="M7.5 21v-3M16.5 21v-3"/><path d="M8 14.6h.1M16 14.6h.1"/><path d="M8 6.5h8"/>',
  leaf: '<path class="f" d="M5 19.5C5 11 10 5 20 4c-.3 10.5-6.2 15.5-15 15.5z"/><path d="M5 19.5c3-4.2 6.2-7.2 10-9.5"/>',
  policy: '<path class="f" d="M4 9.5h16L12 4.5z"/><path d="M4 9.5h16L12 4.5z"/><path d="M6.5 9.5v8M10 9.5v8M14 9.5v8M17.5 9.5v8"/><path d="M3.5 20h17"/>',
  research: '<path d="M9 3h6"/><path class="f" d="M10 3v6.2l-5.3 9A1.9 1.9 0 006.3 21h11.4a1.9 1.9 0 001.6-2.8l-5.3-9V3"/><path d="M7.6 15h8.8"/>',
  /* --- Outils de construction --- */
  cursor: '<path class="f" d="M5.5 3.5l13 6.2-5.6 1.9-2.2 5.9z"/><path d="M13 12l5.5 5.5"/>',
  zones: '<rect class="f" x="3" y="3" width="8" height="8" rx="1.8"/><rect x="13" y="3" width="8" height="8" rx="1.8"/><rect x="3" y="13" width="8" height="8" rx="1.8"/><rect class="f" x="13" y="13" width="8" height="8" rx="1.8"/>',
  road: '<path class="f" d="M8.5 3h7l4 18h-15z"/><path d="M12 4.5v2.8M12 10.6v2.8M12 16.7v2.8"/>',
  building: '<path class="f" d="M4.5 21V8.2l6-4.2v17"/><path d="M10.5 21V10h9v11"/><path d="M3 21h18"/><path d="M13.5 13.5h3M13.5 17h3M7 10h1M7 13.5h1M7 17h1"/>',
  tree: '<path d="M12 21v-5"/><path class="f" d="M12 3a5.2 5.2 0 00-4.9 7A4.4 4.4 0 008.6 16h6.8a4.4 4.4 0 001.5-6A5.2 5.2 0 0012 3z"/>',
  terrain: '<path class="f" d="M2.5 20l6.6-11.2 3.9 6.2 3-4.2L21.5 20z"/><path d="M7.4 11.7l1.7 1.3 1.6-1.2"/>',
  demolish: '<path d="M4 21V5.5h10"/><path d="M14 5.5v4"/><circle class="f" cx="14" cy="13.2" r="3.4"/><path d="M2 21h7"/><path d="M7.5 5.5L4 9"/>',
  undo: '<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 010 11H11"/>',
  /* --- Mini-carte / caméra --- */
  eye: '<path class="f" d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  walk: '<circle cx="13" cy="4.6" r="1.9"/><path d="M10.2 21l2-6.2 3 3V21M8.5 11.2l3.2-3.2 3 2.2 2.3 3M11.7 8l-1.4 5.4"/>',
  zoomIn: '<circle class="f" cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L21 21M10.5 7.6v5.8M7.6 10.5h5.8"/>',
  zoomOut: '<circle class="f" cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L21 21M7.6 10.5h5.8"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M12 4.8l2.6 7.2H9.4z" fill="#ef5b5b" stroke="none"/><path d="M12 19.2l-2.6-7.2h5.2z" fill="currentColor" stroke="none" opacity=".55"/>',
  plane: '<path class="f" d="M21 15.5l-8-4.6V5.2a1 1 0 00-2 0v5.7l-8 4.6V17l8-2.4V19l-2 1.5V22l3-.9 3 .9v-1.5L13 19v-4.4l8 2.4z"/>',
  map: '<path class="f" d="M3 6l6-2.5 6 2.5 6-2.5V18l-6 2.5L9 18l-6 2.5z"/><path d="M9 3.5V18M15 6v14.5"/>',
  target: '<circle class="f" cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  topview: '<rect class="f" x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>',
  /* --- Divers --- */
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<circle class="f" cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/>',
  alert: '<path class="f" d="M12 3.2l9.8 17.3H2.2z"/><path d="M12 10v4.8M12 17.6v.4"/>',
  flag: '<path d="M5.5 21V3.5"/><path class="f" d="M5.5 4h12l-2.6 4 2.6 4h-12"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  /* --- Sous-barres : zones --- */
  house: '<path class="f" d="M5 10.5V20h14v-9.5L12 4.5z"/><path d="M3 12l9-8 9 8"/><path d="M10 20v-5h4v5"/>',
  shop: '<path class="f" d="M4.5 10v10h15V10"/><path d="M3 10l2-5.5h14L21 10z"/><path d="M3 10c0 1.4 1.3 2.4 3 2.4s3-1 3-2.4c0 1.4 1.3 2.4 3 2.4s3-1 3-2.4c0 1.4 1.3 2.4 3 2.4s3-1 3-2.4"/><path d="M10 20v-4.5h4V20"/>',
  factory: '<path class="f" d="M3 20V11l5 3V11l5 3V11l5 3V4h3v16z"/><path d="M7 17.5h2M11.5 17.5h2"/>',
  office: '<rect class="f" x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 7h2M13.5 7h2M8.5 10.5h2M13.5 10.5h2M8.5 14h2M13.5 14h2M10.5 21v-3h3v3"/>',
  wheat: '<path d="M12 21V9"/><path class="f" d="M12 9c-2.6-.4-3.6-2.6-3.4-5 2.5.2 3.6 2.4 3.4 5zM12 9c2.6-.4 3.6-2.6 3.4-5-2.5.2-3.6 2.4-3.4 5z"/><path class="f" d="M12 14c-2.8-.3-4-2.4-4-4.8 2.6.1 4 2.3 4 4.8zM12 14c2.8-.3 4-2.4 4-4.8-2.6.1-4 2.3-4 4.8z"/><path d="M4 21h16"/>',
  star: '<path class="f" d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8z"/>',
  /* --- Sous-barres : bâtiments --- */
  townhouse: '<path class="f" d="M3 20V10l4.5-4 4.5 4v10M12 20V10l4.5-4 4.5 4v10"/><path d="M2 20h20M6 20v-3.5h3V20M15 20v-3.5h3V20"/>',
  apartment: '<rect class="f" x="5" y="5" width="14" height="16" rx="1.2"/><path d="M8 8.5h2M14 8.5h2M8 12h2M14 12h2M8 15.5h2M14 15.5h2M10.5 21v-2.5h3V21M4 5h16"/>',
  tower: '<rect class="f" x="7" y="2.5" width="10" height="18.5" rx="1.2"/><path d="M9.5 6h1.5M13 6h1.5M9.5 9.5h1.5M13 9.5h1.5M9.5 13h1.5M13 13h1.5M9.5 16.5h1.5M13 16.5h1.5M4 21h16"/>',
  skyscraper: '<path class="f" d="M9 21V6l3-3.5L15 6v15z"/><path d="M4.5 21v-9h4.5M15 13h4.5v8M3 21h18M11 9h2M11 12.5h2M11 16h2"/>',
  /* --- Services publics --- */
  townhall: '<path class="f" d="M4 10h16L12 5z"/><path d="M4 10h16L12 5zM12 5V2.5"/><path d="M6.5 10v8M10 10v8M14 10v8M17.5 10v8M3.5 20.5h17"/>',
  school: '<path class="f" d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5v4.5c3.3 2.6 7.7 2.6 11 0v-4.5M21.5 9.5V15"/>',
  hospital: '<rect class="f" x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M12 7.5v9M7.5 12h9"/>',
  police: '<path class="f" d="M12 3l7.5 3v5.5c0 4.6-3.2 8.1-7.5 9.5-4.3-1.4-7.5-4.9-7.5-9.5V6z"/><path d="M12 8.5l1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3z"/>',
  fire: '<path class="f" d="M12 21.5c-4 0-6.5-2.8-6.5-6.3 0-4.6 4.5-6.7 4.8-11.7 3 1.8 4.5 4.6 4.3 7.5 1.1-.6 1.8-1.7 2-3 1.3 1.6 1.9 3.6 1.9 5.4 0 4.6-2.7 8.1-6.5 8.1z"/><path d="M12 21.5c-1.7 0-2.8-1.2-2.8-2.8 0-2 2-3 2.3-5.1 1.6 1 2.9 2.4 3 4.4.1 2-1 3.5-2.5 3.5z"/>',
  museum: '<path class="f" d="M4 9h16L12 4z"/><path d="M4 9h16L12 4zM6 9v8.5M9.3 9v8.5M14.7 9v8.5M18 9v8.5M3.5 20.5h17M5 17.5h14"/>',
  church: '<path class="f" d="M8 21v-9l4-4 4 4v9z"/><path d="M12 2.5V8M10 4.5h4M4 21v-6l4-3M20 21v-6l-4-3M3 21h18M11 21v-3a1 1 0 012 0v3"/>',
  station: '<rect class="f" x="5" y="3.5" width="14" height="13" rx="3.5"/><path d="M5 10.5h14M8.5 13.6h.1M15.5 13.6h.1M8 20.5l1.5-4M16 20.5l-1.5-4M6.5 20.5h11"/>',
  park: '<path class="f" d="M7.5 3.5a4.2 4.2 0 00-3.9 5.7 3.6 3.6 0 002.6 5h2.6a3.6 3.6 0 002.6-5 4.2 4.2 0 00-3.9-5.7z"/><path d="M7.5 21v-7M13 21v-4h8v4M12 17h10M14.5 17l2.5-3 2.5 3"/>',
  flower: '<circle cx="12" cy="9" r="2"/><path class="f" d="M12 7a2.6 2.6 0 110-5 2.6 2.6 0 010 5zM12 11a2.6 2.6 0 110 5 2.6 2.6 0 010-5zM10 9a2.6 2.6 0 11-5 0 2.6 2.6 0 015 0zM14 9a2.6 2.6 0 115 0 2.6 2.6 0 01-5 0z"/><path d="M12 16v5.5M12 19c-1.5-1.6-3-2-4.5-2M12 19c1.5-1.6 3-2 4.5-2"/>',
  bench: '<path class="f" d="M3.5 10h17v3h-17z"/><path d="M3.5 7h17M5.5 13v6M18.5 13v6M3 16h18"/>',
  rock: '<path class="f" d="M3 19l2.5-7 4.5-4.5 5 1.5 3.5 4 2.5 6z"/><path d="M10 7.5l1.5 5 3.5-3.5"/>',
  /* --- Énergie, eau, déchets, transports, terrain (phase 2B/2C) --- */
  plant: '<path class="f" d="M3 21V12h6V9l4 3V9l4 3V4.5h3V21z"/><path d="M18.5 4.5c0-1.4 1-2 2.5-2"/><path d="M6 17h2M11 17h2"/>',
  wind: '<path d="M12 10.5V21M9.5 21h5"/><circle cx="12" cy="9" r="1.5"/><path class="f" d="M12 7.5c.4-2.5 1.2-4.8 2-5.3.9.4.7 3-.5 5.6zM13.3 9.8c2.4.9 4.4 2.3 4.7 3.2-.6.8-3 .1-5.2-1.6zM10.7 9.8c-2 1.6-4.3 2.5-5.2 2.3-.2-1 1.6-2.7 4-3.6z"/>',
  solar: '<path class="f" d="M3 18l3-9h14l-3 9z"/><path d="M4.5 13.5h14M9 9l-1.5 9M14.5 9l-1.5 9M11 18v3M8 21h6"/><path d="M17 2.5v2M20.5 4l-1.4 1.4M13.5 4l1.4 1.4"/>',
  dam: '<path class="f" d="M3 6h6l2 15H3z"/><path d="M11 9c2 0 2-1.5 4-1.5S17 9 19 9s2-1.5 3-1.5M11 13c2 0 2-1.5 4-1.5S17 13 19 13s2-1.5 3-1.5M3 6h6l2 15H3z"/>',
  pylon: '<path class="f" d="M9 21l2-15h2l2 15z"/><path d="M9 21l2-15h2l2 15M6 8h12M7.5 12h9M10.4 12l3.6 6M13.6 12L10 18M12 3v3"/>',
  pump: '<rect class="f" x="4" y="9" width="10" height="11" rx="1.5"/><path d="M14 13h4.5a1.5 1.5 0 011.5 1.5V17M9 9V5.5h-3M3 20.5h12"/><path d="M20 19.5c.8 0 1.2-.7 1.2-1.2 0-.6-.6-1.3-1.2-2.1-.6.8-1.2 1.5-1.2 2.1 0 .5.4 1.2 1.2 1.2z"/>',
  watertower: '<path class="f" d="M5.5 4.5h13v6c0 1.7-2.9 3-6.5 3s-6.5-1.3-6.5-3z"/><path d="M8 13l-2 8M16 13l2 8M7.2 17h9.6M12 13.5V21"/>',
  treatment: '<ellipse class="f" cx="12" cy="13" rx="9" ry="4.5"/><path d="M3 13v3c0 2.5 4 4.5 9 4.5s9-2 9-4.5v-3M8 12.5c1.3.8 2.6.8 4 0s2.7-.8 4 0M12 3v5.5"/>',
  pipe: '<path class="f" d="M2.5 8h9v4h-9zM15.5 12h6v9h-4v-5h-2z"/><path d="M11.5 10h2.5a3.5 3.5 0 013.5 3.5V16"/>',
  sewer: '<circle class="f" cx="12" cy="12" r="8.5"/><path d="M5 9h14M3.8 12h16.4M5 15h14M9 4.3v15.4M15 4.3v15.4"/>',
  truck: '<path class="f" d="M2.5 6.5h11v10h-11z"/><path d="M13.5 9.5h4.2l3.3 3.6v3.4h-7.5"/><circle cx="7" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/><path d="M5 9.5h6M5 12.5h6"/>',
  recycle: '<path class="f" d="M9.5 4.5l-3 5 3 1.8L12.4 6zM20 14.5l-3-5.1-3 1.8 3 5.1zM8 20h6v-3.5H8z"/><path d="M12.4 6l2.6 4.4M17 16.3H8M6.5 9.5L4.3 13.4A2 2 0 006 16.5h2"/>',
  landfill: '<path class="f" d="M2.5 20.5L8 11l4 4 3-3 6.5 8.5z"/><path d="M7 8.5l1.5-2 2 1.5M14.5 7.5l2-1.5 1.5 2"/>',
  busstop: '<path d="M6 21V3.5"/><rect class="f" x="3" y="3" width="6" height="5" rx="1"/><rect class="f" x="11" y="9" width="10" height="9" rx="2"/><path d="M11 13.5h10M13 20.5v-2.5M19 20.5v-2.5"/>',
  tram: '<rect class="f" x="5.5" y="6" width="13" height="12" rx="3"/><path d="M5.5 12h13M9 21l1.5-3M15 21l-1.5-3M8 3h8M12 3v3"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13.5M8 10.5h8"/><path class="f" d="M4.5 13.5c0 4.2 3.4 7 7.5 7s7.5-2.8 7.5-7l-2.5 1.5M4.5 13.5L7 15"/>',
  airport: '<path class="f" d="M21 15.5l-8-4.6V5.2a1 1 0 00-2 0v5.7l-8 4.6V17l8-2.4V19l-2 1.5V22l3-.9 3 .9v-1.5L13 19v-4.4l8 2.4z"/>',
  raise: '<path class="f" d="M2.5 20.5l7-9 4 5 3-3.5 5 7.5z"/><path d="M17 3v6M14.5 5.5L17 3l2.5 2.5"/>',
  lower: '<path class="f" d="M2.5 20.5l7-9 4 5 3-3.5 5 7.5z"/><path d="M17 3v6M14.5 6.5L17 9l2.5-2.5"/>',
  flatten: '<path class="f" d="M2.5 15.5h19v5h-19z"/><path d="M4 11.5h16M7 8.5h10M12 3v5.5"/>',
  smooth: '<path class="f" d="M2.5 20.5c3-6 5.5-8.5 9.5-8.5s6.5 2.5 9.5 8.5z"/><path d="M5 8c2-1.5 4-1.5 6 0s4 1.5 6 0"/>',
};

export type IconName = keyof typeof P;

/** Code SVG d'une icône (chaîne, sûre : contenu statique du module). */
export function icon(name: string, cls = ''): string {
  const body = P[name] ?? P['info']!;
  return `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Élément SVG d'une icône. */
export function iconEl(name: string, cls = ''): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstElementChild as SVGSVGElement;
}

/** Remplace chaque `<i data-icon="nom">` du sous-arbre par l'icône SVG correspondante. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const i of Array.from(root.querySelectorAll<HTMLElement>('i[data-icon]'))) {
    const s = iconEl(i.dataset['icon'] ?? 'info', i.className);
    i.replaceWith(s);
  }
}

export const ICON_NAMES = Object.keys(P);
