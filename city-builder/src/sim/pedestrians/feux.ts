/**
 * Adaptateurs vers les services du module CIRCULATION (autre branche) consommés par les piétons :
 *  - « feux »   : état du feu PIÉTON de chaque passage régulé (obligatoire pour respecter les feux) ;
 *  - « trafic » : créneau avant l'arrivée du prochain véhicule sur une traversée (facultatif).
 * Les piétons ne dépendent QUE des interfaces `FeuxPort` / `TraficPort` définies ici ; `adaptFeux` /
 * `adaptTrafic` vérifient la forme du service publié par `ctx.provide(...)` et le protègent (exception ou valeur
 * invalide = « pas d'information »). Service absent ou invalide : repli « traversée prudente » (crowd.ts).
 * La forme attendue est décrite pour le superviseur dans docs/requests/pietons.md.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

/** État du feu piéton d'un passage. */
export const FEU_VERT = 0;
/** Dégagement (vert clignotant / orange) : on termine sa traversée, on ne s'engage plus. */
export const FEU_DEGAGEMENT = 1;
export const FEU_ROUGE = 2;

export interface EtatPassage {
  /** FEU_VERT | FEU_DEGAGEMENT | FEU_ROUGE. */
  etat: number;
  /** Secondes de SIMULATION restantes dans cet état (Infinity si inconnu). */
  restant: number;
}

/**
 * Service « feux » attendu de la circulation (`ctx.provide('feux', service)`).
 * Identifiants : ceux du réseau routier (`RoadNetwork`) — `nodeId` = carrefour, `segId` = tronçon du bras traversé.
 */
export interface FeuxService {
  /** Incrémenté quand l'ensemble des carrefours régulés change (facultatif). */
  readonly version?: number;
  /**
   * Feu piéton du passage qui traverse le bras `segId` au carrefour `nodeId`.
   * `null` / `undefined` : passage non régulé (pas de feu) → traversée prudente.
   */
  passage(nodeId: number, segId: number): EtatPassage | null | undefined;
}

/** Service « trafic » facultatif (`ctx.provide('trafic', service)`) : créneaux pour les traversées sans feu. */
export interface TraficService {
  /**
   * Secondes avant qu'un véhicule n'atteigne la traversée du tronçon `segId` à l'abscisse `s` (m depuis
   * l'extrémité a), tous sens confondus ; Infinity si la voie est libre.
   */
  creneau(segId: number, s: number): number;
}

/** Port interne des feux : écrit l'état dans `out` et renvoie true si le passage est régulé. */
export interface FeuxPort {
  passage(nodeId: number, segId: number, out: EtatPassage): boolean;
}

export interface TraficPort {
  creneau(segId: number, s: number): number;
}

const isFn = (v: unknown): v is (...args: never[]) => unknown => typeof v === 'function';

/** Adapte le service publié sous « feux » ; null s'il est absent ou n'a pas la forme attendue. */
export function adaptFeux(raw: unknown): FeuxPort | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const svc = raw as Partial<FeuxService>;
  if (!isFn(svc.passage)) return null;
  return {
    passage(nodeId, segId, out) {
      let r: EtatPassage | null | undefined;
      try { r = svc.passage!(nodeId, segId); } catch { return false; }
      if (typeof r !== 'object' || r === null) return false;
      const etat = r.etat;
      if (etat !== FEU_VERT && etat !== FEU_DEGAGEMENT && etat !== FEU_ROUGE) return false;
      out.etat = etat;
      out.restant = typeof r.restant === 'number' && r.restant >= 0 ? r.restant : Infinity;
      return true;
    },
  };
}

/** Adapte le service publié sous « trafic » ; null s'il est absent ou invalide. */
export function adaptTrafic(raw: unknown): TraficPort | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const svc = raw as Partial<TraficService>;
  if (!isFn(svc.creneau)) return null;
  return {
    creneau(segId, s) {
      let t: number;
      try { t = svc.creneau!(segId, s); } catch { return Infinity; }
      return typeof t === 'number' && t >= 0 ? t : Infinity;
    },
  };
}

/** Service publié PAR les piétons (`ctx.provide('pietons', …)`) pour que les véhicules cèdent le passage. */
export interface PietonsService {
  /** Nombre de piétons dans la rue. */
  readonly count: number;
  /**
   * Occupation de la traversée du bras `segId` au carrefour `nodeId` (`nodeId` = -1 : traversées de pleine rue
   * du tronçon) : piétons engagés sur la chaussée et piétons qui attendent au bord.
   */
  passage(nodeId: number, segId: number): { engages: number; enAttente: number };
}
