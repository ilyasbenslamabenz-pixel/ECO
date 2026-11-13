#!/usr/bin/env node
// Validateur du contrat des piétons (GLB + manifest). Sortie non nulle en cas d'échec.
// Usage : node tools/pedestrians/validate.mjs [--dir assets/models/pedestrians]
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, '..', '..');
const require = createRequire(join(racine, 'package.json'));
const { NodeIO } = require('@gltf-transform/core');
const i = process.argv.indexOf('--dir');
const dir = resolve(i > 0 ? process.argv[i + 1] : join(racine, 'assets', 'models', 'pedestrians'));

const BONES = ['hanches', 'colonne', 'poitrine', 'cou', 'tete', 'bras_g', 'avant_bras_g', 'main_g', 'bras_d', 'avant_bras_d', 'main_d',
  'cuisse_g', 'tibia_g', 'pied_g', 'cuisse_d', 'tibia_d', 'pied_d'];
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
const PARTS = ['peau', 'cheveux', 'haut', 'bas', 'chaussures', 'accessoire', 'haut2', 'detail'];
const BORNES = [[3000, 6000], [800, 1500], [150, 350]];
const erreurs = [];
let nbControles = 0;
let ctx = '';
function ok(cond, msg) { nbControles++; if (!cond) erreurs.push(`${ctx}: ${msg}`); return cond; }
const proche = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

// --- petite algèbre (quaternions xyzw) ---
function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]); const ty = 2 * (z * v[0] - x * v[2]); const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

const io = new NodeIO();
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

// --- manifest ---
ctx = 'manifest';
ok(manifest.schemaVersion === 1, 'schemaVersion != 1');
ok(manifest.generator === 'tools/pedestrians/generate_pedestrians.py', 'generator');
ok(manifest.license?.spdx === 'CC0-1.0' && manifest.license?.author === 'Aube Urbaine' && manifest.license?.source === manifest.generator, 'licence');
ok(JSON.stringify(manifest.bones) === JSON.stringify(BONES), 'bones');
ok(JSON.stringify(manifest.parts) === JSON.stringify(PARTS), 'parts');
ok(Array.isArray(manifest.palettes) && manifest.palettes.length >= 40, `>= 40 palettes attendues (${manifest.palettes?.length})`);
const palIds = new Set();
for (const p of manifest.palettes) {
  ok(/^p\d+$/.test(p.id) && !palIds.has(p.id), `id de palette invalide ou dupliqué ${p.id}`);
  palIds.add(p.id);
  ok(p.colors.length === 8 && p.colors.every((c) => /^#[0-9a-f]{6}$/.test(c)), `palette ${p.id} : 8 couleurs #rrggbb`);
}
ok(manifest.models.length >= 10, `>= 10 personnages attendus (${manifest.models.length})`);
ok(new Set(manifest.models.map((m) => m.id)).size === manifest.models.length, 'ids de modèles dupliqués');
ok(new Set(manifest.models.map((m) => m.age)).size === 4, 'les 4 classes d’âge doivent être représentées');

let restRef = null; // noms/ordre communs à tous
for (const m of manifest.models) {
  ctx = m.id;
  ok(/^pieton_[a-z0-9_]+$/.test(m.id), 'id invalide');
  ok(typeof m.nameFr === 'string' && m.nameFr.length > 2, 'nameFr');
  ok(['enfant', 'ado', 'adulte', 'senior'].includes(m.age), 'age');
  ok(['homme', 'femme'].includes(m.genre), 'genre');
  const bornesH = { enfant: [1.1, 1.4], ado: [1.5, 1.72], adulte: [1.58, 1.95], senior: [1.5, 1.8] }[m.age] ?? [0, 9];
  ok(m.height >= bornesH[0] && m.height <= bornesH[1], `hauteur ${m.height} hors plage ${bornesH}`);
  ok(m.radius >= 0.15 && m.radius <= 0.6, `radius ${m.radius}`);
  ok(m.walkSpeed > 0.5 && m.walkSpeed < 2.2, 'walkSpeed');
  ok(proche(m.strideM, m.walkSpeed * m.animations.marche.duration, 1e-3), 'strideM != walkSpeed × durée');
  ok(m.palettes.length >= 6 && m.palettes.every((p) => palIds.has(p)), '>= 6 palettes existantes');
  ok(m.animations.marche.duration >= 1.0 - 1e-6 && m.animations.marche.duration <= 1.3 + 1e-6, 'durée marche hors 1.0–1.3 s');
  ok(m.animations.attente.duration >= 3 - 1e-6 && m.animations.attente.duration <= 4 + 1e-6, 'durée attente hors 3–4 s');
  ok(m.lods.length === 3, '3 LOD');
  ok(m.lods[0].maxDistance < m.lods[1].maxDistance && m.lods[1].maxDistance < m.lods[2].maxDistance, 'maxDistance croissantes');
  let triPrec = Infinity;
  let restLod0 = null;
  let clipsLod0 = null;
  for (let lod = 0; lod < 3; lod++) {
    const L = m.lods[lod];
    ctx = `${m.id} LOD${lod}`;
    ok(L.file === `${m.id}_lod${lod}.glb`, 'nom de fichier');
    const chemin = join(dir, L.file);
    if (!ok(existsSync(chemin), 'fichier absent')) continue;
    const taille = statSync(chemin).size;
    if (lod === 0) ok(taille <= 600 * 1024, `taille ${(taille / 1024).toFixed(0)} Ko > 600 Ko`);
    const doc = await io.read(chemin);
    const root = doc.getRoot();
    ok(root.listMeshes().length === 1, 'un seul maillage');
    ok(root.listTextures().length === 0, 'aucune texture');
    ok(root.listMaterials().length === 1, 'un seul matériau');
    ok(root.listSkins().length === 1, 'une seule skin');
    const mesh = root.listMeshes()[0];
    ok(mesh.listPrimitives().length === 1, 'une seule primitive');
    const prim = mesh.listPrimitives()[0];
    const mat = prim.getMaterial();
    ok(mat?.getName() === 'pieton_palette', 'matériau pieton_palette');
    ok(mat && mat.getBaseColorFactor().every((v) => v === 1) && mat.getMetallicFactor() === 0 && proche(mat.getRoughnessFactor(), 0.85) && !mat.getBaseColorTexture(), 'facteurs du matériau');
    for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']) ok(!!prim.getAttribute(s), `attribut ${s}`);
    ok(prim.listSemantics().length === 6, `attributs inattendus : ${prim.listSemantics()}`);
    const pos = prim.getAttribute('POSITION'); const nor = prim.getAttribute('NORMAL'); const uv = prim.getAttribute('TEXCOORD_0');
    const col = prim.getAttribute('COLOR_0'); const jo = prim.getAttribute('JOINTS_0'); const we = prim.getAttribute('WEIGHTS_0');
    const idx = prim.getIndices();
    const n = pos.getCount();
    const tris = idx.getCount() / 3;
    ok(tris === L.triangles, `triangles ${tris} != manifest ${L.triangles}`);
    ok(tris >= BORNES[lod][0] && tris <= BORNES[lod][1], `triangles ${tris} hors bornes ${BORNES[lod]}`);
    ok(tris < triPrec, 'triangles non strictement décroissants');
    triPrec = tris;
    // nœuds : aucune transformation résiduelle
    const noeudMesh = root.listNodes().find((nd) => nd.getMesh());
    ok(noeudMesh && noeudMesh.getTranslation().every((v) => v === 0) && noeudMesh.getScale().every((v) => v === 1) && proche(noeudMesh.getRotation()[3], 1), 'nœud du maillage transformé');
    const skin = root.listSkins()[0];
    const joints = skin.listJoints();
    ok(JSON.stringify(joints.map((j) => j.getName())) === JSON.stringify(BONES), `joints : ${joints.map((j) => j.getName())}`);
    ok(joints.every((j, k) => (PARENT[k] < 0 ? !joints.includes(j.getParentNode()) : j.getParentNode() === joints[PARENT[k]])), 'hiérarchie des os');
    ok(joints.every((j) => j.getScale().every((v) => proche(v, 1)) && proche(Math.abs(j.getRotation()[3]), 1)), 'os : rotation/échelle de repos non identité');
    const rest = joints.map((j) => j.getTranslation());
    if (lod === 0) restLod0 = rest; else if (restLod0) ok(rest.every((t, k) => t.every((v, a) => proche(v, restLod0[k][a], 1e-6))), 'pose de repos différente du LOD0');
    if (!restRef) restRef = BONES;
    const monde = []; // positions monde de repos
    for (let k = 0; k < 17; k++) monde.push(PARENT[k] < 0 ? rest[k] : rest[k].map((v, a) => v + monde[PARENT[k]][a]));
    const ibm = skin.getInverseBindMatrices();
    let ibmOk = true;
    for (let k = 0; k < 17; k++) { const e = ibm.getElement(k, []); for (let a = 0; a < 3; a++) if (!proche(e[12 + a], -monde[k][a], 1e-5)) ibmOk = false; if (!proche(e[0], 1) || !proche(e[5], 1) || !proche(e[10], 1)) ibmOk = false; }
    ok(ibmOk, 'matrices inverses de liaison incohérentes');
    ok(monde[5][0] > 0 && monde[8][0] < 0 && monde[11][0] > 0, 'gauche du personnage attendue en +X');
    // sommets
    let ymin = Infinity; let ymax = -Infinity; let xmin = Infinity; let xmax = -Infinity; let zPied = 0; let nPied = 0;
    let uvBad = 0; let wBad = 0; let nBad = 0; let cBad = 0; let jBad = 0;
    const p = []; const t = []; const c = []; const w = []; const j = [];
    const parts = new Set();
    const pieds = [];
    for (let v = 0; v < n; v++) {
      pos.getElement(v, p); nor.getElement(v, t); col.getElement(v, c); we.getElement(v, w); jo.getElement(v, j);
      ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]);
      const u = uv.getElement(v, []);
      const part = u[0] * 8 - 0.5;
      if (!proche(part, Math.round(part), 1e-4) || part < -0.01 || part > 7.01 || !proche(u[1], 0.5, 1e-6)) uvBad++; else parts.add(Math.round(part));
      const s = w[0] + w[1] + w[2] + w[3];
      if (!proche(s, 1, 1e-4) || w.some((x) => x < 0)) wBad++;
      if (j.some((x, a) => x > 16 || x < 0 || (w[a] === 0 && x !== 0))) jBad++;
      if (!proche(Math.hypot(t[0], t[1], t[2]), 1, 2e-3)) nBad++;
      if (c[0] < 0.55 - 0.003 || c[0] > 1.001 || !proche(c[0], c[1], 1e-6) || !proche(c[0], c[2], 1e-6)) cBad++;
      for (let a = 0; a < 4; a++) if ((j[a] === 13 || j[a] === 16) && w[a] > 0.999) { zPied += p[2]; nPied++; pieds.push([j[a], p[0], p[1], p[2]]); }
    }
    ok(uvBad === 0, `${uvBad} UV hors des 8 cases de palette`);
    ok(wBad === 0, `${wBad} sommets aux poids non normalisés`);
    ok(jBad === 0, `${jBad} sommets aux joints invalides`);
    ok(nBad === 0, `${nBad} normales non unitaires`);
    ok(cBad === 0, `${cBad} COLOR_0 hors gris 0.55..1`);
    ok(parts.has(0) && parts.has(4), 'parties peau/chaussures absentes');
    ok(Math.abs(ymin) < 0.002, `pieds à y = ${ymin.toFixed(4)} (attendu 0)`);
    if (lod === 0) ok(proche(ymax, m.height, 0.0015), `hauteur ${ymax.toFixed(3)} != manifest ${m.height}`);
    else ok(Math.abs(ymax - m.height) < 0.03, `hauteur LOD ${ymax.toFixed(3)} trop éloignée de ${m.height}`);
    ok(Math.abs(xmin + xmax) < 0.2 && xmax - xmin < 1.2, 'modèle non centré');
    ok(nPied > 0 && zPied / nPied > 0.01, 'le personnage ne regarde pas vers +Z (pieds)');
    let idxBad = 0;
    for (let k = 0; k < idx.getCount(); k++) if (idx.getScalar(k) >= n) idxBad++;
    ok(idxBad === 0, 'indices hors limites');
    // animations
    const anims = root.listAnimations();
    if (lod === 0) ok(anims.length === 2 && anims.some((a) => a.getName() === 'marche') && anims.some((a) => a.getName() === 'attente'), `clips marche/attente attendus (${anims.map((a) => a.getName())})`);
    const resume = {};
    for (const an of anims) {
      const nom = an.getName();
      ctx = `${m.id} LOD${lod} ${nom}`;
      const duree = m.animations[nom]?.duration;
      ok(duree !== undefined, 'clip inconnu du manifest');
      const rot = new Array(17).fill(null); let trans = null; let temps = null;
      for (const ch of an.listChannels()) {
        const k = joints.indexOf(ch.getTargetNode());
        const sp = ch.getSampler();
        ok(k >= 0, 'canal ciblant un nœud hors squelette');
        ok(sp.getInterpolation() === 'LINEAR', 'interpolation non LINEAR');
        const path = ch.getTargetPath();
        ok(path === 'rotation' || (path === 'translation' && k === 0), `canal interdit : ${path} sur ${BONES[k]}`);
        const tin = Array.from(sp.getInput().getArray());
        if (!temps) temps = tin; else ok(tin.length === temps.length, 'échantillonnage hétérogène');
        const out = sp.getOutput();
        const vals = []; for (let f = 0; f < out.getCount(); f++) vals.push(out.getElement(f, []));
        if (path === 'rotation') rot[k] = vals; else trans = vals;
      }
      if (!ok(temps && trans && rot.every(Boolean), 'canaux manquants (17 rotations + translation hanches)')) continue;
      const nf = temps.length;
      ok(proche(temps[0], 0, 1e-6) && proche(temps[nf - 1], duree, 1e-4), `durée ${temps[nf - 1]} != manifest ${duree}`);
      let pas = true; for (let f = 1; f < nf; f++) if (!proche(temps[f] - temps[f - 1], 1 / 30, 1e-4)) pas = false;
      ok(pas, 'échantillonnage != 30 i/s');
      let boucle = true; let unit = true;
      for (let k = 0; k < 17; k++) {
        const a = rot[k][0]; const b = rot[k][nf - 1];
        const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        if (d < 1 - 1e-6) boucle = false;
        for (const q of rot[k]) if (!proche(Math.hypot(...q), 1, 1e-4)) unit = false;
      }
      if (!trans[0].every((v, a) => proche(v, trans[nf - 1][a], 1e-6))) boucle = false;
      ok(boucle, 'première image != dernière image');
      ok(unit, 'quaternions non unitaires');
      ok(trans.every((v) => proche(v[0], rest[0][0], 1e-6) && proche(v[2], rest[0][2], 1e-6)), 'translation XZ de la racine');
      // continuité (pas de saut entre images, y compris au rebouclage)
      let saut = 0;
      for (let k = 0; k < 17; k++) for (let f = 1; f < nf; f++) { const a = rot[k][f - 1]; const b = rot[k][f]; saut = Math.max(saut, 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])))); }
      ok(saut < 0.35, `saut de rotation de ${(saut * 57.3).toFixed(1)}° entre deux images`);
      // cinématique directe : pieds au-dessus du sol, pied d'appui proche du sol
      let basMin = Infinity; let basMaxDesMin = -Infinity; let glisse = 0; let nbAppui = 0;
      const zAppui = { 13: [], 16: [] };
      for (let f = 0; f < nf; f++) {
        const qw = []; const pw = [];
        for (let k = 0; k < 17; k++) {
          const tl = k === 0 ? trans[f] : rest[k];
          if (PARENT[k] < 0) { qw.push(rot[k][f]); pw.push(tl); } else {
            const pp = PARENT[k];
            qw.push(qmul(qw[pp], rot[k][f]));
            const r = qrot(qw[pp], tl);
            pw.push([pw[pp][0] + r[0], pw[pp][1] + r[1], pw[pp][2] + r[2]]);
          }
        }
        let bas = Infinity;
        const basPied = { 13: [Infinity, 0], 16: [Infinity, 0] };
        for (const [k, x, y, z] of pieds) {
          const r = qrot(qw[k], [x - monde[k][0], y - monde[k][1], z - monde[k][2]]);
          const yy = pw[k][1] + r[1];
          if (yy < basPied[k][0]) basPied[k] = [yy, pw[k][2] + r[2]];
          bas = Math.min(bas, yy);
        }
        basMin = Math.min(basMin, bas); basMaxDesMin = Math.max(basMaxDesMin, bas);
        for (const k of [13, 16]) zAppui[k].push(basPied[k][0] < 0.004 ? pw[k][2] : null);
      }
      ok(basMin > -0.012, `pied sous le sol : ${basMin.toFixed(4)} m`);
      ok(basMaxDesMin < 0.02, `personnage décollé du sol : ${basMaxDesMin.toFixed(4)} m`);
      if (nom === 'marche') {
        // rebond vertical des hanches : 2 cycles ; vitesse de recul du pied d'appui = walkSpeed
        let maxima = 0; const y = trans.slice(0, nf - 1).map((v) => v[1]); const N = y.length;
        for (let f = 0; f < N; f++) if (y[f] > y[(f + N - 1) % N] && y[f] >= y[(f + 1) % N]) maxima++;
        ok(maxima === 2, `rebond des hanches : ${maxima} maxima par cycle (attendu 2)`);
        ok(Math.max(...y) - Math.min(...y) > 0.004, 'pas de rebond vertical des hanches');
        for (const k of [13, 16]) for (let f = 1; f < nf; f++) if (zAppui[k][f] !== null && zAppui[k][f - 1] !== null) { glisse += (zAppui[k][f - 1] - zAppui[k][f]) * 30; nbAppui++; }
        const vAppui = glisse / Math.max(1, nbAppui);
        ok(nbAppui > 4 && Math.abs(vAppui - m.walkSpeed) < 0.25 * m.walkSpeed, `vitesse du pied d'appui ${vAppui.toFixed(2)} m/s vs walkSpeed ${m.walkSpeed}`);
        // bras opposés aux jambes : corrélation négative entre cuisse_g et bras_g (tangage ~ composante x)
        let corr = 0; for (let f = 0; f < nf - 1; f++) corr += rot[11][f][0] * (rot[5][f][0] - 0.0);
        const moyC = rot[11].slice(0, nf - 1).reduce((s, q) => s + q[0], 0) / (nf - 1); const moyB = rot[5].slice(0, nf - 1).reduce((s, q) => s + q[0], 0) / (nf - 1);
        corr = 0; for (let f = 0; f < nf - 1; f++) corr += (rot[11][f][0] - moyC) * (rot[5][f][0] - moyB);
        resume.corr = corr;
      }
      resume[nom] = { rot, trans, temps };
    }
    ctx = `${m.id} LOD${lod}`;
    if (lod === 0) clipsLod0 = resume;
    else if (anims.length && clipsLod0) {
      for (const an of anims) {
        const a = clipsLod0[an.getName()]; const b = resume[an.getName()];
        ok(a && b && JSON.stringify(a.rot) === JSON.stringify(b.rot) && JSON.stringify(a.trans) === JSON.stringify(b.trans), `clip ${an.getName()} différent du LOD0`);
      }
    }
  }
}

if (erreurs.length) {
  console.error(`ÉCHEC — ${erreurs.length} erreur(s) sur ${nbControles} contrôles :`);
  for (const e of erreurs) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`OK — ${manifest.models.length} personnages, ${manifest.models.length * 3} GLB, ${manifest.palettes.length} palettes, ${nbControles} contrôles réussis (${dir}).`);
