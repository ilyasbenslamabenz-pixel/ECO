// Prépare dist-artifact/ : types servis par les artifacts (pas de .glb/.hdr).
// GLB -> glTF JSON (buffer binaire embarqué en data URI) ; HDR -> data URI dans catalog.json.
import fs from 'node:fs'; import path from 'node:path';
const src = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
fs.rmSync(out, { recursive: true, force: true });
let nGlb = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name), rel = path.relative(src, p), dst = path.join(out, rel);
  if (e.isDirectory()) { walk(p); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (e.name.endsWith('.hdr')) continue;
  if (e.name.endsWith('.glb')) {
    const b = fs.readFileSync(p);
    if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('pas un GLB : ' + rel);
    let off = 12, json = null, bin = null;
    while (off < b.length) { const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
      const chunk = b.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8')); else if (type === 0x004e4942) bin = chunk;
      off += 8 + len; }
    if (bin) { const buf = json.buffers[0]; if (buf.uri) throw new Error('buffer 0 déjà externe : ' + rel);
      buf.uri = 'data:application/octet-stream;base64,' + bin.toString('base64'); }
    fs.writeFileSync(dst.replace(/\.glb$/, '.gltf.json'), JSON.stringify(json)); nGlb++; continue;
  }
  fs.copyFileSync(p, dst);
} };
walk(src);
const catP = path.join(out, 'assets/catalog.json'); const cat = JSON.parse(fs.readFileSync(catP, 'utf8'));
let nLod = 0;
for (const a of cat.assets) for (const l of a.lods ?? []) if (l.file.endsWith('.glb')) { l.file = l.file.replace(/\.glb$/, '.gltf.json'); nLod++; }
for (const h of cat.hdris) { const f = path.join(src, 'assets', h.file);
  h.file = 'data:application/octet-stream;base64,' + fs.readFileSync(f).toString('base64'); }
fs.writeFileSync(catP, JSON.stringify(cat));
const rest = JSON.stringify(cat).match(/\.glb"/g); 
console.log(`GLB convertis : ${nGlb}, LOD réécrits : ${nLod}, HDRI embarqués : ${cat.hdris.length}, .glb restants dans le catalogue : ${rest ? rest.length : 0}`);
