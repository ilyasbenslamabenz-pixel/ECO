/**
 * Infobulles : tout élément portant `data-tip` affiche son texte au survol de la souris
 * (après un court délai) et au focus clavier. Ignoré au doigt (pas de survol sur iPhone).
 * Propriétaire : agent construction/caméra/UI.
 */
import { $ } from './dom';

export function initTooltips(): void {
  const tip = $('tooltip');
  let timer = 0;
  let current: HTMLElement | null = null;
  const place = (target: HTMLElement): void => {
    const r = target.getBoundingClientRect();
    tip.classList.remove('hidden');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    // Rail d'icônes (`data-tip-side="right"`) : bulle à droite de l'icône, centrée verticalement.
    if (target.dataset['tipSide'] === 'right' && r.right + 10 + w < window.innerWidth) {
      x = r.right + 10;
      y = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
    }
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const show = (t: HTMLElement): void => {
    const text = t.dataset['tip'];
    if (!text) return;
    current = t;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { if (current !== t || !t.isConnected) return; tip.textContent = text; place(t); }, 380);
  };
  const hide = (): void => { current = null; window.clearTimeout(timer); tip.classList.add('hidden'); };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
    if (t && t !== current) show(t); else if (!t) hide();
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('focusin', (e) => { const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]'); if (t && t.matches(':focus-visible')) show(t); });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}
