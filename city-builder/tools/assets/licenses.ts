/**
 * Génère assets/LICENSES.md à partir du catalogue (source unique de vérité) :
 * chaque modèle, jeu de textures et HDRI distribué avec sa licence, sa source exacte, son auteur et ses dates.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog, AssetLicense } from '../../src/shared/catalog';
import { CACHE_DIR, type PhInfo } from './polyhaven';
import { readFileSync } from 'node:fs';

function phId(source: string): string | null {
  const m = /^https:\/\/polyhaven\.com\/a\/([A-Za-z0-9_-]+)$/.exec(source);
  return m ? m[1]! : null;
}

function dates(lic: AssetLicense): { published: string; imported: string } {
  const id = phId(lic.source);
  if (!id) return { published: '—', imported: '—' };
  const f = join(CACHE_DIR, 'api', `info_${id}.json`);
  if (!existsSync(f)) return { published: '?', imported: '?' };
  const info = JSON.parse(readFileSync(f, 'utf8')) as PhInfo;
  return {
    published: new Date(info.date_published * 1000).toISOString().slice(0, 10),
    imported: statSync(f).mtime.toISOString().slice(0, 10),
  };
}

const esc = (s: string): string => s.replace(/\|/g, '\\|');

export function writeLicenses(cat: AssetCatalog, assetsDir: string): void {
  const rows: string[] = [];
  const row = (what: string, kind: string, files: string, lic: AssetLicense): void => {
    const d = dates(lic);
    rows.push(`| ${esc(what)} | ${kind} | ${esc(files)} | ${lic.spdx} | ${esc(lic.source)} | ${esc(lic.author)} | ${d.published} | ${d.imported} |`);
  };
  for (const a of cat.assets) row(`\`${a.id}\` — ${a.nameFr}`, `modèle (${a.category})`, a.lods.map((l) => l.file).join(', '), a.license);
  for (const t of cat.textureSets) row(`\`${t.id}\` — ${t.nameFr}`, 'textures PBR', [t.albedo, t.normal, t.arm ?? t.roughness ?? ''].filter(Boolean).join(', '), t.license);
  for (const h of cat.hdris) row(`\`${h.id}\` — ${h.nameFr}`, 'HDRI', h.file, h.license);
  const md = `# Licences et provenance des assets

Fichier **généré** par \`npm run assets\` (tools/assets/licenses.ts) à partir de \`assets/catalog.json\` — ne pas éditer à la main.
Chaque fichier distribué dans \`dist/assets/\` figure ci-dessous.

Sources autorisées :
- **Poly Haven** — licence CC0 1.0 (domaine public), https://polyhaven.com/license . Source = page de l'asset sur polyhaven.com ;
  fichiers téléchargés via api.polyhaven.com / dl.polyhaven.org, puis optimisés par \`tools/assets/\` (LOD, WebP, recentrage).
- **Générateurs du projet** (\`tools/generators/\`) — CC0 1.0, auteur : projet Aube Urbaine.

« Publié » = date de publication sur Poly Haven ; « Importé » = date du premier téléchargement dans le cache local.

| Asset | Type | Fichiers | Licence | Source | Auteur(s) | Publié | Importé |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
  writeFileSync(join(assetsDir, 'LICENSES.md'), md);
}
