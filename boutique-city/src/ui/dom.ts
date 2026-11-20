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
