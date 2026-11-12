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
export const money = (n: number): string => `${fmt(n)} ¢`;
export const signedMoney = (n: number): string => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))} ¢`;

export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function phaseBadge(n: number): HTMLSpanElement { return el('span', { cls: 'phase', text: `Phase ${n}` }); }
