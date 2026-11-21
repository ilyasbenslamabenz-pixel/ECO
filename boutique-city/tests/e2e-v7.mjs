/**
 * Nouveautés v7 de Boutique City, dans le navigateur (Playwright, Chromium préinstallé) :
 *  - employés : souhaits des candidats à l'agence pour l'emploi, rôle (caisse, rayon, entretien) et équipe (matin,
 *    soir, journée) choisis à l'embauche ; onglet Employés du commerce (planning des caissiers, alerte de trou) ;
 *    seuls les employés de service sont visibles ; un employé d'entretien fait remonter la propreté ;
 *  - propreté : baisse au fil de la journée, alerte sous 50 %, bulle « C'est sale ici… », bouton « Nettoyer » de la
 *    barre intérieure, service de nettoyage de nuit ;
 *  - revêtements : sol et murs choisis dans l'onglet Aperçu, coût débité, rendu de l'intérieur changé ;
 *  - finances : appli Finances du téléphone (impôt estimé, plafond de crédit, placements, notoriété), guichet de la
 *    banque (plafond dynamique), impôt : semaine 1 exonérée, prélevé à la fin de la semaine 2 (jour 14) ;
 *  - sauvegarde et rechargement à l'identique de tout ce nouvel état ; aucune erreur de page.
 * Le temps de jeu avance par l'outil de test (window.__bc.advance), jeu en pause entre deux étapes : le rendu logiciel
 * est lent (≈ 1 image/s dans la rue, ≈ 6 dans un commerce, bien moins sur une machine chargée). D'où : graphismes
 * « Basse » (réglage du joueur, sans ombres), caméra de rue pointée vers le sol pendant les panneaux des services
 * (moins d'objets à dessiner), délais généreux. Les actions DOM sont atomiques (une seule évaluation : le panneau
 * peut être redessiné entre deux allers-retours du pilote). Les états préparés par l'outil de test (stock, propreté
 * abaissée) sont signalés en commentaire.
 * Usage : node scripts/build.mjs && node tests/e2e-v7.mjs [--dist <dossier>] [dossier des captures]
 *         (ou BC_DIST=<dossier> ; dist/ par défaut ; captures dans tests/out/v7 par défaut)
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
let distArg = process.env.BC_DIST ?? null;
const positional = [];
for (let k = 0; k < argv.length; k++) {
  if (argv[k] === '--dist') distArg = argv[++k];
  else if (argv[k].startsWith('--dist=')) distArg = argv[k].slice(7);
  else positional.push(argv[k]);
}
const dist = resolve(distArg ?? join(process.cwd(), 'dist'));
const out = resolve(positional[0] ?? 'tests/out/v7');
if (!existsSync(join(dist, 'index.html'))) { console.error(`Dossier dist introuvable : ${dist} (npm run build, ou --dist <dossier>)`); process.exit(2); }
mkdirSync(out, { recursive: true });
console.log(`dist : ${dist}\ncaptures : ${out}`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = readFileSync(join(dist, u === '/' ? 'index.html' : u)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(u)] ?? 'application/octet-stream' }); res.end(body);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let fails = 0, count = 0;
const failed = [];
const check = (ok, label, extra = '') => {
  count++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${label}${extra ? ` ${extra}` : ''}`);
  if (!ok) { fails++; failed.push(label); }
  return ok;
};
const section = (t) => console.log(`\n— ${t}`);
const t0 = Date.now();
const shots = [];

/**
 * Outils installés dans la page avant le jeu (à chaque chargement) : journal des notifications affichées (toasts),
 * textes dessinés dans chaque canevas (pour reconnaître la bulle « C'est sale ici… » dans la scène 3D), petites
 * fonctions de lecture (format CHF identique au jeu, lignes de panneau, image rendue).
 */
function pageTools() {
  try { localStorage.setItem('bc-qualite', 'basse'); } catch { /* stockage indisponible */ }
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    try { (this.canvas.__texts ??= []).push(String(text)); } catch { /* canevas hors document */ }
    return fill.call(this, text, ...rest);
  };
  window.__toastLog = [];
  const watch = () => {
    const box = document.getElementById('toasts');
    if (!box) return;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains('toast')) window.__toastLog.push({ kind: [...n.classList].filter((c) => c !== 'toast').join(' '), text: n.dataset.text ?? n.textContent });
      }
    }).observe(box, { childList: true });
  };
  document.addEventListener('DOMContentLoaded', watch);
  const nf0 = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 });
  window.__qa = {
    chf: (v) => `${nf0.format(Math.round(v))} CHF`,
    signed: (v) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(Math.round(v)))} CHF`,
    /** Toasts affichés depuis l'indice `from` du journal, filtrés par texte. */
    toasts: (from, part) => window.__toastLog.slice(from).filter((t) => t.text.includes(part)),
    /** Notifications de la partie (journal complet, game.notices étant plafonné à 100) depuis `from`, filtrées. */
    notices: (from, part) => window.__noticeLog.slice(from).filter((n) => n.text.includes(part)),
    /** Branche le journal des notifications sur la partie en cours (après chaque chargement). */
    logNotices: () => {
      const g = window.__bc.game, notify = g.notify.bind(g);
      window.__noticeLog = [];
      g.notify = (level, text) => { window.__noticeLog.push({ at: g.total, level, text }); return notify(level, text); };
    },
    /** Fixe un menu déroulant et signale le changement (comme un choix du joueur). */
    pick: (sel, value) => { sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value === value; },
    /** Ligne d'employé (onglet Employés ou agence) par son nom. */
    empRow: (name) => [...document.querySelectorAll('#panel .item')].find((r) => r.querySelector('select[aria-label="Affectation"]') && r.querySelector('b')?.textContent.includes(name)) ?? null,
    /** Lignes des candidats de l'agence, dans l'ordre de la partie. */
    candRows: () => [...document.querySelectorAll('#panel .item')].filter((r) => r.querySelector('.emp-wish')),
    /** Textes des bulles (sprites) affichées dans l'intérieur (elles et leurs parents visibles). */
    spriteTexts: () => {
      const outT = [], sc = window.__bc.scene;
      const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      sc?.interior?.view.scene.traverse((o) => { if (o.isSprite && shown(o)) outT.push((o.material?.map?.image?.__texts ?? []).join(' ')); });
      return outT;
    },
    /** Image de l'intérieur rendue maintenant : couleur moyenne de trois bandes horizontales (haut, milieu, bas). */
    frameStats: () => {
      const sc = window.__bc.scene, r = sc.renderer, gl = r.getContext();
      r.render(sc.interior.view.scene, sc.camera);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const bands = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      for (let y = 0; y < h; y += 2) {
        const b = bands[Math.min(2, Math.floor(((h - 1 - y) / h) * 3))];
        for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; b[0] += px[i]; b[1] += px[i + 1]; b[2] += px[i + 2]; b[3]++; }
      }
      return bands.map(([R, G, B, n]) => [R / n, G / n, B / n].map((v) => Math.round(v * 10) / 10));
    },
  };
}
/** Plus grand écart (0..255) entre deux mesures frameStats, bande par bande. */
const frameDiff = (a, b) => Math.max(...a.flatMap((band, i) => band.map((v, k) => Math.abs(v - b[i][k]))));
const bandDiff = (a, b, i) => Math.max(...a[i].map((v, k) => Math.abs(v - b[i][k])));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(pageTools);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ev = (f, a) => page.evaluate(f, a);
  /** Capture d'écran (documentation : un délai dépassé est signalé sans arrêter la suite). */
  const shot = async (n) => {
    const p = join(out, `${n}.png`);
    try { await page.screenshot({ path: p, timeout: 120000 }); shots.push(p); } catch (e) { console.log(`(capture ${n} impossible : ${e.message.split('\n')[0]})`); }
  };
  const pause = () => ev(() => window.__bc.setSpeed(0));
  /** Attend qu'une condition soit vraie dans la page (au plus `ms`), sans échouer : la vérification suit. */
  const waitFor = (fn, arg = null, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
  const service = (kind) => ev((k) => window.__bc.game.district.buildings.find((b) => b.service === k).id, kind);
  const shopBuilding = () => ev(() => window.__bc.game.premise(window.__bc.game.shops[0].premiseId).buildingId);
  const at = (day, h, m = 0) => day * 1440 + h * 60 + m;
  const toastMark = () => ev(() => window.__toastLog.length);
  const noticeMark = () => ev(() => window.__noticeLog.length);

  /**
   * Clic réel (souris) au centre de l'élément : défilement, mesure et contrôle de ce qui est sous le pointeur en une
   * seule évaluation (le panneau peut être redessiné entre deux allers-retours ; le bouton redessiné reste en place).
   */
  const tap = async (sel, text = null) => {
    for (let k = 0; k < 40; k++) {
      const b = await ev(([s, t]) => {
        const e = [...document.querySelectorAll(s)].find((x) => x.isConnected && (!t || x.textContent.includes(t)));
        if (!e) return null;
        e.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = e.getBoundingClientRect();
        if (!r.width) return null;
        const x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
        return hit && (hit === e || e.contains(hit)) ? { x, y } : null;
      }, [sel, text]).catch(() => null);
      if (b) { await page.mouse.click(b.x, b.y); await page.waitForTimeout(200); return; }
      await page.waitForTimeout(200);
    }
    await shot('echec-tap');
    throw new Error(`élément introuvable ou masqué : ${sel}${text ? ` « ${text} »` : ''}`);
  };
  const goIn = async (buildingId) => {
    await closeRecap();
    await ev((b) => window.__bc.toDoor(b), buildingId);
    await page.waitForTimeout(250);
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
  };
  /**
   * Ferme le récapitulatif de fin de journée s'il est affiché. La fermeture relance le jeu (vitesse 1) : pause dans la
   * même évaluation, sinon quelques images passent à vitesse 1 (à 23 h 59, minuit sonnerait hors de advanceTo).
   */
  const closeRecap = async () => {
    for (let k = 0; k < 4 && await ev(() => !!document.querySelector('.recap')); k++) {
      await ev(() => { document.querySelector('.recap button.primary')?.click(); window.__bc.setSpeed(0); });
      await page.waitForTimeout(200);
    }
    await pause();
  };
  /**
   * Avance la partie jusqu'à la minute `target` (par tranches d'une heure, personnage nourri et reposé ; à chaque
   * nouveau jour, les augmentations demandées sont accordées, comme le ferait un patron attentif). Si un jour passe,
   * attend le récapitulatif (et le ferme sauf `keepRecap`).
   */
  const advanceTo = async (target, keepRecap = false) => {
    const days = await ev((t) => {
      const b = window.__bc, g = b.game, d0 = g.day;
      while (g.total < t) {
        b.keepAlive();
        const d = g.day;
        b.advance(Math.min(60, t - g.total));
        if (g.day !== d) for (const e of g.employees) if (e.askedRaise) g.raiseWage(e.id, g.marketWage(e.skill, e.training ?? 0) + 1);
      }
      b.keepAlive();
      return g.day - d0;
    }, target);
    if (days > 0) {
      await page.waitForSelector('.recap', { timeout: 60000 }).catch(() => {});
      if (!keepRecap) await closeRecap();
    }
    await pause();
    return days;
  };
  const phoneIsOpen = () => ev(() => !document.querySelector('.phone')?.classList.contains('hidden'));
  const phoneOpen = async (app) => {
    await closeRecap();
    if (!(await phoneIsOpen())) {
      await page.keyboard.press('t');
      await page.waitForFunction(() => !document.querySelector('.phone').classList.contains('hidden'), null, { timeout: 60000 });
    }
    await ev((a) => { document.querySelector('.phone .ph-back')?.click(); document.querySelector(`.ph-app[data-app="${a}"]`).click(); }, app);
    await page.waitForFunction(() => !!document.querySelector('.phone .ph-body'), null, { timeout: 60000 });
  };
  /** Ferme le téléphone : Échap revient à l'accueil, puis fermeture et pause dans la même évaluation (voir closeRecap). */
  const phoneClose = async () => {
    if (await ev(() => !!document.querySelector('.phone .ph-back'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await ev(() => { const v = document.querySelector('.ph-veil'); if (v && !v.classList.contains('hidden')) v.click(); window.__bc.setSpeed(0); });
    await pause();
  };
  /** Panneau du commerce : depuis la barre intérieure (sur place) ou depuis le téléphone (à distance). */
  const openShopPanel = async (tabLabel = 'Aperçu') => {
    await closeRecap();
    if (await phoneIsOpen()) await phoneClose();
    if (await ev(() => window.__bc.state().inside?.kind === 'shop')) await tap('.ibar button', 'Gestion');
    else {
      await phoneOpen('commerces');
      await ev(() => { [...document.querySelectorAll('.phone .ph-body button')].find((b) => b.textContent.trim() === 'Gérer').click(); window.__bc.setSpeed(0); });
    }
    await page.waitForFunction(() => !!document.querySelector('#panel .sp-tabs'), null, { timeout: 60000 });
    await pause();
    await shopTab(tabLabel);
  };
  const shopTab = async (label) => {
    await tap('#panel .sp-tabs button', label);
    await page.waitForFunction((l) => [...document.querySelectorAll('#panel .sp-tabs button')].some((b) => b.classList.contains('on') && b.textContent.includes(l)), label, { timeout: 60000 });
  };
  const closePanel = async () => { if (await ev(() => !document.getElementById('panel').classList.contains('hidden'))) { await ev(() => document.querySelector('#panel .icon-x')?.click()); await page.waitForTimeout(150); } };
  /** Planning des caissiers de l'onglet Employés, comparé aux heures sans caissier de la partie. */
  const readPlanning = () => ev(() => {
    const g = window.__bc.game, s = g.shops[0];
    const cells = [...document.querySelectorAll('#panel .emp-hours .emp-hour')].map((c) => ({ h: Number(c.textContent), bad: c.classList.contains('bad') }));
    const gapH = new Set(g.cashierGaps(s.id).flatMap(([a, b]) => Array.from({ length: b - a }, (_, k) => a + k)));
    return {
      n: cells.length, hours: s.close - s.open, gaps: g.cashierGaps(s.id),
      consistent: cells.every((c, k) => c.h === s.open + k && c.bad === gapH.has(c.h)),
      alert: document.querySelector('#panel .emp-alert')?.textContent ?? null,
      aside: [...document.querySelectorAll('#panel .sp-sec')].find((x) => x.textContent.startsWith('Caissiers par heure'))?.querySelector('em')?.textContent ?? null,
    };
  });

  /* ------------------------------ 0. Démarrage ------------------------------ */
  section('Démarrage');
  await page.goto(`${base}/index.html?seed=7&nouveau`);
  await page.waitForSelector('.menu-card', { timeout: 120000 });
  await page.fill('.menu-card input', 'Test V7');
  await tap('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready, null, { timeout: 60000 });
  await pause();
  await ev(() => window.__qa.logNotices());
  await ev(() => window.__bc.exitInterior());
  // Caméra de rue vers le sol, au plus près (gardée d'une sortie à l'autre) : la rue entière coûte plusieurs secondes
  // par image en rendu logiciel ; les panneaux des services n'en ont pas besoin.
  await ev(() => Object.assign(window.__bc.cam, { pitch: 1.4, dist: 2.5 }));
  check(await ev(() => window.__bc.state().inside === null && window.__bc.game.total <= 7 * 60 + 2), 'partie neuve, dans la rue à 7 h (jeu en pause)', await ev(() => String(window.__bc.game.total)));

  /* ------------------------------ 1. Mise en place : café loué, meublé, approvisionné ------------------------------ */
  section('Mise en place (café)');
  const free = await ev(() => { const g = window.__bc.game; return g.district.premises.filter((p) => g.isFree(p)).sort((a, b) => b.footfall - a.footfall)[0].buildingId; });
  await goIn(free);
  await page.waitForSelector('#panel select', { timeout: 60000 });
  await ev(() => { const s = [...document.querySelectorAll('#panel select')].find((e) => [...e.options].some((o) => o.value === 'cafe')); window.__qa.pick(s, 'cafe'); });
  await page.fill('#panel input[type=text]', 'Café V7');
  await tap('#panel button', 'Signer le bail');
  await page.waitForFunction(() => window.__bc.state().inside?.kind === 'shop', null, { timeout: 60000 }).catch(() => {});
  check(await ev(() => window.__bc.state().inside?.kind === 'shop' && window.__bc.game.shops[0]?.type === 'cafe'), 'bail signé : café loué, entrée dans le local');
  await goIn(await service('meubles'));
  await page.waitForFunction(() => [...document.querySelectorAll('#panel tr b')].some((b) => b.textContent === 'Machine à café'), null, { timeout: 60000 });
  // Achats ligne par ligne : quantité puis « Acheter » dans la même action DOM.
  for (const [name, q] of [['Caisse', 1], ['Machine à café', 1], ['Comptoir', 1], ['Vitrine à pâtisseries', 1], ['Vitrine réfrigérée', 1], ['Table et 4 chaises', 2], ['Plante', 1], ['Lampadaire design', 1]]) {
    await ev(([n, qty]) => {
      const tr = [...document.querySelectorAll('#panel tr')].find((r) => r.querySelector('b')?.textContent === n);
      const i = tr.querySelector('input.qty'); i.value = String(qty); i.dispatchEvent(new Event('change', { bubbles: true }));
      [...tr.querySelectorAll('button')].find((b) => b.textContent.includes('Acheter')).click();
    }, [name, q]);
    await page.waitForTimeout(120);
  }
  // Pose par l'outil de test (l'aménagement à la souris est couvert par e2e.mjs) : chaque meuble à la première place
  // libre qui laisse tout accessible.
  const layout = await ev(() => {
    const g = window.__bc.game, s = g.shops[0], p = g.premise(s.premiseId);
    for (const f of ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'plante', 'lampe']) {
      let done = false;
      for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
        const r = g.place(s.id, f, x, z, 0);
        if (!r.ok) continue;
        if (g.stats(s).blocked.length === 0) done = true; else g.pickUp(s.id, r.data.uid);
      }
    }
    const st = g.stats(s);
    return { items: s.items.length, reserve: s.storage, registers: st.registers, machines: st.machines, blocked: st.blocked.length, grid: [p.gridW, p.gridD] };
  });
  check(layout.items === 9 && layout.registers === 1 && layout.machines === 1 && layout.blocked === 0, 'café meublé (9 meubles, une caisse, une machine, tout accessible)', JSON.stringify(layout));
  // Stock : commandes livrées à 14 h (passées avant midi) et réassort automatique, par l'outil de test.
  const orders = await ev(() => { const g = window.__bc.game, s = g.shops[0]; for (const id of Object.keys(s.products)) { const q = g.room(s, id); if (q > 0) g.order(s.id, id, q); g.setAuto(s.id, id, true); } return g.orders.map((o) => o.deliverAt); });
  check(orders.length === 5 && orders.every((t) => t === at(0, 14)), 'commandes de stock passées (livraison à 14 h, réassort automatique)', JSON.stringify(orders));

  /* ------------------------------ 2. Agence pour l'emploi : souhaits, rôle, équipe ------------------------------ */
  section('Agence pour l’emploi : souhaits, rôle et équipe');
  await goIn(await service('emploi'));
  await page.waitForFunction(() => document.querySelectorAll('#panel .emp-wish').length >= 4, null, { timeout: 60000 });
  await shot('01-agence-souhaits');
  const cands = await ev(() => {
    const g = window.__bc.game, word = { journee: 'journée complète', matin: 'matin', soir: 'soir' };
    return window.__qa.candRows().map((r, k) => {
      const c = g.candidates[k], shiftSel = r.querySelector('select[aria-label="Équipe"]'), roleSel = r.querySelector('select[aria-label="Rôle"]');
      const wish = r.querySelector('.emp-wish').textContent;
      return {
        id: c.id, name: c.name, want: c.wantShift, minWage: c.minWage, wage: c.wage,
        nameOk: r.querySelector('b').textContent === c.name,
        wishOk: wish.toLowerCase().includes(word[c.wantShift]) && wish.includes(`${c.minWage} CHF`),
        starred: [...shiftSel.options].filter((o) => o.textContent.includes('★')).map((o) => o.value),
        roles: [...roleSel.options].map((o) => o.value), shifts: [...shiftSel.options].map((o) => o.value), wish,
      };
    });
  });
  check(cands.length === await ev(() => window.__bc.game.candidates.length) && cands.every((c) => c.nameOk && c.wishOk), 'agence : chaque candidat affiche son souhait (équipe, salaire minimum)', JSON.stringify(cands.map((c) => c.wish)));
  check(cands.every((c) => c.starred.length === 1 && c.starred[0] === c.want), 'agence : l’équipe souhaitée est marquée ★ dans le menu des équipes', JSON.stringify(cands.map((c) => [c.want, c.starred])));
  check(cands.every((c) => c.roles.join() === 'caisse,rayon,entretien' && c.shifts.slice().sort().join() === 'journee,matin,soir'), 'agence : choix du rôle (caisse, rayon, entretien) et de l’équipe (matin, soir, journée)');
  // Candidats retenus selon leurs souhaits (indépendant des tirages) : A caissier du matin, B caissière du soir,
  // C agent d'entretien en journée, D embauché sur une équipe qu'il ne souhaite pas (puis licencié).
  const pickC = (want, taken) => cands.find((c) => c.want === want && !taken.includes(c.id)) ?? cands.find((c) => !taken.includes(c.id));
  const A = pickC('matin', []), B = pickC('soir', [A.id]), C = pickC('journee', [A.id, B.id]), D = cands.find((c) => ![A.id, B.id, C.id].includes(c.id));
  const dShift = D.want === 'matin' ? 'soir' : 'matin';
  const SHIFT_NAME = { journee: 'Journée complète', matin: 'Matin', soir: 'Soir' };
  // Équipe du soir : de 14 h à la fermeture du café (horaires du type, lus dans la partie).
  const close = await ev(() => window.__bc.game.shops[0].close);
  const gapTxt = `de 14 h à ${close} h`;
  console.log('candidats retenus :', JSON.stringify({ A: [A.name, A.want], B: [B.name, B.want], C: [C.name, C.want], D: [D.name, D.want, '→', dShift] }));
  /** Embauche par l'agence : commerce, rôle et équipe choisis dans les menus du candidat, puis « Embaucher ». */
  const hire = async (cand, role, shift) => {
    const n0 = await ev(() => window.__bc.game.employees.length);
    const okSel = await ev(([id, r, s]) => {
      const g = window.__bc.game, k = g.candidates.findIndex((c) => c.id === id), row = window.__qa.candRows()[k];
      const ok = window.__qa.pick(row.querySelector('select[aria-label="Rôle"]'), r) && window.__qa.pick(row.querySelector('select[aria-label="Équipe"]'), s);
      [...row.querySelectorAll('button')].find((b) => b.textContent === 'Embaucher').click();
      return ok;
    }, [cand.id, role, shift]);
    await page.waitForFunction((n) => window.__bc.game.employees.length > n, n0, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(200);
    return okSel && await ev((n) => window.__bc.game.employees.length === n + 1, n0);
  };
  let nm = await noticeMark();
  const hiredA = await hire(A, 'caisse', 'matin');
  const eA = await ev((id) => window.__bc.game.employees.find((e) => e.id === id) ?? null, A.id);
  check(hiredA && eA?.role === 'caisse' && eA.shift === 'matin' && eA.wantShift === A.want && eA.minWage === A.minWage && eA.shopId === await ev(() => window.__bc.game.shops[0].id), 'embauche : caissier du matin (rôle, équipe et souhaits enregistrés)', JSON.stringify(eA));
  check((await ev(([m]) => window.__qa.notices(m, 'préférait').length, [nm])) === (A.want === 'matin' ? 0 : 1), 'embauche sur l’équipe souhaitée : aucun avertissement de souhait');
  // Planning avec un seul caissier (matin) : trou de 14 h à la fermeture (onglet Employés, ouvert depuis le téléphone).
  await openShopPanel('Employés');
  let plan = await readPlanning();
  await shot('02-employes-trou-planning');
  check(plan.n === plan.hours && plan.consistent && JSON.stringify(plan.gaps) === JSON.stringify([[14, close]]), `onglet Employés : planning heure par heure (caissier du matin seul, 14 h – ${close} h en rouge)`, JSON.stringify({ n: plan.n, gaps: plan.gaps, ok: plan.consistent }));
  check(!!plan.alert && plan.alert.includes(gapTxt) && plan.aside === 'trou dans le planning', `onglet Employés : alerte de trou sans caissier (${gapTxt})`, JSON.stringify({ alert: plan.alert, aside: plan.aside }));
  await closePanel();

  await goIn(await service('emploi'));
  await page.waitForFunction(() => document.querySelectorAll('#panel .emp-wish').length >= 3, null, { timeout: 60000 });
  const hiredB = await hire(B, 'caisse', 'soir');
  const hiredC = await hire(C, 'entretien', 'journee');
  nm = await noticeMark();
  let tm = await toastMark();
  const hiredD = await hire(D, 'rayon', dShift);
  const team = await ev(() => window.__bc.game.employees.map((e) => [e.name, e.role, e.shift]));
  check(hiredB && hiredC && hiredD && team.length === 4, 'embauches : caissière du soir, agent d’entretien en journée, employé de rayon', JSON.stringify(team));
  const wishWarn = `préférait l’équipe « ${SHIFT_NAME[D.want]} »`;
  await waitFor(([m, w]) => window.__qa.toasts(m, w).length > 0, [tm, wishWarn]);
  check((await ev(([m, w]) => window.__qa.notices(m, w).length, [nm, wishWarn])) === 1 && (await ev(([m, w]) => window.__qa.toasts(m, w).length, [tm, wishWarn])) >= 1, 'embauche hors souhait : avertissement affiché (notification)', wishWarn);
  const dRow = await ev((n) => window.__qa.empRow(n)?.textContent ?? null, D.name);
  check(!!dRow && dRow.includes('Mécontent') && dRow.includes(`préfère l’équipe « ${SHIFT_NAME[D.want]} »`), 'agence, « Vos employés » : souhait non respecté signalé (Mécontent)', dRow?.slice(0, 160));
  await ev((n) => [...window.__qa.empRow(n).querySelectorAll('button')].find((b) => b.textContent === 'Licencier').click(), D.name);
  await page.waitForTimeout(300);
  check(await ev((id) => !window.__bc.game.employees.some((e) => e.id === id), D.id), 'licenciement depuis l’agence');

  // Planning couvert, puis changements de rôle et d'équipe depuis l'onglet Employés.
  await openShopPanel('Employés');
  plan = await readPlanning();
  check(plan.consistent && plan.gaps.length === 0 && plan.alert === null && plan.aside === 'caisse toujours tenue', 'onglet Employés : matin + soir, caisse toujours tenue (aucune alerte)', JSON.stringify(plan));
  const hoursTxt = await ev(([a, b]) => [window.__qa.empRow(a)?.textContent ?? '', window.__qa.empRow(b)?.textContent ?? ''], [A.name, B.name]);
  const open = await ev(() => window.__bc.game.shops[0].open);
  check(hoursTxt[0].includes(`Travaille ${14 - open} h / jour`) && hoursTxt[1].includes(`Travaille ${close - 14} h / jour`), `onglet Employés : heures travaillées selon l’équipe (matin ${14 - open} h, soir ${close - 14} h)`, JSON.stringify(hoursTxt.map((t) => t.match(/Travaille[^)]*\)/)?.[0])));
  await shot('03-employes-planning-couvert');
  nm = await noticeMark();
  await ev((n) => window.__qa.pick(window.__qa.empRow(n).querySelector('select[aria-label="Rôle"]'), 'rayon'), B.name);
  await page.waitForTimeout(400);
  plan = await readPlanning();
  check(await ev((id) => window.__bc.game.employees.find((e) => e.id === id).role === 'rayon', B.id) && plan.consistent && !!plan.alert?.includes(gapTxt), 'rôle changé (caisse → rayon) : le trou réapparaît dans le planning', JSON.stringify({ gaps: plan.gaps, alert: plan.alert }));
  check((await ev(([m, t]) => window.__qa.notices(m, `aucun caissier ${t}`).length, [nm, gapTxt])) === 1, `rôle changé : avertissement « aucun caissier ${gapTxt} »`);
  await ev((n) => window.__qa.pick(window.__qa.empRow(n).querySelector('select[aria-label="Rôle"]'), 'caisse'), B.name);
  await page.waitForTimeout(400);
  plan = await readPlanning();
  check(plan.gaps.length === 0 && plan.alert === null, 'rôle rétabli (rayon → caisse) : plus de trou');
  nm = await noticeMark();
  const otherShift = A.want === 'journee' ? 'soir' : 'journee';
  await ev(([n, s]) => window.__qa.pick(window.__qa.empRow(n).querySelector('select[aria-label="Équipe"]'), s), [A.name, otherShift]);
  await page.waitForTimeout(400);
  const aRow = await ev((n) => window.__qa.empRow(n)?.textContent ?? '', A.name);
  check(await ev(([id, s]) => window.__bc.game.employees.find((e) => e.id === id).shift === s, [A.id, otherShift]) && (await ev(([m, w]) => window.__qa.notices(m, w).length, [nm, `préfère l’équipe « ${SHIFT_NAME[A.want]} »`])) === 1 && aRow.includes('Mécontent'), 'équipe changée hors souhait : avertissement et « Mécontent »', aRow.match(/Mécontent[^]*?»/)?.[0] ?? '');
  await ev((n) => window.__qa.pick(window.__qa.empRow(n).querySelector('select[aria-label="Équipe"]'), 'matin'), A.name);
  await page.waitForTimeout(400);
  check(await ev((id) => window.__bc.game.employees.find((e) => e.id === id).shift === 'matin', A.id) && (A.want !== 'matin' || !(await ev((n) => window.__qa.empRow(n)?.textContent ?? '', A.name)).includes('Mécontent')), 'équipe rétablie (matin) : plus de mécontentement');
  await closePanel();

  /* ------------------------------ 3. Dans le café : employés visibles, entretien ------------------------------ */
  section('Employés de service visibles ; entretien et propreté');
  await goIn(await shopBuilding());
  check(await ev(() => window.__bc.state().inside?.kind === 'shop'), 'retour dans le café (E)');
  // Les employés affichés sont relus par la boucle de rendu (deux fois par seconde de jeu affiché).
  await waitFor(() => { const g = window.__bc.game, a = window.__bc.agents(); return !!a && JSON.stringify(a.staff.map((s) => s.id).sort()) === JSON.stringify(g.onDuty(g.shops[0].id).map((e) => e.id).sort()); });
  const vis1 = await ev(() => { const g = window.__bc.game; return { shown: window.__bc.agents().staff.map((s) => s.id).sort(), duty: g.onDuty(g.shops[0].id).map((e) => e.id).sort(), h: Math.floor((g.total % 1440) / 60) }; });
  check(JSON.stringify(vis1.shown) === JSON.stringify(vis1.duty) && vis1.duty.length === 2 && vis1.duty.includes(A.id) && vis1.duty.includes(C.id), 'le matin : caissier du matin et agent d’entretien visibles, pas la caissière du soir', JSON.stringify(vis1));
  await openShopPanel();
  let apercu = await ev(() => document.getElementById('panel').textContent);
  const power = Number(apercu.match(/Entretien de l’équipe présente : \+(\d+) points par heure/)?.[1] ?? 0);
  check(power > 0, 'Aperçu : entretien de l’équipe présente affiché (+N points par heure)', `+${power}`);
  await closePanel();
  // Propreté ramenée à 60 % par l'outil de test (aucun client servi avant la livraison de 14 h : seul l'entretien joue).
  const t3 = await ev(() => { const g = window.__bc.game; g.shops[0].clean = 60; return g.total; });
  const tickA = Math.floor(t3 / 60) * 60 + 60;
  await advanceTo(tickA + 120);
  const cMaint = await ev(() => window.__bc.game.cleanliness(window.__bc.game.shops[0]));
  check(cMaint - 60 >= 1.5 * power, 'un employé d’entretien fait remonter la propreté (3 heures)', `60 → ${cMaint.toFixed(1)} %`);
  await openShopPanel('Employés');
  await ev((n) => window.__qa.pick(window.__qa.empRow(n).querySelector('select[aria-label="Rôle"]'), 'rayon'), C.name);
  await page.waitForTimeout(300);
  await shopTab('Aperçu');
  apercu = await ev(() => document.getElementById('panel').textContent);
  check(apercu.includes('Aucun employé d’entretien présent'), 'Aperçu : plus d’employé d’entretien présent (rôle passé à rayon)');
  await closePanel();
  await advanceTo(tickA + 240);
  const cCtrl = await ev(() => window.__bc.game.cleanliness(window.__bc.game.shops[0]));
  check(cCtrl <= cMaint + 0.01, 'sans employé d’entretien, la propreté ne remonte pas (2 heures)', `${cMaint.toFixed(1)} → ${cCtrl.toFixed(1)} %`);
  await openShopPanel('Employés');
  await ev((n) => [...window.__qa.empRow(n).querySelectorAll('button')].find((b) => b.textContent === 'Licencier').click(), C.name);
  await page.waitForTimeout(300);
  check(await ev((id) => !window.__bc.game.employees.some((e) => e.id === id), C.id), 'licenciement depuis l’onglet Employés');
  await closePanel();
  await advanceTo(at(0, 15, 10));
  await waitFor(() => { const g = window.__bc.game, a = window.__bc.agents(); return !!a && JSON.stringify(a.staff.map((s) => s.id).sort()) === JSON.stringify(g.onDuty(g.shops[0].id).map((e) => e.id).sort()); });
  const vis2 = await ev(() => { const g = window.__bc.game; return { shown: window.__bc.agents().staff.map((s) => s.id).sort(), duty: g.onDuty(g.shops[0].id).map((e) => e.id).sort() }; });
  check(JSON.stringify(vis2.shown) === JSON.stringify(vis2.duty) && JSON.stringify(vis2.duty) === JSON.stringify([B.id]), 'l’après-midi : seule la caissière du soir est visible', JSON.stringify(vis2));
  check(await ev(() => Object.values(window.__bc.game.shops[0].products).every((p) => p.stock > 0)), 'stock livré à 14 h');

  /* ------------------------------ 4. Banque, publicité, appli Finances ------------------------------ */
  section('Guichet de la banque : plafond de crédit');
  await goIn(await service('banque'));
  await page.waitForFunction(() => [...document.querySelectorAll('#panel .kpi span')].some((s) => s.textContent === 'Plafond'), null, { timeout: 60000 });
  const kpiPlafond = () => ev(() => [...document.querySelectorAll('#panel .kpi')].find((k) => k.querySelector('span').textContent === 'Plafond')?.querySelector('b').textContent);
  const bank0 = await ev(() => { const g = window.__bc.game; return { limit: g.creditLimit().limit, chf: window.__qa.chf(g.creditLimit().limit), base: g.taxEstimate().base, debt: g.debt }; });
  check(await kpiPlafond() === bank0.chf, 'banque : plafond de crédit affiché au guichet', `${await kpiPlafond()} (partie : ${bank0.chf})`);
  await tap('#panel .item button', 'Emprunter'); // 1re offre affichée : 10 000 CHF
  await page.waitForTimeout(300);
  const offers = await ev(() => [...document.querySelectorAll('#panel .item')].filter((i) => i.querySelector('button')?.textContent === 'Emprunter').map((i) => i.querySelector('b').textContent));
  const loan1 = await ev(() => { const g = window.__bc.game; return { n: g.loans.length, debt: g.debt, limit: g.creditLimit().limit, base: g.taxEstimate().base }; });
  check(loan1.n === 1 && loan1.limit !== bank0.limit && await kpiPlafond() === await ev((v) => window.__qa.chf(v), loan1.limit), 'prêt accordé ; le plafond affiché suit la nouvelle valeur nette', JSON.stringify({ avant: bank0.limit, après: loan1.limit, affiché: await kpiPlafond() }));
  check(Math.abs(loan1.base - bank0.base) < 0.01, 'un prêt reçu ne compte pas dans le bénéfice imposable', `${bank0.base} → ${loan1.base}`);
  // La plus grosse offre, deux fois : la seconde dépasse le plafond.
  tm = await toastMark();
  let refused = null;
  for (let k = 0; k < 4 && !refused; k++) {
    await ev(() => { const it = [...document.querySelectorAll('#panel .item')].filter((i) => i.querySelector('button')?.textContent === 'Emprunter').at(-1); it.querySelector('button').click(); });
    await page.waitForTimeout(300);
    refused = (await ev((m) => window.__qa.toasts(m, 'La banque refuse'), tm))[0] ?? null;
  }
  const loans2 = await ev(() => { const g = window.__bc.game; return { n: g.loans.length, debt: g.debt, limit: g.creditLimit().limit, txt: Math.round(g.creditLimit().limit).toLocaleString('fr-CH') }; });
  check(!!refused && refused.kind.includes('error') && refused.text.includes(`plafond de crédit ${loans2.txt} CHF`) && loans2.debt <= loans2.limit, 'prêt au-delà du plafond refusé, message avec le plafond', JSON.stringify({ toast: refused?.text.slice(0, 120), dette: loans2.debt, plafond: loans2.limit, offres: offers }));
  await shot('04-banque-plafond');
  // Remboursement anticipé de tous les prêts (« Solder ») : le capital rendu n'est pas une charge de l'exercice.
  const before = await ev(() => { const g = window.__bc.game; return { base: g.taxEstimate().base, loans: g.loans.map((l) => ({ amount: l.amount, repay: g.repayAmount(l) })) }; });
  for (let k = 0; k < 6 && await ev(() => window.__bc.game.loans.length > 0); k++) { await tap('#panel button', 'Solder'); await page.waitForTimeout(300); }
  const after = await ev(() => { const g = window.__bc.game; return { base: g.taxEstimate().base, n: g.loans.length }; });
  const interest = before.loans.reduce((a, l) => a + l.repay - l.amount, 0);
  check(after.n === 0, 'prêts soldés au guichet');
  check(after.base >= before.base - interest - 1, 'rembourser le capital d’un prêt ne diminue pas le bénéfice imposable (seuls les intérêts sont une charge)', JSON.stringify({ avant: before.base, après: after.base, intérêts: Math.round(interest), capital: before.loans.reduce((a, l) => a + l.amount, 0) }));
  await closePanel();

  section('Publicité et notoriété');
  await goIn(await service('pub'));
  await page.waitForFunction(() => [...document.querySelectorAll('#panel .item b')].some((b) => b.textContent === 'Distribution de flyers'), null, { timeout: 60000 });
  const promised = await ev(() => Number([...document.querySelectorAll('#panel .item')].find((i) => i.querySelector('b')?.textContent === 'Distribution de flyers')?.textContent.match(/\+(\d+) % de clients dès le lancement/)?.[1] ?? NaN));
  await ev(() => {
    const it = [...document.querySelectorAll('#panel .item')].find((i) => i.querySelector('b')?.textContent === 'Distribution de flyers');
    window.__qa.pick(it.querySelector('select[aria-label="Durée"]'), '3');
    [...it.querySelectorAll('button')].find((b) => b.textContent === 'Lancer').click();
  });
  await page.waitForTimeout(300);
  const aw0 = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { n: g.campaigns.length, days: g.campaigns[0]?.daysLeft, aw: g.awareness[s.id] ?? 0, view: g.awarenessView(s.id) }; });
  check(aw0.n === 1 && aw0.days === 3 && Math.abs(aw0.aw * 100 - promised) < 1e-6, `campagne de flyers (3 jours) : notoriété +${promised} % dès le lancement, comme annoncé à l’agence`, JSON.stringify(aw0));
  await closePanel();

  section('Appli Finances du téléphone');
  await goIn(await shopBuilding());
  await phoneOpen('finances');
  await shot('05-finances');
  const readFin = () => ev(() => {
    document.querySelector('.phone .ph-back')?.click();
    document.querySelector('.ph-app[data-app="finances"]').click();
    const g = window.__bc.game, body = document.querySelector('.phone .ph-body'), q = window.__qa;
    const tiles = Object.fromEntries([...body.querySelectorAll('.ph-tile')].map((t) => [t.querySelector('span').textContent, t.querySelector('b').textContent]));
    const secs = Object.fromEntries([...body.querySelectorAll('.ph-sec')].map((s) => [s.querySelector('span').textContent, s.querySelector('em')?.textContent ?? '']));
    const cards = [...body.querySelectorAll('.ph-card')].map((c) => ({ title: c.querySelector('.ph-card-id b')?.textContent, text: c.textContent }));
    const cl = g.creditLimit(), tx = g.taxEstimate();
    return {
      tiles, secs, cards, text: body.textContent,
      // Chiffres des tuiles coupés à l'affichage (points de suspension) : largeur nécessaire et visible, en pixels.
      clipped: [...body.querySelectorAll('.ph-tile b')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => `${b.textContent} (${b.scrollWidth} px pour ${b.clientWidth})`),
      expect: { worth: q.chf(cl.worth), placed: q.chf(g.investValue()), limit: q.chf(cl.limit), available: q.chf(cl.available), tax: tx.exempt ? 'exonéré' : q.chf(tx.due), week: tx.week, exempt: tx.exempt, daysLeft: tx.daysLeft },
    };
  });
  let fin = await readFin();
  check(fin.tiles['Valeur nette'] === fin.expect.worth && fin.tiles['Placements'] === fin.expect.placed && fin.tiles['Impôt estimé'] === 'exonéré', 'Finances : valeur nette, placements, impôt estimé (semaine 1 exonérée)', JSON.stringify(fin.tiles));
  check(fin.clipped.length === 0, 'Finances : chiffres des tuiles lisibles en entier (sans troncature)', JSON.stringify(fin.clipped));
  check(fin.cards.some((c) => c.title === 'Semaine 1' && c.text.includes('exonérée')), 'Finances : carte d’impôt « Semaine 1 », exonération affichée');
  check(fin.secs['Plafond de crédit'] === fin.expect.limit && fin.cards.some((c) => c.title === `Encore ${fin.expect.available} empruntables`), 'Finances : plafond de crédit et crédit disponible', JSON.stringify({ affiché: fin.secs['Plafond de crédit'], partie: fin.expect.limit }));
  const notoCard = fin.cards.find((c) => c.title === 'Café V7');
  check(!!notoCard && notoCard.text.includes(`+${Math.round(aw0.view.now * 100)} % de clients`) && notoCard.text.includes('1 campagne en cours') && notoCard.text.includes('▲'), 'Finances : notoriété du café (campagne en cours, tendance en hausse)', notoCard?.text.slice(0, 140));
  /** Placement : montant saisi et bouton de la carte, dans la même action DOM. */
  const investAct = (name, amount, label) => ev(([n, a, l]) => {
    document.querySelector('.phone .ph-back')?.click();
    document.querySelector('.ph-app[data-app="finances"]').click();
    const card = [...document.querySelectorAll('.phone .ph-card')].find((c) => c.querySelector('.ph-card-id b')?.textContent === n);
    const inp = card.querySelector('input.fin-amount');
    if (a !== null) { inp.value = String(a); inp.dispatchEvent(new Event('input', { bubbles: true })); }
    [...card.querySelectorAll('button')].find((b) => b.textContent === l).click();
  }, [name, amount, label]);
  const money0 = await ev(() => window.__bc.game.cash);
  await investAct('Compte épargne', 1000, 'Placer');
  await page.waitForTimeout(300);
  await investAct('Fonds Croissance du quartier', 2000, 'Placer');
  await page.waitForTimeout(300);
  const inv1 = await ev(() => { const g = window.__bc.game; return { cash: g.cash, invest: { ...g.invest }, principal: { ...g.investPrincipal } }; });
  check(Math.abs(money0 - inv1.cash - 3000) < 0.01 && inv1.invest.epargne === 1000 && inv1.invest.fonds === 2000, 'Finances : dépôts (1 000 CHF en épargne, 2 000 CHF dans le fonds) débités de la trésorerie', JSON.stringify(inv1));
  await investAct('Fonds Croissance du quartier', 500, 'Retirer');
  await page.waitForTimeout(400);
  const inv2 = await ev(() => { const g = window.__bc.game; return { cash: g.cash, invest: { ...g.invest }, fee: 1 - g.investValue('fonds') / g.invest.fonds }; });
  check(Math.abs(inv2.cash - inv1.cash - 500 * (1 - inv2.fee)) < 0.01 && inv2.invest.fonds === 1500 && inv2.fee > 0, 'Finances : retrait de 500 CHF du fonds (frais de retrait déduits)', JSON.stringify({ versé: Math.round((inv2.cash - inv1.cash) * 100) / 100, frais: `${Math.round(inv2.fee * 1000) / 10} %`, fonds: inv2.invest.fonds }));
  fin = await readFin();
  const epCard = fin.cards.find((c) => c.title === 'Compte épargne');
  check(fin.tiles['Placements'] === fin.expect.placed && fin.expect.placed === await ev((f) => window.__qa.chf(1000 + 1500 * (1 - f)), inv2.fee) && !!epCard?.text.includes('placés'), 'Finances : placements affichés (valeur de rachat)', JSON.stringify({ tuile: fin.tiles['Placements'] }));
  await shot('06-finances-placements');
  await phoneClose();

  /* ------------------------------ 5. Propreté au fil de la journée ------------------------------ */
  section('Propreté au fil de la journée');
  await advanceTo(at(1, 7, 0));
  const day1 = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { clean: g.cleanliness(s), aw: g.awareness[s.id], ep: g.invest.epargne, fonds: g.invest.fonds, fr: g.fundReturns.slice() }; });
  check(Math.abs(day1.aw - aw0.view.next) < 1e-4 && day1.aw > aw0.view.now, 'notoriété après une nuit : celle annoncée la veille (« tendance pour demain »), en hausse pendant la campagne', JSON.stringify({ veille: aw0.view.now, annoncée: aw0.view.next, matin: day1.aw }));
  check(day1.ep > 1000 && day1.ep < 1001 && day1.fr.length >= 1 && Math.abs(day1.fonds - Math.round(1500 * (1 + day1.fr.at(-1)) * 100) / 100) < 0.011, 'placements après une nuit : intérêts de l’épargne, variation du fonds', JSON.stringify({ épargne: day1.ep, fonds: day1.fonds, variation: day1.fr.at(-1) }));
  await advanceTo(at(1, 18, 59));
  const day1b = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { clean: g.cleanliness(s), customers: s.today.customers, wages: s.today.wages, expected: g.staffOf(s.id).reduce((a, e) => a + e.wage * g.hoursPerDay(e), 0) }; });
  check(day1b.customers > 30 && day1b.clean < day1.clean - 5, 'la propreté baisse au fil de la journée (clients servis, heures d’ouverture)', `${day1.clean.toFixed(1)} → ${day1b.clean.toFixed(1)} % (${day1b.customers} clients)`);
  check(Math.abs(day1b.wages - day1b.expected) < 0.01, 'salaires payés aux seules heures de l’équipe (matin 7 h + soir 5 h)', JSON.stringify({ payés: day1b.wages, attendus: day1b.expected }));

  /* ------------------------------ 6. Alerte, bulle, « Nettoyer », service de nuit ------------------------------ */
  section('Alerte sous 50 %, bulle « C’est sale ici… », Nettoyer, service de nettoyage de nuit');
  // Heure par heure jusqu'au passage sous 50 % (sans entretien ni service : deux à trois jours de clients).
  nm = await noticeMark();
  tm = await toastMark();
  let dirty = null, minAbove = 100;
  for (let k = 0; k < 90 && !dirty; k++) {
    const t = await ev(() => window.__bc.game.total);
    await advanceTo(Math.floor(t / 60) * 60 + 60);
    dirty = await ev((m) => { const g = window.__bc.game, n = window.__qa.notices(m, 'est sale (propreté')[0]; return n ? { clean: g.cleanliness(g.shops[0]), at: n.at, text: n.text } : null; }, nm);
    if (!dirty) minAbove = Math.min(minAbove, await ev(() => window.__bc.game.cleanliness(window.__bc.game.shops[0])));
  }
  await waitFor((m) => window.__qa.toasts(m, 'est sale (propreté').length > 0, tm);
  const saleToast = await ev((m) => window.__qa.toasts(m, 'est sale (propreté'), tm);
  const shownPct = Number(dirty?.text.match(/propreté (\d+) %/)?.[1] ?? 100);
  check(!!dirty && dirty.clean < 50 && shownPct < 50 && saleToast.length >= 1 && saleToast[0].kind.includes('warn'), 'alerte affichée quand la propreté passe sous 50 % (après un à trois jours sans entretien)', JSON.stringify({ propreté: dirty?.clean?.toFixed(1), jour: dirty ? Math.floor(dirty.at / 1440) + 1 : null, heure: dirty ? Math.floor((dirty.at % 1440) / 60) : null, notif: dirty?.text.slice(0, 70), minAvant: minAbove.toFixed(1) }));
  // La barre intérieure est redessinée deux fois par seconde de jeu affiché : attendre qu'elle ait relu la propreté.
  await waitFor(() => { const b = [...document.querySelectorAll('.ibar button')].find((x) => x.textContent.includes('Nettoyer')), g = window.__bc.game; return b?.textContent === `Nettoyer (${Math.round(g.cleanliness(g.shops[0]))} %)`; });
  const ib = await ev(() => { const b = [...document.querySelectorAll('.ibar button')].find((x) => x.textContent.includes('Nettoyer')); const g = window.__bc.game; return { text: b?.textContent, warn: b?.classList.contains('warn'), clean: Math.round(g.cleanliness(g.shops[0])) }; });
  check(ib.warn === true && ib.text === `Nettoyer (${ib.clean} %)`, 'barre intérieure : bouton « Nettoyer (N %) » en alerte sous 50 %', JSON.stringify(ib));
  await openShopPanel();
  const tabAlert = await ev(() => { const t = [...document.querySelectorAll('#panel .sp-tabs button')].find((b) => b.textContent.includes('Aperçu')); const sec = [...document.querySelectorAll('#panel .sp-sec')].find((s) => s.textContent.startsWith('Propreté')); return { alert: t?.classList.contains('alert'), badge: sec?.querySelector('.tag-badge')?.className, txt: document.getElementById('panel').textContent.includes('Magasin sale') }; });
  check(tabAlert.alert && /\bbad\b/.test(tabAlert.badge ?? '') && tabAlert.txt, 'Aperçu : onglet signalé, propreté en rouge, « Magasin sale »', JSON.stringify(tabAlert));
  // Durée et gain du nettoyage annoncés dans l'Aperçu (« prend N minutes de jeu (+G points) »).
  const [cleanMin, cleanGain] = await ev(() => { const m = document.getElementById('panel').textContent.match(/prend (\d+) minutes de jeu \(\+(\d+) points\)/); return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN]; });
  await closePanel();
  // Bulle : propreté abaissée à 8 % par l'outil de test (avis « sale » fréquents), jeu en vitesse rapide.
  await ev(() => {
    const g = window.__bc.game;
    g.shops[0].clean = 8;
    window.__feel = { sale: 0, content: 0 };
    const orig = g.feedback.push.bind(g.feedback);
    g.feedback.push = (...items) => { for (const it of items) if (it.kind in window.__feel) window.__feel[it.kind]++; return orig(...items); };
  });
  const tb = await ev(() => window.__bc.game.total);
  // En pleine journée (le café ferme à 19 h ; au moins six heures d'ouverture devant soi), sinon le lendemain à 8 h.
  if (await ev(() => { const h = Math.floor((window.__bc.game.total % 1440) / 60); return h < 8 || h >= 13; })) {
    const d = await ev(() => window.__bc.game.day);
    const h = await ev(() => Math.floor((window.__bc.game.total % 1440) / 60));
    await advanceTo(h >= 13 ? at(d + 1, 8) : at(d, 8));
    await ev(() => { window.__bc.game.shops[0].clean = 8; });
  }
  await ev(() => window.__bc.setSpeed(2));
  let bubble = false;
  for (let k = 0; k < 200 && !bubble; k++) {
    await page.waitForTimeout(700);
    bubble = await ev(() => window.__qa.spriteTexts().some((t) => t.includes('C’est sale ici')));
    if (await ev(() => window.__bc.game.cleanliness(window.__bc.game.shops[0]) > 30)) await ev(() => { window.__bc.game.shops[0].clean = 8; });
  }
  if (bubble) await shot('07-bulle-sale');
  await pause();
  const feel = await ev(() => window.__feel);
  check(bubble, 'bulle « C’est sale ici… » au-dessus d’un client', `après ${Math.round((await ev(() => window.__bc.game.total) - tb))} min de jeu`);
  check(feel.sale >= 1 && feel.content === 0, 'magasin sale : avis « sale », jamais « Super boutique ! »', JSON.stringify(feel));
  const dirt = await ev(() => { const v = window.__bc.scene.interior.view; return { visible: v.dirt.visible, level: v.dirtLevel }; });
  check(dirt.visible && dirt.level >= 0.8, 'rendu : voile de saleté au sol', JSON.stringify(dirt));
  if (!bubble) await shot('07-bulle-sale');
  // « Nettoyer » (barre intérieure) : 30 minutes de jeu, +45 points, un peu d'énergie.
  await ev(() => { window.__bc.keepAlive(); window.__bc.game.player.energy = 80; });
  const cl0 = await ev(() => { const g = window.__bc.game; return { clean: g.cleanliness(g.shops[0]), total: g.total, energy: g.player.energy, dirt: window.__bc.scene.interior.view.dirtLevel }; });
  tm = await toastMark();
  await tap('.ibar button', 'Nettoyer');
  await waitFor((c) => window.__bc.game.cleanliness(window.__bc.game.shops[0]) > c + 20, cl0.clean, 45000);
  await waitFor((m) => window.__qa.toasts(m, 'Magasin nettoyé').length > 0, tm);
  const cl1 = await ev(() => { const g = window.__bc.game, b = [...document.querySelectorAll('.ibar button')].find((x) => x.textContent.includes('Nettoyer')); return { clean: g.cleanliness(g.shops[0]), total: g.total, energy: g.player.energy, label: b?.textContent, warn: b?.classList.contains('warn'), dirt: window.__bc.scene.interior.view.dirtLevel }; });
  const cleanToast = await ev((m) => window.__qa.toasts(m, 'Magasin nettoyé'), tm);
  check(cl1.clean >= Math.min(100, cl0.clean + cleanGain) - 5 && cl1.total - cl0.total === cleanMin && cl0.energy - cl1.energy > 0, `« Nettoyer » : +${cleanGain} points, ${cleanMin} minutes de jeu, énergie dépensée (comme annoncé)`, JSON.stringify({ avant: cl0.clean.toFixed(1), après: cl1.clean.toFixed(1), minutes: cl1.total - cl0.total, énergie: (cl0.energy - cl1.energy).toFixed(1) }));
  check(cleanToast.length >= 1 && cl1.label === `Nettoyer (${Math.round(cl1.clean)} %)` && cl1.warn === cl1.clean < 50, '« Nettoyer » : message, bouton mis à jour', JSON.stringify({ toast: cleanToast[0]?.text, bouton: cl1.label }));
  check(cl1.dirt < cl0.dirt, 'rendu : moins de saleté au sol après le nettoyage', `${cl0.dirt} → ${cl1.dirt}`);
  // Service de nettoyage de nuit (Aperçu) : souscrit, forfait payé à minuit, magasin impeccable au matin.
  await openShopPanel();
  const fee = await ev(() => window.__bc.game.cleanServiceCost(window.__bc.game.shops[0].id));
  await tap('#panel button', 'Souscrire');
  await page.waitForTimeout(300);
  const svc = await ev(() => ({ on: !!window.__bc.game.shops[0].cleanService, resil: [...document.querySelectorAll('#panel .item')].some((i) => i.textContent.includes('Service de nettoyage de nuit') && [...i.querySelectorAll('button')].some((b) => b.textContent === 'Résilier')) }));
  check(svc.on && svc.resil && fee > 0, 'service de nettoyage de nuit souscrit (bouton « Résilier »)', `${fee} CHF / jour`);
  await closePanel();
  const dN = await ev(() => window.__bc.game.day);
  await advanceTo(at(dN, 23, 59));
  const night0 = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { clean: g.cleanliness(s), wages: s.today.wages }; });
  await advanceTo(at(dN + 1, 0, 1));
  const night1 = await ev(() => { const g = window.__bc.game, s = g.shops[0]; return { clean: g.cleanliness(s), wages: s.history.at(-1).wages }; });
  check(night0.clean < 100 && night1.clean === 100 && Math.abs(night1.wages - night0.wages - fee) < 0.01, 'nuit : magasin remis à 100 %, forfait compté avec le personnel', JSON.stringify({ veille: night0.clean.toFixed(1), matin: night1.clean, forfait: Math.round((night1.wages - night0.wages) * 100) / 100 }));

  /* ------------------------------ 7. Revêtements ------------------------------ */
  section('Revêtements de sol et de murs');
  await advanceTo(at(dN + 1, 6, 30));
  await openShopPanel();
  const surf0 = await ev(() => {
    const g = window.__bc.game, s = g.shops[0], q = window.__qa;
    const rows = [...document.querySelectorAll('#panel .prop-surf')].map((r) => ({ part: r.querySelector('.prop-surf-l').textContent, chips: [...r.querySelectorAll('.prop-chip')].map((c) => ({ name: c.querySelector('b').textContent, small: c.querySelector('small').textContent, on: c.classList.contains('on') })) }));
    return { rows, costSol: g.surfaceCost(s.id, 'sol', 'chene'), costMurs: g.surfaceCost(s.id, 'murs', 'brique'), chfSol: q.chf(g.surfaceCost(s.id, 'sol', 'chene')), chfMurs: q.chf(g.surfaceCost(s.id, 'murs', 'brique')) };
  });
  const sol = surf0.rows.find((r) => r.part === 'Sol'), murs = surf0.rows.find((r) => r.part === 'Murs');
  check(sol?.chips.length === 5 && murs?.chips.length === 5 && sol.chips[0].on && murs.chips[0].on && sol.chips[0].small === 'en place', 'Aperçu : choix du sol (5) et des murs (5), revêtements d’origine en place', JSON.stringify(surf0.rows.map((r) => [r.part, r.chips.length])));
  check(!!sol?.chips.find((c) => c.name === 'Parquet de chêne')?.small.startsWith(surf0.chfSol) && !!murs?.chips.find((c) => c.name === 'Briques apparentes')?.small.startsWith(surf0.chfMurs), 'Aperçu : prix de pose selon la surface du local', `${surf0.chfSol} (sol), ${surf0.chfMurs} (murs)`);
  await closePanel();
  await page.waitForTimeout(800);
  const f0 = await ev(() => window.__qa.frameStats());
  const a0 = await ev(() => window.__bc.game.attractiveness(window.__bc.game.shops[0]));
  await shot('08a-revetements-origine');
  /** Pose d'un revêtement : pastille de l'Aperçu, puis « Faire poser » dans la confirmation. */
  const lay = async (name) => {
    await openShopPanel();
    await tap('#panel .prop-chip', name);
    await page.waitForSelector('.confirm:not(.recap) button.primary', { timeout: 30000 });
    const txt = await ev(() => document.querySelector('.confirm:not(.recap) p')?.textContent ?? '');
    await tap('.confirm:not(.recap) button.primary', 'Faire poser');
    await page.waitForTimeout(400);
    return txt;
  };
  let cash0 = await ev(() => window.__bc.game.cash);
  const eq0 = await ev(() => window.__bc.game.shops[0].today.equipment);
  const confirmTxt = await lay('Parquet de chêne');
  const solDone = await ev(() => { const g = window.__bc.game, s = g.shops[0], chip = [...document.querySelectorAll('#panel .prop-chip')].find((c) => c.textContent.includes('Parquet de chêne')); return { cash: g.cash, floor: s.floorId, eq: s.today.equipment, on: chip?.classList.contains('on'), small: chip?.querySelector('small').textContent }; });
  check(confirmTxt.includes(surf0.chfSol) && solDone.floor === 'chene' && Math.abs(cash0 - solDone.cash - surf0.costSol) < 0.01 && Math.abs(solDone.eq - eq0 - surf0.costSol) < 0.01, 'sol « Parquet de chêne » posé : confirmation avec le prix, coût débité (équipement du jour)', JSON.stringify({ débité: Math.round((cash0 - solDone.cash) * 100) / 100, prix: surf0.costSol }));
  check(solDone.on && solDone.small === 'en place', 'Aperçu : nouveau sol « en place »');
  await closePanel();
  await waitFor(() => window.__bc.scene.interior?.view.surfKey === 'chene|origine');
  await page.waitForTimeout(500);
  const f1 = await ev(() => window.__qa.frameStats());
  const key1 = await ev(() => window.__bc.scene.interior.view.surfKey);
  check(key1 === 'chene|origine' && frameDiff(f0, f1) > 6, 'rendu : le sol de l’intérieur change (parquet)', JSON.stringify({ surfaces: key1, écart: frameDiff(f0, f1).toFixed(1) }));
  cash0 = await ev(() => window.__bc.game.cash);
  await lay('Briques apparentes');
  const mursDone = await ev(() => { const g = window.__bc.game; return { cash: g.cash, wall: g.shops[0].wallId, em: [...document.querySelectorAll('#panel .sp-sec')].find((s) => s.textContent.startsWith('Aménagement · revêtements'))?.querySelector('em')?.textContent }; });
  check(mursDone.wall === 'brique' && Math.abs(cash0 - mursDone.cash - surf0.costMurs) < 0.01, 'murs « Briques apparentes » posés : coût débité', JSON.stringify({ débité: Math.round((cash0 - mursDone.cash) * 100) / 100, prix: surf0.costMurs }));
  await closePanel();
  await waitFor(() => window.__bc.scene.interior?.view.surfKey === 'chene|brique');
  await page.waitForTimeout(500);
  const f2 = await ev(() => window.__qa.frameStats());
  const key2 = await ev(() => window.__bc.scene.interior.view.surfKey);
  check(key2 === 'chene|brique' && bandDiff(f1, f2, 0) > 6, 'rendu : les murs de l’intérieur changent (briques)', JSON.stringify({ surfaces: key2, écartHaut: bandDiff(f1, f2, 0).toFixed(1) }));
  const a2 = await ev(() => { const g = window.__bc.game, s = g.shops[0], ap = g.surfaceAppeal(s); return { a: g.attractiveness(s), ap, em: `attrait +${(ap * 100).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %` }; });
  check(a2.ap > 0 && Math.abs(a2.a / a0 - (1 + a2.ap)) < 0.002 && mursDone.em === a2.em, 'attrait du café augmenté du bonus des revêtements (affiché dans l’Aperçu)', JSON.stringify({ rapport: (a2.a / a0).toFixed(4), bonus: a2.ap, affiché: mursDone.em }));
  await shot('08b-revetements-poses');
  // À distance (téléphone, depuis la rue) : la pose est refusée.
  await ev(() => window.__bc.exitInterior());
  await openShopPanel();
  const note = await ev(() => document.getElementById('panel').textContent.includes('La pose se commande sur place'));
  cash0 = await ev(() => window.__bc.game.cash);
  tm = await toastMark();
  await lay('Marbre poli');
  await waitFor((m) => window.__qa.toasts(m, 'Rendez-vous dans le commerce').length > 0, tm, 15000);
  const remote = await ev((m) => { const g = window.__bc.game; return { floor: g.shops[0].floorId, cash: g.cash, toast: window.__qa.toasts(m, 'Rendez-vous dans le commerce')[0] ?? null }; }, tm);
  check(note && remote.floor === 'chene' && remote.cash === cash0 && !!remote.toast && remote.toast.kind.includes('error'), 'à distance : pose refusée (« Rendez-vous dans le commerce »), rien de débité', JSON.stringify({ note, toast: remote.toast?.text }));
  await closePanel();

  /* ------------------------------ 8. Impôt : semaine 1 exonérée, prélevé en semaine 2 ------------------------------ */
  section('Impôt sur le bénéfice');
  await goIn(await shopBuilding());
  await advanceTo(at(6, 23, 59));
  await advanceTo(at(7, 0, 1), true);
  // Annonce cherchée dans tout le journal, datée de minuit fin du jour 7 (indépendant des marques de journal).
  const w1 = await ev(() => { const g = window.__bc.game; return { taxes: g.taxes.length, tax6: g.ledger.find((d) => d.day === 6)?.tax ?? null, notice: window.__qa.notices(0, 'Fin de la période d’exonération').filter((n) => n.at === 7 * 1440).length, recap: document.querySelector('.recap')?.textContent ?? '' }; });
  check(w1.taxes === 0 && w1.tax6 === 0 && w1.notice === 1, 'fin de la semaine 1 (jour 7) : exonérée, aucun impôt, fin de l’exonération annoncée', JSON.stringify({ taxes: w1.taxes, impôtJour7: w1.tax6, annonce: w1.notice }));
  check(w1.recap.includes('Récapitulatif du jour 7') && !w1.recap.includes('Impôt sur le bénéfice (semaine)'), 'récapitulatif du jour 7 : pas de ligne d’impôt');
  await closeRecap();
  await advanceTo(at(13, 12, 0));
  await phoneOpen('finances');
  fin = await readFin();
  const taxCard = fin.cards.find((c) => c.title === 'Semaine 2');
  // Barème progressif affiché (« 15 % jusqu’à 7 000 CHF, 25 % jusqu’à 20 000 CHF, 35 % au-delà ») : tranches [plafond, taux].
  const scale = fin.text.slice(fin.text.indexOf('Barème'));
  const brackets = [...scale.slice(0, scale.indexOf('au-delà') + 8).matchAll(/(\d+) % jusqu’à ([\d’'   ]+) CHF/g)].map((m) => [Number(m[2].replace(/\D/g, '')), Number(m[1]) / 100]);
  const topRate = scale.match(/(\d+) % au-delà/);
  if (topRate) brackets.push([Infinity, Number(topRate[1]) / 100]);
  const taxOf = (b) => { let due = 0, from = 0; for (const [upTo, rate] of brackets) { if (b > from) due += (Math.min(b, upTo) - from) * rate; from = upTo; } return Math.round(due * 100) / 100; };
  const taxRate = brackets.map(([u, r]) => `${Math.round(r * 100)} %${Number.isFinite(u) ? ` ≤ ${u}` : ''}`).join(', ');
  check(!fin.expect.exempt && fin.expect.daysLeft === 0 && fin.tiles['Impôt estimé'] === fin.expect.tax && !!taxCard?.text.includes('ce soir à minuit'), 'Finances, jour 14 : impôt estimé de la semaine 2, prélevé ce soir à minuit', JSON.stringify({ tuile: fin.tiles['Impôt estimé'], partie: fin.expect.tax }));
  await shot('09a-finances-impot-estime');
  await phoneClose();
  await advanceTo(at(13, 23, 59));
  nm = await noticeMark();
  await advanceTo(at(14, 0, 0), true);
  const levy = await ev((m) => {
    const g = window.__bc.game, d13 = g.ledger.find((d) => d.day === 13);
    // Bénéfice de la semaine 2 recalculé à part (jours 8 à 14, avant impôt).
    const base = g.ledger.filter((d) => d.day >= 7 && d.day <= 13).reduce((a, d) => a + d.revenue + (d.rentalIncome ?? 0) - d.purchases - d.wages - d.rent - d.equipment - d.marketing - d.finance - d.living, 0);
    return { taxes: g.taxes, tax13: d13?.tax, base: Math.round(base * 100) / 100, notice: window.__qa.notices(0, 'Impôt sur le bénéfice de la semaine 2 prélevé')[0]?.text ?? window.__qa.notices(0, 'Semaine 2 sans bénéfice')[0]?.text ?? null, recap: document.querySelector('.recap')?.textContent ?? '', chfAmount: window.__qa.chf(g.taxes[0]?.amount ?? 0) };
  }, nm);
  await shot('09b-recap-impot');
  const rec = levy.taxes[0];
  check(brackets.length >= 2 && levy.taxes.length === 1 && rec.week === 1 && Math.abs(rec.base - levy.base) < 0.02 && Math.abs(rec.amount - taxOf(Math.max(0, rec.base - (rec.carried ?? 0)))) < 0.011, `fin de la semaine 2 : impôt = barème affiché (${taxRate}) appliqué au bénéfice de la semaine (jours 8 à 14)`, JSON.stringify({ relevé: rec, bénéficeRecalculé: levy.base }));
  check(rec?.amount > 0 && Math.abs(levy.tax13 - rec.amount) < 0.01 && !!levy.notice?.includes('prélevé'), 'impôt prélevé au jour 14 (inscrit au bilan du jour, notification)', JSON.stringify({ montant: rec?.amount, bilan: levy.tax13, notif: levy.notice?.slice(0, 80) }));
  check(levy.recap.includes('Impôt sur le bénéfice (semaine)') && levy.recap.includes(levy.chfAmount) && levy.recap.includes('Impôt de la semaine 2 prélevé'), 'récapitulatif du jour 14 : ligne d’impôt et rappel', levy.chfAmount);
  await closeRecap();
  await phoneOpen('finances');
  fin = await readFin();
  check(fin.text.includes(`Semaine 2 · bénéfice ${await ev((v) => window.__qa.signed(v), rec.base)}`) && fin.text.includes(`− ${levy.chfAmount}`), 'Finances : impôt de la semaine 2 dans l’historique', levy.chfAmount);
  await phoneClose();

  section('Guichet de la banque : plafond dynamique');
  await goIn(await service('banque'));
  await page.waitForFunction(() => [...document.querySelectorAll('#panel .kpi span')].some((s) => s.textContent === 'Plafond'), null, { timeout: 60000 });
  const bank14 = await ev(() => { const g = window.__bc.game, cl = g.creditLimit(); return { cl, chf: window.__qa.chf(cl.limit), sales7: Math.round(g.ledger.slice(-7).reduce((a, d) => a + d.revenue, 0) * 100) / 100 }; });
  const shown14 = await kpiPlafond();
  check(shown14 === bank14.chf && bank14.cl.limit !== bank0.limit, 'banque : plafond affiché à jour (il a changé depuis le jour 1)', JSON.stringify({ jour1: bank0.limit, jour15: bank14.cl.limit, affiché: shown14 }));
  check(Math.abs(bank14.cl.sales7 - bank14.sales7) < 0.02 && bank14.cl.fromSales > 0 && bank14.cl.fromWorth > 0 && (bank14.cl.capped || bank14.cl.limit === bank14.cl.base + bank14.cl.fromWorth + bank14.cl.fromSales), 'banque : plafond = socle + part de la valeur nette + part des ventes des 7 derniers jours', JSON.stringify({ ventes7: bank14.sales7, socle: bank14.cl.base, valeurNette: bank14.cl.fromWorth, ventes: bank14.cl.fromSales, plafond: bank14.cl.limit }));
  await closePanel();

  /* ------------------------------ 9. Sauvegarde et rechargement ------------------------------ */
  section('Sauvegarde et rechargement');
  await goIn(await shopBuilding());
  const snap = () => ev(() => {
    const g = window.__bc.game, s = g.shops[0];
    return {
      total: g.total,
      state: JSON.stringify({
        cash: Math.round(g.cash * 100), employees: g.employees.map((e) => [e.id, e.role, e.shift, e.wantShift, e.minWage, e.wage, e.shopId]),
        candidates: g.candidates.map((c) => [c.id, c.wantShift, c.minWage]), shop: [s.clean, s.floorId, s.wallId, !!s.cleanService, s.warned],
        invest: g.invest, principal: g.investPrincipal, fundReturns: g.fundReturns, awareness: g.awareness, taxes: g.taxes,
        ledgerTax: g.ledger.map((d) => d.tax ?? 0), credit: g.creditLimit().limit, tax: g.taxEstimate(), campaigns: g.campaigns,
      }),
    };
  });
  const s0 = await snap();
  await phoneOpen('reglages');
  tm = await toastMark();
  await ev(() => [...document.querySelectorAll('.phone .ph-body button')].find((b) => b.textContent.includes('Sauvegarder')).click());
  await page.waitForTimeout(300);
  check((await ev((m) => window.__qa.toasts(m, 'Partie sauvegardée').length, tm)) >= 1, 'sauvegarde depuis le téléphone (Réglages)');
  await phoneClose();
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('.menu-card button.primary', { timeout: 120000 });
  const label = await page.textContent('.menu-card button.primary');
  check(/Continuer : Test V7/.test(label ?? ''), 'reprise proposée au menu', label);
  await tap('.menu-card button.primary');
  await page.waitForFunction(() => window.__bc?.ready, null, { timeout: 60000 });
  await pause();
  const s1 = await snap();
  check(Math.abs(s1.total - s0.total) <= 2 && s1.state === s0.state, 'rechargement : employés (rôles, équipes, souhaits), propreté, revêtements, service, placements, notoriété, impôts identiques', s1.state === s0.state ? '' : `\n  avant : ${s0.state}\n  après : ${s1.state}`);
  await page.waitForTimeout(1500);
  const view = await ev(() => { const v = window.__bc.scene.interior?.view; const g = window.__bc.game; return { inside: window.__bc.state().inside?.kind, surf: v?.surfKey, dirt: v?.dirtLevel, clean: g.cleanliness(g.shops[0]) }; });
  check(view.inside === 'shop' && view.surf === 'chene|brique' && view.dirt === Math.round(Math.max(0, Math.min(1, (85 - view.clean) / 85)) * 20) / 20, 'rechargement : reprise dans le café, parquet et briques rendus, saleté à jour', JSON.stringify(view));
  await phoneOpen('finances');
  fin = await readFin();
  check(fin.tiles['Placements'] === fin.expect.placed && fin.tiles['Valeur nette'] === fin.expect.worth && fin.text.includes('Semaine 2 · bénéfice'), 'rechargement : appli Finances à l’identique (placements, valeur nette, impôts)', JSON.stringify(fin.tiles));
  await phoneClose();
  await shot('10-apres-rechargement');
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3).join(' | '));
} catch (e) {
  fails++;
  failed.push(`exception : ${e.message}`);
  console.log('ÉCHEC exception :', e.stack ?? e);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${count} vérifications, ${fails} échec(s) — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failed.length) console.log(`Échecs :\n - ${failed.join('\n - ')}`);
console.log(`Captures :\n - ${shots.join('\n - ')}`);
console.log(fails ? `ÉCHECS : ${fails}` : 'NOUVEAUTÉS V7 : SUCCÈS');
process.exit(fails ? 1 : 0);
