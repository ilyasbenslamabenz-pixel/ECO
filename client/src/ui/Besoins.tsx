// Besoins du pays : tableau de bord central du gouvernement. Chaque carte montre un besoin (écoles, soins,
// logement, électricité, énergie verte, sécurité, emploi, transports, air), sa gravité, le quartier concerné et des
// actions en un clic (recrutement, programme de construction, démolition, centrale à construire ou fermer). En dessous :
// l'avancement de tous les chantiers et programmes en cours.
import { useMemo } from 'react';
import type { GameState } from '../../../shared/sim/types';
import { assessNeeds, fmtNeedCost, type Need, type NeedAction } from '../../../shared/sim/needs';
import { BUILDINGS } from '../../../shared/sim/construction';
import { useStore, type Panel } from '../store';
import { gameAction, serviceAction } from '../net';
import { camApi } from '../game/world';
import { Drawer, Meter, Section } from './common';
import { monthLabel } from './charts';
import { Icon } from './Icon';

const TONE = ['var(--good)', 'var(--gold)', 'var(--seal)'];
const LEVEL = ['Satisfaisant', 'À surveiller', 'Urgent'];
const STAMP = ['ok', 'watch', 'urgent'];

export function useNeeds(): Need[] {
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  return useMemo(() => {
    if (!snap || !country) return [];
    try { return assessNeeds({ ...snap, country } as unknown as GameState); } catch { return []; }
  }, [snap, country]);
}

function run(a: NeedAction, set: (p: { panel: Panel }) => void) {
  if (a.kind === 'program') return serviceAction({ type: 'programme', building: a.building, cityId: a.cityId, count: a.count });
  if (a.kind === 'demolish') { if (confirm(`${a.label} ?`)) return serviceAction({ type: 'demolir', infraId: a.infraId }); return; }
  if (a.kind === 'recruit') return serviceAction({ type: 'recruter', service: a.service, role: a.role, count: a.count });
  if (a.kind === 'energyBuild') return gameAction({ type: 'energyBuild', tech: a.tech, mw: a.mw });
  if (a.kind === 'energyClose') { if (confirm(`${a.label} ?`)) return gameAction({ type: 'energyClose', tech: a.tech, mw: a.mw }); return; }
  set({ panel: a.panel as Panel });
}

function NeedCard({ n }: { n: Need }) {
  const set = useStore((s) => s.set);
  const country = useStore((s) => s.country);
  return (
    <article className={`need need-${n.level}${n.level > 0 ? ' paper' : ''}`}>
      <div className="need-head">
        <span className="need-icon"><Icon name={n.icon} size={20} /></span>
        <b>{n.title}</b>
        <span className={`need-level stamp ${STAMP[n.level]}`}>{LEVEL[n.level]}</span>
        <span className="need-value">{n.value}</span>
      </div>
      <Meter value={n.score} max={1} tone={TONE[n.level]} />
      <p className="small">{n.detail}</p>
      <div className="btn-row wrap">
        {n.actions.map((a, k) => (
          <button key={k} className={`btn ${a.kind === 'panel' ? 'ghost' : a.kind === 'demolish' || a.kind === 'energyClose' ? 'danger' : k === 0 ? 'primary' : ''}`}
            title={a.kind === 'program' ? `${BUILDINGS[a.building].description} Chantier de ${BUILDINGS[a.building].months} mois.` : undefined}
            onClick={() => {
              void run(a, set);
              if (a.kind === 'program' && country) { const c = country.cities[a.cityId]; if (c) camApi.focus(c.x, c.z, 4); }
            }}>
            <Icon name={a.kind === 'panel' ? 'fleche' : a.kind === 'demolish' ? 'demolir' : a.kind === 'energyClose' ? 'arret' : 'construire'} size={14} />
            {a.kind === 'panel' ? a.label : <>{a.label}<span className="muted-cost"> · {fmtNeedCost(a.cost)}</span></>}
          </button>
        ))}
      </div>
    </article>
  );
}

function Progress() {
  const snap = useStore((s) => s.snap);
  if (!snap) return null;
  const sites = snap.construction?.sites ?? [];
  const energy = (snap.energy?.projects ?? []).filter((p) => p.public);
  if (!sites.length && !energy.length) return <p className="muted">Aucun chantier en cours. Lancez un programme depuis une carte ci-dessus.</p>;
  const KIND = { construction: 'Construction', amelioration: 'Amélioration', renovation: 'Rénovation' } as const;
  return (
    <div className="progress-list">
      {sites.map((s) => {
        const r = s.months > 0 ? s.elapsed / s.months : 1;
        return (
          <div key={`s${s.id}`} className="progress-row">
            <span><Icon name={BUILDINGS[s.type]?.icon} size={15} />{KIND[s.kind]} · {s.name}</span>
            <Meter value={r} max={1} tone="var(--accent)" />
            <em>{Math.round(r * 100)} % · fin {monthLabel(s.started + s.months, snap.startYear)}</em>
          </div>
        );
      })}
      {energy.map((p) => {
        const r = p.done > p.start ? Math.max(0, Math.min(1, (snap.month - p.start) / (p.done - p.start))) : 1;
        return (
          <div key={`e${p.id}`} className="progress-row">
            <span><Icon name={p.kind === 'build' ? 'energie' : 'arret'} size={15} />{p.name}</span>
            <Meter value={r} max={1} tone={p.kind === 'build' ? 'var(--accent)' : 'var(--warn)'} />
            <em>{Math.round(r * 100)} % · fin {monthLabel(p.done, snap.startYear)}</em>
          </div>
        );
      })}
    </div>
  );
}

export function BesoinsPanel() {
  const needs = useNeeds();
  const urgent = needs.filter((n) => n.level === 2).length;
  const watch = needs.filter((n) => n.level === 1).length;
  return (
    <Drawer title="Besoins du pays" icon="besoins" wide>
      <div className="needs-summary">
        <div className="needs-count urgent"><b>{urgent}</b><span>urgent{urgent > 1 ? 's' : ''}</span></div>
        <div className="needs-count watch"><b>{watch}</b><span>à surveiller</span></div>
        <div className="needs-count"><b>{needs.length - urgent - watch}</b><span>satisfaisant{needs.length - urgent - watch > 1 ? 's' : ''}</span></div>
        <p className="muted">
          {urgent ? `${urgent} besoin${urgent > 1 ? 's' : ''} urgent${urgent > 1 ? 's' : ''}` : 'Aucun besoin urgent'}{watch ? `, ${watch} à surveiller` : ''}. Les quartiers et les quantités proposés sont calculés à partir de la
          simulation ; chaque construction prend plusieurs mois et ses effets apparaissent à la mise en service.
        </p>
      </div>
      <div className="needs-grid">{[...needs].sort((a, b) => b.level - a.level).map((n) => <NeedCard key={n.id} n={n} />)}</div>
      <Section title="Avancement des chantiers et programmes"><Progress /></Section>
    </Drawer>
  );
}
