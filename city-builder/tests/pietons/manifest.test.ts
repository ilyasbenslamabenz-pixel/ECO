/**
 * Personnages piétons : manifeste réel (assets/models/pedestrians), choix des personnages par profil, palettes,
 * budget de taille des GLB, lignes du panneau.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PedCasting, checkManifest } from '../../src/render/pedestrians/manifest';
import { pietonsRows } from '../../src/ui/panels/pietons';

const dir = join(import.meta.dirname, '../../assets/models/pedestrians');
const manifest = checkManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));

test('manifeste : ≥ 10 personnages, 3 LOD présents sur disque, squelette commun', () => {
  assert.ok(manifest.models.length >= 10);
  assert.equal(manifest.bones.length, 17);
  for (const m of manifest.models) {
    assert.equal(m.lods.length, 3, m.id);
    for (const l of m.lods) assert.ok(statSync(join(dir, l.file)).size > 0, l.file);
    assert.ok(m.lods[0]!.triangles > m.lods[1]!.triangles && m.lods[1]!.triangles > m.lods[2]!.triangles, m.id);
  }
});

test('casting : chaque profil (âge × genre) a des personnages de cet âge ; variété des choix', () => {
  const c = new PedCasting(manifest);
  const ages = ['enfant', 'ado', 'adulte', 'senior'];
  for (let profil = 0; profil < 8; profil++) {
    assert.ok(c.candidates[profil]!.length > 0);
    // Repli d'âge autorisé seulement si aucun personnage de cet âge n'existe.
    const age = ages[profil & 3]!;
    if (manifest.models.some((m) => m.age === age)) for (const i of c.candidates[profil]!) assert.equal(manifest.models[i]!.age, age);
  }
  const seen = new Set<string>();
  for (let seed = 0; seed < 256; seed++) {
    const m = c.model(2, seed);
    const row = c.paletteRow(m, seed);
    assert.ok(row >= 0 && row < manifest.palettes.length);
    seen.add(`${m}:${row}`);
    const s = PedCasting.scale(seed);
    assert.ok(s >= 0.95 && s <= 1.05);
  }
  assert.ok(seen.size >= 10, `variété adultes hommes : ${seen.size}`);
});

test('budget : personnages < 5 Mo bruts (≈ 1,4 Mo compressés dans dist)', () => {
  const total = readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0);
  assert.ok(total < 5 * 1024 * 1024, `${total} octets`);
});

test('panneau : lignes du compteur', () => {
  const rows = pietonsRows({
    pietons: 1500, enMarche: 1400, enAttente: 80, enTraversee: 20, marcheurs: 670,
    roles: { actifs: 1, ecoliers: 1, retraites: 1, autres: 1 },
    motifs: { travail: 1, ecole: 1, courses: 1, loisirs: 1, retour: 1, flanerie: 1 },
    graphe: { noeuds: 1, aretes: 1, trottoirsM: 8772.4, passages: 93, passagesMarques: 80, passagesRegules: 0 },
    feux: false, trafic: false,
    cumul: { trajets: 0, arrivees: 0, traversees: 0, traverseesAuVert: 0, traverseesPrudentes: 0, traverseesForcees: 0, nonMarchables: 0, itineraires: 0 },
    tickMs: { moyenne: 0.35, p95: 1, max: 6, echantillons: 600 },
  });
  assert.equal(rows[0]![0], 'Piétons dans la rue');
  assert.equal(rows[0]![1].replace(/\s/g, ''), '1500');
  assert.ok(rows.some(([, v]) => v.includes('traversée prudente')));
});
