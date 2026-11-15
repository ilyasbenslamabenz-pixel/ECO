/**
 * Notifications (toasts) : pile limitée, icône par type, disparition animée ; JOURNAL des messages
 * (centre de notifications de la barre supérieure, liste datée en date de jeu). Vague 5 : doublons regroupés
 * (« 12 constructions », « Coupures d'électricité : 3 alertes »), gravité urgent / important / info, badge limité
 * aux urgentes et importantes non lues, « Tout marquer comme lu » (logique pure : src/ui/notify-log.ts).
 * Propriétaire : agent construction/caméra/UI.
 */
import { $, chfText, el } from './dom';
import { iconEl } from './icons';

import { NotifyJournal, type NotifyEntry, type NotifyKind, type Severity } from './notify-log';

export type { NotifyEntry, NotifyKind, Severity } from './notify-log';
const ICONS: Record<NotifyKind, string> = { info: 'info', error: 'alert', ok: 'check' };
const MAX = 4;

/** Journal regroupé et hiérarchisé (src/ui/notify-log.ts). */
export const journal = new NotifyJournal();
/** Entrées du journal (la plus récente en dernier). */
export const notifyLog: NotifyEntry[] = journal.entries;
const listeners: (() => void)[] = [];
let dateOf: () => string = () => '';
const changed = (): void => { for (const l of listeners) l(); };

export function onNotify(fn: () => void): void { listeners.push(fn); }
/** Badge : notifications urgentes et importantes non lues (les infos ne comptent pas). */
export function unreadCount(): number { return journal.badgeCount(); }
export function markAllRead(): void { if (journal.markAllRead()) changed(); }
/** Marque comme lues les notifications d'une gravité (ex. les infos à l'ouverture du journal). */
export function markSeverityRead(sev: Severity): void { if (journal.markRead(sev)) changed(); }
export function markEntryRead(e: NotifyEntry): void { if (e.unread) { e.unread = false; changed(); } }
export function clearLog(): void { journal.clear(); changed(); }
/** Source de la date de jeu affichée dans le journal. */
export function setNotifyDate(fn: () => string): void { dateOf = fn; }

const nf = new Intl.NumberFormat('fr-FR');
/**
 * Texte joueur : monnaie en CHF, nombres au format français (espace des milliers, virgule décimale),
 * tournures sans accord douteux (« Éolienne construit » → « Construction : Éolienne »).
 */
export function playerText(raw: string): string {
  let t = chfText(raw).replace(/\bcrédits\b/g, 'CHF');
  t = t.replace(/^(.+?) construit \(/, 'Construction : $1 (');
  // Décimales : « 3.50 % » → « 3,50 % » (pas dans les nombres déjà groupés).
  t = t.replace(/(\d)\.(\d)/g, '$1,$2');
  // Milliers : « 300000 » → « 300 000 » (nombres entiers de 4 chiffres ou plus, hors identifiants « n° »).
  t = t.replace(/(^|[^\d,n°#])(\d{4,})(?![\d,])/g, (_m, p: string, n: string) => `${p}${nf.format(Number(n))}`);
  return t;
}

/** Bouton d'action d'une notification (ex. « Voir » d'un événement) : au moins 44 px au doigt. */
export interface ToastAction { label: string; run: () => void }

export function toast(raw: string, kind: NotifyKind = 'info', ms = 4200, action?: ToastAction): void {
  const text = playerText(raw);
  // Téléphone : une seule notification à la fois, plus brève (le détail reste dans la cloche).
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  if (phone && kind !== 'error') ms = Math.min(ms, 2800);
  // Journal : regroupement des doublons (« 12 constructions »), gravité (urgent / important / info).
  const e = journal.add(text, kind, Date.now(), dateOf() || undefined);
  changed();
  const grouped = e.count > 1 && e.key.startsWith('r:');
  // Chantiers terminés : cumul discret, sans toast sur téléphone (comme avant).
  if (e.group === 'chantier' && phone) return;
  const shown = grouped ? e.text : text;
  const ch = e.group === 'chantier';
  const box = $('toasts');
  // Un toast par groupe : le cumul (« 5 constructions ») remplace le précédent au lieu d'empiler.
  const key = e.key.startsWith('r:') ? e.key : text;
  // Dédoublonnage : un message identique (ou le cumul des chantiers) déjà affiché est prolongé et mis à jour.
  for (const t of Array.from(box.children) as HTMLElement[]) {
    if (t.dataset['text'] === key && !t.classList.contains('out')) {
      t.dataset['until'] = String(Date.now() + ms);
      const span = t.lastElementChild; if (span) span.textContent = shown;
      return;
    }
  }
  const t = el('div', { cls: `toast ${ch ? 'ok' : kind}${action ? ' has-act' : ''}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, el('span', { cls: 'tico' }, iconEl(ICONS[ch ? 'ok' : kind])));
  if (action) {
    // Le texte reste le dernier enfant (mise à jour des doublons, coupe à deux lignes sur téléphone) ; le bouton est
    // placé après lui par la feuille de style (`order`).
    const b = el('button', { cls: 'toast-act', text: action.label, attrs: { type: 'button' } });
    b.addEventListener('click', (e) => { e.stopPropagation(); action.run(); t.classList.add('out'); setTimeout(() => t.remove(), 260); });
    t.append(b);
  }
  t.append(el('span', { text: shown }));
  t.dataset['text'] = key;
  t.dataset['until'] = String(Date.now() + ms);
  if (phone) t.addEventListener('click', () => document.getElementById('btn-notif')?.click());
  box.appendChild(t);
  while (box.children.length > (phone ? 1 : MAX)) box.firstElementChild?.remove();
  const tick = (): void => {
    if (!t.isConnected) return;
    if (Date.now() < Number(t.dataset['until'])) { setTimeout(tick, 300); return; }
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  };
  setTimeout(tick, Math.min(ms, 1000));
}
