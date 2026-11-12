/**
 * Notifications (toasts) : pile limitée, icône par type, disparition animée.
 * Propriétaire : agent construction/caméra/UI.
 */
import { $, el } from './dom';

export type NotifyKind = 'info' | 'error' | 'ok';
const ICONS: Record<NotifyKind, string> = { info: 'i', error: '!', ok: '✓' };
const MAX = 4;

export function toast(text: string, kind: NotifyKind = 'info', ms = 4200): void {
  const box = $('toasts');
  // Dédoublonnage : un message identique déjà affiché est simplement prolongé.
  for (const t of Array.from(box.children) as HTMLElement[]) {
    if (t.dataset['text'] === text && !t.classList.contains('out')) { t.dataset['until'] = String(Date.now() + ms); return; }
  }
  const t = el('div', { cls: `toast ${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, el('span', { cls: 'tico', text: ICONS[kind] }), el('span', { text }));
  t.dataset['text'] = text;
  t.dataset['until'] = String(Date.now() + ms);
  box.appendChild(t);
  while (box.children.length > MAX) box.firstElementChild?.remove();
  const tick = (): void => {
    if (!t.isConnected) return;
    if (Date.now() < Number(t.dataset['until'])) { setTimeout(tick, 300); return; }
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  };
  setTimeout(tick, Math.min(ms, 1000));
}
