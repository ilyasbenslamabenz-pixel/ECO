/**
 * Interface « clarté » : étapes des Premiers pas (vérifiées d'après l'état de la ville) et lecture tolérante des
 * champs facultatifs de satisfaction (facteurs, logements vides, aide de croissance).
 * Lancer : npx tsx --test tests/unit/premiers-pas.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepDone, TUTO_STEPS, type CityFacts } from '../../src/ui/tutorial';
import { factorAdvice, growthHint, satisfactionFactors, vacancyReasons } from '../../src/ui/satisfaction';
import type { SimReport } from '../../src/sim/sim-protocol';

const facts = (o: Partial<CityFacts> = {}): CityFacts => ({ roads: 0, zones: { R: 0, C: 0, I: 0 }, tags: new Set(), ...o });
const firstOpen = (f: CityFacts): string | null => TUTO_STEPS.find((s) => !stepDone(s, f))?.id ?? null;

test('Premiers pas : ordre route → zones → électricité → eau → déchets → école → services', () => {
  assert.deepEqual(TUTO_STEPS.map((s) => s.id), ['roads', 'zones', 'power', 'water', 'waste', 'school', 'safety']);
  assert.equal(firstOpen(facts()), 'roads');
  assert.equal(firstOpen(facts({ roads: 3, zones: { R: 10, C: 0, I: 4 } })), 'zones');
  const tags = new Set(['elec:centrale:solaire', 'service:eau', 'dechets:depot']);
  assert.equal(firstOpen(facts({ roads: 3, zones: { R: 1, C: 1, I: 1 }, tags })), 'waste', 'dépôt seul : la décharge manque');
  tags.add('dechets:incinerateur'); tags.add('service:education'); tags.add('service:sante'); tags.add('service:police');
  assert.equal(firstOpen(facts({ roads: 3, zones: { R: 1, C: 1, I: 1 }, tags })), 'safety');
  tags.add('service:incendie');
  assert.equal(firstOpen(facts({ roads: 3, zones: { R: 1, C: 1, I: 1 }, tags })), null);
  for (const s of TUTO_STEPS) { assert.ok(s.targets.length > 0, `${s.id} : bouton ciblé`); assert.ok(!/phase/i.test(s.text + s.title)); }
});

test('Satisfaction : champs absents → sections masquées ; présents → triés et expliqués', () => {
  const base = { demography: {} } as unknown as SimReport;
  assert.equal(satisfactionFactors(base), null);
  assert.equal(vacancyReasons(base), null);
  assert.equal(growthHint(base), null);
  const r = { demography: {
    satisfactionFactors: [{ key: 'jobs', label: 'Emplois', delta: 5 }, { key: 'water', label: 'Eau', delta: -18 }, { key: 'x', label: 'Bad', delta: Number.NaN }],
    vacancyReasons: { water: 316, power: 0, road: 12 },
    growthHint: 'need-roads',
  } } as unknown as SimReport;
  const f = satisfactionFactors(r)!;
  assert.deepEqual(f.map((x) => x.key), ['water', 'jobs']);
  assert.match(factorAdvice(f[0]!) ?? '', /pompage/);
  assert.deepEqual(vacancyReasons(r), [{ label: 'sans eau', count: 316 }, { label: 'sans accès routier', count: 12 }]);
  assert.equal(growthHint(r), 'need-roads');
  const list = { demography: { vacancyReasons: [{ key: 'power', count: 4 }, { reason: 'other', label: 'Trop cher', value: 9 }] } } as unknown as SimReport;
  assert.deepEqual(vacancyReasons(list), [{ label: 'Trop cher', count: 9 }, { label: 'sans électricité', count: 4 }]);
});

test('Satisfaction : forme du rapport de démographie (raisons en camelCase, besoin de zones)', () => {
  const r = { demography: { housingFree: 316, vacancyReasons: { sansAcces: 0, sansEau: 12, sansElectricite: 3, demandeFaible: 1 }, growthHint: 'need-zones',
    satisfactionFactors: [{ key: 'logement', label: 'Accès routier', delta: -4 }, { key: 'pollution', label: 'Pollution', delta: 0 }] } } as unknown as SimReport;
  assert.deepEqual(vacancyReasons(r)?.map((v) => v.label), ['sans eau', 'sans électricité', 'demande faible']);
  assert.equal(growthHint(r), 'need-zones');
  assert.match(factorAdvice(satisfactionFactors(r)![0]!) ?? '', /route/);
});
