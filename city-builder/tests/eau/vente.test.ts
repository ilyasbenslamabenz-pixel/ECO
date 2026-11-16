/**
 * Vente du surplus d'eau potable aux villes voisines (docs/EAU.md) : capacité des usines non livrée ni stockée
 * vendue chaque heure si la ville est reliée (raccordement d'eau ou connexion extérieure par route), prix bas,
 * plafonnée, option du joueur, notification unique, sauvegarde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER_EXPORT, WATER_FACILITIES, WATER_IMPORT } from '../../src/shared/water-network/types';
import { SIM_PLUGINS, type SimPlugin } from '../../src/sim/plugins';
import type { Simulation } from '../../src/sim/world';
import { buildTown } from '../sim/fixtures';
import { eauPlugins, linkTown, newSim, place, runHours } from './helpers';

/** Bourg sec + pompage + usine ; `link` : raccordement d'eau ; `road` : fausse connexion par route reliée. */
function town(opts: { link?: boolean; road?: boolean; vente?: boolean } = {}) {
  const fakeRoad: SimPlugin = { id: 'connexions', init(ctx) { ctx.provide('connexions', { system: { linkedCount: 1 } }); } };
  // Modules de base sans le vrai module `connexions` (aucune route au bord de la carte dans ce bourg de toute façon).
  const base = SIM_PLUGINS.filter((p) => p.id !== 'eau' && p.id !== 'municipal' && p.id !== 'connexions');
  const { plugins, eau } = eauPlugins({ base: opts.road ? [...base, fakeRoad] : base });
  const s = newSim(plugins);
  buildTown(s);
  linkTown(s);
  place(s, 'eau_station_pompage', 120, 96, 2);
  place(s, 'eau_usine_potabilisation', 150, 100, 2);
  if (opts.link) assert.ok(s.plugins.command('eau', 'raccordement', { on: true }).ok);
  if (opts.vente === false) assert.ok(s.plugins.command('eau', 'settings', { vente: false }).ok);
  return { s, eau };
}

const line = (s: Simulation): number => s.economy.currentServiceLines()['vente_eau_exterieure'] ?? 0;
const notices = (s: Simulation): number => s.notices.filter((n) => n.message.startsWith('Première vente d\'eau')).length;

test('prix de l\'eau vendue : au-dessus du coût de production, sous le prix d\'achat au voisin', () => {
  const cost = WATER_FACILITIES.pompage.costPerM3 + WATER_FACILITIES.potabilisation.costPerM3;
  assert.ok(WATER_EXPORT.pricePerM3 > cost && WATER_EXPORT.pricePerM3 < WATER_IMPORT.pricePerM3);
  assert.ok(WATER_EXPORT.capacity > 0);
});

test('surplus d\'eau vendu (raccordement) : recette versée à la trésorerie, plafonnée, notification unique', () => {
  const a = town({ link: true });
  const b = town({ link: true, vente: false });
  runHours(a.s, 30); runHours(b.s, 30);
  const bal = a.eau.system.balance!;
  assert.ok((bal.exported ?? 0) > 0, `vendu ${bal.exported} m³/h`);
  assert.ok(bal.exported! <= WATER_EXPORT.capacity + 1e-9);
  assert.ok(bal.exported! <= (bal.sellable ?? 0) + 1e-9);
  const rec = a.eau.system.month.lines['vente:eau_exterieure'] ?? 0;
  assert.ok(rec > 0, 'ligne « vente:eau_exterieure » du panneau Eau');
  assert.ok(Math.abs(line(a.s) - rec) < 0.01, `versée à la trésorerie (poste détaillé du bilan) : ${line(a.s)} / ${rec}`);
  // Même ville sans vente : la trésorerie est plus basse (recette moins le coût de production de l'eau vendue).
  assert.ok(a.s.economy.money > b.s.economy.money, `trésorerie ${a.s.economy.money} > ${b.s.economy.money}`);
  assert.equal(notices(a.s), 1);
  // Option désactivée : rien vendu, ni recette ni notification.
  assert.equal(b.eau.system.balance!.exported, 0);
  assert.equal(b.eau.system.month.lines['vente:eau_exterieure'], undefined);
  assert.equal(line(b.s), 0);
  assert.equal(notices(b.s), 0);
  assert.equal(b.eau.system.settings.vente, false);
});

test('connexion extérieure par route reliée : vente d\'eau sans raccordement', () => {
  const t = town({ road: true });
  runHours(t.s, 30);
  assert.equal(t.eau.system.settings.raccordement, undefined);
  assert.ok((t.eau.system.balance!.exported ?? 0) > 0);
  assert.ok(line(t.s) > 0);
});

test('sans connexion avec l\'extérieur : rien n\'est vendu', () => {
  const t = town();
  runHours(t.s, 30);
  const bal = t.eau.system.balance!;
  assert.ok(bal.production > bal.delivered, 'surplus présent');
  assert.equal(bal.exported, undefined);
  assert.equal(line(t.s), 0);
  assert.equal(notices(t.s), 0);
});

test('sauvegarde : option et notification conservées ; ancienne section sans champs de vente lisible', () => {
  const t = town({ link: true });
  runHours(t.s, 30);
  t.s.plugins.command('eau', 'settings', { vente: false });
  const save = JSON.parse(JSON.stringify(t.s.toSave())) as ReturnType<Simulation['toSave']>;
  const data = save.plugins!.eau!.data as { system: Record<string, Record<string, unknown>> };
  assert.equal(data.system.settings!.vente, false);
  assert.equal(data.system.exportNotified, true);
  const { plugins, eau } = eauPlugins();
  const s2 = newSim(plugins);
  assert.equal(s2.fromSave(save), null);
  assert.equal(eau.system.settings.vente, false);
  // Ancien format : vente activée par défaut.
  delete data.system.settings!.vente; delete data.system.exportNotified;
  const { plugins: p3, eau: e3 } = eauPlugins();
  const s3 = newSim(p3);
  assert.equal(s3.fromSave(save), null);
  assert.equal(e3.system.settings.vente, undefined);
});
