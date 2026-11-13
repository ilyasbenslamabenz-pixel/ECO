/**
 * Sauvegarde de test pour l'e2e de la refonte d'interface : une vraie petite ville (catalogue réel,
 * commandes du joueur) simulée par la VRAIE simulation pendant ~13 mois de jeu, pour que le graphique
 * « 12 mois » et les statistiques mensuelles affichent un historique réel (aucune donnée inventée).
 * Usage : npx tsx tests/e2e/ui-history-fixture.ts <sortie.json> [mois=13]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog } from '../../src/shared/catalog';
import { TILE_SIZE } from '../../src/shared/constants';
import { Simulation } from '../../src/sim/world';

const out = process.argv[2] ?? 'ui-history.json';
const months = Number(process.argv[3] ?? 13);
const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'assets/catalog.json'), 'utf8')) as AssetCatalog;

const s = new Simulation();
s.setCatalog(catalog);
s.newGame({ seed: 4242, mapChunks: 4, startMoney: 6_000_000, cityName: 'Meknès-Test', terrain: { hydrology: 'aucune', rivers: 0 } });

const cheapest = (cat: string): string | null => catalog.assets.filter((a) => a.category === cat).sort((a, b) => a.cost - b.cost)[0]?.id ?? null;
const byTag = (tag: string): string | null => catalog.assets.find((a) => a.tags.includes(tag))?.id ?? null;

/** Rue le long de z = roadZ ; bâtiments au nord (rot 0) puis au sud (rot 2). */
function street(roadZ: number, x0: number, x1: number, north: (string | null)[], south: (string | null)[]): number {
  const r = s.buildRoad({ type: 'street', points: [x0, roadZ, x1, roadZ] });
  if (!r.ok) throw new Error(`route : ${r.error.message}`);
  let placed = 0;
  for (const [side, list] of [[1, north], [-1, south]] as const) {
    let x = x0 + 10;
    for (const id of list) {
      if (!id) continue;
      const a = s.getAsset(id)!;
      const w = a.footprint.tilesX * TILE_SIZE, d = a.footprint.tilesZ * TILE_SIZE;
      const z = side === 1 ? roadZ - 9 - d / 2 : roadZ + 9 + d / 2;
      const p = s.placeBuilding({ assetId: id, x: x + w / 2, z, rot: side === 1 ? 0 : 2 });
      if (p.ok) placed++;
      x += w + 4;
    }
  }
  return placed;
}

const house = cheapest('house');
const town = cheapest('townhouse');
const apt = cheapest('apartment_low');
const shop = cheapest('commercial');
const ind = cheapest('industrial');
const school = byTag('ecole');
const park = byTag('espace_vert');
let n = 0;
n += street(-60, -220, 220, [house, house, town, house, apt, house, town, house], [shop, house, school, house, park]);
n += street(60, -220, 220, [apt, house, house, shop, house, town], [ind, house, house, house]);
s.buildRoad({ type: 'street', points: [-220, -60, -220, 60] });
s.buildRoad({ type: 'street', points: [220, -60, 220, 60] });
const t0 = Date.now();
const total = months * 30 * 24 * 60;
for (let m = 0; m < total; m++) s.tick(1);
const save = s.toSave();
writeFileSync(out, JSON.stringify(save));
const rep = s.report(true);
console.log(`ville de test : ${n} bâtiments, ${rep.demography.population} habitants, ${rep.economy.history.length} mois clos, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
