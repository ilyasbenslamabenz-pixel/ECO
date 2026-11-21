/** Petits outils d'interface : création d'éléments, formats français. */
type Attrs = { cls?: string; text?: string; attrs?: Record<string, string>; on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>> };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.on) for (const [k, fn] of Object.entries(opts.on)) e.addEventListener(k, fn as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const nf0 = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const chf = (v: number): string => `${nf0.format(Math.round(v))} CHF`;
export const chf2 = (v: number): string => `${nf2.format(v)} CHF`;
export const num = (v: number): string => nf0.format(Math.round(v));
export const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(Math.round(v)))} CHF`;
export const pct = (v: number): string => `${Math.round(v * 100)} %`;

export function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return el('button', { cls, text, attrs: { type: 'button' }, on: { click: () => onClick() } });
}

/**
 * Confirmation dans la page (la boîte `confirm()` du navigateur n'est pas disponible partout : dans un cadre
 * protégé, elle répond toujours « non »). Résout vrai si le joueur confirme.
 */
export function askConfirm(text: string, okLabel = 'Confirmer', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean): void => { wrap.remove(); resolve(v); };
    const ok = button(okLabel, () => close(true), danger ? 'danger' : 'primary');
    const wrap = el('div', { cls: 'confirm', attrs: { role: 'dialog', 'aria-modal': 'true' } },
      el('div', { cls: 'confirm-card' }, el('p', { text }), el('div', { cls: 'row end' }, button('Annuler', () => close(false)), ok)));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
    document.body.append(wrap);
    ok.focus();
  });
}

/* ------------------------------ Pictogrammes (SVG au trait, aucun émoji) ------------------------------ */

/** Cercle en commande de chemin SVG (centre, rayon). */
const C = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/**
 * Jeu de pictogrammes 24×24 dessinés au trait (couleur du texte). Un chemin préfixé « F » est plein.
 * Utilisés par le HUD, le téléphone, la carte et la barre d'intérieur.
 */
const ICONS = {
  shop: ['M4 10v10h16V10', 'M3 4h18l-1.2 6H4.2z', 'M10 20v-5h4v5'],
  building: ['M5 21V4h10v17', 'M15 9h4v12', 'M3 21h18', 'M8 8h4M8 12h4M8 16h4'],
  bank: ['M3 10l9-6 9 6z', 'M5.5 10v8M10 10v8M14 10v8M18.5 10v8', 'M3 20.5h18'],
  team: [C(9, 8, 3.2), 'M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6', 'M15.5 4.6a3.2 3.2 0 0 1 0 6.3', 'M17.5 14.3c2.1.7 3.5 2.9 3.5 5.7'],
  chart: ['M4 4v16h16', 'M7.5 15l4-4.5 3 3L20 7', 'M16 7h4v4'],
  chat: ['M4 5h16v11H10l-6 4.5z', 'M8 9.5h8M8 12.5h5'],
  trophy: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5a3 3 0 0 0 3.3 3.6', 'M16 6h3a3 3 0 0 1-3.3 3.6', 'M12 13v4', 'M8 20.5h8', 'M9.5 17h5v3.5h-5z'],
  truck: ['M2.5 6h11.5v10H2.5z', 'M14 9.5h4.2l3.3 3.5v3H14', C(7, 17.5, 2), C(17.5, 17.5, 2)],
  map: ['M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z', 'M9 4v13.5', 'M15 6.5V20'],
  briefcase: ['M3 7.5h18v12.5H3z', 'M9 7.5V5h6v2.5', 'M3 12.5h18', 'M11 12.5v2h2v-2'],
  gear: [C(12, 12, 3), 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1', C(12, 12, 6.5)],
  phone: ['M7 2.5h10v19H7z', 'M10.5 18.5h3', 'M7 5.5h10M7 16h10'],
  bolt: ['FM13.5 2L4.5 13.5h6.5L9.8 22l9.2-12h-6.6z'],
  food: ['M6 3v6.5a3 3 0 0 0 6 0V3', 'M9 3v18', 'M17.5 3c-2.2 2-2.4 7 0 8.5V21'],
  sun: [C(12, 12, 4), 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8'],
  cloud: ['M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z'],
  rain: ['M7 15h10.5a3.7 3.7 0 0 0 .4-7.4A5.6 5.6 0 0 0 7 9.1 3 3 0 0 0 7 15z', 'M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5'],
  box: ['M3 7.5l9-4 9 4v9.5l-9 4-9-4z', 'M3 7.5l9 4 9-4', 'M12 11.5V21', 'M7.5 5.5l9 4'],
  pin: ['M12 21.5s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z', C(12, 9.5, 2.5)],
  eye: ['M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z', C(12, 12, 3)],
  pause: ['FM6.5 5h4v14h-4zM13.5 5h4v14h-4z'],
  play: ['FM7 4.5l12.5 7.5L7 19.5z'],
  sound: ['M4 9h3.5L13 4.5v15L7.5 15H4z', 'M16.5 8.5a5 5 0 0 1 0 7', 'M19 6a8.5 8.5 0 0 1 0 12'],
  mute: ['M4 9h3.5L13 4.5v15L7.5 15H4z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'],
  save: ['M4.5 3.5h12l3 3v14h-15z', 'M8 3.5v5h7.5v-5', 'M7.5 20.5v-6.5h9v6.5'],
  back: ['M15 5l-7 7 7 7'],
  next: ['M9 5l7 7-7 7'],
  alert: ['M12 3.5l9.5 17h-19z', 'M12 10v5', 'M12 17.6v.4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  home: ['M3 11.5l9-8 9 8', 'M5.5 10v10.5h13V10', 'M10 20.5v-6h4v6'],
  key: [C(8, 15.5, 4), 'M11 12.5l9-9', 'M16.5 7l3 3', 'M14 9.5l2 2'],
  info: [C(12, 12, 9), 'M12 11v6', 'M12 7.6v.4'],
  flag: ['M5 21.5V3.5', 'M5 4h12.5l-2.5 4 2.5 4H5'],
  user: [C(12, 8, 4), 'M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7'],
  coin: [C(12, 12, 9), 'M14.8 9.2c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.4 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.7-3-1.8', 'M12 5.8v1.8M12 16.4v1.8'],
  route: [C(6, 18, 2.5), C(18, 6, 2.5), 'M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5'],
  close: ['M6 6l12 12M18 6L6 18'],
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
} satisfies Record<string, string[]>;
export type IconName = keyof typeof ICONS;

/** Pictogramme SVG en ligne (taille par la police : 1em). */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ico ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const p = document.createElementNS(ns, 'path');
    if (d.startsWith('F')) { p.setAttribute('d', d.slice(1)); p.setAttribute('fill', 'currentColor'); p.setAttribute('stroke', 'none'); }
    else p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Bouton avec pictogramme devant le libellé. */
export function iconButton(name: IconName, text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = button('', onClick, `${cls} has-ico`.trim());
  b.append(icon(name), el('span', { text }));
  return b;
}
