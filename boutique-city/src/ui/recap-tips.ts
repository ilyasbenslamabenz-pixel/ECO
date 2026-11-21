/**
 * Conseils du récapitulatif de fin de journée : logique seule, sans DOM (testable hors navigateur). Chaque conseil est
 * conditionnel et chiffré : rayons trop petits pour la demande d'un produit (meuble conseillé qui l'accueille, nombre
 * et places), réassort automatique à activer seulement s'il ne l'est pas, commerce déficitaire et pourquoi (salaires,
 * loyer, ruptures, prix, attente), clients pris par un concurrent récent (« −35 clients : Boulangerie Lumen »).
 */
import { ECONOMY, SHOP_TYPE_BY_ID, bestStoreFurniture, productsOf, type FurnitureDef, type ProductDef } from '../sim/catalog';
import { STOP_FR, listFr, type DayStats, type Game, type Shop } from '../sim/game';
import { chf, num, signed } from './dom';

/** Articles manqués dans la journée à partir desquels un produit mérite un conseil (en dessous : bruit). */
const MISSED_MIN = 3;
const low = (p: ProductDef): string => p.nameFr.toLowerCase();
/** « 1 « Présentoir à pain » », « 2 « Vitrine à pâtisseries » » : nombre puis nom du meuble (sans article à accorder). */
const furnitureQty = (f: FurnitureDef, n: number): string => `${n} « ${f.nameFr} »`;
/** Marque du pluriel (« s ») au-delà de 1. */
const s_ = (n: number): string => (n > 1 ? 's' : '');
/** Résultat d'exploitation d'un commerce sur une journée : marge − salaires − loyer − publicité. */
const shopResult = (d: DayStats): number => d.revenue - d.costOfSales - d.wages - d.rent - d.marketing;

/**
 * Conseils de stock d'un commerce pour une journée, par genre de présentoir, d'après les articles vendus et manqués :
 * pas de machine à café, aucun meuble pour un produit, rayons trop petits pour la demande (deux livraisons par jour au
 * mieux ; meuble conseillé, nombre et places chiffrés), ou réassort automatique à activer (jamais s'il l'est déjà).
 */
export function stockTips(g: Game, s: Shop, d: DayStats): string[] {
  const st = g.stats(s), prods = productsOf(s.type), out: string[] = [];
  const missed = (p: ProductDef): number => d.missed?.[p.id] ?? 0;
  const demand = (p: ProductDef): number => Math.round((d.sold?.[p.id] ?? 0) + missed(p));
  const noMachine = prods.filter((p) => p.needsMachine && st.machines === 0);
  const lostM = noMachine.reduce((a, p) => a + missed(p), 0);
  if (lostM >= MISSED_MIN) out.push(`${s.name} : ${listFr(noMachine.map(low))} impossibles à servir sans machine à café (~${num(lostM)} demandes perdues) → achetez une « Machine à café » au magasin de meubles.`);
  for (const store of [...new Set(prods.map((p) => p.store))]) {
    const group = prods.filter((p) => p.store === store && !noMachine.includes(p));
    const short = group.filter((p) => missed(p) >= MISSED_MIN).sort((a, b) => missed(b) - missed(a));
    const f = bestStoreFurniture(s.type, store);
    if (!short.length || !f?.capacity) continue;
    const per = Math.floor(f.capacity / group.length), shared = group.length > 1 ? `, ${per} par produit` : '';
    if (g.storageFor(s, short[0]!, st) <= 0) {
      out.push(`${s.name} : aucun meuble pour ${listFr(short.map(low))} (~${num(short.reduce((a, p) => a + demand(p), 0))} demandés aujourd’hui, tous perdus) → ajoutez ${furnitureQty(f, 1)} (+${f.capacity} places${shared}, ${chf(f.price)}).`);
      continue;
    }
    // Ventes possibles par jour : place en rayon × ECONOMY.shelfTurns (livraisons de 7 h et 14 h). Réassort automatique
    // actif et demande au-delà d'un rayon plein : c'est la place qui manque (pas le réassort).
    const rows = short.map((p) => ({ p, cap: g.storageFor(s, p, st), dem: demand(p), auto: s.products[p.id]!.auto }));
    const small = rows.filter((r) => r.dem > r.cap * ECONOMY.shelfTurns || (r.auto && r.dem > r.cap));
    // Sans réassort automatique, la place suffit : c'est le réapprovisionnement qui manque.
    const manual = rows.filter((r) => !r.auto && !small.includes(r));
    const autoTip = 'activez le réassort automatique (onglet Prix et stock), livré à 7 h et 14 h';
    if (small.length) {
      const need = Math.max(1, ...small.map((r) => Math.ceil(r.dem / ECONOMY.shelfTurns) - r.cap));
      const n = Math.min(3, Math.max(1, Math.ceil(need / Math.max(1, per))));
      const [w, ...more] = small;
      const noAuto = small.some((r) => !r.auto);
      out.push(`Rayons trop petits chez ${s.name} : ${num(w!.cap)} places de ${low(w!.p)} pour une demande de ~${num(w!.dem)} par jour${more.map((r) => `, ${num(r.cap)} de ${low(r.p)} pour ~${num(r.dem)}`).join('')} (deux livraisons par jour au mieux, à 7 h et 14 h) → ajoutez ${furnitureQty(f, n)} (+${num(f.capacity * n)} places${shared}, ${chf(f.price * n)})${noAuto ? ' et activez le réassort automatique' : ''}${manual.length ? ` ; rupture aussi de ${listFr(manual.map((r) => low(r.p)))} : ${autoTip}` : ''}.`);
    } else if (manual.length) {
      const k = manual.reduce((a, r) => a + missed(r.p), 0);
      out.push(`Rupture de ${listFr(manual.map((r) => low(r.p)))} chez ${s.name} (~${num(k)} article${s_(k)} manqué${s_(k)}) alors que la place suffit : ${autoTip}.`);
    }
  }
  return out;
}

/**
 * Commerce déficitaire deux jours de suite (résultat d'exploitation) : pourquoi, chiffré — salaires, loyer, ruptures,
 * prix, attente en caisse, caisse vide —, du plus lourd au plus léger, avec la piste pour le premier. Null sinon.
 */
export function deficitTip(g: Game, s: Shop, d: DayStats): string | null {
  const k = s.history.findIndex((h) => h.day === d.day), prev = k > 0 ? s.history[k - 1] : undefined;
  if (!prev || shopResult(d) >= 0 || shopResult(prev) >= 0) return null;
  // Aucune vente : ce n'est pas une affaire de charges, le commerce ne peut pas vendre.
  if (d.customers === 0) {
    const why = s.stopped ?? g.blocker(s);
    const fix = why === 'rayons' ? 'réapprovisionnez (grossiste, livraison ou réassort automatique)' : why === 'caisse' ? 'posez une caisse (Aménager)' : why === 'caissier' ? 'embauchez un caissier, donnez le rôle Caisse à un employé ou tenez la caisse' : null;
    return fix ? `${s.name} n’a rien vendu aujourd’hui (${STOP_FR[why!]}) et perd ${chf(-shopResult(d))} par jour : ${fix}.` : null;
  }
  const t = SHOP_TYPE_BY_ID.get(s.type)!, prods = productsOf(s.type), margin = d.revenue - d.costOfSales;
  // Marge d'un article au prix pratiqué ; marge d'un client (réelle, ou panier moyen sans client).
  const unit = (p: ProductDef): number => Math.max(0, s.products[p.id]!.price - g.unitCost(p, s));
  const avgUnit = prods.reduce((a, p) => a + p.share * unit(p), 0);
  const perClient = d.customers > 0 ? margin / d.customers : avgUnit * t.basket;
  const missedN = prods.reduce((a, p) => a + (d.missed?.[p.id] ?? 0), 0);
  const missedV = prods.reduce((a, p) => a + (d.missed?.[p.id] ?? 0) * unit(p), 0);
  const gap = g.priceGap(s), staff = g.staffOf(s.id).length;
  // Charges (salaires, loyer, publicité) et ventes manquées (ruptures, prix, attente, caisse vide), en CHF par jour.
  const causes = [
    { v: d.wages, lost: false, text: `salaires ${chf(d.wages)} (${staff} employé${s_(staff)})`, fix: 'moins d’heures payées : une équipe de pointe (16 h – 20 h) plutôt qu’une journée complète, ou des horaires resserrés sur l’affluence' },
    { v: d.rent, lost: false, text: `loyer ${chf(d.rent)}`, fix: 'le local coûte cher pour ses ventes : attirez plus de clients (publicité, décoration, propreté, prix)' },
    { v: d.marketing, lost: false, text: `publicité ${chf(d.marketing)}`, fix: 'la publicité ne rapporte pas encore assez : laissez la notoriété monter, ou ciblez un commerce bien approvisionné' },
    { v: missedV, lost: true, text: `ruptures (~${num(missedN)} article${s_(missedN)} manqué${s_(missedN)}, ~${chf(missedV)} de marge perdue)`, fix: 'suivez les conseils de rayons ci-dessus (meubles, réassort automatique)' },
    { v: d.refusedPrice * avgUnit, lost: true, text: `prix trop élevés (${num(d.refusedPrice)} article${s_(d.refusedPrice)} reposé${s_(d.refusedPrice)})`, fix: '« Aligner » (téléphone › Commerces) ramène vos prix à ceux du quartier' },
    { v: gap < -0.05 ? (-gap * d.revenue) / (1 + gap) : 0, lost: true, text: `prix ${Math.round(-gap * 100)} % sous le quartier (marge rognée)`, fix: '« Aligner » remonte vos prix au niveau du quartier' },
    { v: d.lostCapacity * perClient, lost: true, text: `attente en caisse (${num(d.lostCapacity)} client${s_(d.lostCapacity)} parti${s_(d.lostCapacity)})`, fix: 'une caisse et un caissier de plus aux heures d’affluence' },
    { v: d.lostStaff * perClient, lost: true, text: `personne en caisse (${num(d.lostStaff)} client${s_(d.lostStaff)} reparti${s_(d.lostStaff)})`, fix: 'un caissier présent à toutes les heures d’ouverture (rôles et équipes)' },
  ].filter((c) => c.v >= 1).sort((a, b) => b.v - a.v);
  if (!causes.length) return null;
  // Piste : d'abord ce qui se corrige vite (ventes manquées qui pèsent), sinon la plus lourde des charges.
  const loss = -shopResult(d), lead = causes.find((c) => c.lost && c.v >= Math.max(30, loss * 0.25)) ?? causes[0]!;
  return `${s.name} reste déficitaire (${signed(shopResult(d))} aujourd’hui pour ${chf(margin)} de marge) : ${causes.slice(0, 3).map((c) => c.text).join(', ')}. Piste : ${lead.fix}.`;
}

/**
 * Concurrents récents (ouverts après votre commerce, il y a moins de deux semaines) ou en promotion près de vos
 * commerces : clients pris dans la journée, chiffrés (« −35 clients : Boulangerie Lumen »).
 */
export function rivalTips(g: Game, y: DayStats): string[] {
  const rv = g.rivalry, out: string[] = [];
  for (const t of rv.threats()) {
    const s = t.shop, rs = t.rival, d = s.history.find((h) => h.day === y.day);
    const fresh = rs.opened > 0 && rs.opened > (s.leaseDay ?? 0) && y.day - rs.opened < 14;
    if (!d || (!fresh && rs.promo <= 0)) continue;
    const im = rv.impact(s, rs, d);
    if (im.customers < 3) continue;
    out.push(`−${num(im.customers)} clients : ${rs.name} (${fresh ? `ouvert le jour ${rs.opened + 1}` : 'en promotion'}, à ${t.dist} m de ${s.name}, −${Math.round(im.share * 100)} % de clientèle). Ripostez : prix, stock, propreté, publicité… ou rachetez-le (téléphone › Concurrence).`);
  }
  return out;
}

/** Conseils du récapitulatif d'une journée : caisse, rayons par produit, prix, attente, concurrence, commerces déficitaires. */
export function recapTips(g: Game, y: DayStats): string[] {
  const tips: string[] = [];
  const dayOf = (s: Shop): DayStats | undefined => s.history.find((h) => h.day === y.day);
  const n1 = y.lostStaff, n2 = y.refusedPrice, n3 = y.lostCapacity;
  if (n1 > 0) tips.push(`${num(n1)} client${s_(n1)} reparti${s_(n1)} faute de caissier : embauchez ou tenez la caisse.`);
  for (const s of g.shops) { const d = dayOf(s); if (d) tips.push(...stockTips(g, s, d)); }
  if (n2 > 0) tips.push(`${num(n2)} article${s_(n2)} reposé${s_(n2)} car trop cher${s_(n2)} : rapprochez vos prix de ceux du quartier.`);
  if (n3 > 0) tips.push(`${num(n3)} client${s_(n3)} lassé${s_(n3)} d’attendre : une caisse et un caissier de plus aux heures d’affluence.`);
  tips.push(...rivalTips(g, y));
  for (const s of g.shops) { const d = dayOf(s), t = d ? deficitTip(g, s, d) : null; if (t) tips.push(t); }
  // Prix restés au-dessus du quartier (les concurrents ont baissé les leurs) : conseil « Aligner ».
  for (const t of [...new Set(g.shops.map((s) => s.type))]) {
    const gap = g.priceGap(t);
    if (gap >= 0.03) tips.push(`Vos prix (${g.shops.find((s) => s.type === t)!.name}${g.batchShops(t).length > 1 ? ' et les autres du même type' : ''}) sont ${Math.round(gap * 100)} % au-dessus du quartier : « Aligner » dans le téléphone (Commerces) les ramène au prix du quartier.`);
  }
  const lost = y.lostStaff + y.lostStock + y.lostCapacity;
  if (!tips.length && y.customers > 0) tips.push(lost > 0 ? `Journée correcte : ${num(lost)} client${s_(lost)} perdu${s_(lost)} seulement, rien d’alarmant.` : 'Aucun client perdu : la journée s’est bien passée. Pensez à agrandir ou à ouvrir un deuxième commerce.');
  if (!tips.length && !g.shops.length) tips.push('Pas encore de commerce : louez un local (anneau jaune devant les locaux libres, carte : touche M).');
  return tips;
}
