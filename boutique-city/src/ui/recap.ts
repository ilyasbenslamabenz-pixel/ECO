/**
 * Récapitulatif de fin de journée (à minuit de jeu) : par commerce, clients, ventes, marge, salaires, loyer et
 * solde ; pour l'entreprise, toutes les dépenses, la trésorerie et les clients perdus avec leur cause. Le jeu est
 * en pause tant qu'il est ouvert. Lit uniquement les bilans enregistrés par la simulation.
 */
import { WEEKDAYS_FR } from '../sim/clock';
import { dayProfit, type DayStats, type Game } from '../sim/game';
import { button, chf, el, num, signed } from './dom';

export function showRecap(g: Game, onClose: () => void): HTMLElement | null {
  const y = g.ledger.at(-1);
  if (!y) return null;
  const prev = g.ledger.at(-2);
  const rows = g.shops.map((s) => ({ name: s.name, d: s.history.find((h) => h.day === y.day) })).filter((r): r is { name: string; d: DayStats } => !!r.d);
  const shopLine = (name: string, d: DayStats): HTMLElement => {
    const margin = d.revenue - d.costOfSales;
    const solde = d.revenue - d.purchases - d.wages - d.rent - d.equipment - d.marketing;
    return el('tr', {}, el('td', { text: name }), el('td', { text: num(d.customers) }), el('td', { text: chf(d.revenue) }), el('td', { text: chf(margin) }),
      el('td', { text: chf(d.wages) }), el('td', { text: chf(d.rent) }), el('td', { text: signed(solde), cls: solde >= 0 ? 'ok' : 'bad' }));
  };
  const profit = dayProfit(y);
  const lost = y.lostStaff + y.lostStock + y.lostCapacity;
  const tips: string[] = [];
  if (y.lostStaff > 0) tips.push(`${y.lostStaff} clients repartis faute de caissier : embauchez ou tenez la caisse.`);
  if (y.lostStock > 0) tips.push(`${y.lostStock} clients sans les produits voulus : réassortez (réassort automatique conseillé).`);
  if (y.refusedPrice > 0) tips.push(`${y.refusedPrice} articles reposés car trop chers : rapprochez vos prix de ceux du quartier.`);
  if (y.lostCapacity > 0) tips.push(`${y.lostCapacity} clients lassés d’attendre : une caisse et un caissier de plus aux heures d’affluence.`);
  const trend = prev ? y.revenue - prev.revenue : null;
  const wrap = el('div', { cls: 'confirm recap', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Récapitulatif de la journée' } },
    el('div', { cls: 'confirm-card recap-card' },
      el('div', { cls: 'kicker', text: `Fin de journée · ${WEEKDAYS_FR[y.day % 7]}` }),
      el('h2', { text: `Récapitulatif du jour ${y.day + 1}` }),
      el('div', { cls: 'kpis' },
        el('div', { cls: 'kpi' }, el('span', { text: 'Clients servis' }), el('b', { text: num(y.customers) })),
        el('div', { cls: 'kpi' }, el('span', { text: 'Ventes' }), el('b', { text: chf(y.revenue) }), trend !== null ? el('span', { cls: trend >= 0 ? 'ok' : 'bad', text: `${trend >= 0 ? '▲' : '▼'} ${signed(trend)} vs veille` }) : null),
        el('div', { cls: 'kpi' }, el('span', { text: 'Résultat du jour' }), el('b', { text: signed(profit), cls: profit >= 0 ? 'ok' : 'bad' }))),
      rows.length ? el('table', { cls: 'tbl' },
        el('tr', {}, ...['Commerce', 'Clients', 'Ventes', 'Marge', 'Salaires', 'Loyer (prov.)', 'Solde'].map((t) => el('th', { text: t }))),
        ...rows.map((r) => shopLine(r.name, r.d))) : null,
      el('div', { cls: 'sec', text: 'Compte de résultat du jour' }),
      el('table', { cls: 'tbl pnl' }, ...([
        ['Ventes', y.revenue, 1], ['Loyers encaissés (sous-locations)', y.rentalIncome ?? 0, 1],
        ['Achats de marchandise', y.purchases, -1], ['Salaires', y.wages, -1], ['Loyer (provision du jour)', y.rent, -1],
        ['Équipement et mobilier', y.equipment, -1], ['Publicité', y.marketing, -1], ['Remboursements de prêts', y.finance, -1],
        ['Vie courante (logement, repas, assurances)', y.living, -1],
      ] as [string, number, number][]).filter(([, v, k]) => v > 0 || k > 0).map(([label, v, k]) => el('tr', {}, el('td', { text: label }), el('td', { cls: k > 0 ? 'num ok' : 'num bad', text: `${k > 0 ? '+' : '−'} ${chf(v)}` }))),
        el('tr', { cls: 'total' }, el('td', { text: 'Résultat' }), el('td', { cls: profit >= 0 ? 'num ok' : 'num bad', text: signed(profit) }))),
      el('p', { cls: 'muted small', text: 'Le loyer des locaux est provisionné chaque jour et prélevé une fois par mois (30 jours après la signature).' }),
      el('p', { cls: 'small', text: `Trésorerie : ${chf(g.cash)}${g.debt > 0 ? ` · dette ${chf(g.debt)}` : ''} · ${lost} client(s) perdu(s)` }),
      tips.length ? el('ul', { cls: 'checks' }, ...tips.map((t) => el('li', { cls: 'todo', text: `• ${t}` }))) : null,
      el('p', { cls: 'muted small', text: 'Partie sauvegardée automatiquement.' }),
      el('div', { cls: 'row end' }, button('Journée suivante', () => { wrap.remove(); onClose(); }, 'primary'))));
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { wrap.remove(); onClose(); } });
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('button.primary')?.focus();
  return wrap;
}
