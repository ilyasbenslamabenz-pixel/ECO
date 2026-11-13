/**
 * Spécifications des indicateurs standard (valeurs de départ ; un module peut en redéfinir une avant usage).
 * Échelles : pollutions et bruit 0..100 (indice), valeur foncière en crédits/m², couvertures 0..1,
 * criminalité 0..100, satisfaction 0..100.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import type { IndicatorSpec, StandardIndicatorId } from './types';

export const STANDARD_INDICATOR_SPECS: Readonly<Record<StandardIndicatorId, Readonly<IndicatorSpec>>> = {
  pollution_air: {
    id: 'pollution_air', nameFr: 'Pollution de l\'air', unit: 'indice', base: 0, min: 0, max: 100,
    diffusion: { rate: 0.2, decay: 0.02, steps: 2, every: 'hour', boundary: 'open' },
  },
  pollution_sol: {
    id: 'pollution_sol', nameFr: 'Pollution des sols', unit: 'indice', base: 0, min: 0, max: 100,
    diffusion: { rate: 0.02, decay: 0.002, steps: 1, every: 'day', boundary: 'closed' },
  },
  pollution_eau: {
    id: 'pollution_eau', nameFr: 'Pollution de l\'eau', unit: 'indice', base: 0, min: 0, max: 100,
    diffusion: { rate: 0.15, decay: 0.01, steps: 2, every: 'hour', boundary: 'open' },
  },
  bruit: {
    id: 'bruit', nameFr: 'Bruit', unit: 'dB(A) relatifs', base: 0, min: 0, max: 100,
    diffusion: { rate: 0.12, decay: 0.3, steps: 1, every: 'hour', boundary: 'open' },
  },
  valeur_fonciere: { id: 'valeur_fonciere', nameFr: 'Valeur foncière', unit: '¢/m²', base: 100, min: 0, max: 100_000 },
  couverture_sante: { id: 'couverture_sante', nameFr: 'Couverture santé', unit: 'part', base: 0, min: 0, max: 1 },
  couverture_education: { id: 'couverture_education', nameFr: 'Couverture éducation', unit: 'part', base: 0, min: 0, max: 1 },
  couverture_police: { id: 'couverture_police', nameFr: 'Couverture police', unit: 'part', base: 0, min: 0, max: 1 },
  couverture_incendie: { id: 'couverture_incendie', nameFr: 'Couverture incendie', unit: 'part', base: 0, min: 0, max: 1 },
  criminalite: {
    id: 'criminalite', nameFr: 'Criminalité', unit: 'indice', base: 0, min: 0, max: 100,
    diffusion: { rate: 0.05, decay: 0.01, steps: 1, every: 'day', boundary: 'open' },
  },
  satisfaction: { id: 'satisfaction', nameFr: 'Satisfaction', unit: 'indice', base: 50, min: 0, max: 100 },
};
