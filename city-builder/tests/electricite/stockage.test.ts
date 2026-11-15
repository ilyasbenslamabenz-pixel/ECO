/**
 * Batteries de stockage, raccordement au réseau voisin et conseil « réseau seulement intermittent ».
 * Scénario du joueur : 7 éoliennes + 3 fermes solaires, aucune centrale pilotable, nuit sans vent (1,9 m/s).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AssetCatalog } from '../../src/shared/catalog';
import { MILESTONES } from '../../src/shared/milestones';
import {
  BATTERY_ONE_WAY, BATTERY_SPEC, batteryStep, capacityKwhOf, facilityKindOf, nominalKwOf, windPowerShare, windProfile,
} from '../../src/shared/power/model';
import { createElectricitePlugin } from '../../src/sim/plugins/electricite';
import type { SimPlugin } from '../../src/sim/plugins';
import { migrateElectricite } from '../../src/sim/save-sections/electricite';
import { INTERMITTENT_ADVICE } from '../../src/sim/power/system';
import { Simulation } from '../../src/sim/world';
import { advanceHours, advanceToHour, placeFacilities, powerCatalog, powerTown, type PowerTown } from './fixtures';

/* --------------------------------- Modèle --------------------------------- */

test('batteries : rendement aller-retour 85 %, bornes de capacité, étiquettes du catalogue', () => {
  // 1 000 kWh pris au réseau -> ≈ 922 kWh stockés -> ≈ 850 kWh restitués.
  const stored = batteryStep(0, 10_000, 1_000);
  assert.ok(Math.abs(stored - 1_000 * BATTERY_ONE_WAY) < 1e-9);
  const restituable = stored * BATTERY_ONE_WAY;
  assert.ok(Math.abs(restituable - 850) < 1e-6, `restitué ${restituable}`);
  assert.equal(batteryStep(stored, 10_000, -restituable), 0);
  assert.equal(batteryStep(9_900, 10_000, 1_000), 10_000, 'plafonnée à la capacité');
  assert.equal(batteryStep(10, 10_000, -1_000), 0, 'jamais négative');
  assert.equal(BATTERY_SPEC.roundTrip, 0.85);
  const tags = { tags: ['elec:batterie', 'elec:kw:1500', 'elec:kwh:6000'] };
  assert.equal(facilityKindOf(tags), 'batterie');
  assert.equal(nominalKwOf(tags, 'batterie'), 1_500);
  assert.equal(capacityKwhOf(tags), 6_000);
  assert.equal(capacityKwhOf({ tags: ['elec:batterie'] }), BATTERY_SPEC.capacityKwh);
});

test('catalogue : « Batteries de stockage » dans l\'onglet Énergie, dès le début, modèle du poste réutilisé', () => {
  const cat = JSON.parse(readFileSync(new URL('../../assets/catalog.json', import.meta.url), 'utf8')) as AssetCatalog;
  const b = cat.assets.find((a) => a.id === 'elec_batteries');
  assert.ok(b, 'elec_batteries au catalogue');
  const poste = cat.assets.find((a) => a.id === 'elec_poste')!;
  assert.equal(b.nameFr, 'Batteries de stockage');
  assert.equal(b.category, 'industrial'); // onglet Énergie : modèles industriels `elec_*`
  assert.equal(facilityKindOf(b), 'batterie');
  assert.ok(b.tags.includes('reutilise:elec_poste'));
  assert.deepEqual(b.lods.map((l) => l.file), poste.lods.map((l) => l.file));
  assert.ok(b.variants.length >= 3);
  assert.ok(b.cost > 0 && b.cost < poste.cost * 4 && b.upkeepPerMonth > 0);
  const locked = MILESTONES.flatMap((m) => m.unlocks).some((u) => u.kind === 'asset' && u.ids.includes('elec_batteries'));
  assert.equal(locked, false, 'disponible dès le début (aucun palier)');
});

test('profil de vent : facteur de charge annuel des éoliennes dans l\'ordre de grandeur terrestre (20 à 35 %)', () => {
  const YEAR = 360 * 1440;
  for (const seed of [0, 42, 1234]) {
    let cf = 0, zero = 0, n = 0, v = 0;
    for (let m = 0; m < YEAR; m += 60) { const w = windProfile(m, seed); const s = windPowerShare(w); cf += s; v += w; if (s === 0) zero++; n++; }
    assert.ok(Math.abs(v / n - 7) < 0.2, `vitesse moyenne ${(v / n).toFixed(2)} m/s`);
    assert.ok(cf / n >= 0.2 && cf / n <= 0.35, `facteur de charge ${(100 * cf / n).toFixed(1)} %`);
    assert.ok(zero / n > 0.03 && zero / n < 0.12, `heures à 0 : ${(100 * zero / n).toFixed(1)} %`);
  }
});

/* -------------------------------- Scénario -------------------------------- */

interface Scene extends PowerTown { weather: { wind: number; cloud: number }; battery?: number }

/** Bourg + 7 éoliennes + 3 fermes solaires (et des batteries), météo pilotée par le test. */
function scene(opts: { battery?: boolean } = {}): Scene {
  const weather = { wind: 8, cloud: 0 };
  const meteo: SimPlugin = { id: 'weather', init(ctx) { ctx.provide('weather', weather); } };
  const t = powerTown({ days: 2, plugins: (e) => [meteo, e] });
  placeFacilities(t.sim, 160, -200, 200, Array<string>(7).fill('eolienne'));
  const row = placeFacilities(t.sim, 230, -200, 200, ['ferme_solaire', 'ferme_solaire', 'ferme_solaire', ...(opts.battery ? ['batteries'] : [])]);
  return { ...t, weather, ...(opts.battery ? { battery: row[3]! } : {}) };
}

const adviceCount = (sim: Simulation): number => sim.notices.filter((n) => n.message === INTERMITTENT_ADVICE).length;

test('scénario : 7 éoliennes + 3 fermes solaires, nuit sans vent, sans batterie -> coupure et conseil donné une seule fois', () => {
  const { sim, elec, weather } = scene();
  advanceHours(sim, 3);
  weather.wind = 1.9;
  advanceToHour(sim, 3);
  advanceHours(sim, 1);
  const s = elec.system.summary()!;
  assert.equal(s.windMs, 1.9);
  assert.equal(s.sun, 0, 'nuit');
  assert.equal(s.availableKw, 0);
  assert.equal(s.producedKw, 0);
  assert.ok(s.cut > 0 && s.shortfallKw > 0, `coupures : ${s.cut}`);
  assert.equal(s.intermittentOnly, true);
  assert.equal(s.storage, undefined);
  assert.equal(adviceCount(sim), 1, 'conseil envoyé à la première coupure faute de vent ou de soleil');
  assert.ok(elec.system.state.events.some((e) => e.message === INTERMITTENT_ADVICE), 'conseil au journal du panneau');
  // Journées suivantes (vent revenu le jour, calme la nuit) : pas de répétition.
  for (let d = 0; d < 2; d++) { weather.wind = 8; advanceToHour(sim, 13); weather.wind = 1.9; advanceToHour(sim, 3); advanceHours(sim, 1); }
  assert.ok(elec.system.summary()!.cut > 0);
  assert.equal(adviceCount(sim), 1, 'pas de conseil en boucle');
  // Les messages de pénurie suivants proposent les bonnes solutions.
  const later = sim.notices.filter((n) => n.message.startsWith('Pénurie électrique'));
  assert.ok(later.length >= 1 && later.every((n) => n.message.includes('réseau voisin')), later.map((n) => n.message).join(' | '));
});

test('scénario : avec des batteries chargées le jour, l\'alimentation est maintenue la nuit sans vent pendant plusieurs heures', () => {
  const { sim, elec, weather, battery } = scene({ battery: true });
  advanceHours(sim, 30); // vent 8 m/s et soleil : le surplus charge les batteries
  let s = elec.system.summary()!;
  assert.ok(s.storage, 'bilan des batteries');
  assert.ok(s.storage.storedKwh >= 0.95 * s.storage.capacityKwh, `charge ${s.storage.storedKwh} / ${s.storage.capacityKwh} kWh`);
  assert.equal(s.intermittentOnly, undefined, 'réseau avec stockage : pas « seulement intermittent »');
  advanceToHour(sim, 23);
  weather.wind = 1.9;
  const N = 7;
  let prev = Infinity;
  for (let h = 0; h < N; h++) {
    advanceHours(sim, 1);
    s = elec.system.summary()!;
    assert.equal(s.availableKw, 0, 'ni vent ni soleil');
    assert.equal(s.cut, 0, `heure ${h} : aucune coupure`);
    assert.ok(s.storage!.dischargeKw > 0 && s.storage!.storedKwh < prev, `heure ${h} : décharge ${s.storage!.dischargeKw} kW`);
    assert.ok(s.storage!.autonomyH > 0);
    prev = s.storage!.storedKwh;
  }
  assert.equal(adviceCount(sim), 0, 'aucun conseil : le réseau a des batteries');
  const v = elec.system.full().facilities!.find((f) => f.id === battery)!;
  assert.equal(v.kind, 'batterie');
  assert.ok((v.storageKw ?? 0) < 0 && (v.storedKwh ?? 0) > 0 && v.capacityKwh === 6_000);
  // Niveau de charge sauvegardé : même évolution après rechargement.
  const save = JSON.parse(JSON.stringify(sim.toSave())) as ReturnType<Simulation['toSave']>;
  const e2 = createElectricitePlugin();
  const w2 = { wind: 1.9, cloud: 0 };
  const t = new Simulation([{ id: 'weather', init(ctx) { ctx.provide('weather', w2); } }, e2]);
  t.setCatalog(powerCatalog());
  assert.equal(t.fromSave(save), null);
  assert.equal(e2.system.state.facilities[String(battery)]!.storedKwh, elec.system.state.facilities[String(battery)]!.storedKwh);
  advanceHours(sim, 2);
  advanceHours(t, 2);
  assert.deepEqual(e2.system.summary(), elec.system.summary());
});

test('scénario : avec le raccordement au réseau voisin, la ville reste alimentée la nuit sans vent', () => {
  const { sim, elec, weather } = scene();
  const r = sim.plugins.command('electricite', 'raccordement', { on: true });
  assert.ok(r.ok);
  weather.wind = 1.9;
  advanceToHour(sim, 3);
  advanceHours(sim, 1);
  const s = elec.system.summary()!;
  assert.equal(s.availableKw, 0);
  assert.equal(s.cut, 0, 'aucune coupure');
  assert.ok((s.importedKw ?? 0) > 0, `achat au réseau voisin : ${s.importedKw} kW`);
  assert.equal(s.intermittentOnly, undefined);
  assert.equal(adviceCount(sim), 0);
});

test('sauvegarde : une ancienne partie (sans batterie ni champ de stockage) se charge ; une batterie construite ensuite part de 0', () => {
  const { sim, elec } = powerTown({ days: 1 });
  placeFacilities(sim, 160, -100, 100, ['eolienne', 'eolienne', 'petite_centrale']);
  advanceHours(sim, 6);
  const save = JSON.parse(JSON.stringify(sim.toSave())) as ReturnType<Simulation['toSave']>;
  const data = save.plugins!.electricite!.data as { power: Record<string, unknown> };
  // Format d'avant les batteries : aucun champ `storedKwh`, `adviceAt`, `storage`.
  delete data.power.adviceAt;
  for (const f of Object.values(data.power.facilities as Record<string, Record<string, unknown>>)) delete f.storedKwh;
  assert.ok(!JSON.stringify(save.plugins!.electricite).includes('storedKwh'));
  assert.ok(migrateElectricite(data, 1).power, 'section v1 lisible');
  const e2 = createElectricitePlugin();
  const t = new Simulation([e2]);
  t.setCatalog(powerCatalog());
  assert.equal(t.fromSave(save), null);
  advanceHours(t, 1);
  advanceHours(sim, 1);
  assert.equal(e2.system.summary()!.storage, undefined, 'pas de batterie');
  assert.deepEqual(e2.system.summary(), elec.system.summary());
  const [bat] = placeFacilities(t, 230, -100, 100, ['batteries']);
  t.plugins.command('electricite', 'refresh', undefined);
  const st = e2.system.summary()!.storage!;
  assert.equal(st.count, 1);
  assert.equal(st.storedKwh, 0, 'batterie neuve vide');
  advanceToHour(t, 3); // nuit : la petite centrale a du surplus
  advanceHours(t, 2);
  assert.ok((e2.system.state.facilities[String(bat)]!.storedKwh ?? 0) > 0, 'chargée par le surplus');
});
