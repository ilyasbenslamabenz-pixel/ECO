/**
 * Récapitulatif de fin de journée (à minuit de jeu) : chiffres clés, tableau par commerce, compte de résultat de
 * l'entreprise, clients perdus avec leur cause et conseils. Le jeu est en pause tant qu'il est ouvert. Lit
 * uniquement les bilans enregistrés par la simulation.
 * Présentation : résultat d'exploitation en grand et investissements (mobilier, revêtements, véhicules, dépôts) à
 * part, compteurs qui défilent, bandeaux de célébration (premier jour rentable, record, progression) et fanfare.
 */
import { WEEKDAYS_FR } from '../sim/clock';
import { FINANCE, RESCUE, taxBracketsText } from '../sim/catalog';
import { STOP_FR, dayProfit, operatingResult, type DayStats, type Game } from '../sim/game';
import { recapTips } from './recap-tips';
import { netWorth } from '../sim/objectives';
import { button, chf, el, icon, num, signed } from './dom';
import { sound } from './sound';

type Tone = 'ok' | 'bad' | 'warn' | '';

function kpi(label: string, value: string, tone: Tone = '', sub: HTMLElement | string | null = null): HTMLElement {
  return el('div', { cls: 'kpi rc-kpi' }, el('span', { text: label }), el('b', { cls: tone, text: value }), typeof sub === 'string' ? el('small', { text: sub }) : sub);
}

/* ------------------------------ Présentation animée du récapitulatif ------------------------------ */

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Compteur qui défile de 0 à `to` (format `fmt`) en `ms` après `delay` ms, ralentissant à la fin. La valeur finale
 * est gardée dans data-final et affichée d'emblée si les animations sont réduites.
 */
function roll(e: HTMLElement, to: number, fmt: (v: number) => string, delay = 0, ms = 950): HTMLElement {
  e.dataset['final'] = fmt(to);
  if (REDUCED || Math.abs(to) < 1) { e.textContent = fmt(to); return e; }
  e.textContent = fmt(0);
  const t0 = performance.now() + delay;
  const step = (now: number): void => {
    if (!e.isConnected && now > t0 + 50) return;
    const a = Math.min(1, Math.max(0, (now - t0) / ms));
    e.textContent = a >= 1 ? fmt(to) : fmt(to * (1 - (1 - a) ** 3));
    if (a < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return e;
}

/** Dépôts de garantie versés le jour `day` (locaux et entrepôts loués ce jour-là) : investis, rendus en fin de bail. */
function depositsOn(g: Game, day: number): number {
  const shops = g.shops.filter((s) => s.leaseDay === day).reduce((a, s) => a + (s.deposit ?? 0), 0);
  const stores = (g.logi?.warehouses ?? []).filter((w) => w.leaseDay === day).reduce((a, w) => a + (w.deposit ?? 0), 0);
  return shops + stores;
}

/** Bandeaux de célébration du soir : premier jour rentable, record de ventes, progression sur la veille. */
function cheers(g: Game, y: DayStats, prev: DayStats | undefined): { title: string; sub: string }[] {
  const out: { title: string; sub: string }[] = [];
  const before = g.ledger.slice(0, -1);
  const op = operatingResult(y);
  if (op > 0 && y.revenue > 0 && g.ledger.length < 120 && !before.some((d) => operatingResult(d) > 0)) out.push({ title: 'Premier jour rentable !', sub: `Votre activité a rapporté ${signed(op)} aujourd’hui.` });
  const best = Math.max(0, ...before.map((d) => d.revenue));
  if (y.revenue > 0 && best > 0 && y.revenue > best) out.push({ title: 'Record de ventes', sub: `${chf(y.revenue)} vendus, contre ${chf(best)} au mieux jusqu’ici.` });
  if (prev && prev.revenue > 0 && y.revenue >= prev.revenue * 1.01) out.push({ title: `+${Math.round((y.revenue / prev.revenue - 1) * 100)} % par rapport à hier`, sub: `Ventes : ${chf(y.revenue)}, hier ${chf(prev.revenue)}.` });
  return out;
}

/**
 * Alertes de redressement du soir (les plus graves d'abord) : risque de faillite, trésorerie négative, pertes
 * d'affilée, commerces à l'arrêt. Vide si tout va bien.
 */
function rescueBlock(g: Game, onRescue?: () => void): HTMLElement | null {
  const R = g.rescue, items: [string, string][] = [];
  const left = g.bankruptcyIn();
  if (left !== null) items.push(['bad', `Faillite dans ${left} jour${left > 1 ? 's' : ''} : valeur nette de ${signed(netWorth(g))} (seuil ${signed(RESCUE.bankruptWorth)}) avec une trésorerie négative.`]);
  if (R.negDays >= RESCUE.negDaysAlert) items.push(['bad', `Trésorerie négative depuis ${R.negDays} jours (${chf(g.cash)}) : découvert facturé ${(FINANCE.overdraftRate * 100).toLocaleString('fr-CH')} % par jour, commandes bloquées au-delà de ${chf(g.overdraftLimit())}.`]);
  else if (g.cash < 0) items.push(['warn', `Trésorerie négative (${chf(g.cash)}) : découvert facturé ${(FINANCE.overdraftRate * 100).toLocaleString('fr-CH')} % par jour.`]);
  if (R.lossDays >= RESCUE.lossDaysPlan) {
    const s = g.lossSummary();
    items.push(['warn', `${R.lossDays} jours de pertes d’affilée : ventes ${chf(s.revenue)} par jour, salaires ${chf(s.wages)}, loyers ${chf(s.rent)}, autres charges ${chf(s.other)} (${signed(s.result)} par jour).`]);
  }
  const stopped = g.shops.filter((s) => s.stopped);
  if (stopped.length) items.push(['warn', `À l’arrêt : ${stopped.map((s) => `${s.name} (${STOP_FR[s.stopped!]})`).join(', ')}. Employés en chômage technique jusqu’à la reprise.`]);
  if (!items.length) return null;
  return el('div', { cls: `rd-recap ${items.some(([t]) => t === 'bad') ? 'bad' : 'warn'}` },
    el('div', { cls: 'rd-recap-list' }, ...items.map(([tone, text]) => el('p', { cls: tone, text }))),
    onRescue && g.inDifficulty() && !R.bankrupt ? button('Plan de redressement', onRescue, 'small primary') : null);
}

/**
 * Récapitulatif du soir. `onRescue` ouvre le plan de redressement : bouton dans l'encadré d'alerte, et ouverture
 * automatique à la fermeture du récapitulatif quand le plan est dû (3 jours de pertes, puis chaque semaine).
 */
export function showRecap(g: Game, onClose: () => void, onRescue?: () => void): HTMLElement | null {
  const y = g.ledger.at(-1);
  if (!y) return null;
  const prev = g.ledger.at(-2);
  const rows = g.shops.map((s) => ({ name: s.name, d: s.history.find((h) => h.day === y.day), stop: s.stopped })).filter((r): r is { name: string; d: DayStats; stop: typeof r.stop } => !!r.d);
  const shopLine = (name: string, d: DayStats, stop?: keyof typeof STOP_FR): HTMLElement => {
    const margin = d.revenue - d.costOfSales;
    // Résultat d'exploitation du commerce (marge − salaires − loyer − publicité), hors investissements du jour.
    const solde = margin - d.wages - d.rent - d.marketing;
    const lostS = d.lostStaff + d.lostStock + d.lostCapacity;
    return el('tr', {}, el('td', {}, el('b', { text: name }), stop ? el('div', { cls: 'sub bad', text: `à l’arrêt : ${STOP_FR[stop]}` }) : lostS ? el('div', { cls: 'sub', text: `${num(lostS)} client(s) perdu(s)` }) : null),
      el('td', { cls: 'n', text: num(d.customers) }), el('td', { cls: 'n', text: chf(d.revenue) }), el('td', { cls: 'n', text: chf(margin) }),
      el('td', { cls: 'n', text: chf(d.wages) }), el('td', { cls: 'n', text: chf(d.rent) }), el('td', { text: signed(solde), cls: `n strong ${solde >= 0 ? 'ok' : 'bad'}` }));
  };
  const profit = dayProfit(y);
  const margin = y.revenue - y.costOfSales;
  const lost = y.lostStaff + y.lostStock + y.lostCapacity;
  const tips = recapTips(g, y);
  const trend = prev ? y.revenue - prev.revenue : null;
  // Impôt : prélevé ce soir (semaine écoulée) ou provision de la semaine en cours (barème progressif, pertes reportées).
  const taxRec = (y.tax ?? 0) > 0 ? g.taxes.at(-1) : undefined;
  const tx = g.taxEstimate();
  const taxNote = taxRec ? `Impôt de la semaine ${taxRec.week + 1} prélevé : ${chf(taxRec.amount)} sur ${chf(taxRec.base - (taxRec.carried ?? 0))} de bénéfice imposable${taxRec.carried ? ` (pertes reportées déduites : ${chf(taxRec.carried)})` : ''} ; barème : ${taxBracketsText()}.`
    : tx.exempt ? 'Impôt sur le bénéfice : première semaine exonérée.'
    : `Impôt de la semaine ${tx.week + 1} : provision ${chf(tx.due)} sur ${chf(tx.taxable)} de bénéfice imposable à ce jour${tx.carry > 0 ? ` (pertes reportées déduites : ${chf(tx.carry)})` : ''}, prélevée ${tx.daysLeft <= 0 ? 'ce soir à minuit' : `dans ${tx.daysLeft + 1} jours`} ; barème : ${taxBracketsText()}.`;

  // Causes de pertes : barre empilée.
  const causes: [string, number, string][] = [['Sans caissier', y.lostStaff, '#ef6b6b'], ['Rupture ou trop cher', y.lostStock, '#f0b84a'], ['Attente trop longue', y.lostCapacity, '#5fc3ff']];
  const lossBlock = lost > 0
    ? el('div', { cls: 'rc-loss' },
      el('div', { cls: 'rc-lossbar' }, ...causes.filter(([, n]) => n > 0).map(([label, n, c]) => el('i', { attrs: { style: `flex:${n};background:${c}`, title: `${label} : ${n}` } }))),
      el('div', { cls: 'rc-losslist' }, ...causes.map(([label, n, c]) => el('div', { cls: n ? '' : 'zero' }, el('i', { attrs: { style: `background:${c}` } }), el('span', { text: label }), el('b', { text: num(n) })))))
    : el('p', { cls: 'rc-none', text: 'Aucun client perdu.' });

  // Exploitation (ce que rapporte l'activité) séparée des investissements (mobilier, revêtements, véhicules, dépôts de
  // garantie, marchandise mise en stock) : le premier jour, tout l'équipement acheté ne passe plus pour une perte.
  const op = operatingResult(y);
  const deposits = depositsOn(g, y.day);
  const invest = y.equipment + deposits;
  const stocked = y.purchases - y.costOfSales;
  const solde = profit - deposits;
  const interest = y.finance - (y.principal ?? 0);
  const pnlOp = ([
    ['Ventes', y.revenue, 1], ['Loyers encaissés (sous-locations)', y.rentalIncome ?? 0, 1],
    ['Coût des marchandises vendues', y.costOfSales, -1], ['Salaires', y.wages, -1], ['Loyer (provision du jour)', y.rent, -1],
    ['Publicité', y.marketing, -1], ['Intérêts (prêts, découvert)', interest, -1],
    ['Vie courante (logement, repas, assurances)', y.living, -1], [`Frais de siège (au-delà de ${FINANCE.hqFreeShops} commerces)`, y.overhead ?? 0, -1],
  ] as [string, number, number][]).filter(([label, v]) => v > 0.004 || label === 'Ventes');
  const pnlInv = ([
    ['Équipement : mobilier, revêtements, véhicules', y.equipment, -1], ['Dépôts de garantie (rendus en fin de bail)', deposits, -1],
    stocked >= 0 ? ['Marchandise mise en stock (pas encore vendue)', stocked, -1] : ['Stock acheté avant et vendu ce jour', -stocked, 1],
    ['Capital des prêts remboursé', y.principal ?? 0, -1], ['Impôt sur le bénéfice (semaine)', y.tax ?? 0, -1],
  ] as [string, number, number][]).filter(([, v]) => v > 0.004);
  const line = ([label, v, k]: [string, number, number]): HTMLElement => el('tr', {}, el('td', { text: label }), el('td', { cls: k > 0 ? 'num ok' : 'num bad', text: `${k > 0 ? '+' : '−'} ${chf(v)}` }));
  const party = cheers(g, y, prev);

  let closed = false;
  // Plan de redressement dû ce soir : il s'ouvre à la fermeture du récapitulatif.
  const planDue = !!onRescue && g.planDue();
  const close = (): void => { if (closed) return; closed = true; wrap.remove(); onClose(); if (planDue) onRescue!(); };
  const wrap = el('div', { cls: 'confirm recap', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Récapitulatif de la journée' } },
    el('div', { cls: 'confirm-card recap-card' },
      el('div', { cls: 'rc-head' },
        el('div', {}, el('div', { cls: 'kicker', text: `Fin de journée · ${WEEKDAYS_FR[y.day % 7]}` }), el('h2', { text: `Récapitulatif du jour ${y.day + 1}` })),
        // Résultat d'exploitation en grand (compteur qui défile) ; investissements du jour à part, en neutre.
        el('div', { cls: `rc-result ${op >= 0 ? 'ok' : 'bad'}`, attrs: { title: 'Ventes moins coût des articles vendus et charges du jour (hors investissements)' } },
          el('span', { text: 'Résultat d’exploitation' }), roll(el('b'), op, signed, 150, 1100),
          invest >= 1 ? el('small', { cls: 'rc-invest', attrs: { title: 'Mobilier, revêtements, véhicules et dépôts de garantie : ils servent plusieurs jours.' } }, 'Investissements : ', roll(el('em'), -invest, signed, 350)) : null)),
      party.length ? el('div', { cls: 'rc-cheers' }, ...party.map((c, k) => el('div', { cls: 'rc-cheer', attrs: { style: `--d:${(REDUCED ? 0 : 1.05 + k * 0.2).toFixed(2)}s` } },
        el('span', { cls: 'rc-cheer-ico' }, icon(c.title.startsWith('Premier') ? 'coin' : c.title.startsWith('Record') ? 'trophy' : 'chart')),
        el('div', {}, el('b', { text: c.title }), el('span', { text: c.sub }))))) : null,
      el('div', { cls: 'kpis rc-kpis' },
        rollKpi(kpi('Clients servis', num(y.customers), '', lost ? `${num(lost)} perdu(s)` : 'aucun perdu'), y.customers, num, 250),
        rollKpi(kpi('Ventes', chf(y.revenue), '', trend !== null ? el('small', { cls: trend >= 0 ? 'ok' : 'bad', text: `${trend >= 0 ? '▲' : '▼'} ${signed(trend)} vs veille` }) : 'premier jour'), y.revenue, chf, 350),
        rollKpi(kpi('Marge brute', chf(margin), '', y.revenue > 0 ? `${Math.round((margin / y.revenue) * 100)} % des ventes` : null), margin, chf, 450),
        rollKpi(kpi('Trésorerie', chf(g.cash), g.cash >= 0 ? '' : 'bad', g.debt > 0 ? `dette ${chf(g.debt)}` : 'sans dette'), g.cash, chf, 550)),
      rescueBlock(g, onRescue ? () => { close(); if (!planDue) onRescue(); } : undefined),
      rows.length ? el('div', { cls: 'sec', text: 'Par commerce' }) : null,
      rows.length ? el('table', { cls: 'tbl rc-shops' },
        el('tr', {}, ...['Commerce', 'Clients', 'Ventes', 'Marge', 'Salaires', 'Loyer (prov.)', 'Exploitation'].map((t, k) => el('th', { cls: k ? 'n' : '', text: t }))),
        ...rows.map((r) => shopLine(r.name, r.d, r.stop))) : null,
      el('div', { cls: 'rc-cols' },
        el('div', { cls: 'rc-col' },
          el('div', { cls: 'sec', text: 'Compte de résultat du jour' }),
          el('table', { cls: 'tbl pnl' },
            el('tr', { cls: 'grp' }, el('td', { attrs: { colspan: '2' }, text: 'Exploitation' })),
            ...pnlOp.map(line),
            el('tr', { cls: 'total sub' }, el('td', { text: 'Résultat d’exploitation' }), el('td', { cls: op >= 0 ? 'num ok' : 'num bad', text: signed(op) })),
            pnlInv.length ? el('tr', { cls: 'grp' }, el('td', { attrs: { colspan: '2' }, text: 'Investissements et autres sorties' })) : null,
            ...pnlInv.map(line),
            el('tr', { cls: 'total' }, el('td', { text: 'Solde du jour' }), el('td', { cls: solde >= 0 ? 'num ok' : 'num bad', text: signed(solde) }))),
          el('p', { cls: 'rc-foot', text: 'Exploitation : ce que rapporte l’activité du jour. Investissements : ce qui sert plusieurs jours (meubles, revêtements, véhicules, dépôts, stock d’avance).' }),
          el('p', { cls: 'rc-foot', text: 'Le loyer des locaux est provisionné chaque jour et prélevé une fois par mois (30 jours après la signature).' }),
          g.shops.length ? el('p', { cls: 'rc-foot', text: taxNote }) : null),
        el('div', { cls: 'rc-col' },
          el('div', { cls: 'sec', text: `Clients perdus · ${num(lost)}` }),
          lossBlock,
          el('div', { cls: 'sec', text: 'Conseils' }),
          el('ul', { cls: 'rc-tips' }, ...tips.map((t) => el('li', { text: t }))))),
      el('div', { cls: 'rc-actions' },
        el('span', { cls: 'rc-saved', text: 'Partie sauvegardée automatiquement.' }),
        el('span', { cls: 'rc-hint' }, el('kbd', { text: 'Entrée' })),
        button(planDue ? 'Journée suivante · plan de redressement' : 'Journée suivante', close, 'primary'))));
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } });
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('.rc-actions button.primary')?.focus();
  // Fanfare quand les bandeaux de célébration apparaissent ; simple note joyeuse pour une journée rentable.
  if (party.length) setTimeout(() => { if (!closed) sound.celebrate(); }, REDUCED ? 0 : 1000);
  else if (op > 0) setTimeout(() => { if (!closed) sound.notify('ok'); }, REDUCED ? 0 : 800);
  return wrap;
}

/** KPI du récapitulatif dont la valeur défile (voir roll). */
function rollKpi(k: HTMLElement, to: number, fmt: (v: number) => string, delay: number): HTMLElement {
  roll(k.querySelector('b')!, to, fmt, delay);
  return k;
}

/**
 * Écran de fin après une faillite : bilan de la partie et choix (recommencer, reprendre une sauvegarde). Les actions
 * sont fournies par l'appelant (elles touchent au stockage et rechargent la page).
 */
export function showBankruptcy(g: Game, actions: { label: string; run: () => void; primary?: boolean }[]): HTMLElement {
  const best = Math.max(0, ...g.ledger.map((d) => d.revenue));
  const sold = g.ledger.reduce((a, d) => a + d.customers, 0);
  const wrap = el('div', { cls: 'confirm recap rd-end', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Faillite' } },
    el('div', { cls: 'confirm-card recap-card rd-end-card' },
      el('div', { cls: 'rc-head' },
        el('div', {}, el('div', { cls: 'kicker', text: `Jour ${(g.rescue.bankruptDay ?? g.day) + 1} · fin de partie` }), el('h2', { text: 'Faillite' })),
        el('div', { cls: 'rc-result bad' }, el('span', { text: 'Valeur nette' }), el('b', { text: signed(netWorth(g)) }))),
      el('p', { cls: 'rd-end-txt', text: `${g.companyName} n’a pas pu redresser ses comptes : valeur nette sous ${signed(RESCUE.bankruptWorth)} et trésorerie négative pendant ${RESCUE.bankruptDays} jours. La banque ferme vos comptes.` }),
      el('div', { cls: 'kpis rc-kpis' },
        kpi('Trésorerie', chf(g.cash), 'bad', g.debt > 0 ? `dette ${chf(g.debt)}` : null),
        kpi('Commerces', num(g.shops.length), '', null),
        kpi('Meilleure journée', chf(best), '', 'ventes'),
        kpi('Clients servis', num(sold), '', `${g.ledger.length} derniers jours`)),
      el('p', { cls: 'rc-foot', text: 'Pour la prochaine fois : surveillez le récapitulatif du soir, ouvrez le plan de redressement dès les premiers jours de pertes, gardez vos rayons pleins et vos prix proches du quartier.' }),
      el('div', { cls: 'rc-actions rd-end-actions' }, ...actions.map((a) => button(a.label, a.run, a.primary ? 'primary' : '')))));
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('button.primary')?.focus();
  return wrap;
}
