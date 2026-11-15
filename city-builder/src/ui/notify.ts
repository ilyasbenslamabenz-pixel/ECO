/**
 * Notifications (toasts) : pile limitée, icône par type, disparition animée ; JOURNAL des messages
 * (centre de notifications de la barre supérieure : badge des non lus, liste datée en date de jeu).
 * Les « Chantier terminé » sont regroupés en un seul message cumulatif (ni toast répété, ni badge).
 * Propriétaire : agent construction/caméra/UI.
 */
import { $, chfText, el } from './dom';
import { iconEl } from './icons';

export type NotifyKind = 'info' | 'error' | 'ok';
const ICONS: Record<NotifyKind, string> = { info: 'info', error: 'alert', ok: 'check' };
const MAX = 4;
const LOG_MAX = 60;

export interface NotifyEntry {
  text: string; kind: NotifyKind; at: number; count: number;
  /** Date de jeu au moment du message (« 12 avr. an 2, 09:34 »), si connue. */
  gameDate?: string;
  /** Message cumulatif (chantiers terminés). */
  group?: 'chantier';
}

/** Journal des notifications (le plus récent en dernier). */
export const notifyLog: NotifyEntry[] = [];
let unread = 0;
const listeners: (() => void)[] = [];
let dateOf: () => string = () => '';

export function onNotify(fn: () => void): void { listeners.push(fn); }
export function unreadCount(): number { return unread; }
export function markAllRead(): void { if (unread === 0) return; unread = 0; for (const l of listeners) l(); }
export function clearLog(): void { notifyLog.length = 0; unread = 0; for (const l of listeners) l(); }
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

const CHANTIER = /^Chantier terminé : (.+?)\.?$/;

/** Bouton d'action d'une notification (ex. « Voir » d'un événement) : au moins 44 px au doigt. */
export interface ToastAction { label: string; run: () => void }

export function toast(raw: string, kind: NotifyKind = 'info', ms = 4200, action?: ToastAction): void {
  const text = playerText(raw);
  // Téléphone : une seule notification à la fois, plus brève (le détail reste dans la cloche).
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  if (phone && kind !== 'error') ms = Math.min(ms, 2800);
  const gameDate = dateOf();
  const ch = CHANTIER.exec(text);
  let shown = text;
  if (ch) {
    // Chantiers terminés : UN message cumulatif dans le journal, sans badge ; toast discret (bureau seulement).
    let g = notifyLog.find((n) => n.group === 'chantier');
    if (!g) { g = { text: '', kind: 'ok', at: 0, count: 0, group: 'chantier' }; notifyLog.push(g); }
    g.count++; g.at = Date.now(); g.gameDate = gameDate;
    g.text = g.count > 1 ? `Chantiers terminés : ${nf.format(g.count)} (dernier : ${ch[1]})` : text;
    // Le message cumulatif remonte en fin de journal (le plus récent).
    notifyLog.splice(notifyLog.indexOf(g), 1); notifyLog.push(g);
    for (const l of listeners) l();
    if (phone) return;
    shown = g.text;
  } else {
    // Journal : un message identique consécutif est regroupé (compteur).
    const last = notifyLog[notifyLog.length - 1];
    if (last && last.text === text && !last.group) { last.count++; last.at = Date.now(); last.gameDate = gameDate; } else notifyLog.push({ text, kind, at: Date.now(), count: 1, gameDate });
    unread++;
  }
  if (notifyLog.length > LOG_MAX) notifyLog.splice(0, notifyLog.length - LOG_MAX);
  if (!ch) for (const l of listeners) l();
  const box = $('toasts');
  const key = ch ? 'chantier' : text;
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
