/**
 * Objectifs de l'entrepreneur, dans l'ordre d'une partie : ils guident les premiers pas puis fixent des paliers
 * (ventes du jour, nombre de commerces, valeur nette). Chaque objectif lit uniquement l'état de la partie.
 * TypeScript pur.
 */
import { FURNITURE_BY_ID, VEHICLE_BY_ID, ECONOMY } from './catalog';
import type { Game } from './game';

export interface Objective {
  id: string;
  title: string;
  hint: string;
  /** Avancement 0..1 et texte court (« 4 / 10 clients »). */
  progress: (g: Game) => { p: number; text: string };
}

const totalCustomers = (g: Game): number => g.ledger.reduce((a, d) => a + d.customers, 0) + g.today.customers;
const bestDay = (g: Game): number => Math.max(g.today.revenue, ...g.ledger.map((d) => d.revenue), 0);
const step = (v: number, goal: number, unit: string): { p: number; text: string } => ({ p: Math.min(1, v / goal), text: `${Math.floor(Math.min(v, goal)).toLocaleString('fr-CH')} / ${goal.toLocaleString('fr-CH')} ${unit}` });
const flag = (ok: boolean): { p: number; text: string } => ({ p: ok ? 1 : 0, text: ok ? 'fait' : 'à faire' });

/** Valeur nette : trésorerie + mobilier (revente) + véhicules (revente) + dépôts − dettes − loyers provisionnés non encore prélevés. */
export function netWorth(g: Game): number {
  let v = g.cash - g.debt;
  for (const s of g.shops) {
    v += s.deposit - (s.rentDue ?? 0);
    for (const it of s.items) v += (FURNITURE_BY_ID.get(it.def)?.price ?? 0) * ECONOMY.resale;
    for (const [id, n] of Object.entries(s.storage)) v += (FURNITURE_BY_ID.get(id)?.price ?? 0) * ECONOMY.resale * n;
  }
  for (const veh of g.vehicles) v += VEHICLE_BY_ID.get(veh.type)!.price * ECONOMY.vehicleResale;
  for (const sl of g.sublets) v += sl.deposit;
  return v;
}

export const OBJECTIVES: readonly Objective[] = [
  { id: 'sortir', title: 'Sortir de chez soi', hint: 'Marchez jusqu’à la porte de l’appartement (E).', progress: (g) => flag(g.player.place.kind !== 'logement' || g.shops.length > 0) },
  { id: 'louer', title: 'Louer un premier local', hint: 'Téléphone (T) › Immobilier : comparez les locaux, « Voir sur la carte », puis signez le bail devant l’anneau jaune.', progress: (g) => flag(g.shops.length > 0) },
  { id: 'meubler', title: 'Poser une caisse et un présentoir', hint: 'Achetez une caisse et un présentoir au magasin de meubles, puis dans votre local : « Aménager » (B).', progress: (g) => flag(g.shops.some((s) => { const st = g.stats(s); return st.registers > 0 && Object.values(st.capacity).some((c) => c > 0); })) },
  { id: 'stock', title: 'Mettre de la marchandise en rayon', hint: 'Grossiste : faites-la livrer (7 h ou 14 h) ou emportez-la puis « Décharger » dans le commerce.', progress: (g) => flag(g.shops.some((s) => Object.values(s.products).some((p) => p.stock > 0))) },
  { id: 'servir10', title: 'Servir 10 clients', hint: 'Tenez la caisse vous-même (E derrière la caisse) pendant les heures d’ouverture.', progress: (g) => step(totalCustomers(g), 10, 'clients') },
  { id: 'embaucher', title: 'Embaucher un employé', hint: 'Agence pour l’emploi : un caissier tient la caisse à votre place.', progress: (g) => flag(g.employees.length > 0) },
  { id: 'jour500', title: 'Vendre pour 500 CHF en une journée', hint: 'Réassort automatique, prix proches du quartier, horaires sur les heures d’affluence.', progress: (g) => step(bestDay(g), 500, 'CHF') },
  { id: 'vehicule', title: 'Acheter un véhicule', hint: 'Garage : une camionnette transporte 600 unités, bien moins cher que la livraison.', progress: (g) => flag(g.vehicles.length > 0) },
  { id: 'pub', title: 'Lancer une campagne de publicité', hint: 'Agence de publicité : plus de clients pendant la campagne.', progress: (g) => flag(g.campaigns.length > 0 || g.ledger.some((d) => d.marketing > 0) || g.today.marketing > 0) },
  { id: 'deux', title: 'Ouvrir un deuxième commerce', hint: 'Téléphone › Immobilier : un autre type dans une autre rue évite de vous concurrencer vous-même.', progress: (g) => step(g.shops.length, 2, 'commerces') },
  { id: 'trois', title: 'Bâtir un réseau de trois commerces', hint: 'Prêts bancaires pour financer, employés pour tenir les caisses.', progress: (g) => step(g.shops.length, 3, 'commerces') },
  { id: 'gamme', title: 'Monter en gamme : un commerce premium', hint: 'Formez un employé (Gestion › Employés › Former), puis Gestion › Prix et stock › Gamme premium. Mieux vaut une bonne réputation : la clientèle premium la suit.', progress: (g) => {
    const best = Math.max(0, ...g.shops.map((s) => (s.premium ? 2 : 0) + Math.min(1, g.bestTraining(s.id))));
    return { p: best >= 2 ? 1 : best / 2, text: best >= 2 ? 'fait' : best >= 1 ? 'employé formé, gamme à activer' : 'former un employé' };
  } },
  { id: 'valeur100k', title: 'Atteindre 60 000 CHF de valeur nette', hint: 'Trésorerie, mobilier, véhicules et dépôts, moins les dettes. Leviers : gamme premium, formation, une caisse de plus là où des clients attendent, contrat fournisseur quand vous achetez beaucoup.', progress: (g) => step(Math.max(0, netWorth(g)), 60_000, 'CHF') },
];

/** Titre de l'entrepreneur selon le nombre d'objectifs atteints. */
export function rankOf(done: number): string {
  return ['Débutant', 'Débutant', 'Apprenti commerçant', 'Apprenti commerçant', 'Commerçant', 'Commerçant', 'Gérant', 'Gérant confirmé', 'Entrepreneur', 'Entrepreneur', 'Chef d’entreprise', 'Chef d’entreprise', 'Magnat du quartier', 'Légende de Boutique City'][Math.min(13, done)]!;
}
