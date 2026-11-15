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
export const DEMAND_NOTE = 'Barre verte vers la droite : la ville en veut plus, zonez-en. Barre rouge vers la gauche : il y en a déjà trop, des bâtiments restent vides, n\'en zonez plus pour l\'instant.';

const WHAT: Record<DemandSector, string> = { R: 'logements', C: 'commerces', I: 'industries', B: 'bureaux' };

/** Conseil en clair pour un secteur (ce que le joueur doit faire), d'après la demande −1..+1 et celle des logements. */
export function demandAdvice(s: DemandSector, v: number, residential: number): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const w = WHAT[s];
  if (v >= 0.5) return { text: `Forte demande : zonez des ${w}.`, tone: 'ok' };
  if (v >= 0.15) return { text: `Demande modérée : vous pouvez zoner quelques ${w}.`, tone: 'ok' };
  if (v > -0.15) return { text: 'Équilibré : rien à faire.', tone: 'muted' };
  if (s === 'R') return { text: v <= -0.5 ? 'Trop de logements vides : créez des emplois, des commerces et des services pour attirer des habitants.' : 'Assez de logements pour l\'instant.', tone: 'warn' };
  if (v <= -0.5 && residential > 0.15) return { text: `Trop de ${w} pour si peu d'habitants : n'en zonez plus, faites d'abord venir des habitants (zonez des logements).`, tone: 'warn' };
  return { text: v <= -0.5 ? `Trop de ${w} : des locaux restent vides, n'en zonez plus pour l'instant.` : `Assez de ${w} pour l'instant.`, tone: 'warn' };
}

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
