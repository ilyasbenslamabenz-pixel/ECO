/**
 * Paliers de ville (docs/PROGRESSION.md) : chaque palier se franchit avec des POINTS D'EXPANSION (croissance, bonheur,
 * objectifs et réalisations), verse une prime une seule fois et débloque du contenu.
 *
 * Compatibilité : `population` reste le seuil historique (paliers v1 fondés sur la population) ; les points requis
 * (`xp`) valent ce même nombre et la croissance rapporte 1 point par nouvel habitant (record de population) : une ville
 * franchit donc chaque palier au plus tard au même moment qu'avant, plus tôt si elle est heureuse et remplit ses
 * objectifs.
 *
 * Verrous : seulement dans une partie neuve créée en mode « déblocages progressifs » (réglage du module `paliers`). Une
 * ancienne sauvegarde, ou une partie sans ce mode, garde TOUT débloqué. Les bonus additifs (capacité d'emprunt, lignes
 * de bus) ne retirent rien à personne.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** Ce qu'un palier débloque. */
export type UnlockDef =
  | { kind: 'asset'; ids: readonly string[]; label: string }
  | { kind: 'zone'; zone: string; label: string }
  | { kind: 'policy'; id: string; label: string }
  | { kind: 'level'; level: number; label: string }
  | { kind: 'busLines'; max: number; label: string }
  | { kind: 'loan'; amount: number; label: string };

export interface MilestoneDef {
  id: string;
  nameFr: string;
  /** Seuil historique de population (paliers v1) : référence et reprise des anciennes sauvegardes. */
  population: number;
  /** Points d'expansion requis (cumul depuis le début de la partie). */
  xp: number;
  reward: number;
  unlocks: readonly UnlockDef[];
}

const TOWERS = ['tour_vitree_mur_rideau', 'gratte_ciel_retraits', 'proc_tour_bureaux_retraits', 'proc_tour_bureaux_antenne', 'proc_tour_belvedere'];

export const MILESTONES: readonly MilestoneDef[] = [
  // Primes de l'ordre d'un équipement (le premier palier paie une école, le deuxième un service de déchets…) :
  // elles comptent surtout pour un budget serré, sans faire exploser la trésorerie d'un budget normal.
  { id: 'hameau', nameFr: 'Hameau', population: 100, xp: 100, reward: 100_000, unlocks: [
    { kind: 'busLines', max: 3, label: '3 lignes de bus' },
    { kind: 'policy', id: 'tri_obligatoire', label: 'Politique « Tri des déchets obligatoire »' },
    { kind: 'loan', amount: 150_000, label: 'Capacité d’emprunt +150 000 CHF' },
  ] },
  { id: 'village', nameFr: 'Village', population: 500, xp: 500, reward: 250_000, unlocks: [
    { kind: 'zone', zone: 'bureaux', label: 'Zone de bureaux' },
    { kind: 'asset', ids: ['dechets_centre_tri'], label: 'Centre de tri des déchets' },
    { kind: 'level', level: 2, label: 'Amélioration des équipements au niveau 2' },
    { kind: 'policy', id: 'soutien_commerce', label: 'Politique « Soutien au commerce local »' },
    { kind: 'busLines', max: 4, label: '4 lignes de bus' },
    { kind: 'loan', amount: 300_000, label: 'Capacité d’emprunt +300 000 CHF' },
  ] },
  { id: 'bourg', nameFr: 'Bourg', population: 1_500, xp: 1_500, reward: 400_000, unlocks: [
    { kind: 'zone', zone: 'res_dense', label: 'Zone résidentielle dense' },
    { kind: 'asset', ids: ['public_hopital'], label: 'Hôpital' },
    { kind: 'asset', ids: ['elec_centrale_gaz'], label: 'Centrale thermique au gaz' },
    { kind: 'asset', ids: ['proc_mediatheque'], label: 'Médiathèque' },
    { kind: 'policy', id: 'aide_logement', label: 'Politique « Aide au logement »' },
    { kind: 'busLines', max: 6, label: '6 lignes de bus' },
    { kind: 'loan', amount: 600_000, label: 'Capacité d’emprunt +600 000 CHF' },
  ] },
  { id: 'petite_ville', nameFr: 'Petite ville', population: 3_000, xp: 3_000, reward: 600_000, unlocks: [
    { kind: 'asset', ids: ['dechets_incinerateur'], label: 'Incinérateur' },
    { kind: 'asset', ids: ['public_gare'], label: 'Gare' },
    { kind: 'asset', ids: ['public_musee_bibliotheque'], label: 'Musée et bibliothèque' },
    { kind: 'level', level: 3, label: 'Amélioration des équipements au niveau 3' },
    { kind: 'policy', id: 'ville_verte', label: 'Politique « Ville verte »' },
    { kind: 'policy', id: 'filtres_industriels', label: 'Politique « Filtres industriels »' },
    { kind: 'busLines', max: 8, label: '8 lignes de bus' },
    { kind: 'loan', amount: 1_000_000, label: 'Capacité d’emprunt +1 M CHF' },
  ] },
  { id: 'ville', nameFr: 'Ville', population: 6_000, xp: 6_000, reward: 900_000, unlocks: [
    { kind: 'asset', ids: ['public_hotel_de_ville'], label: 'Hôtel de ville' },
    { kind: 'asset', ids: ['elec_barrage'], label: 'Barrage hydroélectrique' },
    { kind: 'asset', ids: TOWERS, label: 'Tours de bureaux' },
    { kind: 'busLines', max: 12, label: '12 lignes de bus' },
    { kind: 'loan', amount: 2_000_000, label: 'Capacité d’emprunt +2 M CHF' },
  ] },
  { id: 'grande_ville', nameFr: 'Grande ville', population: 12_000, xp: 12_000, reward: 1_400_000, unlocks: [
    { kind: 'asset', ids: ['tour_iconique_couronne'], label: 'Tour iconique' },
    { kind: 'asset', ids: ['commerce_centre_commercial'], label: 'Centre commercial' },
    { kind: 'busLines', max: 16, label: '16 lignes de bus' },
    { kind: 'loan', amount: 3_500_000, label: 'Capacité d’emprunt +3,5 M CHF' },
  ] },
  { id: 'cite', nameFr: 'Cité régionale', population: 25_000, xp: 25_000, reward: 2_200_000, unlocks: [
    { kind: 'busLines', max: 24, label: '24 lignes de bus' },
    { kind: 'loan', amount: 6_000_000, label: 'Capacité d’emprunt +6 M CHF' },
  ] },
  { id: 'agglomeration', nameFr: 'Agglomération', population: 50_000, xp: 50_000, reward: 3_500_000, unlocks: [
    { kind: 'busLines', max: 32, label: '32 lignes de bus' },
    { kind: 'loan', amount: 10_000_000, label: 'Capacité d’emprunt +10 M CHF' },
  ] },
  { id: 'metropole', nameFr: 'Métropole', population: 100_000, xp: 100_000, reward: 5_000_000, unlocks: [
    { kind: 'loan', amount: 15_000_000, label: 'Capacité d’emprunt +15 M CHF' },
  ] },
  { id: 'megapole', nameFr: 'Mégapole', population: 200_000, xp: 200_000, reward: 8_000_000, unlocks: [
    { kind: 'loan', amount: 25_000_000, label: 'Capacité d’emprunt +25 M CHF' },
  ] },
];

/** Lignes de bus autorisées au départ d'une partie en déblocages progressifs. */
export const START_BUS_LINES = 2;
/** Niveau d'amélioration des équipements autorisé au départ (déblocages progressifs). */
export const START_SERVICE_LEVEL = 1;

/** Ce qui est verrouillé et le palier qui le débloque (null = libre). Fonctions pures : interface et simulation. */
export interface LockInfo { milestone: MilestoneDef }

export function milestoneForAsset(assetId: string): MilestoneDef | null {
  for (const m of MILESTONES) for (const u of m.unlocks) if (u.kind === 'asset' && u.ids.includes(assetId)) return m;
  return null;
}
export function milestoneForZone(zone: string): MilestoneDef | null {
  for (const m of MILESTONES) for (const u of m.unlocks) if (u.kind === 'zone' && u.zone === zone) return m;
  return null;
}
export function milestoneForPolicy(id: string): MilestoneDef | null {
  for (const m of MILESTONES) for (const u of m.unlocks) if (u.kind === 'policy' && u.id === id) return m;
  return null;
}
export function milestoneForLevel(level: number): MilestoneDef | null {
  for (const m of MILESTONES) for (const u of m.unlocks) if (u.kind === 'level' && u.level >= level) return m;
  return null;
}
/** Lignes de bus autorisées une fois les paliers `reached` franchis (verrous actifs). */
export function busLinesAllowed(reached: ReadonlySet<string>): number {
  let n = START_BUS_LINES;
  for (const m of MILESTONES) if (reached.has(m.id)) for (const u of m.unlocks) if (u.kind === 'busLines') n = Math.max(n, u.max);
  return n;
}
/** Premier palier qui autorise au moins `count` lignes de bus. */
export function milestoneForBusLines(count: number): MilestoneDef | null {
  for (const m of MILESTONES) for (const u of m.unlocks) if (u.kind === 'busLines' && u.max >= count) return m;
  return null;
}
/** Capacité d'emprunt supplémentaire (CHF) apportée par les paliers franchis (bonus additif, pour toutes les parties). */
export function loanBonus(reached: ReadonlySet<string>): number {
  let n = 0;
  for (const m of MILESTONES) if (reached.has(m.id)) for (const u of m.unlocks) if (u.kind === 'loan') n = Math.max(n, u.amount);
  return n;
}

/** Verrous d'une partie en déblocages progressifs (listes de ce qui est ENCORE verrouillé, avec le palier requis). */
export interface PaliersLocks {
  assets: Record<string, string>;
  zones: Record<string, string>;
  policies: Record<string, string>;
  /** Niveau d'amélioration maximal autorisé, et palier du suivant (null au maximum). */
  maxLevel: number;
  nextLevelAt: string | null;
  busLines: number;
  nextBusLinesAt: string | null;
}

export function computeLocks(reached: ReadonlySet<string>): PaliersLocks {
  const assets: Record<string, string> = {}, zones: Record<string, string> = {}, policies: Record<string, string> = {};
  let maxLevel = START_SERVICE_LEVEL, nextLevelAt: string | null = null;
  for (const m of MILESTONES) {
    const done = reached.has(m.id);
    for (const u of m.unlocks) {
      if (u.kind === 'asset' && !done) for (const id of u.ids) assets[id] = m.nameFr;
      if (u.kind === 'zone' && !done) zones[u.zone] = m.nameFr;
      if (u.kind === 'policy' && !done) policies[u.id] = m.nameFr;
      if (u.kind === 'level') { if (done) maxLevel = Math.max(maxLevel, u.level); else if (nextLevelAt === null) nextLevelAt = m.nameFr; }
    }
  }
  const busLines = busLinesAllowed(reached);
  const nb = milestoneForBusLines(busLines + 1);
  return { assets, zones, policies, maxLevel, nextLevelAt, busLines, nextBusLinesAt: nb && !reached.has(nb.id) ? nb.nameFr : null };
}

export interface PaliersState {
  population: number;
  reached: string[];
  /** Titre actuel (dernier palier atteint) ; null avant le premier. */
  title: string | null;
  next: MilestoneDef | null;
  milestones: (MilestoneDef & { reached: boolean; at: number | null })[];
  /** Points d'expansion cumulés et détail par source (croissance, bonheur, objectifs, réalisations, reprise). */
  xp: number;
  xpBy: Record<string, number>;
  /** Points gagnés hier (croissance + bonheur) : rythme de progression affiché. */
  xpLastDay: number;
  /** Déblocages progressifs actifs (partie neuve) ; faux = tout est libre (ancienne sauvegarde, bac à sable). */
  locked: boolean;
  /** Verrous restants (null si `locked` est faux). */
  locks: PaliersLocks | null;
  /** Capacité d'emprunt supplémentaire acquise (CHF). */
  loanBonus: number;
}

/** Service `paliers` publié par le module (lu par la simulation, les objectifs et les modules verrouillables). */
export interface PaliersService {
  /** Raison du refus si `assetId` est verrouillé (partie en déblocages progressifs), sinon null. */
  assetLock(assetId: string): string | null;
  zoneLock(zone: string): string | null;
  policyLock(id: string): string | null;
  levelLock(level: number): string | null;
  busLineLock(count: number): string | null;
  /** Capacité d'emprunt supplémentaire (CHF). */
  loanBonus(): number;
  /** Ajoute des points d'expansion (objectifs, réalisations) ; renvoie les points effectivement ajoutés. */
  grant(points: number, source: 'objectifs' | 'realisations' | 'evenements'): number;
  /** Points d'expansion entre le palier courant et le suivant (récompenses proportionnelles). */
  gap(): number;
  xp(): number;
  reachedCount(): number;
  /**
   * Rapport de la démographie calculé par le module au début du jour courant (minute `at`), partagé pour éviter de le
   * recalculer (objectifs) ; undefined s'il date d'une autre minute.
   */
  dayReport(at: number): unknown;
}
export const PALIERS_SERVICE = 'paliers';
