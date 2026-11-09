// --- plan climat --- Panneau « Plan climat » (trajectoire facteur 4, jalons, émissions par secteur, jauges de soutien,
// aléas, catalogue de cartes-actions, cartes jouées) et jauges compactes de la barre supérieure.
// Toutes les valeurs viennent du moteur (shared/sim/climate.ts) via l'instantané ; les disponibilités et prévisions
// des cartes sont recalculées ici avec les mêmes fonctions pures. Aucun émoji : classes CSS sémantiques « climat-* ».
import { useMemo, useState } from 'react';
import {
  ACTORS, ACTOR_NAMES, CARDS, MILESTONE_YEARS, SECTOR_NAMES, SUPPORT_FLOOR, cardStatus, targetSeries,
  type Actor, type ClimateSector, type ClimateState, type Milestone, type PlayedCard,
} from '../../../shared/sim/climate';
import type { GameState } from '../../../shared/sim/types';
import { useStore } from '../store';
import { climatAction } from '../net';
import { Drawer, Kpi, Section } from './common';
import { LineChart, monthLabel, type ChartMark } from './charts';

const nf = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const mt = (v: number, d = 1) => `${nf(v / 1e6, d)} Mt`;
const kt = (v: number) => (Math.abs(v) >= 1e6 ? `${nf(v / 1e6, 1)} Mt` : `${nf(v / 1e3)} kt`);
const eur = (v: number) => (Math.abs(v) >= 1e9 ? `${nf(v / 1e9, 1)} Md€` : `${nf(v / 1e6)} M€`);
const signed = (v: number, f: (x: number) => string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;

const SECTOR_ORDER: ClimateSector[] = ['energie', 'batiment', 'transports', 'industrie', 'agriculture', 'dechets', 'nature'];
const STATUS_LABEL: Record<Milestone['status'], string> = { a_venir: 'à venir', atteint: 'atteint', proche: 'presque atteint', manque: 'manqué' };
const PLAYED_LABEL: Record<PlayedCard['status'], string> = { engagee: 'engagée', vote: 'au vote', rejetee: 'rejetée', en_vigueur: 'en vigueur' };
const SOURCES: [string, string][] = [
  ['em_electricite', 'Électricité'], ['em_autresEnergie', 'Autres énergies'], ['em_industrie', 'Industrie'], ['em_transport', 'Transports'],
  ['em_batiments', 'Bâtiments'], ['em_agriculture', 'Agriculture'], ['em_construction', 'Construction'], ['em_dechets', 'Déchets'], ['em_puits', 'Sols et forêts (net)'],
];

/** Moyenne glissante sur 12 mois (émissions saisonnières). */
function rolling12(v: number[]) {
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= 12) s -= v[i - 12];
    out.push(s / Math.min(12, i + 1));
  }
  return out;
}

function useClimate() {
  const snap = useStore((s) => s.snap);
  return { snap, C: snap?.climate as ClimateState | undefined };
}

// ---------- Jauges ----------
function Gauge({ actor, C, compact }: { actor: Actor; C: ClimateState; compact?: boolean }) {
  const v = C.support[actor];
  const tone = v < SUPPORT_FLOOR + 10 ? 'low' : v < 50 ? 'mid' : 'high';
  const title = `${ACTOR_NAMES[actor]} : ${nf(v)}/100 (indicateurs ${nf(C.derived[actor])}, capital ${signed(C.capital[actor], (x) => nf(x))})`;
  return (
    <div className={`climat-gauge climat-gauge-${actor} ${tone} ${compact ? 'compact' : ''}`} title={title}>
      <span className="climat-gauge-label">{compact ? ACTOR_NAMES[actor].slice(0, 1) : ACTOR_NAMES[actor]}</span>
      <span className="climat-gauge-track">
        <span className="climat-gauge-fill" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
        <span className="climat-gauge-floor" style={{ left: `${SUPPORT_FLOOR}%` }} />
      </span>
      <b className="climat-gauge-value">{nf(v)}</b>
    </div>
  );
}

/** Jauges compactes (barre supérieure) : un clic ouvre le plan climat. */
export function ClimatMini() {
  const { C } = useClimate();
  const set = useStore((s) => s.set);
  if (!C) return null;
  const on = C.onTrack <= 0;
  return (
    <button className="climat-mini" onClick={() => set({ panel: 'climat' })} title="Plan climat : soutien de l'État, des entreprises et des citoyens ; écart à la trajectoire facteur 4">
      <span className={`climat-mini-track ${on ? 'on' : 'off'}`}>{on ? 'Sur la trajectoire' : `${signed(C.onTrack, (x) => nf(x, 1))} pts`}</span>
      {ACTORS.map((a) => <Gauge key={a} actor={a} C={C} compact />)}
    </button>
  );
}

// ---------- Panneau ----------
export function ClimatPanel() {
  const { snap, C } = useClimate();
  const history = useStore((s) => s.history);
  const [tab, setTab] = useState<'plan' | 'cartes' | 'jouees'>('plan');
  const [sector, setSector] = useState<ClimateSector | 'tous'>('tous');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const target = useMemo(() => (C ? targetSeries(C) : []), [C?.reference, C?.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!snap || !C) return <Drawer title="Plan climat" icon=""><p className="muted">Plan climat indisponible pour cette partie.</p></Drawer>;
  const S = snap as unknown as GameState;
  const net = history.emissionsNet ?? [];
  const real = rolling12(net);
  const now12 = real.at(-1) ?? 0;
  const year = snap.startYear + Math.floor(snap.month / 12);
  const goalNow = target[Math.min(target.length - 1, snap.month)] ?? C.reference;
  const cut = 1 - now12 / Math.max(1, C.reference);
  const marks: ChartMark[] = C.milestones.map((m) => ({ month: (m.year - snap.startYear) * 12 + 11, value: m.target, label: String(m.year), tone: `climat-${m.status}` }));
  const canChangeMode = C.milestones.every((m) => m.status === 'a_venir');

  return (
    <Drawer title="Plan climat — facteur 4" icon="" wide>
      <div className="climat-panel">
        <div className="tabs climat-tabs">
          {([['plan', 'Trajectoire et soutien'], ['cartes', 'Catalogue des mesures'], ['jouees', `Mesures engagées (${C.played.length})`]] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <div className="climat-support">
          {ACTORS.map((a) => <Gauge key={a} actor={a} C={C} />)}
          <p className="muted small">Jauges dérivées des indicateurs (État : déficit, dette, cohérence avec la trajectoire ; Entreprises : confiance, marges, fiscalité ; Citoyens : satisfaction, confiance, popularité), plus un capital gagné par les jalons et les missions réussies et dépensé par les mesures. Une mesure ne peut pas faire descendre une jauge sous {SUPPORT_FLOOR}.</p>
        </div>

        {tab === 'plan' && <>
          <div className="kpis climat-kpis">
            <Kpi label="Émissions nettes (12 mois)" value={mt(now12)} sub={`${signed(-cut * 100, (x) => nf(x, 1))} % depuis 2030`} tone={now12 <= goalNow ? 'good' : 'warn'} />
            <Kpi label={`Objectif ${year}`} value={mt(goalNow)} sub={`référence 2030 : ${mt(C.reference)}${C.referenceFixed ? '' : ' (provisoire)'}`} />
            <Kpi label="Écart à la trajectoire" value={`${signed(C.onTrack, (x) => nf(x, 1))} pts`} tone={C.onTrack <= 0 ? 'good' : C.onTrack <= 5 ? 'warn' : 'bad'} sub="en points de la référence" />
            <Kpi label="Émissions cumulées" value={mt(C.cumulative, 0)} sub="depuis janvier 2030" />
            <Kpi label="Réchauffement local (indice)" value={`+${nf(C.warming, 2)} °C`} sub="indice de jeu, pas un modèle climatique"
              hint="Grandeur abstraite dérivée des émissions cumulées du pays : +0,5 « °C de jeu » pour 40 années d'émissions au niveau de 2030. Elle règle la probabilité et la gravité des aléas climatiques ; elle ne prétend pas représenter le climat réel." />
          </div>

          <Section title="Trajectoire visée et émissions réelles" hint="Émissions territoriales nettes en moyenne glissante sur 12 mois, comparées à la trajectoire facteur 4 (référence ÷ 4 en 2080). Les repères marquent les jalons.">
            <LineChart years="all" fmt={(v) => mt(v, 0)} height={200} marks={marks}
              series={[{ key: 'real', label: 'Réelles (12 mois)', values: real, color: 'var(--climat-real, #c0392b)' }, { key: 'target', label: 'Visée', values: target, color: 'var(--climat-target, #b08d3c)' }]} />
            <div className="climat-mode">
              <span>Trajectoire :</span>
              {(['lineaire', 'exponentielle'] as const).map((m) => (
                <button key={m} className={`btn small ${C.mode === m ? 'on' : ''}`} disabled={!canChangeMode || C.mode === m} onClick={() => void climatAction({ type: 'climatTrajectoire', mode: m })}>
                  {m === 'lineaire' ? 'Linéaire par jalons' : 'Exponentielle'}
                </button>
              ))}
              {!canChangeMode && <span className="muted small">fixée depuis le premier jalon</span>}
            </div>
          </Section>

          <Section title="Jalons">
            <table className="climat-milestones">
              <thead><tr><th>Année</th><th>Objectif</th><th>Réel</th><th>Écart</th><th>Bilan</th></tr></thead>
              <tbody>
                {C.milestones.map((m) => (
                  <tr key={m.year} className={`climat-${m.status}`} title={m.text ?? ''}>
                    <td>{m.year}</td>
                    <td>{mt(m.target)} <span className="muted">(−{nf((1 - m.target / Math.max(1, C.reference)) * 100)} %)</span></td>
                    <td>{m.actual !== undefined ? mt(m.actual) : '—'}</td>
                    <td>{m.gap !== undefined ? `${signed(m.gap, (x) => nf(x, 1))} pts` : '—'}</td>
                    <td><span className={`climat-status climat-${m.status}`}>{STATUS_LABEL[m.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Jalon atteint : soutien et confiance en hausse, popularité de la majorité, expérience. Jalon manqué : sanctions proportionnées à l'écart. Les jalons {MILESTONE_YEARS[0]} et {MILESTONE_YEARS[1]} débloquent des mesures d'adaptation.</p>
          </Section>

          <Section title="Émissions par secteur (moyenne 12 mois)">
            <SectorBars history={history} />
          </Section>

          <Section title="Aléas climatiques" hint="Probabilités calculées par le module des événements à partir de la saison, de l'indice de réchauffement local et des protections engagées (hors délais minimaux entre deux événements).">
            <div className="climat-hazards">
              {C.hazards.map((h) => (
                <div key={h.id} className="climat-hazard">
                  <span>{h.name}</span>
                  <span className="climat-hazard-bar"><span style={{ width: `${Math.min(100, h.year * 400)}%` }} /></span>
                  <b>{nf(h.year * 100, 1)} %</b><span className="muted small">sur 12 mois · {nf(h.month * 100, 1)} % ce mois-ci</span>
                </div>
              ))}
            </div>
          </Section>
        </>}

        {tab === 'cartes' && <>
          <div className="climat-filters">
            <button className={sector === 'tous' ? 'on' : ''} onClick={() => setSector('tous')}>Tous</button>
            {SECTOR_ORDER.map((s) => <button key={s} className={sector === s ? 'on' : ''} onClick={() => setSector(s)}>{SECTOR_NAMES[s]}</button>)}
            <label className="climat-only"><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> jouables seulement</label>
          </div>
          <div className="climat-cards">
            {CARDS.filter((c) => sector === 'tous' || c.sector === sector).map((c) => {
              const st = cardStatus(S, c.id);
              if (onlyAvail && !st.available) return null;
              const f = st.forecast;
              return (
                <article key={c.id} className={`climat-card climat-sector-${c.sector} ${st.available ? 'available' : 'locked'}`}>
                  <header>
                    <span className="climat-card-sector">{SECTOR_NAMES[c.sector]}</span>
                    <h4>{c.title}</h4>
                    {st.max > 1 && <span className="climat-card-plays">{st.plays}/{st.max}</span>}
                  </header>
                  <p className="climat-card-desc">{c.desc}</p>
                  <dl className="climat-card-forecast">
                    <div><dt>CO₂ évité</dt><dd>{f.co2 > 0 ? `${kt(f.co2)}/an` : '—'}</dd></div>
                    <div><dt>Coût</dt><dd>{f.cost > 0 ? eur(f.cost) : '—'}</dd></div>
                    <div><dt>Budget annuel</dt><dd>{f.budget !== 0 ? `${signed(f.budget, eur)}/an` : '—'}</dd></div>
                    <div><dt>Emplois</dt><dd>{Math.abs(f.jobs) >= 10 ? signed(Math.round(f.jobs), (x) => nf(x)) : '—'}</dd></div>
                    <div><dt>Satisfaction</dt><dd>{f.sat !== 0 ? signed(f.sat, (x) => nf(x, 1)) : '—'}</dd></div>
                    <div><dt>Délai</dt><dd>{c.delay} mois</dd></div>
                  </dl>
                  <div className="climat-card-cost">
                    {ACTORS.filter((a) => st.cost[a] > 0).map((a) => <span key={a} className={`climat-cost climat-cost-${a}`}>{ACTOR_NAMES[a]} −{st.cost[a]}</span>)}
                    {ACTORS.every((a) => st.cost[a] <= 0) && <span className="climat-cost">sans coût en soutien</span>}
                  </div>
                  <p className="climat-card-mech muted small">{c.mechanism}</p>
                  {st.available
                    ? <button className="btn primary climat-play" onClick={() => void climatAction({ type: 'climatCard', card: c.id })}>Engager la mesure</button>
                    : <p className="climat-card-reason">{st.reason}</p>}
                </article>
              );
            })}
          </div>
          <p className="muted small">Prévisions : ordres de grandeur calculés sur l'état actuel. L'effet réel est celui des moteurs (énergie, transports, logement, industrie…) et apparaît dans « Mesures engagées ».</p>
        </>}

        {tab === 'jouees' && (
          <Section title="Mesures engagées et effet constaté" hint="Effet constaté : évolution des émissions du secteur concerné (moyenne 12 mois) depuis la décision, toutes causes confondues.">
            {C.played.length === 0 && <p className="muted">Aucune mesure engagée pour l'instant. Ouvrez le catalogue pour lancer votre plan climat.</p>}
            <div className="climat-played">
              {[...C.played].reverse().map((p) => {
                const delta = p.observed !== undefined ? p.observed - p.before : undefined;
                return (
                  <div key={p.uid} className={`climat-played-row climat-played-${p.status}`}>
                    <div className="climat-played-head">
                      <b>{p.title}</b>
                      <span className="muted small">{SECTOR_NAMES[p.sector]} · {monthLabel(p.month, snap.startYear)}</span>
                      <span className={`climat-status climat-played-${p.status}`}>{PLAYED_LABEL[p.status]}</span>
                    </div>
                    <div className="small">{p.msg}</div>
                    <div className="climat-played-effect small">
                      <span>Prévu : −{kt(p.forecastCo2)}/an</span>
                      {p.status !== 'rejetee' && delta !== undefined && <span>Constaté : {mt(p.before)} → {mt(p.observed!)} ({signed(delta, kt)}/an)</span>}
                      {snap.month < p.due && p.status !== 'rejetee' && <span className="muted">bilan dans {p.due - snap.month} mois</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </Drawer>
  );
}

function SectorBars({ history }: { history: Record<string, number[]> }) {
  const rows = SOURCES.map(([k, label]) => {
    const h = history[k] ?? [];
    const t = h.slice(-12);
    const v = t.length ? t.reduce((s, x) => s + x, 0) / t.length : 0;
    const p = h.slice(-24, -12);
    const prev = p.length ? p.reduce((s, x) => s + x, 0) / p.length : undefined;
    return { k, label, v, prev };
  });
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className="climat-sectors">
      {rows.map((r) => (
        <div key={r.k} className={`climat-sector-row ${r.v < 0 ? 'sink' : ''}`}>
          <span className="climat-sector-label">{r.label}</span>
          <span className="climat-sector-track"><span style={{ width: `${(Math.abs(r.v) / max) * 100}%` }} /></span>
          <b>{mt(r.v)}</b>
          <span className="muted small">{r.prev !== undefined ? `${signed(r.v - r.prev, kt)} sur un an` : ''}</span>
        </div>
      ))}
    </div>
  );
}
