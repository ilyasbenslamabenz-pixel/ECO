/** Petits utilitaires DOM de l'interface. Propriétaire : agent construction/caméra/UI. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} absent du balisage`);
  return el as T;
};

/** Crée un élément avec classes, attributs et enfants (texte échappé par textContent). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { cls?: string; text?: string; attrs?: Record<string, string>; title?: string } = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.cls) e.className = props.cls;
  if (props.text !== undefined) e.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) e.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const nf = new Intl.NumberFormat('fr-FR');
export const fmt = (n: number): string => nf.format(Math.round(n));
/** Monnaie affichée : franc suisse (CHF). Les montants internes et les sauvegardes sont inchangés. */
export const CURRENCY = 'CHF';
/** Montant complet : « 500 000 CHF ». */
export const money = (n: number): string => `${n < 0 ? '−' : ''}${fmt(Math.abs(n))} ${CURRENCY}`;
/** Montant signé complet : « +423 000 CHF ». */
export const signedMoney = (n: number): string => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))} ${CURRENCY}`;
/** Nombre compact (« 12,5 M », « 423 k », « 9 800 ») : précision suffisante, chiffres jamais tronqués. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  const d = (v: number, max: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: max });
  if (a >= 1e9) return `${s}${d(a / 1e9, a >= 1e10 ? 1 : 2)} Md`;
  if (a >= 1e6) return `${s}${d(a / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)} M`;
  if (a >= 1e5) return `${s}${d(a / 1e3, 0)} k`;
  return `${s}${fmt(a)}`;
}
/** Montant compact : « 12,5 M CHF », « 500 000 CHF » (en dessous d'un million : montant complet). */
export const moneyShort = (n: number): string => (Math.abs(n) >= 1e6 ? `${compact(n)} ${CURRENCY}` : money(n));
/** Montant compact signé : « +423 k CHF ». */
export const signedShort = (n: number): string => `${n >= 0 ? '+' : '−'}${compact(Math.abs(n))} ${CURRENCY}`;
/** Textes venant d'autres couches (outils, simulation) : le symbole historique « ¢ » est affiché « CHF ». */
export const chfText = (t: string): string => t.replace(/¢/g, CURRENCY);
export const pct = (v: number, d = 0): string => `${(v * 100).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;

export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function phaseBadge(n: number | string): HTMLSpanElement { return el('span', { cls: 'phase', text: `Phase ${n}` }); }

/**
 * Rend le défilement horizontal ÉVIDENT : `data-more` vaut « r », « l » ou « lr » selon qu'il reste du contenu
 * à droite / à gauche ; la feuille de style fond alors le bord concerné (un libellé coupé net au bord de
 * l'écran passait pour un défaut d'affichage). Écoute le défilement et les changements de taille.
 */
export function scrollHints(elm: HTMLElement): void {
  const upd = (): void => {
    const max = elm.scrollWidth - elm.clientWidth;
    const v = max > 2 ? `${elm.scrollLeft > 2 ? 'l' : ''}${elm.scrollLeft < max - 2 ? 'r' : ''}` : '';
    if (v) elm.dataset['more'] = v; else delete elm.dataset['more'];
  };
  elm.addEventListener('scroll', upd, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(upd).observe(elm);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => requestAnimationFrame(upd)).observe(elm, { childList: true });
  window.addEventListener('resize', upd);
  requestAnimationFrame(upd);
}
