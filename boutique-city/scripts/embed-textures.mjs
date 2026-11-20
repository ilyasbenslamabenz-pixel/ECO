/**
 * Intègre dans un fichier GLB les textures qu'il référence par chemin (images « uri ») : le modèle devient
 * autonome. Les packs Kenney pointent tous vers « Textures/colormap.png », image différente selon le pack.
 *   node scripts/embed-textures.mjs <texture.png> <modèle.glb>...
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [png, ...files] = process.argv.slice(2);
const img = readFileSync(png);
const pad4 = (n) => (n + 3) & ~3;
for (const f of files) {
  const b = readFileSync(f);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${f} : pas un GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = Buffer.alloc(0);
  const binStart = 20 + jsonLen;
  if (binStart < b.length) { const binLen = b.readUInt32LE(binStart); bin = b.subarray(binStart + 8, binStart + 8 + binLen); }
  const ext = (json.images ?? []).filter((i) => i.uri && !i.uri.startsWith('data:'));
  if (!ext.length) { console.log(`${f} : rien à intégrer`); continue; }
  const offset = pad4(bin.length);
  const nb = Buffer.alloc(pad4(offset + img.length));
  bin.copy(nb, 0); img.copy(nb, offset);
  json.bufferViews ??= [];
  const view = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: img.length }) - 1;
  for (const i of ext) { delete i.uri; i.bufferView = view; i.mimeType = 'image/png'; }
  json.buffers ??= [{}];
  json.buffers[0].byteLength = nb.length;
  delete json.buffers[0].uri;
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const total = 12 + 8 + js.length + 8 + nb.length;
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(nb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(f, Buffer.concat([head, jh, js, bh, nb]));
  console.log(`${f} : texture intégrée (${img.length} octets)`);
}
