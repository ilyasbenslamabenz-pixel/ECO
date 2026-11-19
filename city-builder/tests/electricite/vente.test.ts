/**
 * Vente du surplus d'électricité aux villes voisines (docs/ELECTRICITE.md, « Vente d'électricité ») : surplus éolien
 * et solaire vendu chaque heure si la ville est reliée (raccordement ou connexion extérieure par route), recette à
 * la trésorerie (poste détaillé du bilan), batteries chargées d'abord, option du joueur, notification unique.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_SPEC, IMPORT_SPEC, TARIFF_CENTS_PER_KWH, clampExportPrice, exportDemandShare } from '../../src/shared/power/model';
import type { SimPlugin } from '../../src/sim/plugins';
import { createElectricitePlugin } from '../../src/sim/plugins/electricite';
import { migrateElectricite } from '../../src/sim/save-sections/electricite';
import { Simulation } from '../../src/sim/world';
import { advanceHours, advanceToHour, placeFacilities, powerCatalog, powerTown, type PowerTown } from './fixtures';

interface Scene extends PowerTown { weather: { wind: number; cloud: number } }

/** Bourg + 7 éoliennes + 3 fermes solaires (+ batteries) ; `link` : raccordement au réseau voisin ; `road` : fausse connexion par route reliée. */
function scene(opts: { battery?: boolean; link?: boolean; road?: boolean } = {}): Scene {
  const weather = { wind: 8, cloud: 0 };
  const meteo: SimPlugin = { id: 'weather', init(ctx) { ctx.provide('weather', weather); } };
  const extra: SimPlugin[] = opts.road ? [{ id: 'connexions', init(ctx) { ctx.provide('connexions', { system: { linkedCount: 1 } }); } }] : [];
  const t = powerTown({ days: 2, plugins: (e) => [meteo, ...extra, e] });
  placeFacilities(t.sim, 160, -200, 400, Array<string>(7).fill('eolienne'));
  placeFacilities(t.sim, 230, -200, 200, ['ferme_solaire', 'ferme_solaire', 'ferme_solaire', ...(opts.battery ? ['batteries'] : [])]);
  if (opts.link) assert.ok(t.sim.plugins.command('electricite', 'raccordement', { on: true }).ok);
  return { ...t, weather };
}

const exportLine = (sim: Simulation): number => sim.economy.currentServiceLines()['vente_electricite_exterieure'] ?? 0;
const firstSaleNotices = (sim: Simulation): number => sim.notices.filter((n) => n.message.startsWith('Première vente d\'électricité')).length;

test('prix : défaut moins cher que l\'achat au voisin ; part achetée par les voisins selon le prix choisi', () => {
  assert.ok(EXPORT_SPEC.priceCentsPerKwh < IMPORT_SPEC.priceCentsPerKwh);
  assert.ok(EXPORT_SPEC.priceCentsPerKwh < TARIFF_CENTS_PER_KWH);
  assert.equal(exportDemandShare(EXPORT_SPEC.refPrice), 1);
  assert.equal(exportDemandShare(EXPORT_SPEC.maxPrice), 0);
  assert.ok(exportDemandShare(8) > 0 && exportDemandShare(8) < 1);
  assert.equal(clampExportPrice(99), EXPORT_SPEC.maxPrice);
  assert.equal(clampExportPrice(undefined), EXPORT_SPEC.priceCentsPerKwh);
});

test('surplus vendu (raccordement) : la trésorerie augmente exactement de la recette, poste détaillé, notification unique', () => {
  const a = scene({ link: true });
  const b = scene({ link: true });
  assert.ok(b.sim.plugins.command('electricite', 'vente', { on: false }).ok);
  advanceToHour(a.sim, 12); advanceToHour(b.sim, 12);
  const m0 = a.sim.economy.money - b.sim.economy.money;
  const inc0 = a.elec.system.state.month.exportIncome ?? 0;
  advanceHours(a.sim, 4); advanceHours(b.sim, 4);
  const s = a.elec.system.summary()!;
  assert.ok((s.exportedKw ?? 0) > 0, `vendu ${s.exportedKw} kW`);
  assert.equal(s.importedKw, 0, 'rien acheté');
  const income = ((a.elec.system.state.month.exportIncome ?? 0) - inc0) / 100;
  assert.ok(income > 0);
  const gain = a.sim.economy.money - b.sim.economy.money - m0;
  assert.ok(Math.abs(gain - income) < 0.01, `trésorerie +${gain.toFixed(2)} CHF, recette ${income.toFixed(2)} CHF`);
  assert.ok(exportLine(a.sim) > 0, 'poste « vente_electricite_exterieure » du bilan');
  assert.equal(exportLine(b.sim), 0);
  assert.equal(firstSaleNotices(a.sim), 1, 'notification à la première vente seulement');
  const bud = a.elec.system.budget();
  assert.ok((bud.monthExportIncome ?? 0) > 0 && (bud.monthExportedKwh ?? 0) > 0, 'ligne du panneau Énergie');
  assert.equal(b.elec.system.summary()!.exportedKw, 0, 'option désactivée : rien vendu');
  assert.equal(firstSaleNotices(b.sim), 0);
  // Clôture mensuelle : inscrite au grand livre (sans double paiement) et au bilan mensuel de l'économie.
  const muni = a.elec.municipal()!;
  advanceHours(a.sim, 24 * 31);
  assert.ok(a.sim.economy.history.some((h) => (h.serviceLines?.['vente_electricite_exterieure'] ?? 0) > 0), 'bilan financier : vente d\'électricité');
  assert.ok(muni.budget.history.some((h) => JSON.stringify(h).includes('vente:electricite_exterieure')), 'grand livre municipal');
  assert.ok(a.elec.system.state.lastMonth.exportIncome! > 0);
  assert.equal(firstSaleNotices(a.sim), 1);
});

test('connexion extérieure par route reliée : vente sans raccordement', () => {
  const t = scene({ road: true });
  advanceToHour(t.sim, 12);
  advanceHours(t.sim, 2);
  const s = t.elec.system.summary()!;
  assert.equal(s.importedKw, undefined, 'pas de raccordement');
  assert.ok((s.exportedKw ?? 0) > 0);
  assert.ok(exportLine(t.sim) > 0);
});

test('sans raccordement ni route au bord : le surplus est vendu quand même, sans plafond', () => {
  const t = scene();
  advanceToHour(t.sim, 12);
  advanceHours(t.sim, 3);
  const s = t.elec.system.summary()!;
  assert.ok(s.exportableKw > 0, 'surplus présent');
  assert.ok((s.exportedKw ?? 0) > 0, `vendu ${s.exportedKw} kW`);
  assert.ok(Math.abs((s.exportedKw ?? 0) - (s.sellableKw ?? 0)) < 0.2, 'tout le surplus vendu (prix par défaut)');
  assert.ok(exportLine(t.sim) > 0);
});

test('prix de vente réglable : plus cher, recette par kWh plus haute et part vendue réduite au-delà du prix de référence', () => {
  const a = scene(), b = scene();
  assert.ok(b.sim.plugins.command('electricite', 'prixVente', { price: 9 }).ok);
  assert.equal(b.elec.system.exportPrice, 9);
  assert.ok(!b.sim.plugins.command('electricite', 'prixVente', { price: 'x' }).ok);
  advanceToHour(a.sim, 12); advanceToHour(b.sim, 12);
  advanceHours(a.sim, 2); advanceHours(b.sim, 2);
  const sa = a.elec.system.summary()!, sb = b.elec.system.summary()!;
  assert.ok((sb.exportedKw ?? 0) < (sa.exportedKw ?? 0), 'moins vendu à 9 ct');
  assert.ok((b.elec.system.state.month.exportIncome ?? 0) > (a.elec.system.state.month.exportIncome ?? 0), 'mais recette plus haute');
});

test('pas de surplus (nuit sans vent) : rien n\'est vendu', () => {
  const t = scene({ link: true });
  t.weather.wind = 1.9;
  advanceToHour(t.sim, 2);
  const inc = t.elec.system.state.month.exportIncome ?? 0;
  advanceHours(t.sim, 2);
  const s = t.elec.system.summary()!;
  assert.equal(s.availableKw, 0);
  assert.equal(s.exportedKw, 0);
  assert.equal(t.elec.system.state.month.exportIncome ?? 0, inc);
});

test('batteries chargées avant la vente : le surplus vendu est diminué de la recharge', () => {
  const a = scene({ link: true });
  const b = scene({ link: true, battery: true });
  advanceToHour(a.sim, 12); advanceToHour(b.sim, 12);
  // Batteries vidées (comme au sortir d'une nuit sans vent) : elles doivent se recharger avant toute vente.
  for (const f of b.elec.system.facilityList()) if (f.kind === 'batterie') b.elec.system.state.facilities[String(f.id)]!.storedKwh = 0;
  advanceHours(a.sim, 1); advanceHours(b.sim, 1);
  const sa = a.elec.system.summary()!, sb = b.elec.system.summary()!;
  const charge = sb.storage!.chargeKw;
  assert.ok(charge > 0, `recharge ${charge} kW`);
  assert.ok((sb.exportedKw ?? 0) > 0);
  assert.ok(Math.abs((sa.exportedKw! - sb.exportedKw!) - charge) < 1, `sans batterie ${sa.exportedKw} kW, avec ${sb.exportedKw} kW, recharge ${charge} kW`);
  // Plus tard (batteries presque pleines) : la vente reste diminuée exactement de la recharge, puis plus du tout.
  for (let h = 0; h < 8; h++) {
    advanceHours(b.sim, 1); advanceHours(a.sim, 1);
    const x = a.elec.system.summary()!, y = b.elec.system.summary()!;
    assert.ok(Math.abs((x.exportedKw! - y.exportedKw!) - y.storage!.chargeKw) < 1, `heure ${h} : ${x.exportedKw} / ${y.exportedKw} / recharge ${y.storage!.chargeKw}`);
  }
  assert.equal(b.elec.system.summary()!.storage!.chargeKw, 0, 'batteries pleines : plus de recharge, tout le surplus est vendu');
});

test('sauvegarde : option et notification conservées ; ancienne section (sans champs de vente) lisible', () => {
  const t = scene({ link: true });
  advanceToHour(t.sim, 12);
  advanceHours(t.sim, 1);
  assert.ok(t.sim.plugins.command('electricite', 'vente', { on: false }).ok);
  const save = JSON.parse(JSON.stringify(t.sim.toSave())) as ReturnType<Simulation['toSave']>;
  const data = save.plugins!.electricite!.data as { power: Record<string, unknown> };
  assert.equal((data.power.settings as Record<string, unknown>).vente, false);
  assert.equal(data.power.exportNotified, true);
  const e2 = createElectricitePlugin();
  const s2 = new Simulation([{ id: 'weather', init(ctx) { ctx.provide('weather', { wind: 8, cloud: 0 }); } }, e2]);
  s2.setCatalog(powerCatalog());
  assert.equal(s2.fromSave(save), null);
  assert.equal(e2.system.exportOn, false);
  assert.equal(e2.system.state.exportNotified, true);
  // Ancien format : ni `vente`, ni `exportNotified`, ni cumuls de vente → vente activée par défaut.
  const old = JSON.parse(JSON.stringify(data)) as { power: Record<string, Record<string, unknown>> };
  delete old.power.settings!.vente; delete old.power.exportNotified;
  delete old.power.month!.exportedKwh; delete old.power.month!.exportIncome; delete old.power.lastMonth!.exportIncome;
  const m = migrateElectricite(old, 1);
  assert.equal(m.power!.settings.vente, undefined);
  assert.equal(m.power!.exportNotified, undefined);
});

test('centrale au gaz : sa capacité inutilisée n\'est vendue que si le prix couvre le gaz (jamais de vente à perte)', () => {
  const t = powerTown({ days: 2 });
  placeFacilities(t.sim, 160, -200, 300, ['centrale_gaz']);
  assert.ok(t.sim.plugins.command('electricite', 'raccordement', { on: false }).ok);
  advanceToHour(t.sim, 12);
  // Prix par défaut (1,5 ct) sous le coût du gaz (2 ct) : rien de thermique n'est vendu, aucune perte.
  const l0 = exportLine(t.sim);
  advanceHours(t.sim, 6);
  assert.ok(exportLine(t.sim) - l0 >= 0, `vente au prix par défaut : ${(exportLine(t.sim) - l0).toFixed(2)} CHF`);
  assert.equal(t.elec.system.summary()!.exportedKw ?? 0, 0);
  // Prix au-dessus du gaz : la capacité inutilisée est vendue, avec une recette positive.
  assert.ok(t.sim.plugins.command('electricite', 'prixVente', { price: 4 }).ok);
  const l1 = exportLine(t.sim);
  advanceHours(t.sim, 6);
  assert.ok((t.elec.system.summary()!.exportedKw ?? 0) > 0, 'capacité thermique vendue');
  assert.ok(exportLine(t.sim) - l1 > 0, 'recette positive');
});
