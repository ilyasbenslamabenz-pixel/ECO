/**
 * Demande de construction affichée par l'interface : UNE seule source et UNE seule échelle partout (barre du haut,
 * Population > Demande, tiroir Zones). Source : la demande du zonage (celle qui fait pousser les zones) dès que le
 * module l'envoie, sinon la demande de la démographie. Échelle −1..+1 affichée en pourcentage, ordre R C I B.
 */
import { zoningView } from '../client/zoning-view';
import type { DemandSector } from '../shared/protocol-ext/zonage';
import type { SimReport } from '../sim/sim-protocol';

/** Ordre d'affichage des secteurs (identique partout) : Résidentiel, Commerces, Industrie, Bureaux. */
export const DEMAND_ORDER: readonly DemandSector[] = ['R', 'C', 'I', 'B'];

/** Phrase d'explication commune. */
export const DEMAND_NOTE = 'Besoin de nouveaux bâtiments par secteur : au-dessus de zéro, les zones de ce secteur se remplissent ; en dessous, des bâtiments restent vides.';

export function cityDemand(r: SimReport | null): Record<DemandSector, number> | null {
  const z = zoningView.demand;
  if (z) return { R: z.R, C: z.C, I: z.I, B: z.B };
  if (!r) return null;
  const d = r.demography.demand;
  return { R: d.residential, C: d.commercial, I: d.industrial, B: d.office };
}

/** « +56 % », « −12 % ». */
export const demandPct = (v: number): string => {
  const x = Math.max(-1, Math.min(1, v));
  const n = Math.round(Math.abs(x) * 100);
  return `${n === 0 ? '' : x > 0 ? '+' : '−'}${n} %`;
};
