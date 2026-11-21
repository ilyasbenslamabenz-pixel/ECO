/**
 * Parcours d'un bon joueur par la simulation, en suivant la carte d'objectifs (les trois objectifs actifs) : premiers
 * pas du tutoriel, puis gestion (prix, propreté, formation, contrat), expansion (nouveaux types, rachats, gamme
 * premium) et empire (dix commerces, sept types, rachat d'une enseigne) jusqu'à « Légende du quartier ».
 * Affiche le jour d'atteinte de chaque objectif, palier par palier, les paliers franchis et leurs récompenses, puis
 * vérifie l'espacement : au plus 3 objectifs le même jour après le jour 1, aucun trou de plus de 10 jours avant le
 * jour 60. Signale les objectifs qui ne se débloquent pas.   npx tsx scripts/tutoriel.ts
 */
import { FURNITURE_BY_ID, PREMIUM_BY_TYPE, SHOP_TYPES, productsOf, type ShopType } from '../src/sim/catalog';
import { serviceBuilding } from '../src/sim/district';
import { canPlace, layoutStats } from '../src/sim/layout';
import { Game } from '../src/sim/game';
import { LEGEND_ID, OBJECTIVES, TIERS, activeObjectives, netWorth, tierComplete, type TierId } from '../src/sim/objectives';

const g = new Game(7, 'Tutoriel SA');
const DAY_MAX = 400;
const log: string[] = [];
/** Jour d'atteinte (1 = premier jour) de chaque objectif et de chaque palier. */
const reached = new Map<string, number>();
const tiersAt = new Map<TierId, number>();
const today = (): number => g.day + 1;
const track = (): void => {
  for (const id of g.achieved) if (!reached.has(id)) reached.set(id, today());
  for (const t of TIERS) {
    if (tiersAt.has(t.id) || !tierComplete(g, t.id)) continue;
    tiersAt.set(t.id, today());
    const n = [...g.notices].reverse().find((x) => x.text.startsWith(`Palier franchi : ${t.name}`));
    log.push(`J${String(today()).padStart(3)} ★ ${n?.text ?? `Palier franchi : ${t.name}`}`);
  }
};
const k = (v: number): string => `${Math.round(v / 1000)} k`;
const act = (label: string): void => { g.checkObjectives(); track(); log.push(`J${String(today()).padStart(3)} · ${label} (valeur nette ${k(netWorth(g))}, trésorerie ${k(g.cash)})`); };
const hours = (n: number): void => { for (let h = 0; h < n; h++) { g.advance(60); track(); } };
const live = (days: number): void => { for (let d = 0; d < days; d++) { g.player.energy = 100; g.player.hunger = 100; hours(24); } };
const go = (kind: Parameters<typeof serviceBuilding>[1]): void => { const b = serviceBuilding(g.district, kind)!; g.setPlace({ kind: 'service', service: kind, buildingId: b.id }); };

const LAYOUTS: Record<ShopType, string[]> = {
  epicerie: ['caisse', 'rayon', 'rayon', 'rayon', 'frigo', 'frigo', 'plante', 'plante'],
  cafe: ['caisse', 'machine', 'comptoir', 'vitrine', 'frigo', 'table', 'table', 'plante'],
  vetements: ['caisse', 'portant', 'portant', 'portant', 'portant', 'rayon', 'plante', 'lampe'],
  fleuriste: ['caisse', 'frigo', 'frigo', 'rayon', 'plante', 'lampe', 'tapis'],
  boulangerie: ['caisse', 'rayon', 'rayon', 'vitrine', 'vitrine', 'frigo', 'table', 'plante'],
  fastfood: ['caisse', 'comptoir', 'comptoir', 'vitrine', 'frigo', 'table', 'plante'],
  primeur: ['caisse', 'rayon', 'rayon', 'rayon', 'rayon', 'frigo', 'plante'],
};
const layoutCost = (t: ShopType): number => LAYOUTS[t].reduce((a, f) => a + FURNITURE_BY_ID.get(f)!.price, 0);

/** Pose chaque meuble à la première place qui garde tout accessible. */
function placeAll(id: number, layout: string[]): void {
  const s = g.shop(id)!, p = g.premise(s.premiseId)!;
  for (const f of layout) {
    let done = false;
    for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
      if (canPlace(s.items, p.gridW, p.gridD, FURNITURE_BY_ID.get(f)!, x, z, 0)) continue;
      const q = g.place(id, f, x, z, 0);
      if (q.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (q.ok) g.pickUp(id, q.data.uid);
    }
  }
}
function hireBest(shopId: number): boolean {
  go('emploi');
  const c = [...g.candidates].sort((a, b) => b.skill - a.skill)[0];
  return !!c && g.hire(c.id, shopId).ok;
}
function stockUp(id: number): void {
  const s = g.shop(id)!;
  for (const pr of productsOf(s.type)) { g.setAuto(id, pr.id, true); const q = g.room(s, pr.id); if (q > 0) g.order(id, pr.id, q); }
}
/** Ouvre un commerce du type donné dans le local libre le plus prometteur (passants, concurrence). */
function open(type: ShopType, label: string): number | null {
  const p = g.district.premises.filter((x) => g.isFree(x)).sort((a, b) => g.estimatePeak(b, type) - g.estimatePeak(a, type))[0];
  if (!p) return null;
  const r = g.rent(p.id, type);
  if (!r.ok) return null;
  go('meubles');
  for (const f of LAYOUTS[type]) g.buyFurniture(f, 1, r.data.id);
  placeAll(r.data.id, LAYOUTS[type]);
  stockUp(r.data.id);
  hireBest(r.data.id);
  act(`${label} : ${r.data.name}`);
  return r.data.id;
}
/** Prix de chaque produit ramenés au prix du quartier (le bouton « Aligner » d'un joueur). */
function align(id: number): void { const s = g.shop(id)!; for (const pr of productsOf(s.type)) g.setPrice(id, pr.id, g.refPrice(pr, s)); }
const raises = (): void => { for (const e of g.employees) if (e.askedRaise) g.raiseWage(e.id, g.marketWage(e.skill, e.training ?? 0)); };
const openCost = (t: ShopType): number => layoutCost(t) + 12_000;

/* ------------------------------ Démarrage ------------------------------ */
g.setPlace({ kind: 'rue' }); act('sortir dans la rue');
const a = open('epicerie', 'louer et meubler l’épicerie')!;
hours(8); act('marchandise livrée');
g.setPlace({ kind: 'commerce', shopId: a }); g.tend(a); hours(4); g.tend(null); act('tenir la caisse 4 h');
live(1);
go('pub'); g.startCampaign('flyers', a, 3); act('campagne de flyers');
live(1);
open('cafe', 'deuxième commerce');
live(2);
go('banque'); g.takeLoan(1); act('prêt de 25 000 CHF');
const c = open('fastfood', 'troisième commerce');
for (const id of [a, c ?? a]) hireBest(id);
live(1);
go('garage'); g.buyVehicle('scooter'); act('un scooter (il suffit)');

/* ------------------------------ Gestion, expansion, empire ------------------------------ */
// Chaque jour : la gestion courante (salaires, caisses, formation, gamme premium, prix chaque semaine), puis au plus
// une initiative pour un des trois objectifs de la carte, comme un joueur qui suit ses objectifs.
const repeat: ShopType[] = ['epicerie', 'boulangerie', 'cafe', 'fastfood', 'primeur', 'epicerie', 'boulangerie'];
let rep = 0;
const typesHeld = (): Set<ShopType> => new Set(g.shops.map((s) => s.type));
/** Concurrent le moins cher d'un type déjà tenu (sa clientèle s'ajoute à la vôtre : part de marché). */
function buyRival(why: string): boolean {
  const held = typesHeld();
  const best = g.rivalry.shops.filter((rs) => held.has(rs.type)).map((rs) => ({ rs, q: g.rivalry.quote(rs.premiseId)! })).filter((x) => x.q).sort((x, y) => x.q.total - y.q.total)[0];
  if (!best || g.cash < best.q.total + 6000) return false;
  const r = g.rivalry.buy(best.rs.premiseId, true);
  if (!r.ok) return false;
  stockUp(r.data.id);
  act(`${why} : rachat de ${r.data.name} (${k(best.q.total)})`);
  return true;
}
function initiative(): void {
  for (const o of activeObjectives(g)) {
    switch (o.id) {
      case 'prix': {
        const moved = g.shops.filter((s) => Math.abs((g.rivals[s.type] ?? 1) - 1) >= 0.03);
        if (moved.length) { for (const s of moved) align(s.id); act(`prix alignés sur le quartier (${moved.length} commerce(s))`); return; }
        break;
      }
      case 'proprete': for (const s of g.shops) g.setCleanService(s.id, true); act('nettoyage de nuit dans chaque commerce'); return;
      case 'former': { const e = [...g.employees].sort((x, y) => y.skill - x.skill)[0]; if (e && g.train(e.id).ok) { act(`formation de ${e.name}`); return; } break; }
      case 'contrat': if (g.ledger.slice(-3).reduce((x, d) => x + d.purchases, 0) / 3 > 600) { go('grossiste'); if (g.signContract('essentiel').ok) { act('contrat fournisseur'); return; } } break;
      case 'types4': case 'types7': {
        const t = SHOP_TYPES.map((x) => x.id).find((x) => !typesHeld().has(x));
        if (t && g.cash > openCost(t) + 8000 && open(t, `nouveau type (${g.shops.length + 1}e commerce)`)) return;
        break;
      }
      case 'rachat': if (buyRival('premier rachat')) return; break;
      case 'part40': if (buyRival('part de marché')) return; break;
      case 'cinq': case 'dix': {
        // Réseau : un type qui marche déjà, en gardant une réserve de trésorerie.
        const t = repeat[rep % repeat.length]!;
        if (g.cash > openCost(t) + 15_000 && open(t, `réseau (${g.shops.length + 1}e commerce)`)) { rep++; return; }
        break;
      }
      case 'enseigne': {
        // La moins chère des enseignes ; un prêt de 50 000 CHF complète la trésorerie si elle en couvre déjà 60 %.
        const best = g.rivalry.active.map((co) => ({ co, q: g.rivalry.companyQuote(co.id) })).filter((x) => x.q).sort((x, y) => x.q!.total - y.q!.total)[0];
        if (best && g.cash < best.q!.total + 10_000 && g.cash > best.q!.total * 0.6 && g.cash + 50_000 > best.q!.total + 10_000) { go('banque'); if (g.takeLoan(2).ok) act('prêt de 50 000 CHF pour un rachat'); }
        if (best && g.cash > best.q!.total + 10_000) {
          const r = g.rivalry.buyCompany(best.co.id, true);
          if (r.ok) { for (const s of g.shops) if (s.acquired) stockUp(s.id); act(`rachat de l’enseigne ${best.co.name} (${r.data} commerces)`); return; }
        }
        break;
      }
      default: break;
    }
  }
}
while (!g.achieved.includes(LEGEND_ID) && g.day < DAY_MAX) {
  live(1);
  raises();
  if (g.achieved.includes('prix') && today() % 7 === 0) for (const s of g.shops) align(s.id);
  if (g.achieved.includes('proprete')) for (const s of g.shops) if (!s.cleanService) g.setCleanService(s.id, true);
  for (const s of g.shops) {
    // Une caisse et un caissier de plus là où des clients attendent.
    const y = s.history.at(-1), staff = g.staffOf(s.id).length;
    if (y && y.lostCapacity > 25 && staff < 3 && g.cash > 6000) {
      if (staff >= g.stats(s).registers) { go('meubles'); g.buyFurniture('caisse', 1, s.id); placeAll(s.id, ['caisse']); }
      hireBest(s.id);
    }
    // Formation des caissiers, puis gamme premium quand la réputation la porte.
    if (g.achieved.includes('former')) for (const e of g.staffOf(s.id)) if ((e.training ?? 0) === 0 && g.cash > 8000) g.train(e.id);
    const def = PREMIUM_BY_TYPE.get(s.type)!;
    if (g.achieved.includes('former') && !s.premium && s.reputation >= 0.8 && g.bestTraining(s.id) > 0 && g.cash > def.cost + 4000 && g.setPremium(s.id, true).ok) act(`${s.name} en gamme premium`);
  }
  initiative();
}

/* ------------------------------ Bilan ------------------------------ */
console.log(log.join('\n'));
console.log('');
for (const t of TIERS) {
  const list = OBJECTIVES.filter((o) => o.tier === t.id);
  console.log(`Palier ${TIERS.indexOf(t) + 1} · ${t.name}${tiersAt.has(t.id) ? ` — franchi le jour ${tiersAt.get(t.id)} (récompense : ${t.reward})` : ' — non franchi'}`);
  for (const o of list) console.log(`  ${reached.has(o.id) ? `J${String(reached.get(o.id)).padStart(3)}` : ' —  '}  ${o.title}`);
}
const missing = OBJECTIVES.filter((o) => !reached.has(o.id));
console.log(missing.length ? `\nNon atteints (jour ${today()}) : ${missing.map((o) => o.title).join(' ; ')}` : `\nLes ${OBJECTIVES.length} objectifs sont atteints : légende du quartier le jour ${reached.get(LEGEND_ID)}.`);
// Espacement : objectifs le même jour (après le jour 1), trous avant le jour 60.
const days = [...reached.values()].sort((x, y) => x - y);
const perDay = new Map<number, number>();
for (const d of days) perDay.set(d, (perDay.get(d) ?? 0) + 1);
const crowded = [...perDay].filter(([d, n]) => d > 1 && n > 3);
// Trou avant J60 : jours sans nouvel objectif, comptés jusqu'au jour 60 au plus ; au-delà, écarts donnés pour information.
const gaps: string[] = [], later: string[] = [];
let longest = 0;
for (let i = 1; i < days.length; i++) {
  const [d0, d1] = [days[i - 1]!, days[i]!];
  if (d0 < 60) { const span = Math.min(d1, 60) - d0; longest = Math.max(longest, span); if (span > 10) gaps.push(`J${d0} → J${d1}`); }
  if (d1 > 60 && d1 > d0) later.push(`J${d0} → J${d1} (${d1 - d0} j)`);
}
console.log(`Espacement : ${crowded.length ? `plus de 3 objectifs le même jour : ${crowded.map(([d, n]) => `J${d} (${n})`).join(', ')}` : 'jamais plus de 3 objectifs le même jour après le jour 1'} ; ${gaps.length ? `trous de plus de 10 jours avant J60 : ${gaps.join(', ')}` : `aucun trou de plus de 10 jours avant J60 (le plus long : ${longest} jours)`}.`);
if (later.length) console.log(`Après J60 : ${later.join(', ')}.`);
console.log(`Fin : jour ${today()}, ${g.shops.length} commerces (${new Set(g.shops.map((s) => s.type)).size} types), valeur nette ${Math.round(netWorth(g)).toLocaleString('fr-CH')} CHF, trésorerie ${Math.round(g.cash).toLocaleString('fr-CH')} CHF, dette ${Math.round(g.debt).toLocaleString('fr-CH')} CHF.`);
