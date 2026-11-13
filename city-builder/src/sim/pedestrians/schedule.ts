/**
 * Marcheurs et emplois du temps : une partie des habitants se déplace à pied. Chaque marcheur a un domicile, un
 * rôle tiré de la démographie réelle de la ville (actif, écolier, retraité, autre) et, s'il en existe à distance
 * de marche, un lieu d'attache (emploi, école).
 *
 * ÉCHELLE DE TEMPS. Une journée de jeu dure 1 440 ticks = 144 s réelles à x1 (src/shared/constants.ts) et les
 * piétons marchent à vitesse réelle (≈ 1,3 m/s, comme les véhicules roulent à vitesse réelle) : 100 m à pied
 * durent ≈ 13 h de jeu. Un marcheur ne peut donc pas enchaîner aller, journée de travail et retour dans la même
 * journée de jeu. L'emploi du temps est donc ÉCHANTILLONNÉ : il fixe où se trouve chaque marcheur à chaque heure
 * (domicile la nuit, travail ou école en journée…), et chaque jour UN déplacement de cet emploi du temps est
 * réellement marché (« épisode ») :
 *   actif    : trajet domicile -> travail du matin, OU retour du soir, OU déjeuner dehors, OU sortie du soir ;
 *   écolier  : chemin de l'école le matin, OU retour à 16 h 30, OU parc après l'école ;
 *   retraité : courses du matin (aller ou retour), promenade de l'après-midi (aller ou retour) ;
 *   autre, actif sans emploi proche, week-end : courses, loisirs, sorties du soir (aller ou retour).
 * Les heures de départ donnent le rythme de la rue (pointe du matin vers les emplois et l'école, midi autour
 * des commerces, retours du soir vers les logements, plus aucun départ la nuit) ; un trajet commencé se termine.
 * L'épisode est une fonction PURE de (graine du marcheur, jour, bâtiments alentour) : il n'est pas sauvegardé.
 * Structure de tableaux, aucune allocation par tick. TypeScript pur : AUCUN import de three ni du DOM.
 */
import { PIETON_AGE, PIETON_GENRE_BIT } from '../../shared/protocol-ext/pietons';

export const ROLE_ACTIF = 0;
export const ROLE_ECOLIER = 1;
export const ROLE_RETRAITE = 2;
export const ROLE_AUTRE = 3;
export const ROLE_NAMES = ['actif', 'ecolier', 'retraite', 'autre'] as const;

export const MOTIF_TRAVAIL = 0;
export const MOTIF_ECOLE = 1;
export const MOTIF_COURSES = 2;
export const MOTIF_LOISIRS = 3;
export const MOTIF_RETOUR = 4;
export const MOTIF_FLANERIE = 5;
export const MOTIF_NAMES = ['travail', 'ecole', 'courses', 'loisirs', 'retour', 'flanerie'] as const;

/** Retard maximal (minutes de jeu) au-delà duquel l'épisode du jour est abandonné. */
export const EPISODE_LATE_MIN = 150;

/** Vitesse de marche de base (m/s) par classe d'âge (enfant, ado, adulte, senior). */
export const BASE_SPEED = [1.15, 1.4, 1.35, 0.95] as const;

/** Vitesse de marche propre à une apparence : base de l'âge ± 12 % selon la graine. */
export function walkSpeed(look: number, seed: number): number {
  return BASE_SPEED[look & 3]! * (0.88 + 0.24 * (seed / 255));
}

/** PRNG local (mulberry32) : plans déterministes par (marcheur, jour). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recherche de lieux pour les plans (fournie par le système, qui lit les bâtiments). */
export interface VenueFinder {
  /** Bâtiment d'un type donné autour d'un bâtiment (rayon en m), tiré avec `r` ∈ [0,1) ; -1 si aucun. */
  venue(aroundBuilding: number, radius: number, kind: 'repas' | 'courses' | 'loisirs' | 'parc' | 'tout', r: number): number;
}

export class Personas {
  count = 0;
  cap = 0;
  home = new Int32Array(0);
  anchor = new Int32Array(0);
  role = new Uint8Array(0);
  look = new Uint8Array(0);
  seed8 = new Uint8Array(0);
  seed = new Uint32Array(0);
  travelling = new Uint8Array(0);
  /** Jour de l'épisode courant (-1 : aucun), 1 si l'épisode du jour est fait (ou abandonné). */
  planDay = new Int32Array(0);
  done = new Uint8Array(0);
  /** Épisode du jour : minute de départ (-1 : pas de sortie aujourd'hui), origine, destination, motif. */
  epT = new Int16Array(0);
  epFrom = new Int32Array(0);
  epDest = new Int32Array(0);
  epMotif = new Uint8Array(0);

  constructor(capacity = 256) { this.grow(capacity); }

  private grow(n: number): void {
    const i32 = (a: Int32Array): Int32Array<ArrayBuffer> => { const b = new Int32Array(n); b.set(a); return b; };
    const u8 = (a: Uint8Array): Uint8Array<ArrayBuffer> => { const b = new Uint8Array(n); b.set(a); return b; };
    this.home = i32(this.home); this.anchor = i32(this.anchor); this.planDay = i32(this.planDay);
    this.epFrom = i32(this.epFrom); this.epDest = i32(this.epDest);
    this.role = u8(this.role); this.look = u8(this.look); this.seed8 = u8(this.seed8); this.travelling = u8(this.travelling);
    this.done = u8(this.done); this.epMotif = u8(this.epMotif);
    const s = new Uint32Array(n); s.set(this.seed); this.seed = s;
    const t = new Int16Array(n); t.set(this.epT); this.epT = t;
    this.cap = n;
  }

  clear(): void { this.count = 0; }

  add(home: number, anchor: number, role: number, look: number, seed8: number, seed: number): number {
    if (this.count === this.cap) this.grow(this.cap * 2);
    const p = this.count++;
    this.home[p] = home; this.anchor[p] = anchor; this.role[p] = role; this.look[p] = look; this.seed8[p] = seed8; this.seed[p] = seed;
    this.travelling[p] = 0; this.planDay[p] = -1; this.done[p] = 0; this.epT[p] = -1; this.epFrom[p] = -1; this.epDest[p] = -1; this.epMotif[p] = 0;
    return p;
  }

  /**
   * Choisit l'épisode du jour d'un marcheur (déterministe). `keepDone` : conserve l'état « fait » (épisode
   * régénéré après un chargement).
   */
  makeEpisode(p: number, day: number, weekday: number, finder: VenueFinder, keepDone: boolean): void {
    const r = mulberry((this.seed[p]! ^ Math.imul(day + 1, 0x9e3779b1)) >>> 0);
    const home = this.home[p]!, anchor = this.anchor[p]!, role = this.role[p]!;
    let t = -1, from = -1, dest = -1, motif = 0;
    const set = (tt: number, f: number, d: number, m: number): void => { if (f >= 0 && d >= 0 && f !== d) { t = Math.round(tt); from = f; dest = d; motif = m; } };
    /** Sortie vers un lieu (aller si `out`, sinon retour depuis ce lieu). */
    const outing = (tOut: number, stay: number, around: number, radius: number, kind: Parameters<VenueFinder['venue']>[2], m: number, out: boolean, back: number): void => {
      const v = finder.venue(around, radius, kind, r());
      if (v < 0) return;
      if (out) set(tOut, around, v, m); else set(tOut + stay, v, back, MOTIF_RETOUR);
    };
    const weekend = weekday >= 5;
    const tri = (): number => (r() + r()) / 2;
    const u = r();
    if (role === ROLE_ACTIF && !weekend && anchor >= 0) {
      if (u < 0.42) set(390 + tri() * 150, home, anchor, MOTIF_TRAVAIL);
      else if (u < 0.84) set(990 + tri() * 120, anchor, home, MOTIF_RETOUR);
      else if (u < 0.92) outing(725 + r() * 50, 40, anchor, 90, 'repas', MOTIF_COURSES, r() < 0.5, anchor);
      else outing(1125 + r() * 75, 70, home, 140, 'loisirs', MOTIF_LOISIRS, r() < 0.6, home);
    } else if (role === ROLE_ECOLIER && !weekend && anchor >= 0) {
      if (u < 0.47) set(465 + r() * 35, home, anchor, MOTIF_ECOLE);
      else if (u < 0.94) set(980 + r() * 30, anchor, home, MOTIF_RETOUR);
      else outing(1030 + r() * 30, 60, home, 160, 'parc', MOTIF_LOISIRS, r() < 0.5, home);
    } else if (role === ROLE_RETRAITE) {
      if (u < 0.5) outing(540 + r() * 120, 50 + r() * 40, home, 150, 'courses', MOTIF_COURSES, u < 0.27, home);
      else if (u < 0.9) outing(870 + r() * 120, 40 + r() * 50, home, 150, r() < 0.5 ? 'parc' : 'tout', MOTIF_FLANERIE, u < 0.72, home);
    } else {
      // Autres habitants, actifs sans emploi à distance de marche (ils vont travailler en voiture), week-end.
      const flanerie = r() < 0.4;
      if (u < 0.34) outing(570 + r() * 150, 40 + r() * 50, home, 150, 'courses', MOTIF_COURSES, u < 0.18, home);
      else if (u < 0.7) outing(840 + r() * 180, 50 + r() * 60, home, 150, flanerie ? 'tout' : 'loisirs', flanerie ? MOTIF_FLANERIE : MOTIF_LOISIRS, u < 0.53, home);
      else if (u < (weekend ? 0.92 : 0.84)) outing(1125 + r() * 75, 60 + r() * 40, home, 150, 'loisirs', MOTIF_LOISIRS, r() < 0.6, home);
    }
    this.epT[p] = Math.min(1439, t); this.epFrom[p] = from; this.epDest[p] = dest; this.epMotif[p] = motif;
    this.planDay[p] = day;
    if (!keepDone) this.done[p] = t < 0 ? 1 : 0;
  }
}

/** Apparence (octet « profil ») tirée du rôle : classe d'âge + genre. */
export function lookForRole(role: number, r: () => number): number {
  let age: number;
  if (role === ROLE_ECOLIER) age = r() < 0.6 ? PIETON_AGE.enfant : PIETON_AGE.ado;
  else if (role === ROLE_RETRAITE) age = PIETON_AGE.senior;
  else if (role === ROLE_ACTIF) age = r() < 0.06 ? PIETON_AGE.ado : PIETON_AGE.adulte;
  else age = r() < 0.12 ? PIETON_AGE.ado : r() < 0.2 ? PIETON_AGE.senior : PIETON_AGE.adulte;
  return age | (r() < 0.5 ? PIETON_GENRE_BIT : 0);
}
