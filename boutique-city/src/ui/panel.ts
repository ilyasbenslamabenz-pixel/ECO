/**
 * Panneau latéral générique : un titre, un contenu redessiné quand la partie change (au plus deux fois par
 * seconde, jamais pendant une saisie), un bouton de fermeture. Les vues (services, commerce, entreprise) ne sont
 * que des fonctions qui produisent du DOM à partir de l'état de la partie.
 */
import type { Game, Result } from '../sim/game';
import { $, button, el } from './dom';

export interface View { kicker: string; title: string; render: () => (Node | null)[]; onClose?: () => void; wide?: boolean }

export class Panel {
  private view: View | null = null;
  private lastVersion = -1;
  private lastPaint = 0;
  private readonly root = $('panel');

  constructor(private readonly game: Game) {}

  get isOpen(): boolean { return this.view !== null; }
  get current(): View | null { return this.view; }

  open(v: View): void {
    const prev = this.view;
    this.view = v;
    if (prev && prev !== v) prev.onClose?.();
    this.paint(true);
  }

  close(): void {
    const v = this.view;
    this.view = null;
    this.root.classList.add('hidden');
    this.root.replaceChildren();
    v?.onClose?.();
  }

  /** Redessine si la partie a changé (ou immédiatement avec force). */
  paint(force = false): void {
    const v = this.view;
    if (!v) return;
    const now = performance.now();
    if (!force) {
      // Changement de la partie (au plus 2 fois par seconde) ou rafraîchissement lent (horloge).
      if (this.game.version === this.lastVersion ? now - this.lastPaint < 5000 : now - this.lastPaint < 500) return;
      // Jamais sous le pointeur ni pendant une saisie : un clic ne doit pas tomber entre deux versions du panneau.
      const a = document.activeElement;
      if (a && this.root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
      if (this.root.querySelector('button:hover, input:hover, select:hover, label:hover')) return;
    }
    this.lastVersion = this.game.version;
    this.lastPaint = now;
    const body = this.root.querySelector('.p-body');
    const scroll = body?.scrollTop ?? 0;
    this.root.classList.toggle('wide', !!v.wide);
    const nb = el('div', { cls: 'p-body' }, ...v.render());
    // Contenu identique (rafraîchissement sans changement visible) : on garde les éléments en place — pas de
    // scintillement, survol et clic en cours conservés.
    const head = this.root.querySelector('.p-head h3')?.textContent;
    if (!force && body && head === v.title && body.innerHTML === nb.innerHTML) return;
    this.root.replaceChildren(
      el('div', { cls: 'p-head' }, el('div', {}, el('div', { cls: 'kicker', text: v.kicker }), el('h3', { text: v.title })), button('×', () => this.close(), 'icon-x')),
      nb);
    nb.scrollTop = scroll;
    this.root.classList.remove('hidden');
  }
}

/** Affiche le résultat d'une action (message d'erreur ou de succès) ; vrai si réussie. */
export type Act = <T>(r: Result<T>, okText?: string | ((d: T) => string)) => boolean;
