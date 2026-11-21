/**
 * Récapitulatif de fin de journée (à minuit de jeu) : chiffres clés, tableau par commerce, compte de résultat de
 * l'entreprise, clients perdus avec leur cause et conseils. Le jeu est en pause tant qu'il est ouvert. Lit
 * uniquement les bilans enregistrés par la simulation.
 */
import { WEEKDAYS_FR } from '../sim/clock';
import { dayProfit, type DayStats, type Game } from '../sim/game';
import { button, chf, el, num, signed } from './dom';

type Tone = 'ok' | 'bad' | 'warn' | '';

function kpi(label: string, value: string, tone: Tone = '', sub: HTMLElement | string | null = null): HTMLElement {
  return el('div', { cls: 'kpi rc-kpi' }, el('span', { text: label }), el('b', { cls: tone, text: value }), typeof sub === 'string' ? el('small', { text: sub }) : sub);
}

export function showRecap(g: Game, onClose: () => void): HTMLElement | null {
  const y = g.ledger.at(-1);
  if (!y) return null;
  const prev = g.ledger.at(-2);
  const rows = g.shops.map((s) => ({ name: s.name, d: s.history.find((h) => h.day === y.day) })).filter((r): r is { name: string; d: DayStats } => !!r.d);
  const shopLine = (name: string, d: DayStats): HTMLElement => {
    const margin = d.revenue - d.costOfSales;
    const solde = d.revenue - d.purchases - d.wages - d.rent - d.equipment - d.marketing;
    const lostS = d.lostStaff + d.lostStock + d.lostCapacity;
    return el('tr', {}, el('td', {}, el('b', { text: name }), lostS ? el('div', { cls: 'sub', text: `${num(lostS)} client(s) perdu(s)` }) : null),
      el('td', { cls: 'n', text: num(d.customers) }), el('td', { cls: 'n', text: chf(d.revenue) }), el('td', { cls: 'n', text: chf(margin) }),
      el('td', { cls: 'n', text: chf(d.wages) }), el('td', { cls: 'n', text: chf(d.rent) }), el('td', { text: signed(solde), cls: `n strong ${solde >= 0 ? 'ok' : 'bad'}` }));
  };
  const profit = dayProfit(y);
  const margin = y.revenue - y.costOfSales;
  const lost = y.lostStaff + y.lostStock + y.lostCapacity;
  const tips: string[] = [];
  if (y.lostStaff > 0) tips.push(`${y.lostStaff} clients repartis faute de caissier : embauchez ou tenez la caisse.`);
  if (y.lostStock > 0) tips.push(`${y.lostStock} clients sans les produits voulus : réassortez (réassort automatique conseillé).`);
  if (y.refusedPrice > 0) tips.push(`${y.refusedPrice} articles reposés car trop chers : rapprochez vos prix de ceux du quartier.`);
  if (y.lostCapacity > 0) tips.push(`${y.lostCapacity} clients lassés d’attendre : une caisse et un caissier de plus aux heures d’affluence.`);
  if (!tips.length && y.customers > 0) tips.push('Aucun client perdu : la journée s’est bien passée. Pensez à agrandir ou à ouvrir un deuxième commerce.');
  if (!tips.length && !g.shops.length) tips.push('Pas encore de commerce : louez un local (anneau jaune devant les locaux libres, carte : touche M).');
  const trend = prev ? y.revenue - prev.revenue : null;

  // Causes de pertes : barre empilée.
  const causes: [string, number, string][] = [['Sans caissier', y.lostStaff, '#ef6b6b'], ['Rupture ou trop cher', y.lostStock, '#f0b84a'], ['Attente trop longue', y.lostCapacity, '#5fc3ff']];
  const lossBlock = lost > 0
    ? el('div', { cls: 'rc-loss' },
      el('div', { cls: 'rc-lossbar' }, ...causes.filter(([, n]) => n > 0).map(([label, n, c]) => el('i', { attrs: { style: `flex:${n};background:${c}`, title: `${label} : ${n}` } }))),
      el('div', { cls: 'rc-losslist' }, ...causes.map(([label, n, c]) => el('div', { cls: n ? '' : 'zero' }, el('i', { attrs: { style: `background:${c}` } }), el('span', { text: label }), el('b', { text: num(n) })))))
    : el('p', { cls: 'rc-none', text: 'Aucun client perdu.' });

  const pnl = ([
    ['Ventes', y.revenue, 1], ['Loyers encaissés (sous-locations)', y.rentalIncome ?? 0, 1],
    ['Achats de marchandise', y.purchases, -1], ['Salaires', y.wages, -1], ['Loyer (provision du jour)', y.rent, -1],
    ['Équipement et mobilier', y.equipment, -1], ['Publicité', y.marketing, -1], ['Remboursements de prêts', y.finance, -1],
    ['Vie courante (logement, repas, assurances)', y.living, -1],
  ] as [string, number, number][]).filter(([label, v]) => v > 0 || label === 'Ventes');

  let closed = false;
  const close = (): void => { if (closed) return; closed = true; wrap.remove(); onClose(); };
  const wrap = el('div', { cls: 'confirm recap', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Récapitulatif de la journée' } },
    el('div', { cls: 'confirm-card recap-card' },
      el('div', { cls: 'rc-head' },
        el('div', {}, el('div', { cls: 'kicker', text: `Fin de journée · ${WEEKDAYS_FR[y.day % 7]}` }), el('h2', { text: `Récapitulatif du jour ${y.day + 1}` })),
        el('div', { cls: `rc-result ${profit >= 0 ? 'ok' : 'bad'}` }, el('span', { text: 'Résultat du jour' }), el('b', { text: signed(profit) }))),
      el('div', { cls: 'kpis rc-kpis' },
        kpi('Clients servis', num(y.customers), '', lost ? `${num(lost)} perdu(s)` : 'aucun perdu'),
        kpi('Ventes', chf(y.revenue), '', trend !== null ? el('small', { cls: trend >= 0 ? 'ok' : 'bad', text: `${trend >= 0 ? '▲' : '▼'} ${signed(trend)} vs veille` }) : 'premier jour'),
        kpi('Marge brute', chf(margin), '', y.revenue > 0 ? `${Math.round((margin / y.revenue) * 100)} % des ventes` : null),
        kpi('Trésorerie', chf(g.cash), g.cash >= 0 ? '' : 'bad', g.debt > 0 ? `dette ${chf(g.debt)}` : 'sans dette')),
      rows.length ? el('div', { cls: 'sec', text: 'Par commerce' }) : null,
      rows.length ? el('table', { cls: 'tbl rc-shops' },
        el('tr', {}, ...['Commerce', 'Clients', 'Ventes', 'Marge', 'Salaires', 'Loyer (prov.)', 'Solde'].map((t, k) => el('th', { cls: k ? 'n' : '', text: t }))),
        ...rows.map((r) => shopLine(r.name, r.d))) : null,
      el('div', { cls: 'rc-cols' },
        el('div', { cls: 'rc-col' },
          el('div', { cls: 'sec', text: 'Compte de résultat du jour' }),
          el('table', { cls: 'tbl pnl' }, ...pnl.map(([label, v, k]) => el('tr', {}, el('td', { text: label }), el('td', { cls: k > 0 ? 'num ok' : 'num bad', text: `${k > 0 ? '+' : '−'} ${chf(v)}` }))),
            el('tr', { cls: 'total' }, el('td', { text: 'Résultat' }), el('td', { cls: profit >= 0 ? 'num ok' : 'num bad', text: signed(profit) }))),
          el('p', { cls: 'rc-foot', text: 'Le loyer des locaux est provisionné chaque jour et prélevé une fois par mois (30 jours après la signature).' })),
        el('div', { cls: 'rc-col' },
          el('div', { cls: 'sec', text: `Clients perdus · ${num(lost)}` }),
          lossBlock,
          el('div', { cls: 'sec', text: 'Conseils' }),
          el('ul', { cls: 'rc-tips' }, ...tips.map((t) => el('li', { text: t }))))),
      el('div', { cls: 'rc-actions' },
        el('span', { cls: 'rc-saved', text: 'Partie sauvegardée automatiquement.' }),
        el('span', { cls: 'rc-hint' }, el('kbd', { text: 'Entrée' })),
        button('Journée suivante', close, 'primary'))));
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } });
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('button.primary')?.focus();
  return wrap;
}
