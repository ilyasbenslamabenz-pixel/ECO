/**
 * Ressources (zones spécialisées) — formules PURES et réglages : terrain admissible, repousse de la forêt,
 * rendements, consommation de la ville, demande des zones forêt / agricole. Documentation : docs/ZONAGE.md §8.
 * Mécaniques inspirées des city-builders modernes (industries spécialisées liées à une ressource du terrain) ;
 * formules et valeurs propres au jeu.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export interface RessourcesTuning {
  /** Densité forestière minimale (0..1) d'une case pour y peindre une zone forestière. */
  foretMin: number;
  /** Fertilité minimale (0..1) d'une case pour y peindre une zone agricole ; pente maximale (dénivelé / m). */
  fertiliteMin: number;
  penteMaxAgricole: number;
  /** Repousse logistique par jour (part du stock) et semis minimal par jour (part de la capacité). */
  repousse: number;
  semis: number;
  /** Coupe maximale par case et par jour (part de la capacité), rayon de coupe autour d'une exploitation (m). */
  coupeMaxCase: number;
  rayonCoupe: number;
  /** Bois (m³) d'une case de 8 m pleinement boisée ; stock coupé par employé et par jour (en cases). */
  boisParCase: number;
  coupeParEmploye: number;
  /** Stock sous lequel une case est « déboisée » (part de la capacité) ; au-dessus duquel elle a « repoussé ». */
  seuilDeboise: number;
  seuilRepousse: number;
  /** Nourriture (t) par employé agricole et par jour, à fertilité 1, champs complets, en été. */
  nourritureParEmploye: number;
  /** Rayon des champs d'une ferme (m) ; cases zonées libres pour des champs complets. */
  rayonChamps: number;
  champsPleins: number;
  /** Consommation : bois (m³ / jour) par emploi industriel et par habitant ; nourriture (t / jour) par habitant. */
  boisParEmploiIndustriel: number;
  boisParHabitant: number;
  nourritureParHabitant: number;
  /** Prix à l'export (CHF par m³ de bois, par t de nourriture) ; part reversée à la ville = taux industriel × partFiscale. */
  prixBois: number;
  prixNourriture: number;
  partFiscale: number;
  /** Lissage quotidien de la demande des zones spécialisées. */
  lissage: number;
}

export const DEFAULT_RESSOURCES_TUNING: Readonly<RessourcesTuning> = Object.freeze({
  foretMin: 0.25,
  fertiliteMin: 0.35,
  penteMaxAgricole: 0.12,
  repousse: 0.03,
  semis: 0.002,
  coupeMaxCase: 0.06,
  rayonCoupe: 72,
  boisParCase: 25,
  coupeParEmploye: 0.02,
  seuilDeboise: 0.15,
  seuilRepousse: 0.6,
  nourritureParEmploye: 0.35,
  rayonChamps: 56,
  champsPleins: 12,
  boisParEmploiIndustriel: 0.02,
  boisParHabitant: 0.002,
  nourritureParHabitant: 0.0015,
  prixBois: 70,
  prixNourriture: 420,
  partFiscale: 2.5,
  lissage: 0.3,
});

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/**
 * Fertilité d'un point (0..1) : terre fertile du générateur = 1 ; sinon humidité (0,2 → 0, 0,7 → 1) ; pénalité de
 * pente (0 au-delà de `penteMax`). Sol mouillé : 0.
 */
export function fertilityValue(fertileSoil: boolean, moisture01: number, slope: number, wet: boolean, penteMax = DEFAULT_RESSOURCES_TUNING.penteMaxAgricole): number {
  if (wet) return 0;
  const base = fertileSoil ? 1 : clamp01((moisture01 - 0.2) / 0.5);
  const flat = clamp01(1 - slope / Math.max(1e-6, penteMax));
  return clamp01(base * flat);
}

/** Facteur saisonnier des récoltes. */
export function seasonYield(season: string): number {
  switch (season) {
    case 'printemps': return 0.8;
    case 'ete': return 1.2;
    case 'automne': return 1;
    case 'hiver': return 0.3;
    default: return 1;
  }
}

/** Repousse d'une case en un jour : logistique + semis, bornée par la capacité `k`. */
export function regrow(stock: number, k: number, t: Readonly<RessourcesTuning> = DEFAULT_RESSOURCES_TUNING): number {
  if (k <= 0) return 0;
  const s = Math.max(0, stock);
  return Math.min(k, s + t.repousse * s * (1 - s / k) + t.semis * k);
}

/**
 * Demande brute (−1..1) d'une zone de ressource : demande industrielle de la ville, plus le manque local
 * (consommation non couverte), moins un excédent très supérieur à la consommation. Toujours un peu positive
 * tant que la production est faible : les surplus s'exportent.
 */
export function resourceDemand(industryDemand: number, production: number, consumption: number): number {
  const gap = (consumption - production) / Math.max(1, consumption, production * 0.5);
  return Math.max(-1, Math.min(1, 0.15 + 0.4 * industryDemand + 0.6 * gap));
}
