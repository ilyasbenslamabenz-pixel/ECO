/**
 * Liste des fichiers du dossier models/ → src/model-files.ts (chaque fichier y reçoit une clé « f:<nom> » dans
 * ASSETS). À relancer après un ajout de modèles :  node scripts/gen-model-list.mjs
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'models')).filter((f) => f.endsWith('.glb')).sort().map((f) => f.slice(0, -4));
const lines = [];
for (let i = 0; i < files.length; i += 8) lines.push('  ' + files.slice(i, i + 8).map((f) => `'${f}'`).join(', ') + ',');
writeFileSync(join(root, 'src/model-files.ts'), `/** Fichiers du dossier models/ (sans « .glb »), générés par scripts/gen-model-list.mjs. */\nexport const MODEL_FILES: readonly string[] = [\n${lines.join('\n')}\n];\n`);
console.log(`${files.length} modèles listés`);
