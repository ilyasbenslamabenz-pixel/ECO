/**
 * Manifeste des personnages piétons (assets/models/pedestrians/manifest.json), écrit par
 * tools/pedestrians/generate_pedestrians.py. Le rendu choisit un personnage et une rangée de palette pour chaque
 * piéton à partir de son profil (âge, genre) et de sa graine d'apparence : la simulation ne connaît pas les modèles.
 */
import { PIETON_AGE, PIETON_GENRE_BIT } from '../../shared/protocol-ext/pietons';

export const PED_PARTS = 8;
export const PED_MANIFEST_FILE = 'models/pedestrians/manifest.json';
export const PED_MODELS_DIR = 'models/pedestrians/';

export interface PedLod { file: string; triangles: number; maxDistance: number }

export interface PedModelInfo {
  id: string;
  nameFr: string;
  age: 'enfant' | 'ado' | 'adulte' | 'senior';
  genre: 'homme' | 'femme';
  height: number;
  radius: number;
  walkSpeed: number;
  strideM: number;
  palettes: string[];
  lods: PedLod[];
  animations: { marche: { duration: number }; attente: { duration: number } };
}

export interface PedManifest {
  schemaVersion: number;
  generator: string;
  license: { spdx: string; source: string; author: string };
  bones: string[];
  parts: string[];
  palettes: { id: string; colors: string[] }[];
  models: PedModelInfo[];
}

/** Vérifie la forme minimale du manifeste (lève avec un message lisible). */
export function checkManifest(m: unknown): PedManifest {
  const x = m as Partial<PedManifest> | null;
  if (!x || !Array.isArray(x.models) || !Array.isArray(x.palettes) || !Array.isArray(x.bones)) throw new Error('Manifeste des piétons invalide');
  if (x.models.length === 0 || x.palettes.length === 0) throw new Error('Manifeste des piétons vide');
  for (const p of x.palettes) if (!Array.isArray(p.colors) || p.colors.length !== PED_PARTS) throw new Error(`Palette ${p.id} : ${PED_PARTS} couleurs attendues`);
  for (const mod of x.models) {
    if (!mod.id || !Array.isArray(mod.lods) || mod.lods.length < 1) throw new Error(`Personnage ${mod.id} sans LOD`);
    if (!(mod.height > 0) || !(mod.strideM > 0) || !mod.animations?.marche || !mod.animations?.attente) throw new Error(`Personnage ${mod.id} incomplet`);
  }
  return x as PedManifest;
}

const AGE_BY_CODE = ['enfant', 'ado', 'adulte', 'senior'] as const;

/**
 * Table de choix : pour chaque profil (âge 0..3 | genre), la liste des personnages possibles (repli : même âge sans
 * le genre, puis âge voisin, puis tous) ; pour chaque personnage, les index de ses rangées de palette.
 */
export class PedCasting {
  /** candidates[profil 0..7] = index de personnages. */
  readonly candidates: number[][] = [];
  /** rows[modèle] = index de rangées de palette. */
  readonly rows: number[][] = [];

  constructor(readonly manifest: PedManifest) {
    const models = manifest.models;
    const palIndex = new Map(manifest.palettes.map((p, i) => [p.id, i]));
    for (const m of models) {
      const r = m.palettes.map((id) => palIndex.get(id)).filter((v): v is number => v !== undefined);
      this.rows.push(r.length > 0 ? r : manifest.palettes.map((_, i) => i));
    }
    const all = models.map((_, i) => i);
    const fallbackAge: Record<string, string[]> = { enfant: ['ado'], ado: ['adulte', 'enfant'], adulte: ['ado', 'senior'], senior: ['adulte'] };
    for (let profil = 0; profil < 8; profil++) {
      const age = AGE_BY_CODE[profil & 3]!;
      const genre = profil & PIETON_GENRE_BIT ? 'femme' : 'homme';
      let c = all.filter((i) => models[i]!.age === age && models[i]!.genre === genre);
      if (c.length === 0) c = all.filter((i) => models[i]!.age === age);
      for (const alt of fallbackAge[age]!) {
        if (c.length > 0) break;
        c = all.filter((i) => models[i]!.age === alt && models[i]!.genre === genre);
        if (c.length === 0) c = all.filter((i) => models[i]!.age === alt);
      }
      this.candidates.push(c.length > 0 ? c : all);
    }
    void PIETON_AGE;
  }

  /** Personnage d'un piéton (index dans le manifeste). */
  model(profil: number, seed: number): number {
    const c = this.candidates[profil & 7]!;
    return c[seed % c.length]!;
  }

  /** Rangée de palette d'un piéton pour son personnage. */
  paletteRow(model: number, seed: number): number {
    const r = this.rows[model]!;
    return r[((seed * 7 + (seed >> 3)) >>> 0) % r.length]!;
  }

  /** Échelle de taille (± 5 %) propre au piéton. */
  static scale(seed: number): number { return 0.95 + ((seed * 37) % 101) / 1000; }
}
