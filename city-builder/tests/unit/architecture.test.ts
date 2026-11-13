/**
 * Garde-fous d'architecture : la simulation et le code partagé ne doivent dépendre
 * ni de three ni du DOM (exigence de séparation sim/rendu et de portabilité moteur).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN = [
  { re: /from\s+['"]three/, what: 'import de three' },
  { re: /from\s+['"]\.\.\/(render|client|ui|input|save)['"/]/, what: 'import d\'un module côté navigateur' },
  { re: /\b(document|window|localStorage|HTMLElement|requestAnimationFrame)\b/, what: 'API DOM' },
];

for (const dir of ['src/sim', 'src/shared']) {
  test(`${dir} : ni three, ni DOM`, () => {
    for (const f of files(join(root, dir))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const { re, what } of FORBIDDEN) assert.ok(!re.test(src), `${f} : ${what} interdit`);
    }
  });
}
