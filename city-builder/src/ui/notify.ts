/**
 * Notifications (toasts) : pile limitée, icône par type, disparition animée ; JOURNAL des messages
 * (centre de notifications de la barre supérieure : badge des non lus, liste horodatée).
 * Propriétaire : agent construction/caméra/UI.
 */
import { $, chfText, el } from './dom';
import { iconEl } from './icons';

export type NotifyKind = 'info' | 'error' | 'ok';
const ICONS: Record<NotifyKind, string> = { info: 'info', error: 'alert', ok: 'check' };
const MAX = 4;
const LOG_MAX = 60;

export interface NotifyEntry { text: string; kind: NotifyKind; at: number; count: number }

/** Journal des notifications (le plus récent en dernier). */
export const notifyLog: NotifyEntry[] = [];
let unread = 0;
const listeners: (() => void)[] = [];

export function onNotify(fn: () => void): void { listeners.push(fn); }
export function unreadCount(): number { return unread; }
export function markAllRead(): void { if (unread === 0) return; unread = 0; for (const l of listeners) l(); }
export function clearLog(): void { notifyLog.length = 0; unread = 0; for (const l of listeners) l(); }

export function toast(raw: string, kind: NotifyKind = 'info', ms = 4200): void {
  const text = chfText(raw);
  // Journal : un message identique consécutif est regroupé (compteur).
  const last = notifyLog[notifyLog.length - 1];
  if (last && last.text === text) { last.count++; last.at = Date.now(); } else notifyLog.push({ text, kind, at: Date.now(), count: 1 });
  if (notifyLog.length > LOG_MAX) notifyLog.splice(0, notifyLog.length - LOG_MAX);
  unread++;
  for (const l of listeners) l();
  const box = $('toasts');
  // Dédoublonnage : un message identique déjà affiché est simplement prolongé.
  for (const t of Array.from(box.children) as HTMLElement[]) {
    if (t.dataset['text'] === text && !t.classList.contains('out')) { t.dataset['until'] = String(Date.now() + ms); return; }
  }
  const t = el('div', { cls: `toast ${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, el('span', { cls: 'tico' }, iconEl(ICONS[kind])), el('span', { text }));
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
