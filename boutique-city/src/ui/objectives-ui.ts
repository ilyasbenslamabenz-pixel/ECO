/**
 * Objectifs à l'écran : carte des trois objectifs actifs (en haut à gauche : palier courant, avancement chiffré,
 * indication de l'objectif choisi), bannière « Palier franchi » et écran de victoire « Légende du quartier ».
 * Lit uniquement l'état de la partie (src/sim/objectives.ts).
 */
import type { Game } from '../sim/game';
import { LEGEND_ID, LEGEND_RANK, OBJECTIVES, TIERS, TIER_BY_ID, activeObjectives, currentTier, netWorth, tierComplete, tierCount, victoryScore, type Tier } from '../sim/objectives';
import { button, chf, el, icon, num } from './dom';

export interface ObjectiveHooks {
  /** Palier franchi pendant la partie (la bannière s'affiche) : son. */
  onTier: (t: Tier) => void;
  /** Légende atteinte pendant la partie : l'interface affiche l'écran de victoire dès qu'elle le peut. */
  onVictory: () => void;
}

/** Carte repliable des objectifs actifs ; détecte aussi les paliers franchis et la victoire. */
export class ObjectiveCard {
  readonly root = el('div', { cls: 'objective', attrs: { role: 'region', 'aria-label': 'Objectifs en cours' } });
  /** Indication visible (carte dépliée). */
  private open = true;
  /** Objectif dont l'indication est affichée (absent : le premier). */
  private focus: string | null = null;
  private sig = '';
  private readonly tiersDone: Set<string>;
  private legend: boolean;

  constructor(private readonly game: Game, private readonly hooks: ObjectiveHooks) {
    this.tiersDone = new Set(TIERS.filter((t) => tierComplete(game, t.id)).map((t) => t.id));
    this.legend = game.achieved.includes(LEGEND_ID);
    document.body.append(this.root);
    this.render();
  }

  /** Vérifie les objectifs puis redessine si quelque chose a changé (appelée deux fois par seconde). */
  render(): void {
    const g = this.game;
    g.checkObjectives();
    for (const t of TIERS) {
      if (this.tiersDone.has(t.id) || !tierComplete(g, t.id)) continue;
      this.tiersDone.add(t.id);
      if (t.id !== 'magnat') showTierBanner(g, t);
      this.hooks.onTier(t);
    }
    if (!this.legend && g.achieved.includes(LEGEND_ID)) { this.legend = true; this.hooks.onVictory(); }
    const act = activeObjectives(g), prs = act.map((o) => o.progress(g));
    const focus = act.find((o) => o.id === this.focus) ?? act[0];
    const sig = `${this.open}|${focus?.id}|${g.achieved.length}|${prs.map((p) => p.text).join('|')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const cur = currentTier(g);
    if (!cur || !act.length) {
      this.root.replaceChildren(el('div', { cls: 'obj-head done' }, icon('trophy'), el('b', { text: `${LEGEND_RANK} · tous les objectifs atteints !` })));
      return;
    }
    const k = TIERS.indexOf(cur), c = tierCount(g, cur.id);
    const head = el('button', { cls: 'obj-head', attrs: { type: 'button', 'aria-expanded': String(this.open), title: this.open ? 'Masquer les indications' : 'Afficher les indications' }, on: { click: () => { this.open = !this.open; this.sig = ''; this.render(); } } },
      el('span', { cls: 'obj-tier' }, el('b', { text: `Palier ${k + 1} · ${cur.name}` })),
      el('span', { cls: 'obj-count', text: `${c.done} / ${c.total}` }),
      el('span', { cls: 'obj-chev', text: this.open ? '▾' : '▸' }));
    const rows = act.map((o, i) => {
      const pr = prs[i]!, on = o === focus;
      const other = o.tier !== cur.id ? el('em', { cls: 'obj-next', text: TIER_BY_ID.get(o.tier)!.name }) : null;
      return el('li', { cls: `obj-row${on && this.open ? ' focus' : ''}` },
        el('button', { cls: 'obj-pick', attrs: { type: 'button', 'aria-label': `${o.title} : ${pr.text}` }, on: { click: () => { this.focus = o.id; this.open = true; this.sig = ''; this.render(); } } },
          el('span', { cls: 'obj-title' }, el('i', { cls: 'obj-ring', attrs: { 'aria-hidden': 'true' } }), el('b', { text: o.title }), other),
          el('span', { cls: 'obj-prog' }, el('span', { cls: 'obj-bar' }, el('i', { attrs: { style: `width:${Math.round(pr.p * 100)}%` } })), el('small', { text: pr.text }))),
        on && this.open ? el('p', { cls: 'obj-hint', text: o.hint }) : null);
    });
    this.root.replaceChildren(head, el('div', { cls: 'obj-tierbar', attrs: { title: `Palier ${cur.name} : ${c.done} objectifs sur ${c.total}` } }, el('i', { attrs: { style: `width:${Math.round((c.done / c.total) * 100)}%` } })),
      el('ol', { cls: 'obj-list' }, ...rows));
  }
}

/** Bannière centrale « Palier franchi » (6 secondes, un clic la ferme). */
function showTierBanner(g: Game, t: Tier): void {
  document.querySelector('.tier-banner')?.remove();
  const k = TIERS.indexOf(t), next = TIERS[k + 1];
  const close = (): void => { b.classList.add('out'); setTimeout(() => b.remove(), 350); };
  const b = el('div', { cls: 'tier-banner', attrs: { role: 'status', 'aria-live': 'polite' }, on: { click: close } },
    el('div', { cls: 'tb-ico' }, icon('trophy')),
    el('div', { cls: 'tb-txt' },
      el('span', { cls: 'kicker', text: `Palier ${k + 1} franchi` }),
      el('b', { text: t.name }),
      el('span', { text: `Récompense : ${t.reward}.` }),
      next && currentTier(g)?.id === next.id ? el('small', { text: `Vous voilà ${next.rank} : ${tierCount(g, next.id).total - tierCount(g, next.id).done} nouveaux objectifs.` }) : null));
  document.body.append(b);
  setTimeout(close, 6500);
}

/** Écran de victoire (jeu en pause tant qu'il est ouvert) : score, jour, chiffres clés, « Continuer la partie ». */
export function showVictory(g: Game, onClose: () => void): HTMLElement {
  let closed = false;
  const close = (): void => { if (closed) return; closed = true; wrap.remove(); onClose(); };
  const types = new Set(g.shops.map((s) => s.type)).size;
  const kpi = (label: string, value: string): HTMLElement => el('div', { cls: 'kpi' }, el('span', { text: label }), el('b', { text: value }));
  const wrap = el('div', { cls: 'confirm victory', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Victoire' } },
    el('div', { cls: 'confirm-card victory-card' },
      el('div', { cls: 'vc-ico' }, icon('trophy')),
      el('div', { cls: 'kicker', text: `Victoire · jour ${g.day + 1}` }),
      el('h2', { text: LEGEND_RANK }),
      el('p', { cls: 'vc-lead', text: `${g.companyName} a atteint les ${OBJECTIVES.length} objectifs : le quartier ne parle plus que de vous.` }),
      el('div', { cls: 'vc-score' }, el('span', { text: 'Score' }), el('b', { text: num(victoryScore(g)) }), el('small', { text: 'valeur nette ÷ jours de jeu' })),
      el('div', { cls: 'kpis vc-kpis' }, kpi('Valeur nette', chf(netWorth(g))), kpi('Trésorerie', chf(g.cash)), kpi('Commerces', `${g.shops.length} · ${types} types`), kpi('Employés', String(g.employees.length))),
      el('div', { cls: 'row end' }, button('Continuer la partie', close, 'primary'))));
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } });
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('button.primary')?.focus();
  return wrap;
}
