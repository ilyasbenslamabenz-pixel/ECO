/**
 * Objectifs de l'entrepreneur, en quatre paliers dans l'ordre d'une partie : Démarrage (les premiers pas), Gérant
 * (bien tenir ses commerces), Entrepreneur (grandir et s'imposer face aux rivaux), Magnat (dominer le quartier),
 * jusqu'à l'objectif final « Légende du quartier », qui déclenche l'écran de victoire (interface).
 *
 * Trois objectifs sont actifs en parallèle : les trois premiers non atteints, palier courant d'abord, puis le suivant.
 * Un objectif ne se valide que s'il appartient au palier courant (le premier palier inachevé) ou aux objectifs actifs :
 * les paliers suivants restent verrouillés (la mise de départ ne valide pas « 40 000 CHF de valeur nette » dès le
 * premier jour). Chaque palier franchi apporte une récompense : une recrue d'exception, de la réputation, une prime.
 *
 * Chaque objectif lit l'état de la partie ; seul le suivi de propreté (série à 90 % ou plus) est noté sur les
 * commerces, pour survivre à une sauvegarde. Identifiants stables : ceux des anciennes versions sont conservés
 * (« valeur100k » désigne l'objectif des 60 000 CHF). TypeScript pur.
 */
import { ECONOMY, FURNITURE_BY_ID, LOGISTICS, PRODUCT_BY_ID, SHOP_TYPES, SHOP_TYPE_BY_ID, TRAINING, VEHICLE_BY_ID, productsOf } from './catalog';
import { MINUTES_PER_DAY } from './clock';
import { dayProfit, type Candidate, type Game, type Shop } from './game';
import { randomName } from './names';
import { Rng } from './rng';

export type TierId = 'demarrage' | 'gerant' | 'entrepreneur' | 'magnat';

export interface Tier {
  id: TierId;
  name: string;
  /** Titre de l'entrepreneur tant que ce palier est le palier courant. */
  rank: string;
  /** Récompense annoncée, versée quand le palier est franchi. */
  reward: string;
}

export interface Objective {
  id: string;
  tier: TierId;
  title: string;
  hint: string;
  /** Avancement 0..1 et texte court (« 4 / 10 clients »). */
  progress: (g: Game) => { p: number; text: string };
}

/** Ce que la partie fournit au module : identifiants uniques (recrue offerte), signal de changement d'état. */
export interface ObjectiveHost { newId: () => number; bump: () => void }

export const LEGEND_ID = 'legende';
/** Titre une fois tous les objectifs atteints. */
export const LEGEND_RANK = 'Légende du quartier';

/** Seuils (valeurs lisibles dans les titres) et récompenses des paliers. */
const PRICE_TOLERANCE = 0.03;
const CLEAN_GOAL = 90;
const CLEAN_DAYS = 3;
const MARKET_GOAL = 0.4;
const REWARD_SKILL = 0.95;
/** Jours pendant lesquels la recrue offerte attend à l'agence. */
const REWARD_DAYS = 7;
const REWARD_REPUTATION = 0.1;
const REWARD_CASH = 25_000;

const fmt = (v: number): string => Math.floor(v).toLocaleString('fr-CH');
const pct = (v: number): string => `${Math.round(v * 100)} %`;

export const TIERS: readonly Tier[] = [
  { id: 'demarrage', name: 'Démarrage', rank: 'Débutant', reward: `une recrue d’exception (compétence ${pct(REWARD_SKILL)}) à l’agence pour l’emploi pendant ${REWARD_DAYS} jours` },
  { id: 'gerant', name: 'Gérant', rank: 'Gérant', reward: `+${Math.round(REWARD_REPUTATION * 100)} points de réputation dans tous vos commerces` },
  { id: 'entrepreneur', name: 'Entrepreneur', rank: 'Entrepreneur', reward: `une prime de ${REWARD_CASH.toLocaleString('fr-CH')} CHF` },
  { id: 'magnat', name: 'Magnat', rank: 'Magnat', reward: 'le titre de Légende du quartier' },
];
export const TIER_BY_ID: ReadonlyMap<TierId, Tier> = new Map(TIERS.map((t) => [t.id, t]));

const step = (v: number, goal: number, unit: string): { p: number; text: string } => ({ p: Math.max(0, Math.min(1, v / goal)), text: `${fmt(Math.max(0, Math.min(v, goal)))} / ${goal.toLocaleString('fr-CH')} ${unit}` });
const flag = (ok: boolean): { p: number; text: string } => ({ p: ok ? 1 : 0, text: ok ? 'fait' : 'à faire' });
const typeName = (t: string): string => SHOP_TYPE_BY_ID.get(t as Shop['type'])?.nameFr ?? t;

const totalCustomers = (g: Game): number => g.ledger.reduce((a, d) => a + d.customers, 0) + g.today.customers;
const bestDay = (g: Game): number => Math.max(g.today.revenue, ...g.ledger.map((d) => d.revenue), 0);
/** Meilleur résultat d'une journée terminée (toutes dépenses comprises, comme le récapitulatif du soir). */
const bestProfit = (g: Game): number => Math.max(0, ...g.ledger.map(dayProfit));
const typeCount = (g: Game): number => new Set(g.shops.map((s) => s.type)).size;
const worth = (goal: number) => (g: Game): { p: number; text: string } => step(netWorth(g), goal, 'CHF');

/**
 * Valeur nette : trésorerie + placements (valeur de rachat) + mobilier (revente) + véhicules (revente) + dépôts de
 * garantie (commerces, locaux sous-loués, entrepôts) + étagères d'entrepôt (revente) + marchandise au coût d'achat
 * (rayons, véhicules, portée, entrepôts, commandes et arrivages payés) − dettes − loyers provisionnés non prélevés.
 */
export function netWorth(g: Game): number {
  const goods = (r: Record<string, number>): number => Object.entries(r).reduce((a, [id, n]) => a + (PRODUCT_BY_ID.get(id)?.cost ?? 0) * n, 0);
  let v = g.cash - g.debt + g.investValue() + goods(g.player.carry);
  for (const s of g.shops) {
    v += s.deposit - (s.rentDue ?? 0);
    for (const it of s.items) v += (FURNITURE_BY_ID.get(it.def)?.price ?? 0) * ECONOMY.resale;
    for (const [id, n] of Object.entries(s.storage)) v += (FURNITURE_BY_ID.get(id)?.price ?? 0) * ECONOMY.resale * n;
    for (const pr of productsOf(s.type)) v += (s.products[pr.id]?.stock ?? 0) * g.unitCost(pr, s);
  }
  for (const o of g.orders) v += o.cost;
  for (const veh of g.vehicles) v += VEHICLE_BY_ID.get(veh.type)!.price * ECONOMY.vehicleResale + goods(veh.cargo);
  for (const sl of g.sublets) v += sl.deposit;
  for (const w of g.logi.warehouses) v += w.deposit - (w.rentDue ?? 0) + w.racks * LOGISTICS.rackPrice * ECONOMY.resale + goods(w.stock);
  for (const o of g.logi.imports) v += o.cost;
  return v;
}

/**
 * Commerce le mieux aligné sur les prix du quartier, parmi ceux dont les concurrents ont bougé leurs prix d'au moins
 * 3 % (sinon les prix de départ sont déjà « alignés » sans rien faire).
 */
function priceAlignment(g: Game): { k: number; n: number; shop: Shop | null } {
  let best: { k: number; n: number; shop: Shop | null } = { k: 0, n: 1, shop: null };
  for (const s of g.shops) {
    if (Math.abs((g.rivals[s.type] ?? 1) - 1) < PRICE_TOLERANCE) continue;
    const prods = productsOf(s.type);
    const k = prods.filter((pr) => Math.abs(s.products[pr.id]!.price / g.refPrice(pr, s) - 1) <= PRICE_TOLERANCE + 1e-9).length;
    if (!best.shop || k / prods.length > best.k / best.n) best = { k, n: prods.length, shop: s };
  }
  return best;
}

/** Jours de propreté à 90 % ou plus d'affilée, comptés pour un commerce qui a servi des clients ses 3 derniers jours. */
function cleanRun(g: Game, s: Shop): number {
  if (s.cleanSince === undefined) return 0;
  if (s.history.length < CLEAN_DAYS || !s.history.slice(-CLEAN_DAYS).every((d) => d.customers > 0)) return 0;
  return (g.total - s.cleanSince) / MINUTES_PER_DAY;
}

/**
 * Meilleure part de marché (clients de la veille, rivaux estimés). Un marché sans aucun concurrent ne compte que si
 * vous y tenez au moins deux commerces (sinon 100 % sans effort).
 */
export function bestMarketShare(g: Game): { share: number; type: string | null } {
  let best: { share: number; type: string | null } = { share: 0, type: null };
  for (const r of g.rivalry.marketShare()) {
    if (r.total <= 0 || r.mine <= 0) continue;
    if (!r.parts.length && g.shops.filter((s) => s.type === r.type).length < 2) continue;
    const share = r.mine / r.total;
    if (share > best.share) best = { share, type: r.type };
  }
  return best;
}

/** Avancement d'un rachat : trésorerie rapportée au rachat le moins cher (commerce rival ou enseigne entière). */
function buyProgress(g: Game, cheapest: { total: number; label: string } | null): { p: number; text: string } {
  if (!cheapest) return { p: 0, text: 'rien à racheter pour l’instant' };
  const cash = Math.max(0, g.cash);
  return { p: Math.min(0.99, cash / cheapest.total), text: `${fmt(Math.min(cash, cheapest.total))} / ${fmt(cheapest.total)} CHF · ${cheapest.label}` };
}
function cheapestShop(g: Game): { total: number; label: string } | null {
  let best: { total: number; label: string } | null = null;
  for (const rs of g.rivalry.shops) {
    const q = g.rivalry.quote(rs.premiseId);
    if (q && (!best || q.total < best.total)) best = { total: q.total, label: rs.name };
  }
  return best;
}
function cheapestCompany(g: Game): { total: number; label: string } | null {
  let best: { total: number; label: string } | null = null;
  for (const co of g.rivalry.active) {
    const q = g.rivalry.companyQuote(co.id);
    if (q && (!best || q.total < best.total)) best = { total: q.total, label: co.name };
  }
  return best;
}

const ALL_TYPES = SHOP_TYPES.map((t) => t.nameFr.toLowerCase()).join(', ');

export const OBJECTIVES: readonly Objective[] = [
  /* ------------------------------ Démarrage ------------------------------ */
  { id: 'sortir', tier: 'demarrage', title: 'Sortir de chez soi', hint: 'Marchez jusqu’à la porte de l’appartement (E).', progress: (g) => flag(g.player.place.kind !== 'logement' || g.shops.length > 0) },
  { id: 'louer', tier: 'demarrage', title: 'Louer un premier local', hint: 'Téléphone (T) › Immobilier : comparez les locaux, « Voir sur la carte », puis signez le bail devant l’anneau jaune.', progress: (g) => flag(g.shops.length > 0) },
  { id: 'meubler', tier: 'demarrage', title: 'Poser une caisse et un présentoir', hint: 'Achetez une caisse et un présentoir au magasin de meubles, puis dans votre local : « Aménager » (B).', progress: (g) => flag(g.shops.some((s) => { const st = g.stats(s); return st.registers > 0 && Object.values(st.capacity).some((c) => c > 0); })) },
  { id: 'stock', tier: 'demarrage', title: 'Mettre de la marchandise en rayon', hint: 'Grossiste : faites-la livrer (7 h ou 14 h) ou emportez-la puis « Décharger » dans le commerce.', progress: (g) => flag(g.shops.some((s) => Object.values(s.products).some((p) => p.stock > 0))) },
  { id: 'servir10', tier: 'demarrage', title: 'Servir 10 clients', hint: 'Tenez la caisse vous-même (E derrière la caisse) pendant les heures d’ouverture.', progress: (g) => step(totalCustomers(g), 10, 'clients') },
  { id: 'embaucher', tier: 'demarrage', title: 'Embaucher un employé', hint: 'Agence pour l’emploi : un caissier tient la caisse à votre place.', progress: (g) => flag(g.employees.length > 0) },
  { id: 'jour500', tier: 'demarrage', title: 'Vendre pour 500 CHF en une journée', hint: 'Réassort automatique, prix proches du quartier, horaires sur les heures d’affluence.', progress: (g) => step(bestDay(g), 500, 'CHF') },
  { id: 'pub', tier: 'demarrage', title: 'Lancer une campagne de publicité', hint: 'Agence de publicité : plus de clients pendant la campagne.', progress: (g) => flag(g.campaigns.length > 0 || g.ledger.some((d) => d.marketing > 0) || g.today.marketing > 0) },
  { id: 'deux', tier: 'demarrage', title: 'Ouvrir un deuxième commerce', hint: 'Téléphone › Immobilier : un autre type dans une autre rue évite de vous concurrencer vous-même.', progress: (g) => step(g.shops.length, 2, 'commerces') },
  { id: 'trois', tier: 'demarrage', title: 'Bâtir un réseau de trois commerces', hint: 'Prêts bancaires pour financer, employés pour tenir les caisses.', progress: (g) => step(g.shops.length, 3, 'commerces') },
  { id: 'vehicule', tier: 'demarrage', title: 'Acheter un véhicule', hint: `Garage : un scooter suffit pour vos allers-retours chez le grossiste (${VEHICLE_BY_ID.get('scooter')!.cargo} unités). Plus tard, une camionnette en porte ${VEHICLE_BY_ID.get('camionnette')!.cargo}.`, progress: (g) => flag(g.vehicles.length > 0) },

  /* ------------------------------ Gérant ------------------------------ */
  { id: 'prix', tier: 'gerant', title: 'Aligner ses prix sur le quartier', hint: `Quand les concurrents baissent leurs prix (un message vous prévient), ramenez chaque prix d’un commerce à ± ${pct(PRICE_TOLERANCE)} du prix du quartier : « Aligner » dans le message, Gestion › Prix et stock, ou Réglages en lot (coefficient ×1).`, progress: (g) => {
    const a = priceAlignment(g);
    if (!a.shop) return { p: 0, text: 'concurrents encore au prix habituel' };
    return { p: a.k / a.n, text: `${a.k} / ${a.n} produits au prix · ${a.shop.name}` };
  } },
  { id: 'proprete', tier: 'gerant', title: 'Tenir un commerce impeccable', hint: `Gestion › Aperçu › Propreté : souscrivez le service de nettoyage de nuit, ou gardez la propreté à ${CLEAN_GOAL} % ou plus ${CLEAN_DAYS} jours de suite (employé d’entretien).`, progress: (g) => {
    if (g.shops.some((s) => s.cleanService)) return { p: 1, text: 'service de nuit souscrit' };
    const days = Math.max(0, ...g.shops.map((s) => cleanRun(g, s)));
    return { p: Math.min(1, days / CLEAN_DAYS), text: `${(Math.floor(Math.min(days, CLEAN_DAYS) * 10) / 10).toLocaleString('fr-CH')} / ${CLEAN_DAYS} jours à ${CLEAN_GOAL} %` };
  } },
  { id: 'former', tier: 'gerant', title: 'Former un employé', hint: `Gestion › Employés › Former : il sert ${pct(TRAINING.capacity)} de clients en plus par niveau, mais son salaire du marché monte un peu.`, progress: (g) => flag(g.employees.some((e) => (e.training ?? 0) >= 1)) },
  { id: 'reputation', tier: 'gerant', title: 'Atteindre 90 % de réputation dans un commerce', hint: 'La réputation suit la part de clients bien servis : rayons pleins, caissiers aux heures d’affluence, magasin propre, prix raisonnables.', progress: (g) => step(Math.max(0, ...g.shops.map((s) => s.reputation)) * 100, 90, '%') },
  { id: 'contrat', tier: 'gerant', title: 'Signer un contrat fournisseur', hint: 'Chez le grossiste : une remise sur tous vos achats contre un forfait quotidien. Rentable dès que vous achetez beaucoup.', progress: (g) => flag(g.contract !== null) },
  { id: 'clients5000', tier: 'gerant', title: 'Servir 5 000 clients au total', hint: 'Commerces ouverts, approvisionnés et tenus : chaque client servi compte, tous commerces confondus.', progress: (g) => step(totalCustomers(g), 5000, 'clients') },
  { id: 'benefice1000', tier: 'gerant', title: 'Gagner 1 000 CHF en une journée', hint: 'Résultat d’une journée complète, toutes dépenses comprises (récapitulatif du soir). Leviers : rayons pleins, prix du quartier, horaires calés sur l’affluence.', progress: (g) => step(bestProfit(g), 1000, 'CHF') },
  { id: 'vn40k', tier: 'gerant', title: 'Remonter à 40 000 CHF de valeur nette', hint: 'Vos débuts ont entamé la mise de départ : faites remonter la valeur nette (trésorerie, placements, mobilier, véhicules, dépôts, marchandise, moins les dettes).', progress: worth(40_000) },

  /* ------------------------------ Entrepreneur ------------------------------ */
  { id: 'types4', tier: 'entrepreneur', title: 'Tenir quatre types de commerce', hint: 'Téléphone › Immobilier : chaque nouveau type touche une autre clientèle, sans vous concurrencer vous-même.', progress: (g) => step(typeCount(g), 4, 'types') },
  { id: 'gamme', tier: 'entrepreneur', title: 'Monter en gamme : un commerce premium', hint: 'Avec un employé formé dans le commerce : Gestion › Prix et stock › Gamme premium. Visez une bonne réputation d’abord : la clientèle premium la suit.', progress: (g) => {
    const best = Math.max(0, ...g.shops.map((s) => (s.premium ? 2 : 0) + Math.min(1, g.bestTraining(s.id))));
    return { p: best >= 2 ? 1 : best / 2, text: best >= 2 ? 'fait' : best >= 1 ? 'employé formé, gamme à activer' : 'former un employé' };
  } },
  { id: 'rachat', tier: 'entrepreneur', title: 'Racheter un commerce rival', hint: 'Devant un commerce concurrent, ou appli Concurrence : « Racheter ». Meubles, marchandise et clientèle compris.', progress: (g) => (g.shops.some((s) => s.acquired) || g.rivalry.cos.some((c) => c.bought) ? flag(true) : buyProgress(g, cheapestShop(g))) },
  { id: 'part40', tier: 'entrepreneur', title: 'Prendre 40 % d’un marché', hint: 'Appli Concurrence › Parts de marché : la part de vos clients dans un type de commerce. Un deuxième commerce du même type, ou un rachat, la fait grimper.', progress: (g) => {
    const b = bestMarketShare(g);
    return { p: Math.min(1, b.share / MARKET_GOAL), text: `${Math.floor(b.share * 100)} / ${Math.round(MARKET_GOAL * 100)} %${b.type ? ` · ${typeName(b.type)}` : ''}` };
  } },
  { id: 'cinq', tier: 'entrepreneur', title: 'Bâtir un réseau de cinq commerces', hint: 'Ouvrez dans des rues passantes, ou rachetez un concurrent déjà installé avec sa clientèle.', progress: (g) => step(g.shops.length, 5, 'commerces') },
  { id: 'valeur100k', tier: 'entrepreneur', title: 'Atteindre 60 000 CHF de valeur nette', hint: 'Leviers : gamme premium, employés formés, une caisse de plus là où des clients attendent, contrat fournisseur quand vous achetez beaucoup.', progress: worth(60_000) },
  { id: 'vn100k', tier: 'entrepreneur', title: 'Atteindre 100 000 CHF de valeur nette', hint: 'Développez les commerces les plus rentables, placez la trésorerie qui dort, remboursez les prêts coûteux.', progress: worth(100_000) },

  /* ------------------------------ Magnat ------------------------------ */
  { id: 'types7', tier: 'magnat', title: 'Tenir les sept types de commerce', hint: `Au moins un commerce de chaque type : ${ALL_TYPES}.`, progress: (g) => step(typeCount(g), SHOP_TYPES.length, 'types') },
  { id: 'dix', tier: 'magnat', title: 'Bâtir un réseau de dix commerces', hint: 'Ouvertures et rachats : un entrepôt et des tournées de nuit simplifient le réassort d’un grand réseau.', progress: (g) => step(g.shops.length, 10, 'commerces') },
  { id: 'enseigne', tier: 'magnat', title: 'Racheter une enseigne rivale entière', hint: 'Appli Concurrence › Entreprises rivales : « Racheter l’entreprise » reprend tous ses commerces d’un coup (ou rachetez-les un par un).', progress: (g) => {
    if (g.rivalry.cos.some((c) => c.bought)) return flag(true);
    if (g.rivalry.cos.length && !g.rivalry.active.length) return { p: 1, text: 'plus aucune enseigne rivale dans le quartier' };
    return buyProgress(g, cheapestCompany(g));
  } },
  { id: 'vn250k', tier: 'magnat', title: 'Atteindre 250 000 CHF de valeur nette', hint: 'Un réseau rentable, des employés formés, la gamme premium là où la réputation le permet.', progress: worth(250_000) },
  { id: 'vn500k', tier: 'magnat', title: 'Atteindre 500 000 CHF de valeur nette', hint: 'Les gros leviers : rachats rentables, importateur et entrepôt pour acheter moins cher, gamme premium partout où elle paie.', progress: worth(500_000) },
  { id: 'vn1m', tier: 'magnat', title: 'Atteindre 1 000 000 CHF de valeur nette', hint: 'Le million : un empire rentable, sans dette inutile.', progress: worth(1_000_000) },
  { id: LEGEND_ID, tier: 'magnat', title: LEGEND_RANK, hint: 'Le dernier défi : atteindre tous les autres objectifs. Le quartier ne parlera plus que de vous.', progress: (g) => {
    const others = OBJECTIVES.filter((o) => o.id !== LEGEND_ID);
    const n = others.filter((o) => g.achieved.includes(o.id)).length;
    return { p: n / others.length, text: n >= others.length ? 'fait' : `${n} / ${others.length} objectifs` };
  } },
];
export const OBJECTIVE_BY_ID: ReadonlyMap<string, Objective> = new Map(OBJECTIVES.map((o) => [o.id, o]));

/* ------------------------------ Paliers et objectifs actifs ------------------------------ */

export const tierObjectives = (id: TierId): Objective[] => OBJECTIVES.filter((o) => o.tier === id);
/** Objectifs atteints et total d'un palier. */
export function tierCount(g: Game, id: TierId): { done: number; total: number } {
  const list = tierObjectives(id);
  return { done: list.filter((o) => g.achieved.includes(o.id)).length, total: list.length };
}
export function tierComplete(g: Game, id: TierId): boolean { const c = tierCount(g, id); return c.done >= c.total; }
/** Palier courant : le premier palier inachevé (null : tous les objectifs sont atteints). */
export function currentTier(g: Game): Tier | null {
  return TIERS.find((t) => !tierComplete(g, t.id)) ?? null;
}
/** Objectifs actifs : les `n` premiers non atteints, palier courant d'abord, puis le suivant. */
export function activeObjectives(g: Game, n = 3): Objective[] {
  return OBJECTIVES.filter((o) => !g.achieved.includes(o.id)).slice(0, n);
}
/** Un objectif peut-il se valider maintenant ? (palier courant, ou parmi les objectifs actifs.) */
export function isUnlocked(g: Game, o: Objective): boolean {
  const cur = currentTier(g);
  return !!cur && (o.tier === cur.id || activeObjectives(g).includes(o));
}
/** Titre de l'entrepreneur : celui du palier courant, « Légende du quartier » une fois tout atteint. */
export function rankOf(g: Game): string { return currentTier(g)?.rank ?? LEGEND_RANK; }
/** Score affiché à la victoire : valeur nette gagnée par jour de jeu. */
export function victoryScore(g: Game): number { return Math.max(0, Math.round(netWorth(g) / (g.day + 1))); }

/* ------------------------------ Vérification ------------------------------ */

/** Série de propreté : début (minute de jeu) de la période en cours à 90 % ou plus, pour chaque commerce. */
function trackCleanliness(g: Game): void {
  for (const s of g.shops) {
    if (g.cleanliness(s) >= CLEAN_GOAL) s.cleanSince ??= g.total;
    else delete s.cleanSince;
  }
}

/** Récompense d'un palier franchi (une seule fois) ; renvoie la phrase de la notification. */
function grantReward(g: Game, t: Tier, host: ObjectiveHost): string {
  switch (t.id) {
    case 'demarrage': {
      const rng = new Rng(((g.seed ^ 0x2545f491) + g.total * 0x9e3779b1) >>> 0);
      const wage = g.marketWage(REWARD_SKILL);
      const c: Candidate = { id: host.newId(), name: randomName(rng), skill: REWARD_SKILL, wage, look: rng.int(0, 999), wantShift: 'journee', minWage: wage, until: g.day + REWARD_DAYS };
      g.candidates.unshift(c);
      return `Récompense : une recrue d’exception, ${c.name} (compétence ${pct(REWARD_SKILL)}), vous attend à l’agence pour l’emploi pendant ${REWARD_DAYS} jours.`;
    }
    case 'gerant':
      for (const s of g.shops) s.reputation = Math.min(1, s.reputation + REWARD_REPUTATION);
      return `Récompense : +${Math.round(REWARD_REPUTATION * 100)} points de réputation dans tous vos commerces.`;
    case 'entrepreneur':
      g.cash += REWARD_CASH;
      return `Récompense : une prime de ${REWARD_CASH.toLocaleString('fr-CH')} CHF versée sur votre compte.`;
    case 'magnat':
      return 'Vous êtes la légende du quartier !';
  }
}

/**
 * Vérifie les objectifs ouverts (palier courant et objectifs actifs) et valide ceux qui sont remplis, en cascade
 * (un objectif validé peut en ouvrir un autre déjà rempli). Une seule notification par vérification ; chaque palier
 * franchi verse sa récompense et l'annonce (« Palier franchi : … »). Appelée chaque heure de jeu et par l'interface.
 */
export function updateObjectives(g: Game, host: ObjectiveHost): void {
  trackCleanliness(g);
  // Recrue offerte non embauchée : elle repart après ses 7 jours d'attente.
  if (g.candidates.some((c) => c.until !== undefined && c.until < g.day)) { g.candidates = g.candidates.filter((c) => c.until === undefined || c.until >= g.day); host.bump(); }
  const before = new Set(TIERS.filter((t) => tierComplete(g, t.id)).map((t) => t.id));
  const got: Objective[] = [];
  for (let pass = 0; pass < OBJECTIVES.length; pass++) {
    const cur = currentTier(g);
    if (!cur) break;
    const active = activeObjectives(g);
    const hit = OBJECTIVES.filter((o) => !g.achieved.includes(o.id) && (o.tier === cur.id || active.includes(o)) && o.progress(g).p >= 1);
    if (!hit.length) break;
    for (const o of hit) { g.achieved.push(o.id); got.push(o); }
  }
  if (!got.length) return;
  g.notify('ok', got.length === 1 ? `Objectif atteint : ${got[0]!.title} !` : `Objectifs atteints : ${got.map((o) => o.title).join(' · ')} !`);
  for (const t of TIERS) {
    if (before.has(t.id) || !tierComplete(g, t.id)) continue;
    g.notify('ok', `Palier franchi : ${t.name} ! ${grantReward(g, t, host)}`);
  }
  host.bump();
}
