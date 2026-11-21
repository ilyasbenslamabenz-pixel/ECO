/**
 * Concurrence active : entreprises rivales (noms inventés) qui tiennent des commerces dans le quartier, avec une
 * trésorerie simulée simplement, une réputation et un niveau de prix par commerce. Chaque nuit, chaque commerce
 * rival fait un chiffre d'affaires estimé (passage, attrait, concurrence voisine, commerces du joueur compris) ;
 * à partir de RIVALS.startDay, les entreprises ouvrent des commerces dans des locaux libres, ajustent leurs prix,
 * lancent des promotions (moins de clients, borné, pour les commerces du joueur du même type à proximité),
 * ferment les commerces qui perdent de l'argent et peuvent faire faillite (les locaux redeviennent libres).
 * Le joueur peut racheter un commerce rival (meubles et stock de départ, employés en option) ou une entreprise.
 *
 * Tirages : générateurs dérivés de la graine et du jour, sans toucher au générateur principal de la partie.
 * Les commerces indépendants du quartier (sans entreprise) sont suivis aussi, mais restent passifs.
 * TypeScript pur.
 */
import { ECONOMY, FURNITURE_BY_ID, RIVALS, RIVAL_COMPANIES, RIVAL_LAYOUTS, SHOP_TYPES, SHOP_TYPE_BY_ID, productsOf, type ShopType } from './catalog';
import type { Premise } from './district';
import type { DayStats, Employee, Game, Result, Shop } from './game';
import { canPlace, layoutStats } from './layout';
import { randomName } from './names';
import { Rng } from './rng';

export interface RivalCo {
  id: string;
  name: string;
  brand: string;
  color: string;
  types: ShopType[];
  /** Trésorerie simulée (CHF). */
  cash: number;
  /** Réputation de l'enseigne (0..1), vers laquelle tendent ses commerces. */
  reputation: number;
  /** Faillite ou rachat : l'entreprise n'existe plus. */
  gone: boolean;
  /** Racheté par le joueur (sinon : faillite). */
  bought?: boolean;
  endDay?: number;
}

export interface RivalShop {
  premiseId: number;
  /** Entreprise (id), ou null pour un indépendant du quartier. */
  co: string | null;
  type: ShopType;
  name: string;
  reputation: number;
  /** Niveau de prix (× prix habituel). */
  price: number;
  /** Jours de promotion restants. */
  promo: number;
  opened: number;
  /** Jours de pertes d'affilée. */
  loss: number;
  /** Clients, chiffre d'affaires et résultat estimés des derniers jours (le plus récent en dernier, 7 au plus). */
  customers: number;
  revenue: number[];
  profit: number[];
  /** Ouvert par le premier coup de la concurrence : commerce du joueur visé (id). */
  target?: number;
}

/** Premier coup marquant de la concurrence : jour, local du commerce rival, commerce du joueur visé, enseigne. */
export interface RivalStrike { day: number; premiseId: number; shopId: number; co: string }

/**
 * État sauvegardé ; `buys` : commerces déjà rachetés par le joueur (absent des anciennes sauvegardes : 0) ; `strike` :
 * premier coup déjà joué, ou null s'il n'aura pas lieu (absent : pas encore joué).
 */
export interface RivalSave { cos: RivalCo[]; shops: RivalShop[]; buys?: number; strike?: RivalStrike | null }

export interface RivalQuote {
  /** Prix du fonds de commerce, dépôt de garantie du bail, total à payer. */
  price: number; deposit: number; total: number;
  /** Chiffre d'affaires moyen par jour, clients par jour, réputation. */
  revenue: number; customers: number; reputation: number;
  /** Valeur du mobilier livré, employés repris en option. */
  furniture: number; staff: number;
}

export interface MarketRow { type: ShopType; total: number; mine: number; parts: { label: string; color: string; customers: number }[] }
export interface Threat { shop: Shop; rival: RivalShop; dist: number }

interface Host { newId: () => number; bump: () => void }

const r2 = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const avg = (a: readonly number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const dist = (a: Premise, b: Premise): number => Math.hypot(a.doorX - b.doorX, a.doorZ - b.doorZ);
const typeName = (t: ShopType): string => SHOP_TYPE_BY_ID.get(t)!.nameFr;
const typeLower = (t: ShopType): string => typeName(t).toLowerCase();

export class Rivalry {
  cos: RivalCo[] = [];
  shops: RivalShop[] = [];
  /** Commerces rivaux déjà rachetés par le joueur : chaque rachat renchérit les suivants (RIVALS.buySurcharge). */
  buys = 0;
  /** Premier coup marquant : joué (détails), null s'il n'aura pas lieu, absent tant qu'il n'est pas joué. */
  strike?: RivalStrike | null;
  private byPremise = new Map<number, RivalShop>();

  constructor(private readonly game: Game, private readonly host: Host) {}

  /* ------------------------------ État ------------------------------ */

  /** Début de partie (ou sauvegarde sans rivaux) : entreprises tirées de la graine, reprise des commerces existants. */
  init(save?: RivalSave): void {
    // Premier coup scénarisé : joué, abandonné (null) ou à venir (absent ; au-delà de RIVALS.strikeLastDay, abandonné).
    this.strike = save?.strike !== undefined ? structuredClone(save.strike) : undefined;
    if (save) {
      this.cos = structuredClone(save.cos);
      this.shops = structuredClone(save.shops);
      this.buys = save.buys ?? 0;
    } else {
      const g = this.game, rng = new Rng((g.seed ^ 0x27d4eb2f) >>> 0);
      const n = rng.int(RIVALS.countMin, RIVALS.countMax);
      const pool = [...RIVAL_COMPANIES];
      this.cos = [];
      for (let k = 0; k < n && pool.length; k++) {
        const d = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
        this.cos.push({ id: d.id, name: d.nameFr, brand: d.brand, color: d.color, types: [...d.types], cash: rng.int(RIVALS.startCash[0], RIVALS.startCash[1]), reputation: r2(0.4 + rng.next() * 0.25), gone: false });
      }
      this.shops = [];
      for (const p of g.district.premises) {
        if (!p.competitor || g.shopAt(p.id)) continue;
        this.shops.push({ premiseId: p.id, co: null, type: p.competitor, name: p.competitorName ?? typeName(p.competitor), reputation: 0.5, price: 1, promo: 0, opened: 0, loss: 0, customers: 0, revenue: [], profit: [] });
      }
      // Chaque entreprise reprend quelques commerces de ses types de prédilection (les mieux placés d'abord).
      const byFoot = [...this.shops].sort((a, b) => (g.premise(b.premiseId)?.footfall ?? 0) - (g.premise(a.premiseId)?.footfall ?? 0));
      for (const co of this.cos) {
        let got = 0;
        for (const rs of byFoot) {
          if (got >= RIVALS.startShops) break;
          if (rs.co || !co.types.includes(rs.type) || rng.next() > 0.75) continue;
          rs.co = co.id; rs.name = `${typeName(rs.type)} ${co.brand}`; got++;
        }
        if (!got) {
          const rs = byFoot.find((x) => !x.co);
          if (rs) { rs.co = co.id; rs.name = `${typeName(rs.type)} ${co.brand}`; if (!co.types.includes(rs.type)) co.types.push(rs.type); }
        }
      }
    }
    this.apply();
  }

  save(): RivalSave {
    const out: RivalSave = { cos: structuredClone(this.cos), shops: structuredClone(this.shops), buys: this.buys };
    if (this.strike !== undefined) out.strike = structuredClone(this.strike);
    return out;
  }

  /** Majoration des prix de rachat (× 1 + RIVALS.buySurcharge par commerce déjà racheté). */
  buyFactor(): number { return 1 + RIVALS.buySurcharge * this.buys; }

  /** Recopie l'état sur les locaux du quartier (concurrent installé ou local libre). */
  private apply(): void {
    this.byPremise = new Map(this.shops.map((s) => [s.premiseId, s]));
    for (const p of this.game.district.premises) {
      const rs = this.byPremise.get(p.id);
      p.competitor = rs ? rs.type : null;
      p.competitorName = rs ? rs.name : null;
    }
  }

  shopAt(premiseId: number): RivalShop | undefined { return this.byPremise.get(premiseId); }
  co(id: string | null): RivalCo | undefined { return id ? this.cos.find((c) => c.id === id) : undefined; }
  /** Entreprises encore en activité. */
  get active(): RivalCo[] { return this.cos.filter((c) => !c.gone); }
  shopsOf(coId: string): RivalShop[] { return this.shops.filter((s) => s.co === coId); }
  /** Les rivaux agissent-ils déjà (ouvertures, prix, promotions) ? */
  get awake(): boolean { return this.game.day >= RIVALS.startDay; }

  /* ------------------------------ Effets sur la demande ------------------------------ */

  /**
   * Poids d'un commerce rival dans la concurrence (1 = commerce moyen) : plus fort si sa réputation est bonne ou ses
   * prix bas (de 0,6 à 1,5).
   */
  weight(premiseId: number): number {
    const rs = this.byPremise.get(premiseId);
    if (!rs) return 1;
    return clamp((0.5 + rs.reputation) * Math.exp(-1.5 * (rs.price - 1)), 0.6, 1.5);
  }

  /**
   * Pression concurrentielle d'un local pour un type : somme, sur les commerces du même type (rivaux et joueur), d'un
   * poids décroissant avec la distance (1 porte à porte, ≈ 0,3 à 110 m, rien au-delà de 300 m), × poids du rival.
   */
  pressure(p: Premise, type: ShopType): number {
    const g = this.game;
    let n = 0;
    for (const q of g.district.premises) {
      if (q.id === p.id) continue;
      let w: number;
      if (q.competitor) { if (q.competitor !== type) continue; w = this.weight(q.id); }
      else if (g.shopAt(q.id)?.type === type) w = 1;
      else continue;
      const d = dist(p, q);
      if (d < 300) n += Math.exp(-d / 90) * w;
    }
    return Math.round(n * 100) / 100;
  }

  /** Part de clients perdue par un commerce du joueur à cause des promotions rivales voisines (0..RIVALS.promoMax). */
  promoLoss(s: Shop): number {
    let loss = 0;
    const p = this.game.premise(s.premiseId);
    if (!p) return 0;
    for (const rs of this.shops) {
      if (rs.promo <= 0 || rs.type !== s.type) continue;
      const q = this.game.premise(rs.premiseId);
      if (!q) continue;
      const d = dist(p, q);
      if (d < RIVALS.promoRadius) loss += RIVALS.promoMax * Math.exp(-d / 120);
    }
    return Math.min(RIVALS.promoMax, loss);
  }
  /** Facteur de clientèle (× ≤ 1) dû aux promotions rivales. */
  promoFactor(s: Shop): number { return 1 - this.promoLoss(s); }

  /**
   * Clients qu'un commerce rival prend chaque jour à un commerce du joueur du même type : sa part de la pression
   * concurrentielle (sa seule présence) et sa promotion en cours. `share` : part des clients perdus (0..1) ;
   * `customers` : clients par jour, rapportés aux clients venus ce jour-là (`day`, par défaut la veille ; 0 sans bilan).
   */
  impact(s: Shop, rs: RivalShop, day?: DayStats): { share: number; customers: number } {
    const g = this.game, p = g.premise(s.premiseId), q = g.premise(rs.premiseId);
    if (!p || !q || rs.type !== s.type) return { share: 0, customers: 0 };
    const d = dist(p, q);
    // Même formule que la concurrence (attractiveness) : 1 / (1 + 0,6 × pression), avec ou sans ce rival.
    const w = d < 300 ? Math.exp(-d / 90) * this.weight(rs.premiseId) : 0;
    const presence = (0.6 * w) / (1 + 0.6 * this.pressure(p, s.type));
    const promo = rs.promo > 0 && d < RIVALS.promoRadius ? Math.min(RIVALS.promoMax, RIVALS.promoMax * Math.exp(-d / 120)) : 0;
    const share = Math.min(0.95, 1 - (1 - presence) * (1 - promo));
    const y = day ?? s.history.at(-1);
    const came = y ? y.customers + y.lostStock + y.lostCapacity + y.lostStaff : 0;
    return { share, customers: Math.round((came * share) / (1 - share)) };
  }

  /* ------------------------------ Estimation d'un commerce rival ------------------------------ */

  estimate(rs: RivalShop): { customers: number; revenue: number; profit: number } {
    const t = SHOP_TYPE_BY_ID.get(rs.type)!, p = this.game.premise(rs.premiseId);
    if (!p) return { customers: 0, revenue: 0, profit: 0 };
    let hours = 0;
    for (let h = t.open; h < t.close; h++) hours += t.hourly[h] ?? 0;
    const eff = rs.price * (rs.promo > 0 ? 1 - RIVALS.promoDiscount : 1);
    const priceAttr = clamp(Math.exp(-2.2 * (eff - 1)), 0.05, 1.8);
    const customers = (p.footfall * t.capture * hours * RIVALS.attract * (0.5 + rs.reputation) * priceAttr) / (1 + 0.6 * this.pressure(p, rs.type));
    let avgP = 0, avgC = 0;
    for (const pr of productsOf(rs.type)) { avgP += pr.share * pr.basePrice; avgC += pr.share * pr.cost; }
    const revenue = customers * t.basket * avgP * eff;
    const cogs = customers * t.basket * avgC;
    const staff = RIVALS.staffWage * (t.close - t.open) * (1 + customers / 350);
    const profit = revenue - cogs - staff - p.rent / 30 - (rs.promo > 0 ? RIVALS.promoCost : 0);
    return { customers: Math.round(customers), revenue: Math.round(revenue), profit: Math.round(profit) };
  }

  /** Chiffre d'affaires moyen par jour (estimation du jour si pas encore d'historique). */
  avgRevenue(rs: RivalShop): number { return rs.revenue.length ? Math.round(avg(rs.revenue)) : this.estimate(rs).revenue; }
  avgProfit(rs: RivalShop): number { return rs.profit.length ? Math.round(avg(rs.profit)) : this.estimate(rs).profit; }

  /* ------------------------------ Nuit : résultats et décisions ------------------------------ */

  /** Appelée à minuit, après la clôture des commerces du joueur. */
  night(): void {
    const g = this.game, day = g.day;
    const rng = new Rng(((g.seed ^ 0x2c1b3c6d) + day * 0x9e3779b1) >>> 0);
    for (const rs of this.shops) {
      const e = this.estimate(rs);
      rs.customers = e.customers;
      rs.revenue.push(e.revenue); if (rs.revenue.length > 7) rs.revenue.shift();
      rs.profit.push(e.profit); if (rs.profit.length > 7) rs.profit.shift();
      rs.loss = e.profit < 0 ? rs.loss + 1 : 0;
      if (rs.promo > 0) rs.promo--;
      const co = this.co(rs.co);
      if (co) co.cash = Math.round(co.cash + e.profit);
    }
    for (const co of this.active) co.cash = Math.round(co.cash - RIVALS.overhead - RIVALS.overheadPerShop * this.shopsOf(co.id).length);
    if (day < RIVALS.startDay) return;
    // Premier coup marquant (scénarisé) : il remplace l'ouverture ordinaire de la nuit.
    let opened = this.firstStrike(day, new Rng(((g.seed ^ 0x3c6ef372) + day * 0x85ebca6b) >>> 0));
    for (const co of this.active) {
      const mine = this.shopsOf(co.id);
      // Réputation et prix : la réputation tend vers celle de l'enseigne (un peu plus haut avec des prix bas) ;
      // un commerce en perte baisse ses prix, un commerce rentable et apprécié les remonte.
      const adjust = rng.next() < 0.3;
      for (const rs of mine) {
        const target = clamp(co.reputation + 0.3 * (1 - rs.price), 0.1, 0.95);
        rs.reputation = r2(rs.reputation + (target - rs.reputation) * 0.05);
        if (!adjust) continue;
        const p7 = rs.profit.reduce((a, b) => a + b, 0), before = rs.price;
        if (p7 < 0) rs.price = r2(Math.max(RIVALS.priceMin, rs.price - 0.03));
        else if (p7 > 7 * 300 && rs.reputation > 0.5) rs.price = r2(Math.min(RIVALS.priceMax, rs.price + 0.02));
        if (before > 0.95 && rs.price <= 0.95) {
          const near = this.nearPlayer(rs);
          if (near) g.notify('info', `${rs.name} baisse ses prix (${Math.round((1 - rs.price) * 100)} % sous le prix habituel), à ${Math.round(near.d)} m de votre ${near.s.name}.`);
        }
      }
      // Commerces en perte depuis trop longtemps : fermeture.
      for (const rs of mine) if (rs.loss >= RIVALS.closeAfterLoss) this.close(rs, `${rs.name} (${co.name}) ferme ses portes après des semaines de pertes`);
      // Faillite.
      if (co.cash < RIVALS.bankruptCash) {
        const left = this.shopsOf(co.id);
        for (const rs of left) this.close(rs, null);
        co.gone = true; co.endDay = day;
        g.notify('ok', `Faillite : ${co.name} disparaît${left.length ? ` et ferme ${left.length} commerce${left.length > 1 ? 's' : ''}` : ''}. Les locaux sont à louer.`);
        continue;
      }
      // Promotion sur un de ses types.
      const live = this.shopsOf(co.id);
      if (day >= RIVALS.promoStartDay && live.length && !live.some((s) => s.promo > 0) && co.cash > 3000 && rng.next() < RIVALS.promoChance) {
        const type = rng.pick(live).type, days = rng.int(RIVALS.promoDays[0], RIVALS.promoDays[1]);
        for (const rs of live) if (rs.type === type) rs.promo = days;
        const hit = g.shops.filter((s) => s.type === type && this.promoLoss(s) > 0.005);
        const off = Math.round(RIVALS.promoDiscount * 100);
        if (hit.length) for (const s of hit) g.notify('warn', `Promotion chez ${co.brand} (${typeLower(type)}, −${off} % pendant ${days} jours) : ${s.name} peut perdre jusqu’à ${Math.round(this.promoLoss(s) * 100)} % de ses clients.`);
        else if (g.shops.some((s) => s.type === type)) g.notify('info', `${co.name} lance une promotion sur ses commerces (${typeLower(type)}, −${off} % pendant ${days} jours).`);
      }
      // Ouverture d'un commerce (une au plus par nuit dans le quartier).
      if (!opened && co.cash >= RIVALS.openCost && live.length < RIVALS.maxShops && rng.next() < RIVALS.openChance) {
        if (this.open(co, rng)) opened = true;
      }
    }
    this.host.bump();
  }

  /** Jour (indice, 0 = premier jour) du premier coup marquant : tiré de la graine dans RIVALS.strikeDays (jours 11 à 13). */
  get strikeDay(): number {
    const [a, b] = RIVALS.strikeDays;
    return a + new Rng((this.game.seed ^ 0x1b873593) >>> 0).int(0, b - a);
  }

  /**
   * Premier coup marquant, une seule fois : dès le jour du coup, quand le joueur a un commerce ouvert depuis au moins
   * RIVALS.strikeMinAge jours, l'enseigne la plus riche qui tient ce type ouvre un commerce du même type à environ
   * RIVALS.strikeDist m de son commerce le plus rentable (local libre ; sinon elle reprend un indépendant voisin), avec
   * une offre d'ouverture (promotion de RIVALS.strikePromo jours). Alerte chiffrée ; impact suivi par le récapitulatif.
   */
  private firstStrike(day: number, rng: Rng): boolean {
    if (this.strike !== undefined || day < this.strikeDay) return false;
    // Aucun commerce prêt à temps (ou ancienne sauvegarde déjà plus loin) : le coup n'a pas lieu.
    if (day > RIVALS.strikeLastDay) { this.strike = null; return false; }
    const g = this.game;
    // Le plus rentable : résultat moyen des trois derniers jours (marge − salaires − loyer).
    const ranked = g.shops.filter((s) => s.history.length >= RIVALS.strikeMinAge && s.history.some((d) => d.customers > 0))
      .map((s) => ({ s, v: avg(s.history.slice(-3).map((d) => d.revenue - d.costOfSales - d.wages - d.rent)) }))
      .sort((a, b) => b.v - a.v || a.s.id - b.s.id);
    const target = ranked[0]?.s;
    if (!target) return false;
    if (!this.active.length) { this.strike = null; return false; }
    const co = [...this.active].sort((a, b) => Number(b.types.includes(target.type)) - Number(a.types.includes(target.type)) || b.cash - a.cash || a.id.localeCompare(b.id))[0]!;
    const tp = g.premise(target.premiseId)!, spot = this.strikeSpot(tp, rng);
    if (!spot) { this.strike = null; return false; }
    const name = `${typeName(target.type)} ${co.brand}`;
    let rs = spot.takeover;
    if (rs) Object.assign(rs, { co: co.id, type: target.type, name, reputation: co.reputation, price: 1, opened: day, loss: 0, revenue: [], profit: [] });
    else { rs = { premiseId: spot.premise.id, co: co.id, type: target.type, name, reputation: co.reputation, price: 1, promo: 0, opened: day, loss: 0, customers: 0, revenue: [], profit: [] }; this.shops.push(rs); }
    rs.promo = RIVALS.strikePromo;
    rs.target = target.id;
    if (!co.types.includes(target.type)) co.types.push(target.type);
    // Ses investisseurs suivent : l'enseigne paie l'ouverture sans tomber sous RIVALS.strikeCashFloor.
    co.cash = Math.max(RIVALS.strikeCashFloor, co.cash - RIVALS.openCost);
    this.apply();
    rs.customers = this.estimate(rs).customers;
    this.strike = { day, premiseId: rs.premiseId, shopId: target.id, co: co.id };
    const d = Math.round(dist(spot.premise, tp)), im = this.impact(target, rs);
    const loss = im.customers >= 1 ? `environ ${im.customers} client${im.customers > 1 ? 's' : ''} de moins par jour (−${Math.round(im.share * 100)} %)` : `environ ${Math.round(im.share * 100)} % de clients en moins`;
    g.notify('warn', `Coup dur : ${co.name} ${spot.takeover ? 'reprend le commerce voisin et ouvre' : 'ouvre'} ${rs.name} à ${d} m de ${target.name}, votre commerce le plus rentable, avec −${Math.round(RIVALS.promoDiscount * 100)} % pendant ${RIVALS.strikePromo} jours. Attendez-vous à ${loss}. Ripostez : prix, stock, propreté, publicité… ou rachetez-le (téléphone › Concurrence).`);
    return true;
  }

  /**
   * Local du premier coup : un local libre à moins de RIVALS.nearRadius m du commerce visé, le plus proche de
   * RIVALS.strikeDist m (petit écart tiré au sort), en laissant assez de locaux libres au joueur ; sinon un commerce
   * indépendant voisin (repris par l'enseigne) ; sinon null.
   */
  private strikeSpot(tp: Premise, rng: Rng): { premise: Premise; takeover: RivalShop | null } | null {
    const g = this.game, here = g.player.place;
    const pick = <T>(list: { item: T; d: number }[]): T | null => {
      const scored = list.map((x) => ({ item: x.item, score: Math.abs(x.d - RIVALS.strikeDist) + rng.next() * 25 }));
      return scored.sort((a, b) => a.score - b.score)[0]?.item ?? null;
    };
    const free = g.district.premises.filter((p) => g.isFree(p) && !(here.kind === 'local' && here.premiseId === p.id));
    if (free.length > RIVALS.minFreeLeft + 1) {
      const p = pick(free.map((item) => ({ item, d: dist(item, tp) })).filter((x) => x.d > 0 && x.d < RIVALS.nearRadius));
      if (p) return { premise: p, takeover: null };
    }
    const ind = pick(this.shops.filter((rs) => !rs.co).map((item) => ({ item, d: dist(g.premise(item.premiseId) ?? tp, tp) })).filter((x) => x.d > 0 && x.d < RIVALS.nearRadius));
    const p = ind ? g.premise(ind.premiseId) : undefined;
    return ind && p ? { premise: p, takeover: ind } : null;
  }

  /** Commerce du joueur du même type le plus proche (dans RIVALS.nearRadius), ou null. */
  private nearPlayer(rs: RivalShop): { s: Shop; d: number } | null {
    const g = this.game, p = g.premise(rs.premiseId);
    if (!p) return null;
    let best: { s: Shop; d: number } | null = null;
    for (const s of g.shops) {
      if (s.type !== rs.type) continue;
      const q = g.premise(s.premiseId);
      if (!q) continue;
      const d = dist(p, q);
      if (d < RIVALS.nearRadius && (!best || d < best.d)) best = { s, d };
    }
    return best;
  }

  private open(co: RivalCo, rng: Rng): boolean {
    const g = this.game, here = g.player.place;
    const free = g.district.premises.filter((p) => g.isFree(p) && !(here.kind === 'local' && here.premiseId === p.id));
    if (free.length <= RIVALS.minFreeLeft) return false;
    const type = rng.pick(co.types);
    let best: Premise | null = null, bestScore = -Infinity;
    for (const p of free) {
      const score = (p.footfall / (1 + 0.6 * this.pressure(p, type))) * (0.8 + 0.4 * rng.next());
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best) return false;
    const rs: RivalShop = { premiseId: best.id, co: co.id, type, name: `${typeName(type)} ${co.brand}`, reputation: co.reputation, price: 1, promo: 0, opened: g.day, loss: 0, customers: 0, revenue: [], profit: [] };
    this.shops.push(rs);
    co.cash -= RIVALS.openCost;
    this.apply();
    const e = this.estimate(rs);
    rs.customers = e.customers;
    const near = this.nearPlayer(rs);
    if (near) g.notify('warn', `${rs.name} (${co.name}) ouvre à ${Math.round(near.d)} m de votre ${near.s.name} : attendez-vous à moins de clients. Soignez prix, stock et décoration.`);
    else g.notify('info', `Nouvelle ouverture : ${rs.name} (${co.name}) dans un local de ${best.area} m².`);
    return true;
  }

  /** Ferme un commerce rival : le local redevient libre. */
  private close(rs: RivalShop, why: string | null): void {
    this.shops = this.shops.filter((x) => x !== rs);
    this.apply();
    const p = this.game.premise(rs.premiseId);
    if (why) this.game.notify('info', `${why} : le local${p ? ` de ${p.area} m²` : ''} est à louer.`);
  }

  /* ------------------------------ Lecture pour l'interface ------------------------------ */

  /** Parts de marché par type (clients par jour : joueur hier, rivaux estimés), types présents seulement. */
  marketShare(): MarketRow[] {
    const g = this.game, rows: MarketRow[] = [];
    for (const t of SHOP_TYPES) {
      const mine = g.shops.filter((s) => s.type === t.id).reduce((a, s) => a + (s.history.at(-1)?.customers ?? 0), 0);
      const parts: MarketRow['parts'] = [];
      for (const co of this.active) {
        const c = this.shopsOf(co.id).filter((s) => s.type === t.id).reduce((a, s) => a + (s.customers || this.estimate(s).customers), 0);
        if (c > 0) parts.push({ label: co.brand, color: co.color, customers: c });
      }
      const ind = this.shops.filter((s) => !s.co && s.type === t.id).reduce((a, s) => a + (s.customers || this.estimate(s).customers), 0);
      if (ind > 0) parts.push({ label: 'Indépendants', color: '#7d6a8c', customers: ind });
      const total = mine + parts.reduce((a, p) => a + p.customers, 0);
      if (total > 0 || g.shops.some((s) => s.type === t.id)) rows.push({ type: t.id, total, mine, parts });
    }
    return rows;
  }

  /** Commerces rivaux du même type près des commerces du joueur (les plus proches d'abord). */
  threats(): Threat[] {
    const g = this.game, out: Threat[] = [];
    for (const s of g.shops) {
      const p = g.premise(s.premiseId);
      if (!p) continue;
      for (const rs of this.shops) {
        if (rs.type !== s.type) continue;
        const q = g.premise(rs.premiseId);
        if (!q) continue;
        const d = dist(p, q);
        if (d < RIVALS.nearRadius) out.push({ shop: s, rival: rs, dist: Math.round(d) });
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /* ------------------------------ Rachat ------------------------------ */

  /**
   * Prix de rachat d'un commerce rival : chiffre d'affaires × réputation, plus le mobilier (plancher RIVALS.buyMin),
   * majoré de RIVALS.buySurcharge par commerce déjà racheté ; dépôt du bail en plus.
   */
  quote(premiseId: number): RivalQuote | null {
    const rs = this.byPremise.get(premiseId), p = this.game.premise(premiseId);
    if (!rs || !p) return null;
    const revenue = this.avgRevenue(rs);
    const furniture = RIVAL_LAYOUTS[rs.type].reduce((a, f) => a + (FURNITURE_BY_ID.get(f)?.price ?? 0), 0);
    const base = Math.max(RIVALS.buyMin, revenue * RIVALS.buyRevenueDays * (0.5 + rs.reputation) + furniture * 0.5);
    const price = Math.round((base * this.buyFactor()) / 100) * 100;
    const deposit = p.rent * ECONOMY.depositMonths;
    const customers = rs.customers || this.estimate(rs).customers;
    return { price, deposit, total: price + deposit, revenue, customers, reputation: rs.reputation, furniture, staff: customers > 250 ? 2 : 1 };
  }

  /** Rachète un commerce rival : il devient un commerce du joueur, meublé et approvisionné ; employés repris en option. */
  buy(premiseId: number, withStaff: boolean, price?: number): Result<Shop> {
    const g = this.game, rs = this.byPremise.get(premiseId), q = this.quote(premiseId), p = g.premise(premiseId);
    if (!rs || !q || !p) return { ok: false, message: 'Ce commerce n’est pas à vendre.' };
    const cost = price ?? q.price;
    if (g.cash < cost + q.deposit) return { ok: false, message: `Trésorerie insuffisante : ${Math.round(cost + q.deposit).toLocaleString('fr-CH')} CHF à payer (rachat et dépôt du bail).` };
    p.competitor = null; p.competitorName = null;
    const r = g.rent(premiseId, rs.type, rs.name);
    if (!r.ok) { this.apply(); return r; }
    if (g.notices.at(-1)?.text.startsWith('Local loué')) g.notices.pop();
    this.shops = this.shops.filter((x) => x !== rs);
    this.apply();
    const s = r.data;
    s.acquired = true;
    g.cash -= cost;
    s.today.equipment += cost; g.today.equipment += cost;
    s.reputation = r2(clamp(rs.reputation, 0.22, 0.9));
    // Mobilier : posé à la première place qui garde tout accessible (le reste attend dans la réserve).
    for (const f of RIVAL_LAYOUTS[rs.type]) {
      const def = FURNITURE_BY_ID.get(f);
      if (!def) continue;
      s.storage[f] = (s.storage[f] ?? 0) + 1;
      let done = false;
      for (let z = 0; z < p.gridD && !done; z += 2) for (let x = 0; x < p.gridW && !done; x++) {
        if (canPlace(s.items, p.gridW, p.gridD, def, x, z, 0)) continue;
        const pl = g.place(s.id, f, x, z, 0);
        if (pl.ok && layoutStats(s.items, p.gridW, p.gridD).blocked.length === 0) done = true; else if (pl.ok) g.pickUp(s.id, pl.data.uid);
      }
    }
    for (const pr of productsOf(rs.type)) s.products[pr.id]!.stock = Math.floor(g.storageFor(s, pr) * RIVALS.buyStock);
    const staff: Employee[] = [];
    if (withStaff) {
      const rng = new Rng(((g.seed ^ 0x165667b1) + premiseId * 0x27d4eb2f + g.day) >>> 0);
      for (let k = 0; k < q.staff; k++) {
        const skill = r2(0.6 + rng.next() * 0.25), wage = g.marketWage(skill);
        const e: Employee = { id: this.host.newId(), name: randomName(rng), skill, wage, shopId: s.id, hiredDay: g.day, look: rng.int(0, 999), mood: 0.75, unhappy: 0, role: 'caisse', shift: 'journee', wantShift: 'journee', minWage: wage };
        g.employees.push(e); staff.push(e);
      }
    }
    s.capacity = g.capacityNow(s);
    g.notify('ok', `Rachat conclu : ${s.name} est à vous (${Math.round(cost).toLocaleString('fr-CH')} CHF). Meubles posés, rayons remplis à ${Math.round(RIVALS.buyStock * 100)} %${staff.length ? `, ${staff.map((e) => e.name).join(' et ')} reste${staff.length > 1 ? 'nt' : ''} en caisse` : ' ; embauchez quelqu’un pour tenir la caisse'}.`);
    // Une entreprise sans commerce disparaît.
    const co = this.co(rs.co);
    if (co && !co.gone && !this.shopsOf(co.id).length) { co.gone = true; co.bought = true; co.endDay = g.day; }
    this.buys++;
    this.host.bump();
    return { ok: true, data: s };
  }

  /** Prix de rachat d'une entreprise entière (tous ses commerces, avec remise) et dépôts des baux. */
  companyQuote(coId: string): { price: number; deposit: number; total: number; shops: number } | null {
    const co = this.co(coId);
    if (!co || co.gone) return null;
    let price = 0, deposit = 0, n = 0;
    for (const rs of this.shopsOf(co.id)) { const q = this.quote(rs.premiseId); if (!q) continue; price += q.price; deposit += q.deposit; n++; }
    if (!n) return null;
    price = Math.round((price * RIVALS.buyCompanyDiscount) / 100) * 100;
    return { price, deposit, total: price + deposit, shops: n };
  }

  /** Rachète une entreprise entière : tous ses commerces passent au joueur. */
  buyCompany(coId: string, withStaff: boolean): Result<number> {
    const g = this.game, co = this.co(coId), q = this.companyQuote(coId);
    if (!co || !q) return { ok: false, message: 'Cette entreprise n’est pas à vendre.' };
    if (g.cash < q.total) return { ok: false, message: `Trésorerie insuffisante : ${Math.round(q.total).toLocaleString('fr-CH')} CHF à payer.` };
    const list = this.shopsOf(co.id);
    // Parts du prix fixées avant le premier rachat (chaque rachat renchérit les devis suivants).
    const prices = list.map((rs) => this.quote(rs.premiseId)?.price ?? 0);
    const sum = prices.reduce((a, b) => a + b, 0) || 1;
    let n = 0;
    list.forEach((rs, k) => {
      const part = Math.round(q.price * (prices[k]! / sum));
      if (this.buy(rs.premiseId, withStaff, part).ok) n++;
    });
    co.gone = true; co.bought = true; co.endDay = g.day;
    g.notify('ok', `${co.name} vous appartient : ${n} commerce${n > 1 ? 's' : ''} repris.`);
    this.host.bump();
    return { ok: true, data: n };
  }
}
