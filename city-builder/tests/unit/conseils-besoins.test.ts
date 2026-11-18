/**
 * « Ce qu'il faut faire » (src/ui/needs-advice.ts) : phrase chiffrée en tête des tableaux Énergie, Eau, Déchets.
 * Les chiffres viennent du bilan et des fiches techniques partagées ; le bouton ouvre la bonne famille.
 * Lancer : npx tsx --test tests/unit/conseils-besoins.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { powerAdvice, waterAdvice, wasteAdvice } from '../../src/ui/needs-advice';
import type { ElectriciteSummary } from '../../src/shared/power/types';
import type { WaterBalance } from '../../src/shared/water-network/types';
import type { WasteSummary } from '../../src/shared/waste/types';

const elec = (o: Partial<ElectriciteSummary>): ElectriciteSummary => ({
  at: 0, hour: 0, availableKw: 0, producedKw: 0, demandKw: 0, deliveredKw: 0, lossesKw: 0, shortfallKw: 0, unlinkedKw: 0, exportableKw: 0,
  windMs: 5, windSource: 'profil', sun: 0.5, bySource: [], byClass: [], buildings: 0, powered: 0, cut: 0, unlinked: 0,
  jobsWithoutPower: 0, residentsWithoutPower: 0, ...o,
} as ElectriciteSummary);
const plant = (o: Record<string, unknown> = {}) => ({ id: 1, kind: 'thermique', isolated: false, failedUntil: 0, siteOk: true, ...o }) as never;

test('énergie : rien du tout → raccordement chiffré, bouton Construire (Énergie)', () => {
  const a = powerAdvice(undefined, {});
  assert.equal(a.level, 'warn');
  assert.match(a.text, /60\s000 CHF/);
  assert.match(a.text, /3 MW/);
  assert.equal(a.action?.build, 'energy');
});

test('énergie : déficit sans source → « Il manque 125 kW », raccordement proposé', () => {
  const a = powerAdvice(elec({ buildings: 23, demandKw: 125, deliveredKw: 0, shortfallKw: 125, cut: 23 }), {});
  assert.equal(a.level, 'bad');
  assert.match(a.text, /Il manque 125 kW/);
  assert.match(a.text, /raccordez-vous/);
});

test('énergie : gros déficit déjà raccordé → nombre de centrales thermiques (60 MW) et d’éoliennes', () => {
  const a = powerAdvice(elec({ buildings: 400, demandKw: 20_000, deliveredKw: 9_000, shortfallKw: 11_000, cut: 120 }), { facilities: [plant()], settings: { raccordement: true } as never });
  assert.match(a.text, /Il manque 11 MW/);
  assert.match(a.text, /une centrale thermique \(60 MW/);
  assert.match(a.text, /≈ 5 éoliennes/);
});

test('énergie : installation isolée → bouton Routes', () => {
  const a = powerAdvice(elec({ buildings: 5, demandKw: 50 }), { facilities: [plant({ isolated: true })] });
  assert.equal(a.level, 'bad');
  assert.equal(a.action?.build, 'road');
});

test('énergie : marge faible puis confortable', () => {
  const low = powerAdvice(elec({ buildings: 50, demandKw: 1000, deliveredKw: 1000, availableKw: 1080 }), { facilities: [plant()] });
  assert.equal(low.level, 'warn');
  assert.match(low.text, /marge est faible \(80 kW, 8 %/);
  const ok = powerAdvice(elec({ buildings: 50, demandKw: 1000, deliveredKw: 1000, availableKw: 5000 }), { facilities: [plant()] });
  assert.equal(ok.level, 'ok');
  assert.equal(ok.action, undefined);
});

const bal = (o: Partial<WaterBalance>): WaterBalance => ({
  at: 0, pumped: 0, treated: 0, production: 0, demand: 0, delivered: 0, stock: 0, storage: 0, quality: 1, servedShare: 1,
  buildings: 0, served: 0, unserved: 0, pressure: 0, sewage: 0, sewageTreated: 0, sewageRaw: 0, sewageOverflow: 0, ...o,
} as WaterBalance);

test('eau : pas de service → raccordement 40 m³/h et pompage 160 m³/h', () => {
  const a = waterAdvice(undefined, false);
  assert.match(a.text, /40 m³\/h/);
  assert.match(a.text, /160 m³\/h/);
  assert.equal(a.action?.build, 'water');
});

test('eau : production insuffisante → nombre de stations de pompage', () => {
  const a = waterAdvice(bal({ production: 100, demand: 420, delivered: 100, buildings: 60, served: 15, unserved: 45 }), true);
  assert.equal(a.level, 'bad');
  assert.match(a.text, /Il manque 320 m³\/h/);
  assert.match(a.text, /2 stations de pompage/);
});

test('eau : production suffisante mais bâtiments non desservis → canalisations / château d’eau', () => {
  const a = waterAdvice(bal({ production: 500, demand: 300, delivered: 300, buildings: 60, served: 55, unserved: 5 }), true);
  assert.equal(a.level, 'warn');
  assert.match(a.text, /5 bâtiments sans eau suffisante/);
});

test('eau : eaux usées brutes → stations d’épuration ; puis tout va bien', () => {
  const a = waterAdvice(bal({ production: 500, demand: 300, delivered: 300, buildings: 60, served: 60, sewage: 250, sewageRaw: 250 }), true);
  assert.match(a.text, /250 m³\/h d'eaux usées/);
  assert.match(a.text, /2 stations d'épuration/);
  const ok = waterAdvice(bal({ production: 500, demand: 300, delivered: 300, buildings: 60, served: 60, sewage: 250, sewageTreated: 250 }), true);
  assert.equal(ok.level, 'ok');
  assert.match(ok.text, /60 \/ 60 bâtiments desservis/);
});

const waste = (o: Partial<WasteSummary>): WasteSummary => ({ blocked: null, overflowingBuildings: 0, producers: 0, diagnostics: [], ...o } as WasteSummary);

test('déchets : collecte arrêtée, hors de portée, débordements, tout va bien', () => {
  assert.match(wasteAdvice(waste({ blocked: 'Aucun dépôt de camions-bennes relié à la route' })).text, /^Collecte arrêtée : Aucun dépôt/);
  const far = wasteAdvice(waste({ unservedProducers: 4 }));
  assert.equal(far.action?.build, 'road');
  const over = wasteAdvice(waste({ overflowingBuildings: 7, diagnostics: [{ level: 'warn', text: 'Bacs pleins', fix: 'Fréquence de collecte : passez à 5 / semaine' }] }));
  assert.match(over.text, /7 bâtiments avec des bacs qui débordent : Fréquence de collecte/);
  const ok = wasteAdvice(waste({ producers: 40 }));
  assert.equal(ok.level, 'ok');
});
