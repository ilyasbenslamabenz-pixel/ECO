// Indicateurs du module énergie et environnement, formatés pour l'interface (définitions dans shared/sim/energyIndicators.ts).
import { ENERGY_INDICATORS, type EnergyIndicatorKind } from '../../../shared/sim/energyIndicators';
import { dec1, dec2, int, pct } from '../format';
import type { IndicatorDef } from './indicators';

/** Formatage d'une valeur selon sa nature. */
export function fmtKind(kind: EnergyIndicatorKind, v: number): string {
  switch (kind) {
    case 'share': return pct(v);
    case 'risk': return pct(v, 0);
    case 'tco2': return Math.abs(v) >= 1e6 ? `${dec1(v / 1e6)} Mt` : `${int(v / 1e3)} kt`;
    case 'mwh': return Math.abs(v) >= 1e6 ? `${dec1(v / 1e6)} TWh` : `${int(v / 1e3)} GWh`;
    case 'eurmwh': return `${int(v)} €/MWh`;
    case 'index': return dec2(v);
    case 'score': return `${dec1(v)}/100`;
    case 'gkwh': return `${int(v)} g/kWh`;
  }
}

export const ENERGY_IND: Record<string, IndicatorDef> = Object.fromEntries(
  Object.entries(ENERGY_INDICATORS).map(([k, d]) => [k, { label: d.label, unit: d.unit, period: d.period, def: d.def, good: d.good, fmt: (v: number) => fmtKind(d.kind, v) }]),
);
