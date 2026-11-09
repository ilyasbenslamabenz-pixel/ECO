// Bibliothèque de modèles 3D : cohérence du manifeste, budgets de triangles, GLB valides, utilitaires purs.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  boundsOf,
  colorsLinearToSrgb,
  extractEmissiveTriangles,
  linearToSrgb,
  writeInstanceMatrix,
  type Manifest,
} from '../client/src/game/modelLibraryUtils';

const DOSSIER = path.resolve(__dirname, '../client/public/assets/models');
const manifest: Manifest = JSON.parse(readFileSync(path.join(DOSSIER, 'manifest.json'), 'utf8'));

const BUDGETS: Record<string, number> = {
  berline: 800, citadine: 800, suv: 800, utilitaire: 800, taxi: 800, police: 800, ambulance: 800,
  camion_porteur: 1200, semi_remorque: 1200, bus_articule: 1200, rame_tete: 1200, rame_intermediaire: 1200,
  avion_moyen_courrier: 3000, avion_gros_porteur: 3000,
  porte_conteneurs: 3000, petrolier: 3000, remorqueur: 3000, peniche: 3000, bateau_mouche: 3000,
  portique_sts: 1500, portique_rtg: 1500, eolienne: 800,
  lampadaire: 150, lampadaire_classique: 150,
};

function lireGlb(fichier: string): { json: { meshes: unknown[]; materials?: unknown[]; nodes: { name?: string }[] } } {
  const b = readFileSync(path.join(DOSSIER, fichier));
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // « glTF »
  expect(b.readUInt32LE(4)).toBe(2);
  const n = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + n).toString('utf8')) };
}

describe('manifeste des modèles', () => {
  it('liste au moins les modèles demandés', () => {
    const ids = new Set(manifest.modeles.map((m) => m.id));
    for (const id of [...Object.keys(BUDGETS), 'arbre_platane', 'arbre_parc_large', 'arbre_parc_rond', 'feu_tricolore',
      'abribus', 'climatiseur', 'local_technique', 'chateau_eau']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('respecte les budgets de triangles', () => {
    for (const m of manifest.modeles) {
      if (BUDGETS[m.id]) expect(m.triangles, m.id).toBeLessThanOrEqual(BUDGETS[m.id]);
      if (m.categorie === 'arbre') {
        expect(m.lods.length, m.id).toBe(2);
        expect(m.lods[0].triangles, m.id).toBeLessThanOrEqual(400);
        expect(m.lods[1].triangles, m.id).toBeLessThan(m.lods[0].triangles);
      }
    }
  });

  it('a des GLB présents, valides, à un seul matériau, pour moins de 15 Mo au total', () => {
    let total = 0;
    for (const m of manifest.modeles) {
      const f = path.join(DOSSIER, m.fichier);
      expect(existsSync(f), m.fichier).toBe(true);
      total += statSync(f).size;
      const { json } = lireGlb(m.fichier);
      expect(json.materials?.length ?? 0, m.id).toBeLessThanOrEqual(1);
      const noeuds = json.nodes.map((n) => n.name);
      for (const p of m.parties_animees.filter((p) => p.type !== 'emissif')) expect(noeuds, m.id).toContain(p.nom);
      for (const l of m.lods) expect(noeuds, m.id).toContain(l.noeud);
    }
    expect(total).toBeLessThan(15 * 1024 * 1024);
  });

  it('a des dimensions réalistes', () => {
    const d = (id: string) => manifest.modeles.find((m) => m.id === id)!.dimensions_m;
    expect(d('avion_moyen_courrier').longueur).toBeCloseTo(37.6, 0);
    expect(d('avion_gros_porteur').longueur).toBeGreaterThan(62);
    expect(d('porte_conteneurs').longueur).toBe(300);
    expect(d('eolienne').hauteur).toBeGreaterThan(145);
    expect(d('berline').longueur).toBeGreaterThan(4.5);
    expect(d('berline').longueur).toBeLessThan(5.1);
  });
});

describe('utilitaires de la bibliothèque', () => {
  it('convertit linéaire → sRGB', () => {
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 6);
    expect(linearToSrgb(0.214)).toBeCloseTo(0.5, 2);
    const c = new Float32Array([0.214, 0.214, 0.214, 0.3]);
    colorsLinearToSrgb(c);
    expect(c[0]).toBeCloseTo(0.5, 2);
    expect(c[3]).toBe(1);
  });

  it('extrait les triangles émissifs par code', () => {
    // deux triangles : le premier code 1 (phare), le second code 0
    const g = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [1, 0, 1, 0, 1, 0, 0, 0],
      indices: [0, 1, 2, 3, 1, 2],
    };
    const l = extractEmissiveTriangles(g, [1, 2])!;
    expect(l.indices.length).toBe(3);
    expect(l.parCode).toEqual({ 1: 1 });
    expect(Array.from(l.colors.slice(0, 3))).toEqual([1, 0.95, 0.8199999928474426].map((x) => Math.fround(x)));
    expect(extractEmissiveTriangles(g, [5])).toBeNull();
  });

  it('écrit une matrice d’instance (lacet π/2 : l’avant +Z regarde vers +X)', () => {
    const m = new Float32Array(16);
    writeInstanceMatrix(m, 0, 10, 0, 5, Math.PI / 2, 2);
    // vecteur ligne (0, 0, 1, 1) × M → (x, y, z)
    const x = 0 * m[0] + 0 * m[4] + 1 * m[8] + m[12];
    const z = 0 * m[2] + 0 * m[6] + 1 * m[10] + m[14];
    expect(x).toBeCloseTo(12, 5);
    expect(z).toBeCloseTo(5, 5);
    expect(boundsOf([1, 2, 3, -1, 5, 0])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
  });
});
