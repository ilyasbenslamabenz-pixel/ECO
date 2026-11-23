/**
 * Conduite dans le navigateur (Playwright, Chromium préinstallé), comme un joueur au clavier AZERTY (touches physiques
 * Z Q S D = KeyW KeyA KeyS KeyD) et à la souris :
 *  - sortie de l'appartement à pied ; voiture garée du quartier : invite « Pas à vous — achetez un véhicule au
 *    garage », E trace l'itinéraire vers le garage ;
 *  - garage : rapproché à 9 m, marche jusqu'à la porte (invite « Voitures d'exposition » en longeant la vitrine), E,
 *    achat d'une citadine dans le panneau : panneau fermé, message « approchez-vous et appuyez sur E », balise sur
 *    le véhicule ;
 *  - marche réelle jusqu'au véhicule (souris pour orienter la caméra, Z maintenue), invite « Conduire : Citadine »,
 *    E, barre de conduite ; accélérer, tourner (caméra qui suit), freiner, reculer (sans demi-tour de la caméra) ;
 *    descendre (E) : à pied, à côté du véhicule ;
 *  - un véhicule garé devant la porte du garage ne la masque pas ; un second véhicule n'est pas livré sur le premier ;
 *  - rechargement de la sauvegarde : à pied à côté du véhicule, on remonte et on roule ; aucune erreur de page.
 * Rendu logiciel lent (pas de temps plafonné à 0,1 s : quelques images par seconde = ralenti) : graphismes « Basse »,
 * fenêtre 1024 × 640, touches maintenues jusqu'à l'effet attendu (délais généreux). window.__bc sert à observer
 * (positions, invite, état), à rapprocher le joueur (10 m au plus) et à préparer un état signalé en commentaire ; le
 * reste passe par le clavier, la souris et le DOM.
 * Usage : node scripts/build.mjs && node tests/e2e-conduite.mjs [--dist <dossier>] [dossier des captures]
 *         (ou BC_DIST=<dossier> ; dist/ par défaut ; captures dans tests/out/conduite par défaut)
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
const out = resolve(positional[0] ?? 'tests/out/conduite');
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
let fails = 0;
const failed = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${label}${extra ? ` ${extra}` : ''}`);
  if (!ok) { fails++; failed.push(label); }
  return ok;
};
const section = (t) => console.log(`\n— ${t}`);
const t0 = Date.now();
const W = 1024, H = 640;

/** Avant le jeu, à chaque chargement : graphismes « Basse » (réglage du joueur) et journal des notifications. */
function pageTools() {
  try { localStorage.setItem('bc-qualite', 'basse'); } catch { /* stockage indisponible */ }
  window.__toastLog = [];
  const watch = () => {
    const box = document.getElementById('toasts');
    if (!box) return;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) window.__toastLog.push(n.dataset.text ?? n.textContent);
    }).observe(box, { childList: true });
  };
  document.addEventListener('DOMContentLoaded', watch);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.addInitScript(pageTools);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { try { await page.screenshot({ path: join(out, `${n}.png`), timeout: 60000 }); } catch (e) { console.log(`(capture ${n} : ${String(e).split('\n')[0]})`); } };
  /** Invite affichée (libellé sans la touche), état observé. */
  const look = () => ev(() => {
    const b = window.__bc, g = b.game, s = b.state();
    const pr = document.querySelector('.prompt:not(.hidden) span');
    return { x: g.player.x, z: g.player.z, prompt: pr ? pr.textContent : null, car: s.car, panel: s.panel, waypoint: s.waypoint, yaw: b.cam.yaw };
  });
  const toastsSince = (n) => ev((k) => window.__toastLog.slice(k), n);
  const toastCount = () => ev(() => window.__toastLog.length);
  const keepAlive = () => ev(() => window.__bc.keepAlive());
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  /** Glisser à la souris (bouton gauche) pour que « avancer » vise (x, z), comme un joueur qui oriente la caméra. */
  const aim = async (x, z) => {
    const [want, yaw] = await ev(([x, z]) => { const g = window.__bc.game; return [Math.atan2(-(x - g.player.x), -(z - g.player.z)), window.__bc.cam.yaw]; }, [x, z]);
    const dx = wrap(yaw - want) / 0.006;
    if (Math.abs(dx) < 12) return;
    const y = Math.round(H * 0.62);
    await page.mouse.move(W / 2 - dx / 2, y);
    await page.mouse.down();
    await page.mouse.move(W / 2 + dx / 2, y, { steps: 4 });
    await page.mouse.up();
  };
  /**
   * Marche réelle vers (x, z) : Z (KeyW) maintenue, caméra réorientée à la souris si l'on dévie ; s'arrête quand
   * `until(état)` est vrai, à moins de `near` m, ou au bout de `timeout` ms. Rend le dernier état et les invites vues.
   */
  const walkTo = async (x, z, { until = null, near = 0.6, timeout = 120000 } = {}) => {
    const seen = new Set();
    const tEnd = Date.now() + timeout;
    let s = await look();
    await aim(x, z);
    await page.keyboard.down('KeyW');
    try {
      while (Date.now() < tEnd) {
        s = await look();
        if (s.prompt) seen.add(s.prompt);
        if ((until && until(s)) || Math.hypot(x - s.x, z - s.z) < near) break;
        const off = await ev(([x, z]) => { const g = window.__bc.game; const want = Math.atan2(-(x - g.player.x), -(z - g.player.z)); let d = window.__bc.cam.yaw - want; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }, [x, z]);
        if (Math.abs(off) > 0.3) { await page.keyboard.up('KeyW'); await aim(x, z); await page.keyboard.down('KeyW'); }
        await page.waitForTimeout(150);
      }
    } finally { await page.keyboard.up('KeyW'); }
    return { s, seen: [...seen] };
  };
  /** Touches maintenues jusqu'à `until(état)` (ou `timeout` ms), puis relâchées. */
  const hold = async (codes, until, timeout = 60000) => {
    for (const c of codes) await page.keyboard.down(c);
    const tEnd = Date.now() + timeout;
    let s = await look();
    try {
      while (Date.now() < tEnd && !until(s)) { await page.waitForTimeout(150); s = await look(); }
    } finally { for (const c of codes) await page.keyboard.up(c); }
    return s;
  };
  /** Distance du personnage à la carrosserie (rectangle orienté) d'un véhicule du joueur. */
  const bodyDist = (id) => ev((id) => {
    const g = window.__bc.game, v = g.vehicle(id);
    const L = { scooter: [0.7, 1.8], citadine: [1.8, 3.95], sportive: [1.9, 3.75], suv: [2.0, 3.8], camionnette: [2.1, 3.9], camion: [2.4, 5.2] }[v.type];
    const fx = -Math.sin(v.heading), fz = -Math.cos(v.heading), dx = g.player.x - v.x, dz = g.player.z - v.z;
    return Math.hypot(Math.max(0, Math.abs(dx * fx + dz * fz) - L[1] / 2), Math.max(0, Math.abs(dx * fz - dz * fx) - L[0] / 2));
  }, id);
  const startGame = async () => {
    await page.waitForFunction(() => window.__bc?.ready, null, { timeout: 180000 });
    await page.waitForTimeout(800);
    await keepAlive();
  };

  section('Sortie de l’appartement et voitures du quartier');
  await page.goto(`${base}/index.html?seed=7&nouveau`);
  await page.waitForSelector('.menu-card button.primary', { timeout: 180000 });
  await page.click('.menu-card button.primary');
  await startGame();
  check(await ev(() => window.__bc.state().inside?.kind === 'home'), 'réveil dans l’appartement');
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => window.__bc.state().inside === null, null, { timeout: 90000, polling: 200 }).catch(() => {});
  await page.keyboard.up('KeyS');
  check(await ev(() => window.__bc.state().inside === null), 'sorti dans la rue en marchant (S)');
  // Voiture garée du quartier, loin des portes et du garage : approche à pied par le trottoir.
  const parked = await ev(() => {
    const g = window.__bc.game, sc = window.__bc.scene;
    const doors = g.district.buildings.filter((b) => b.premise || b.service || b.home).map((b) => [b.doorX, b.doorZ]);
    const rs = sc.view.parkedRects;
    const c = rs.map((r) => ({ r, x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, alongZ: r.maxZ - r.minZ > r.maxX - r.minX }))
      .filter((c) => c.alongZ && doors.every(([x, z]) => Math.hypot(x - c.x, z - c.z) > 10)
        && rs.every((o) => o === c.r || o.minZ > c.r.maxZ + 9 || o.maxZ < c.r.minZ - 1 || o.maxX < c.r.minX - 1 || o.minX > c.r.maxX + 1))
      .sort((a, b) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(b.x - g.player.x, b.z - g.player.z))[0];
    return c ? { x: c.x, z: c.z, maxZ: c.r.maxZ } : null;
  });
  check(!!parked, 'voiture garée trouvée', JSON.stringify(parked));
  if (parked) {
    // Rapproché à 6 m (outil de test), puis marche réelle vers l'arrière de la voiture.
    await ev(([x, z]) => window.__bc.teleport(x, z), [parked.x, parked.maxZ + 6]);
    await page.waitForTimeout(600);
    const w = await walkTo(parked.x, parked.z, { until: (s) => /Pas à vous/.test(s.prompt ?? ''), timeout: 90000 });
    await page.waitForTimeout(400);
    await shot('01-voiture-pas-a-vous');
    check(w.s.prompt === 'Pas à vous — achetez un véhicule au garage', 'voiture garée : invite « Pas à vous — achetez un véhicule au garage »', JSON.stringify(w.s.prompt));
    const n = await toastCount();
    await page.keyboard.press('e');
    await page.waitForTimeout(700);
    const s = await look();
    const ts = await toastsSince(n);
    check(s.waypoint?.label === 'Garage Utilitaires' && s.car === null && ts.some((t) => /n’est pas à vous/.test(t) && /garage/.test(t)), 'E : explication et itinéraire vers le garage (balise)', JSON.stringify({ wp: s.waypoint?.label, ts }));
  }

  section('Garage : marche jusqu’à la porte, achat dans le panneau');
  const gar = await ev(() => { const b = window.__bc.game.district.buildings.find((x) => x.service === 'garage'); return { id: b.id, face: b.face, doorX: b.doorX, doorZ: b.doorZ }; });
  const N = [[0, 1], [1, 0], [0, -1], [-1, 0]][gar.face], T = [N[1], -N[0]];
  // Rapproché à 9 m le long du trottoir (outil de test), puis marche réelle en longeant la vitrine.
  await ev(([x, z]) => window.__bc.teleport(x, z), [gar.doorX + T[0] * 9, gar.doorZ + T[1] * 9]);
  await page.waitForTimeout(600);
  const wd = await walkTo(gar.doorX, gar.doorZ, { until: (s) => /^Entrer : Garage/.test(s.prompt ?? ''), timeout: 90000 });
  check(wd.seen.some((p) => p === 'Voitures d’exposition — voir les véhicules à vendre'), 'vitrine du garage : invite « Voitures d’exposition »', JSON.stringify(wd.seen));
  check(wd.s.prompt === 'Entrer : Garage Utilitaires', 'porte du garage : invite « Entrer »', JSON.stringify(wd.s.prompt));
  await page.keyboard.press('e');
  await page.waitForSelector('#panel:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(400);
  check(await ev(() => /approchez-vous-en et appuyez sur E/.test(document.querySelector('#panel').textContent)), 'garage : le panneau dit comment conduire, avant la liste');
  await shot('02-garage');
  const nBuy = await toastCount();
  await ev(() => [...document.querySelectorAll('#panel button')].filter((b) => b.textContent.includes('Acheter'))[1].click());
  await page.waitForFunction(() => window.__bc.game.vehicles.length === 1, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  const car0 = await ev(() => { const v = window.__bc.game.vehicles[0]; return v && { ...v }; });
  const afterBuy = await look();
  const buyToasts = await toastsSince(nBuy);
  check(car0?.type === 'citadine', 'citadine achetée', JSON.stringify(car0));
  check(afterBuy.panel === null, 'panneau du garage fermé après l’achat');
  check(buyToasts.some((t) => t === 'Votre citadine vous attend devant le garage : approchez-vous et appuyez sur E pour conduire.'), 'message : où est le véhicule et comment le conduire', JSON.stringify(buyToasts));
  check(!!afterBuy.waypoint && Math.hypot(afterBuy.waypoint.x - car0.x, afterBuy.waypoint.z - car0.z) < 0.5, 'balise bleue posée sur le véhicule', JSON.stringify(afterBuy.waypoint));
  await shot('03-apres-achat');

  section('Marche jusqu’au véhicule, conduite, descente');
  const wv = await walkTo(car0.x, car0.z, { until: (s) => /^Conduire/.test(s.prompt ?? ''), timeout: 120000 });
  const reach = await bodyDist(car0.id);
  await shot('04-invite-conduire');
  check(wv.s.prompt === 'Conduire : Citadine', 'invite « Conduire : Citadine » à côté du véhicule', `${JSON.stringify(wv.s.prompt)} à ${reach.toFixed(2)} m de la carrosserie`);
  await page.keyboard.press('e');
  await page.waitForTimeout(800);
  let s = await look();
  check(s.car?.id === car0.id, 'E : au volant');
  const bar = await ev(() => { const b = document.querySelector('.drivebar'); return b && !b.classList.contains('hidden') ? b.textContent : null; });
  check(!!bar && /Citadine/.test(bar) && /km\/h/.test(bar) && /Descendre/.test(bar), 'barre de conduite (véhicule, vitesse, commandes)', JSON.stringify(bar));
  await shot('05-au-volant');
  // Accélérer : Z maintenue jusqu'à 8 m/s.
  const p0 = { x: s.car.x, z: s.car.z, h: s.car.heading };
  s = await hold(['KeyW'], (q) => q.car && q.car.speed > 8, 90000);
  const run = Math.hypot(s.car.x - p0.x, s.car.z - p0.z);
  check(s.car.speed > 8 && run > 4, 'Z : le véhicule accélère et roule', `${s.car.speed.toFixed(1)} m/s, ${run.toFixed(1)} m`);
  const kmh = await ev(() => Number((document.querySelector('.drivebar .ib-stats b')?.textContent ?? '0').replace(/\D/g, '')));
  check(kmh >= 20, 'compteur de vitesse', `${kmh} km/h`);
  await shot('06-roule');
  // Tourner à gauche (Q) en accélérant ; la caméra suit le cap.
  s = await hold(['KeyW', 'KeyA'], (q) => q.car && Math.abs(wrap(q.car.heading - p0.h)) > 0.7, 60000);
  check(Math.abs(wrap(s.car.heading - p0.h)) > 0.7 && wrap(s.car.heading - p0.h) > 0, 'Q : le véhicule tourne à gauche', `cap ${p0.h.toFixed(2)} → ${s.car.heading.toFixed(2)}`);
  s = await hold(['KeyW'], (q) => q.car && Math.abs(wrap(q.yaw - q.car.heading)) < 0.25, 30000);
  check(Math.abs(wrap(s.yaw - s.car.heading)) < 0.25, 'caméra dans le dos du véhicule', `écart ${wrap(s.yaw - s.car.heading).toFixed(2)} rad`);
  // Freiner (Espace) jusqu'à l'arrêt.
  s = await hold(['Space'], (q) => q.car && Math.abs(q.car.speed) < 0.3, 60000);
  check(Math.abs(s.car.speed) < 0.3, 'Espace : freine jusqu’à l’arrêt');
  await shot('07-arret');
  // Reculer (S) : marche arrière, la caméra ne fait pas demi-tour.
  s = await hold(['KeyS'], (q) => q.car && q.car.speed < -2, 60000);
  const camBack = Math.abs(wrap(s.yaw - s.car.heading));
  check(s.car.speed < -2, 'S : marche arrière', `${s.car.speed.toFixed(1)} m/s`);
  await page.waitForTimeout(1500);
  s = await look();
  check(Math.abs(wrap(s.yaw - s.car.heading)) < 0.6 && camBack < 0.6, 'caméra : pas de demi-tour en marche arrière', `écart ${wrap(s.yaw - s.car.heading).toFixed(2)} rad`);
  s = await hold(['Space'], (q) => q.car && Math.abs(q.car.speed) < 0.3, 60000);
  await page.keyboard.press('e');
  await page.waitForTimeout(800);
  s = await look();
  const side = await bodyDist(car0.id);
  check(s.car === null && side > 0 && side <= 1.8 && s.prompt === 'Conduire : Citadine', 'E : descendu, à pied à côté du véhicule', `${side.toFixed(2)} m de la carrosserie, invite ${JSON.stringify(s.prompt)}`);
  await shot('08-descendu');

  section('Porte du garage et second véhicule');
  // État préparé (outil de test) : la citadine garée contre le trottoir juste devant la porte du garage (carrosserie à
  // 1,5 m de la porte), comme après un créneau du joueur. Avant : « Conduire » prenait la place de « Entrer ».
  await ev(([x, z, h]) => { const g = window.__bc.game; g.setVehiclePose(g.vehicles[0].id, x, z, h); }, [gar.doorX + N[0] * 2.4, gar.doorZ + N[1] * 2.4, car0.heading]);
  await ev((id) => window.__bc.toDoor(id), gar.id);
  await page.waitForTimeout(700);
  s = await look();
  check(s.prompt === 'Entrer : Garage Utilitaires', 'véhicule garé devant la porte : la porte reste accessible (E = entrer)', JSON.stringify(s.prompt));
  await page.keyboard.press('e');
  await page.waitForSelector('#panel:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(300);
  await ev(() => [...document.querySelectorAll('#panel button')].filter((b) => b.textContent.includes('Acheter'))[0].click());
  await page.waitForFunction(() => window.__bc.game.vehicles.length === 2, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const pair = await ev(() => window.__bc.game.vehicles.map((v) => ({ id: v.id, type: v.type, x: v.x, z: v.z })));
  const gap = pair.length === 2 ? Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z) : 0;
  check(pair.length === 2 && pair[1].type === 'scooter' && gap >= 5.5, 'second véhicule livré à une place libre (pas sur le premier)', `${gap.toFixed(1)} m d’écart`);
  await shot('09-deux-vehicules');

  section('Rechargement de la sauvegarde');
  // Page rouverte (sauvegarde automatique à la fermeture), sans « ?nouveau » : la partie est proposée au menu.
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('.menu-card button.primary', { timeout: 180000 });
  const label = await page.textContent('.menu-card button.primary');
  check(/^Continuer/.test(label ?? ''), 'reprise proposée', label);
  await page.click('.menu-card button.primary');
  await startGame();
  const back = await ev(() => window.__bc.game.vehicles.map((v) => v.type).join(','));
  check(back === 'citadine,scooter', 'véhicules repris', back);
  const cit = await ev(() => { const v = window.__bc.game.vehicles.find((x) => x.type === 'citadine'); return v ? { ...v } : null; });
  if (!cit) throw new Error('citadine absente après rechargement');
  const wr = await walkTo(cit.x, cit.z, { until: (q) => q.prompt === 'Conduire : Citadine', timeout: 90000 });
  check(wr.s.prompt === 'Conduire : Citadine', 'après rechargement : invite « Conduire : Citadine »', JSON.stringify(wr.s.prompt));
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  const c1 = await look();
  s = await hold(['KeyW'], (q) => q.car && Math.hypot(q.car.x - cit.x, q.car.z - cit.z) > 3, 90000);
  check(c1.car?.id === cit.id && s.car && Math.hypot(s.car.x - cit.x, s.car.z - cit.z) > 3, 'après rechargement : on remonte et on roule', s.car ? `${Math.hypot(s.car.x - cit.x, s.car.z - cit.z).toFixed(1)} m` : 'pas au volant');
  await hold(['Space'], (q) => q.car && Math.abs(q.car.speed) < 0.3, 60000);
  // Descendu, touche V : « Retrouver mon véhicule ».
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  const nV = await toastCount();
  await page.keyboard.press('v');
  await page.waitForTimeout(600);
  const tv = await toastsSince(nV);
  check(tv.some((t) => /^Votre (citadine|scooter utilitaire) (est juste là|est à)/.test(t)), 'touche V : retrouver mon véhicule', JSON.stringify(tv));
  await shot('10-apres-rechargement');

  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3).join(' | '));
} catch (e) {
  check(false, 'déroulé interrompu', String(e).split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(fails ? `ÉCHECS : ${fails} (${failed.join(' ; ')})` : 'CONDUITE : SUCCÈS');
process.exit(fails ? 1 : 0);
