// Prépare dist-artifact/ pour l'hébergement en artifact claude.ai, qui ne sert ni .glb ni .hdr
// et dont la politique de sécurité peut bloquer les URL data:/blob:.
// - chaque fichier binaire X.glb / X.hdr est publié en X.glb.b64.json / X.hdr.b64.json ({ "b64": ... }) ;
// - les URL blob: créées par la page (images embarquées des GLB) sont servies depuis la mémoire,
//   sans requête réseau ;
// - un petit adaptateur `fetch` injecté dans artifact.html redirige les requêtes .glb/.hdr vers ces
//   fichiers JSON et rend au jeu une Response binaire identique : le code du jeu et le catalogue
//   restent inchangés (chemins .glb/.hdr d'origine).
import fs from 'node:fs'; import path from 'node:path';
const src = path.resolve(process.argv[2] ?? 'dist'), out = path.resolve(process.argv[3] ?? 'dist-artifact');
fs.rmSync(out, { recursive: true, force: true });
let n = 0;

const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name), dst = path.join(out, path.relative(src, p));
  if (e.isDirectory()) { walk(p); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (e.name.endsWith('.glb')) { fs.writeFileSync(dst + '.b64.json', JSON.stringify({ b64: fs.readFileSync(p).toString('base64') })); n++; continue; }
  if (e.name.endsWith('.hdr')) { fs.writeFileSync(dst + '.b64.json', JSON.stringify({ b64: fs.readFileSync(p).toString('base64') })); n++; continue; }
  fs.copyFileSync(p, dst);
} };
walk(src);
const shim = `<script>(function(){var f=window.fetch.bind(window);function dec(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
var blobs=new Map(),mk=URL.createObjectURL.bind(URL),rv=URL.revokeObjectURL.bind(URL);URL.createObjectURL=function(o){var u=mk(o);if(o instanceof Blob)blobs.set(u,o);return u;};URL.revokeObjectURL=function(u){blobs.delete(u);rv(u);};
window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url)||String(input);if(blobs.has(url))return Promise.resolve(new Response(blobs.get(url),{status:200}));var m=/^[^?#]*\\.(glb|hdr)(?=$|[?#])/i.exec(url);
if(!m)return f(input,init);var u=new URL(url,location.href);u.pathname+='.b64.json';
return f(u.href).then(function(r){if(!r.ok)return r;return r.json().then(function(j){return new Response(dec(j.b64),{status:200,headers:{'Content-Type':'application/octet-stream'}});});});};})();</script>`;
const page = path.join(out, 'artifact.html'); let html = fs.readFileSync(page, 'utf8');
const at = html.indexOf('<script'); if (at < 0) throw new Error('aucun <script> dans artifact.html');
html = html.slice(0, at) + shim + '\n' + html.slice(at);
html = html.replace(/<title>[^<]*<\/title>/, '<title>Meknes City</title>');
fs.writeFileSync(page, html);
console.log(`binaires empaquetés : ${n} ; adaptateur fetch injecté dans artifact.html`);
