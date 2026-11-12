/**
 * Kit bâtiments — jeux de textures PBR complémentaires (Poly Haven, CC0) propres au kit :
 * pierre de taille, moellons, pierre rustique, bois de volets, portes de garage, lames de terrasse.
 * Ils complètent les 31 jeux du pipeline (briques, enduits, bardages, toitures, métaux).
 *
 * Téléchargés par le client du pipeline (tools/assets/polyhaven.ts : hôtes Poly Haven uniquement,
 * cache .cache/polyhaven, contrôle md5) et encodés comme les autres (WebP 1024 / ARM 512) dans
 * assets/buildings/textures/<id>/. Chemins renvoyés relatifs à assets/.
 */
import { join } from 'node:path';
import type { AssetCatalog, TextureSet } from '../../../src/shared/catalog';
import { buildTextureSet } from '../../assets/textures';
import type { TextureSpec } from '../../assets/selection';

export const KIT_TEXTURES: TextureSpec[] = [
  { id: 'pierre_taille', ph: 'white_sandstone_blocks_02', nameFr: 'Pierre de taille claire', role: 'beton_facade' },
  { id: 'pierre_moellons', ph: 'stone_wall', nameFr: 'Mur en moellons', role: 'beton_facade' },
  { id: 'pierre_rustique', ph: 'rustic_stone_wall', nameFr: 'Pierre rustique appareillée', role: 'beton_facade' },
  { id: 'bois_volet', ph: 'wood_shutter', nameFr: 'Bois de volets (lames)', role: 'bardage' },
  { id: 'porte_garage', ph: 'wooden_garage_door', nameFr: 'Porte de garage en bois', role: 'bardage' },
  { id: 'bois_terrasse', ph: 'wood_floor_deck', nameFr: 'Lames de terrasse en bois', role: 'bardage' },
];

/** Construit (ou reprend du cache) les jeux du kit. `assetsDir` = dossier assets/ du projet. */
export async function buildKitTextureSets(assetsDir: string): Promise<TextureSet[]> {
  const out: TextureSet[] = [];
  for (const spec of KIT_TEXTURES) {
    const t = await buildTextureSet(spec, join(assetsDir, 'buildings'));
    const pre = (p: string | undefined): string | undefined => (p ? `buildings/${p}` : undefined);
    const ts: TextureSet = { ...t, albedo: pre(t.albedo)!, normal: pre(t.normal)! };
    if (t.arm) ts.arm = pre(t.arm)!;
    out.push(ts);
  }
  return out;
}

/** Jeux connus du kit : ceux du catalogue principal + ceux du kit (les seconds l'emportent). */
export function mergeTextureSets(cat: AssetCatalog, kit: TextureSet[]): Map<string, TextureSet> {
  const m = new Map<string, TextureSet>();
  for (const t of cat.textureSets) m.set(t.id, t);
  for (const t of kit) m.set(t.id, t);
  return m;
}
