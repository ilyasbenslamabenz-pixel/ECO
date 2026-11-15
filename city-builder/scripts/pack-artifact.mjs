// Prépare dist-artifact/ pour l'hébergement en artifact claude.ai (sauvegardes en ligne par compte Claude).
// Contraintes de l'hébergeur : ni .glb ni .hdr servis, au plus ~511 fichiers par version, ≤ 15 Mo par fichier.
// - les binaires X.glb / X.hdr sont regroupés en paquets JSON (« packs/pNN.json » : { files: { chemin: base64 } }),
//   ~2 Mo chacun, groupés par dossier pour que les modèles d'une même famille arrivent ensemble ;
// - « packs/index.json » associe chaque chemin d'origine à son paquet ;
// - un petit adaptateur `fetch` injecté dans artifact.html sert les requêtes .glb/.hdr depuis ces paquets
//   (chaque paquet téléchargé une seule fois) et rend au jeu une Response binaire identique : le code du jeu
//   et le catalogue restent inchangés ;
// - les URL blob: créées par la page (images embarquées des GLB) sont servies depuis la mémoire.
import fs from 'node:fs'; import path from 'node:path';
const src = path.resolve(process.argv[2] ?? 'dist'), out = path.resolve(process.argv[3] ?? 'dist-artifact');
const PACK_MAX = 2 * 1024 * 1024; // octets binaires par paquet (≈ 2,7 Mo en base64)
fs.rmSync(out, { recursive: true, force: true });

const bins = []; let copied = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  const p = path.join(d, e.name), rel = path.relative(src, p).split(path.sep).join('/');
  if (e.isDirectory()) { walk(p); continue; }
  if (/\.(glb|hdr)$/i.test(e.name)) { bins.push({ rel, size: fs.statSync(p).size, p }); continue; }
  if (e.name === 'index.html') continue; // la page publiée est artifact.html
  const dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(p, dst); copied++;
} };
walk(src);

// Regroupement : par dossier, puis découpe à PACK_MAX.
bins.sort((a, b) => a.rel.localeCompare(b.rel));
const packs = []; let cur = null;
for (const b of bins) {
  const dir = path.posix.dirname(b.rel);
  if (!cur || cur.size + b.size > PACK_MAX || (cur.dir !== dir && cur.size > PACK_MAX / 2)) { cur = { dir, size: 0, items: [] }; packs.push(cur); }
  cur.items.push(b); cur.size += b.size;
}
fs.mkdirSync(path.join(out, 'packs'), { recursive: true });
const index = {};
packs.forEach((pk, i) => {
  const name = `packs/p${String(i).padStart(2, '0')}.json`;
  const files = {};
  for (const b of pk.items) { files[b.rel] = fs.readFileSync(b.p).toString('base64'); index[b.rel] = name; }
  fs.writeFileSync(path.join(out, name), JSON.stringify({ files }));
});
fs.writeFileSync(path.join(out, 'packs/index.json'), JSON.stringify(index));

const shim = `<script>(function(){var f=window.fetch.bind(window);function dec(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
var blobs=new Map(),mk=URL.createObjectURL.bind(URL),rv=URL.revokeObjectURL.bind(URL);URL.createObjectURL=function(o){var u=mk(o);if(o instanceof Blob)blobs.set(u,o);return u;};URL.revokeObjectURL=function(u){blobs.delete(u);rv(u);};
var base=new URL('./',document.baseURI||location.href),idx=null,packs={};function index(){return idx||(idx=f(new URL('packs/index.json',base).href).then(function(r){if(!r.ok)throw new Error('index des paquets introuvable');return r.json();}));}
function pack(n){return packs[n]||(packs[n]=f(new URL(n,base).href).then(function(r){if(!r.ok){delete packs[n];throw new Error('paquet introuvable : '+n);}return r.json();}).catch(function(e){delete packs[n];throw e;}));}
window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url)||String(input);if(blobs.has(url))return Promise.resolve(new Response(blobs.get(url),{status:200}));
if(!/^[^?#]*\\.(glb|hdr)(?=$|[?#])/i.test(url))return f(input,init);var p=decodeURIComponent(new URL(url,location.href).pathname),k=p.indexOf('/assets/');if(k<0)return f(input,init);var key=p.slice(k+1);
return index().then(function(ix){var n=ix[key];if(!n)return new Response(null,{status:404,statusText:'absent des paquets'});return pack(n).then(function(j){var s=j.files[key];if(s==null)return new Response(null,{status:404});return new Response(dec(s),{status:200,headers:{'Content-Type':'application/octet-stream'}});});});};})();</script>`;
const page = path.join(out, 'artifact.html'); let html = fs.readFileSync(page, 'utf8');
const at = html.indexOf('<script'); if (at < 0) throw new Error('aucun <script> dans artifact.html');
html = html.slice(0, at) + shim + '\n' + html.slice(at);
html = html.replace(/<title>[^<]*<\/title>/, '<title>Meknes City</title>');
fs.writeFileSync(page, html);

const all = []; const walkOut = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkOut(p); else all.push(p); } };
walkOut(out);
const big = all.filter((p) => fs.statSync(p).size > 15 * 1024 * 1024);
console.log(`binaires : ${bins.length} en ${packs.length} paquets ; fichiers copiés : ${copied} ; total dist-artifact : ${all.length} fichiers`);
if (all.length > 500) throw new Error(`trop de fichiers pour un artifact (${all.length} > 500)`);
if (big.length) throw new Error(`fichiers > 15 Mo : ${big.join(', ')}`);
