/**
 * Journal des notifications (vague 5, docs/INTERFACE.md) : logique PURE (sans DOM, testée).
 *  - chaque message reçoit une GRAVITÉ (urgent / important / info) et une CLÉ DE REGROUPEMENT ;
 *  - les doublons sont regroupés en une seule entrée qui compte ses occurrences et garde le dernier détail
 *    (« 12 constructions (dernière : Maison) », « Coupures d'électricité : 3 alertes ») — aucun type n'est supprimé ;
 *  - le badge ne compte que les entrées urgentes et importantes non lues ; « Tout marquer comme lu ».
 */

export type NotifyKind = 'info' | 'error' | 'ok';
export type Severity = 'urgent' | 'important' | 'info';
export const SEVERITY_ORDER: readonly Severity[] = ['urgent', 'important', 'info'];
export const SEVERITY_FR: Record<Severity, string> = { urgent: 'Urgent', important: 'Important', info: 'Info' };

export interface NotifyEntry {
  /** Texte affiché (résumé du groupe quand il compte plusieurs messages). */
  text: string;
  /** Dernier message reçu (détail). */
  last: string;
  kind: NotifyKind;
  severity: Severity;
  /** Clé de regroupement. */
  key: string;
  at: number;
  count: number;
  /** Non lue (une nouvelle occurrence la remet en non lue). */
  unread: boolean;
  /** Date de jeu du dernier message (« 12 avr. an 2, 09:34 »), si connue. */
  gameDate?: string;
  /** Message cumulatif historique des chantiers terminés (compatibilité). */
  group?: 'chantier';
}

interface Rule {
  re: RegExp;
  key: string;
  severity: Severity;
  /** Résumé d'un groupe de `n` messages (n ≥ 2) ; `m` = correspondance du dernier message. */
  summary?: (n: number, m: RegExpExecArray, last: string) => string;
}

const nf = new Intl.NumberFormat('fr-FR');
const n0 = (n: number): string => nf.format(n);

/** Règles dans l'ordre (la première qui correspond gagne). Textes déjà passés par `playerText`. */
const RULES: readonly Rule[] = [
  // Urgent : la ville est en danger ou des habitants perdent un service vital.
  { re: /faillite|Trésorerie négative/i, key: 'faillite', severity: 'urgent' },
  { re: /^(Incendie|Le feu se propage) : (.+?) \(/, key: 'incendie', severity: 'urgent', summary: (n, m) => `${n0(n)} incendies (dernier : ${m[2]})` },
  { re: /^Bâtiment détruit par le feu : (.+?) \(/, key: 'ruine', severity: 'urgent', summary: (n, m) => `${n0(n)} bâtiments détruits par le feu (dernier : ${m[1]})` },
  { re: /^(.+?) : (\d[\d\s ]*) bâtiments coupés/, key: 'courant-coupe', severity: 'urgent', summary: (n, m) => `Coupures d’électricité : ${n0(n)} alertes (dernière : ${m[2]!.trim()} bâtiments sans courant)` },
  { re: /sans eau|eau coupée|pénurie d.eau/i, key: 'eau-coupee', severity: 'urgent', summary: (n, _m, last) => `Eau : ${n0(n)} alertes (dernière : ${last})` },
  // Important : à traiter bientôt.
  { re: /^Panne : (.+?) hors service/, key: 'panne', severity: 'important', summary: (n, m) => `${n0(n)} pannes (dernière : ${m[1]})` },
  { re: /^La nuit sans vent/, key: 'intermittence', severity: 'important' },
  { re: /^Événement annoncé|^Événement — /, key: 'evenement', severity: 'important' },
  { re: /^Palier atteint/, key: 'palier', severity: 'important' },
  { re: /^Circulation très lente/, key: 'trafic', severity: 'important' },
  { re: /^Incendie maîtrisé : (.+?) \(.*endommagé/, key: 'incendie-degats', severity: 'important', summary: (n, m) => `${n0(n)} bâtiments endommagés par le feu (dernier : ${m[1]})` },
  { re: /délits?|criminalité/i, key: 'criminalite', severity: 'important', summary: (n, _m, last) => `Criminalité : ${n0(n)} alertes (dernière : ${last})` },
  { re: /démoli : (\d+) habitant/, key: 'evacuation', severity: 'important', summary: (n) => `${n0(n)} démolitions avec habitants relogés ou partis` },
  // Info : retours d'action du joueur et nouvelles.
  { re: /^Chantier terminé : (.+?)\.?$/, key: 'chantier', severity: 'info', summary: (n, m) => `Chantiers terminés : ${n0(n)} (dernier : ${m[1]})` },
  { re: /^Construction : (.+?) \(/, key: 'construction', severity: 'info', summary: (n, m) => `${n0(n)} constructions (dernière : ${m[1]})` },
  { re: /^(.+?) construit \(/, key: 'construction', severity: 'info', summary: (n, m) => `${n0(n)} constructions (dernière : ${m[1]})` },
  { re: /^(.+?) construite : (.+?) m\b/, key: 'route', severity: 'info', summary: (n) => `${n0(n)} routes construites` },
  { re: /^Route parallèle|^Giratoire construit|^Quadrillage|^Tracé terminé/, key: 'route', severity: 'info', summary: (n) => `${n0(n)} routes construites` },
  { re: /démoli \(\+|^Tronçon supprimé|^Zone démolie/, key: 'demolition', severity: 'info', summary: (n) => `${n0(n)} démolitions` },
  { re: /déplacé \(gratuit\)/, key: 'deplacement', severity: 'info', summary: (n) => `${n0(n)} bâtiments déplacés` },
  { re: /refusée?\b|impossible|^Rien à/i, key: 'refus', severity: 'info', summary: (n, _m, last) => `${n0(n)} actions refusées (dernière : ${last})` },
  { re: /^Annulé|^Annulation/, key: 'annulation', severity: 'info', summary: (n) => `${n0(n)} annulations` },
  { re: /^Partie sauvegardée/, key: 'sauvegarde', severity: 'info', summary: (n, _m, last) => `${n0(n)} sauvegardes (dernière : ${last.replace(/^Partie sauvegardée\s*\(?\s*/, '').replace(/\)\s*$/, '')})` },
  { re: /^(Nouvel objectif|Objectif accompli|Objectif atteint|Réalisation)/, key: 'objectifs', severity: 'info' },
  { re: /^Incendie maîtrisé|^Reconstruit par son promoteur/, key: 'incendie-fin', severity: 'info', summary: (n) => `${n0(n)} incendies maîtrisés ou bâtiments reconstruits` },
  { re: /^Emprunt|^Politique|^Recherche terminée|^Secteur créé|mis en service|amélioré au niveau/, key: '', severity: 'info' },
];

/** Gravité et clé de regroupement d'un message (pur). Messages d'alerte inconnus : importants. */
export function classify(text: string, kind: NotifyKind): { severity: Severity; key: string; rule: Rule | null; m: RegExpExecArray | null } {
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) return { severity: r.severity, key: r.key ? `r:${r.key}` : `t:${normalize(text)}`, rule: r.key ? r : null, m };
  }
  return { severity: kind === 'error' ? 'important' : 'info', key: `t:${normalize(text)}`, rule: null, m: null };
}

/** Clé d'un texte : chiffres remplacés (« 12 bâtiments » et « 15 bâtiments » se regroupent). */
export const normalize = (t: string): string => t.replace(/\d[\d\s ,.]*/g, '#').trim();

export const LOG_MAX = 60;

/** Journal : regroupement, gravité, non lues (pur, sans DOM). */
export class NotifyJournal {
  readonly entries: NotifyEntry[] = [];

  /** Ajoute un message ; renvoie l'entrée (nouvelle ou regroupée). */
  add(text: string, kind: NotifyKind, at: number, gameDate?: string): NotifyEntry {
    const c = classify(text, kind);
    let e = this.entries.find((x) => x.key === c.key);
    if (e) {
      e.count++;
      e.last = text; e.at = at; e.gameDate = gameDate; e.kind = kind === 'error' || e.kind !== 'error' ? kind : e.kind;
      e.text = e.count > 1 && c.rule?.summary && c.m ? c.rule.summary(e.count, c.m, text) : text;
      e.unread = true;
      // Remonte en fin de journal (le plus récent).
      this.entries.splice(this.entries.indexOf(e), 1);
      this.entries.push(e);
    } else {
      e = { text, last: text, kind, severity: c.severity, key: c.key, at, count: 1, unread: true, ...(gameDate ? { gameDate } : {}), ...(c.key === 'r:chantier' ? { group: 'chantier' as const } : {}) };
      this.entries.push(e);
      if (this.entries.length > LOG_MAX) this.dropOldest();
    }
    return e;
  }

  /** Retire l'entrée la plus ancienne en épargnant les urgentes non lues tant que possible. */
  private dropOldest(): void {
    const k = this.entries.findIndex((x) => !(x.severity === 'urgent' && x.unread));
    this.entries.splice(k >= 0 ? k : 0, 1);
  }

  /** Badge : entrées urgentes et importantes non lues. */
  badgeCount(): number { let n = 0; for (const e of this.entries) if (e.unread && e.severity !== 'info') n++; return n; }
  unreadCount(sev?: Severity): number { let n = 0; for (const e of this.entries) if (e.unread && (!sev || e.severity === sev)) n++; return n; }
  markAllRead(): boolean { let ch = false; for (const e of this.entries) if (e.unread) { e.unread = false; ch = true; } return ch; }
  markRead(sev: Severity): boolean { let ch = false; for (const e of this.entries) if (e.unread && e.severity === sev) { e.unread = false; ch = true; } return ch; }
  clear(): void { this.entries.length = 0; }
  /** Entrées d'une gravité, de la plus récente à la plus ancienne. */
  bySeverity(sev: Severity): NotifyEntry[] { return this.entries.filter((e) => e.severity === sev).reverse(); }
}
