// Ministère de l'Intérieur et des relations avec le parlement : partis, hémicycle, coalition, lois et votes,
// élections, syndicats et associations.
import { useState } from 'react';
import { AXIS_NAMES, INTEREST_GROUPS, LAW_CATEGORY_NAMES, LAW_THRESHOLDS, PARTIES, PARTY_INDEX, forecastVote, type Bill, type ElectionResult, type PartyId, type PoliticsState } from '../../../shared/sim/politics';
import { useStore } from '../store';
import { govAction } from '../net';
import { pct } from '../format';
import { Bars, Drawer, Kpi, Meter, Section, Tabs } from './common';
import { LineChart, monthLabel, tint } from './charts';
import { Icon } from './Icon';

const partyName = (id: PartyId) => PARTIES[PARTY_INDEX[id]].name;
const partyColor = (id: PartyId) => tint(PARTIES[PARTY_INDEX[id]].color);
const coalitionSeats = (P: PoliticsState, ids = P.coalition) => P.parties.filter((p) => ids.includes(p.id)).reduce((s, p) => s + p.seats, 0);
const MODE_LABEL: Record<PoliticsState['mode'], string> = { majorite: 'Gouvernement majoritaire', minorite: 'Gouvernement minoritaire', cohabitation: 'Cohabitation' };

export function PolitiquePanel() {
  const [tab, setTab] = useState<'parlement' | 'partis' | 'lois' | 'groupes' | 'elections'>('parlement');
  return (
    <Drawer title="Vie politique & parlement" icon="politique" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['parlement', 'Parlement'], ['partis', 'Partis'], ['lois', 'Lois & votes'], ['groupes', 'Syndicats & associations'], ['elections', 'Élections']]} />
      {tab === 'parlement' && <Parlement />}
      {tab === 'partis' && <Partis />}
      {tab === 'lois' && <Lois />}
      {tab === 'groupes' && <Groupes />}
      {tab === 'elections' && <Elections />}
    </Drawer>
  );
}

/** Hémicycle : sièges disposés en demi-cercles concentriques, partis ordonnés de la gauche vers la droite. */
export function Hemicycle({ P, height = 190 }: { P: PoliticsState; height?: number }) {
  const total = P.seatsTotal;
  const rows = 9;
  const radii = Array.from({ length: rows }, (_, i) => 0.42 + (0.58 * i) / (rows - 1));
  const rsum = radii.reduce((s, r) => s + r, 0);
  const perRow = radii.map((r) => Math.round((total * r) / rsum));
  perRow[rows - 1] += total - perRow.reduce((s, v) => s + v, 0);
  const seats: { a: number; r: number }[] = [];
  radii.forEach((r, i) => { for (let k = 0; k < perRow[i]; k++) seats.push({ a: Math.PI * (1 - (k + 0.5) / perRow[i]), r }); });
  seats.sort((x, y) => y.a - x.a || x.r - y.r);
  const order = [...P.parties].sort((a, b) => PARTIES[PARTY_INDEX[b.id]].pos[0] - PARTIES[PARTY_INDEX[a.id]].pos[0]);
  const colors: { c: string; coal: boolean }[] = [];
  for (const p of order) for (let k = 0; k < p.seats; k++) colors.push({ c: partyColor(p.id), coal: P.coalition.includes(p.id) });
  const W = 400, H = 210, cx = 200, cy = 200, R = 190;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }} role="img" aria-label="Hémicycle">
      {seats.map((s, i) => (
        <circle key={i} cx={cx + Math.cos(s.a) * s.r * R} cy={cy - Math.sin(s.a) * s.r * R} r={4.2} fill={colors[i]?.c ?? '#666'} stroke={colors[i]?.coal ? '#f2ecdf' : 'none'} strokeWidth={0.8} />
      ))}
      <text x={cx} y={cy - 18} textAnchor="middle" fontSize={22} fontWeight={700} fill="currentColor">{coalitionSeats(P)}</text>
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>sièges du camp gouvernemental / {total}</text>
    </svg>
  );
}

function Parlement() {
  const snap = useStore((s) => s.snap);
  const P = snap?.politics;
  if (!snap || !P) return null;
  const half = Math.floor(P.seatsTotal / 2) + 1;
  const cs = coalitionSeats(P);
  const inCohab = P.mode === 'cohabitation';
  return (
    <>
      <Hemicycle P={P} />
      <div className="legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
        {P.parties.map((p) => <span key={p.id}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: partyColor(p.id), marginRight: 4 }} />{PARTIES[PARTY_INDEX[p.id]].short} {p.seats}{P.coalition.includes(p.id) ? ' ★' : ''}</span>)}
      </div>
      <div className="kpis">
        <Kpi label="Situation" value={MODE_LABEL[P.mode]} tone={P.mode === 'majorite' ? 'good' : 'warn'} />
        <Kpi label="Camp gouvernemental" value={`${cs} / ${P.seatsTotal}`} sub={`majorité absolue : ${half}`} tone={cs >= half ? 'good' : 'bad'} />
        <Kpi label="Discipline de vote" value={pct(P.discipline, 0)} hint="Dépend de la confiance dans le gouvernement ; renforcée temporairement par une question de confiance gagnée." />
        <Kpi label="Confiance" value={`${Math.round(snap.satisfaction.trust)}/100`} tone={snap.satisfaction.trust < 35 ? 'bad' : undefined} hint="Sous 35 pendant 3 mois, l'opposition dépose une motion de censure." />
        <Kpi label="Prochaines élections" value={monthLabel(P.nextElection, snap.startYear)} sub={`dans ${Math.max(0, P.nextElection - snap.month)} mois`} />
        <Kpi label="Lois adoptées / rejetées" value={`${P.adopted} / ${P.rejected}`} />
      </div>
      <Section title="Coalition" hint="Un parti accepte de rejoindre la coalition si son programme est assez proche de celui de votre parti.">
        <p className="small">Chef du gouvernement : <b>{partyName(P.leader)}</b>. {inCohab && <>Majorité parlementaire de cohabitation : <b>{P.majority.map(partyName).join(', ')}</b>.</>}</p>
        <table className="table">
          <thead><tr><th>Parti</th><th>Sièges</th><th>Intentions de vote</th><th /></tr></thead>
          <tbody>
            {P.parties.map((p) => (
              <tr key={p.id}>
                <td><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: partyColor(p.id), marginRight: 6 }} />{partyName(p.id)}{p.id === P.leader ? ' (votre parti)' : ''}</td>
                <td>{p.seats}</td>
                <td>{pct(p.popularity)}</td>
                <td>{p.id !== P.leader && (P.coalition.includes(p.id)
                  ? <button className="btn ghost" onClick={() => govAction({ type: 'coalition', party: p.id, join: false })}>Exclure</button>
                  : <button className="btn" disabled={inCohab && P.majority.includes(p.id)} onClick={() => govAction({ type: 'coalition', party: p.id, join: true })}>Inviter</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Responsabilité du gouvernement">
        <div className="btn-row">
          <button className="btn" onClick={() => govAction({ type: 'confiance' })}><Icon name="urne" size={14} />Poser la question de confiance</button>
          <button className="btn danger" onClick={() => { if (confirm('Dissoudre le parlement ? Élections anticipées dans 2 mois.')) void govAction({ type: 'dissolution' }); }}>Dissoudre le parlement</button>
        </div>
        <p className="muted small">Confiance gagnée : discipline renforcée pendant plusieurs mois. Confiance refusée ou motion de censure adoptée : élections anticipées dans 2 mois.</p>
        {P.motions.length > 0 && (
          <table className="table"><thead><tr><th>Date</th><th>Vote</th><th>Pour</th><th>Contre</th><th>Résultat</th></tr></thead>
            <tbody>{[...P.motions].reverse().slice(0, 6).map((m, i) => <tr key={i}><td>{monthLabel(m.month, snap.startYear)}</td><td>{m.kind === 'censure' ? 'Motion de censure' : 'Question de confiance'}</td><td>{m.yes}</td><td>{m.no}</td><td className={(m.kind === 'censure') !== m.passed ? 'good' : 'bad'}>{m.passed ? 'Adoptée' : 'Rejetée'}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function Partis() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  const P = snap?.politics;
  if (!snap || !P) return null;
  return (
    <>
      <Section title="Intentions de vote" hint="Calculées chaque mois à partir de la satisfaction de chaque catégorie (pondérée par ses effectifs), de la croissance, de l'inflation, du chômage, des enjeux saillants et des lois adoptées.">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['all', 'Tout']]} />
        <LineChart years={years} fmt={(v) => pct(v)} startYear={snap.startYear} series={P.parties.map((p) => ({ key: p.id, label: PARTIES[PARTY_INDEX[p.id]].short, values: history['party_' + p.id] ?? [], color: partyColor(p.id) }))} />
      </Section>
      {PARTIES.map((d) => {
        const p = P.parties.find((x) => x.id === d.id)!;
        return (
          <Section key={d.id} title={`${d.name}${P.coalition.includes(d.id) ? ' ★ coalition' : ' — opposition'}`}>
            <div className="kpis compact">
              <Kpi label="Intentions de vote" value={pct(p.popularity)} />
              <Kpi label="Sièges" value={String(p.seats)} />
              <Kpi label="Humeur de l'électorat" value={`${p.mood >= 0 ? '+' : ''}${Math.round(p.mood * 100)}`} tone={p.mood > 0.05 ? 'good' : p.mood < -0.05 ? 'bad' : undefined} hint="Réaction de l'électorat aux lois adoptées (s'estompe avec le temps)." />
            </div>
            <p className="small">Priorités : {d.priorities.join(' · ')}</p>
            <p className="small muted">{AXIS_NAMES.map((a, i) => `${a} ${d.pos[i] >= 0 ? '+' : ''}${d.pos[i].toFixed(1)}`).join(' · ')}</p>
          </Section>
        );
      })}
    </>
  );
}

function BillCard({ b, P }: { b: Bill; P: PoliticsState }) {
  const snap = useStore((s) => s.snap)!;
  const status: Record<Bill['status'], [string, string]> = { en_debat: ['En débat', 'warn'], adoptee: ['Adoptée', 'good'], rejetee: ['Rejetée', 'bad'], retiree: ['Retirée', ''] };
  const [label, tone] = status[b.status];
  const forecast = b.status === 'en_debat' ? forecastVote(snap, b.vector) : null;
  return (
    <div className={`notice ${tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'info'}`}>
      <div className="notice-head"><b>{b.title}</b><span>{label} · {monthLabel(b.voteMonth, snap.startYear)}</span></div>
      <p className="small muted">{LAW_CATEGORY_NAMES[b.category]}</p>
      <ul className="small">{b.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
      {forecast !== null && (
        <>
          <p className="small">Prévision : environ <b>{Math.round(forecast * P.seatsTotal)}</b> voix pour sur {P.seatsTotal} ({forecast > 0.5 ? 'adoption probable' : forecast > 0.42 ? 'vote serré' : 'rejet probable'}). Vote au 1er {monthLabel(b.voteMonth, snap.startYear)}.</p>
          <Meter value={forecast} max={1} />
          <button className="btn ghost" onClick={() => govAction({ type: 'retirerLoi', bill: b.id })}>Retirer le texte</button>
        </>
      )}
      {b.votes && (
        <>
          <p className="small">Pour <b>{b.yes}</b> · Contre <b>{b.no}</b> · Abstentions <b>{b.abstention}</b></p>
          <Bars fmt={(v) => String(v)} max={Math.max(...b.votes.map((v) => v.yes + v.no + v.abstention), 1)} items={b.votes.flatMap((v) => [
            { label: `${PARTIES[PARTY_INDEX[v.party]].short} pour`, value: v.yes, color: partyColor(v.party) },
            { label: `${PARTIES[PARTY_INDEX[v.party]].short} contre`, value: v.no, color: '#888' },
          ])} />
        </>
      )}
    </div>
  );
}

function Lois() {
  const snap = useStore((s) => s.snap);
  const P = snap?.politics;
  if (!snap || !P) return null;
  const debate = P.bills.filter((b) => b.status === 'en_debat');
  const past = P.bills.filter((b) => b.status !== 'en_debat').reverse();
  return (
    <>
      <Section title="Projets de loi en débat">
        {debate.length ? debate.map((b) => <BillCard key={b.id} b={b} P={P} />) : <p className="muted small">Aucun texte en débat. Les réformes majeures adoptées dans les ministères deviennent des projets de loi.</p>}
      </Section>
      <Section title="Historique des votes">
        {past.length ? past.slice(0, 15).map((b) => <BillCard key={b.id} b={b} P={P} />) : <p className="muted small">Aucun vote pour l'instant.</p>}
      </Section>
      <Section title="Décret ou loi ?" hint="Les petits ajustements sont pris par décret et entrent en vigueur au 1er du mois suivant. Au-delà des seuils ci-dessous, la mesure devient un projet de loi voté au début du mois suivant ; rejetée, elle n'entre pas en vigueur.">
        <table className="table"><tbody>{LAW_THRESHOLDS.map((t) => <tr key={t.group}><td><b>{t.group}</b></td><td className="small">{t.text}</td></tr>)}</tbody></table>
      </Section>
    </>
  );
}

function Groupes() {
  const snap = useStore((s) => s.snap);
  const P = snap?.politics;
  if (!snap || !P) return null;
  const KIND: Record<string, string> = { syndicat: 'Syndicat', association: 'Association', patronat: 'Organisation patronale', economique: 'Groupe économique' };
  return (
    <Section title="Soutien des corps intermédiaires" hint="Le soutien dépend de la satisfaction des catégories représentées et des réformes adoptées. Un syndicat hostile (< 40) rend les grèves plus probables ; un patronat hostile (< 30) érode la confiance des entreprises.">
      {INTEREST_GROUPS.map((d) => {
        const g = P.groups.find((x) => x.id === d.id)!;
        return (
          <div key={d.id} className="bar-row" style={{ marginBottom: 8 }}>
            <span className="bar-label" style={{ alignItems: 'flex-start' }}><Icon name={d.icon} size={15} /><span>{d.name}<br /><em className="muted small">{KIND[d.kind]}</em></span></span>
            <div style={{ flex: 1 }}><Meter value={g.support} /></div>
            <span className="bar-val">{Math.round(g.support)}/100 {g.support >= 60 ? 'favorable' : g.support < 35 ? 'hostile' : 'réservé'}</span>
          </div>
        );
      })}
    </Section>
  );
}

function Districts({ e }: { e: ElectionResult }) {
  const [open, setOpen] = useState(false);
  const d = e.districts!;
  const wins = PARTIES.map((p) => ({ p, n: d.filter((x) => x.winner === p.id).length })).filter((x) => x.n > 0);
  return (
    <>
      <p className="small">Arrondissements remportés : {wins.map((w) => `${w.p.short} ${w.n}`).join(' · ')} <button className="link" onClick={() => setOpen(!open)}>{open ? 'Masquer' : 'Détail par arrondissement'}</button></p>
      {open && (
        <table className="table">
          <thead><tr><th>Arrondissement / quartier</th><th>Électeurs</th>{PARTIES.map((p) => <th key={p.id}>{p.short}</th>)}</tr></thead>
          <tbody>{d.map((x) => (
            <tr key={x.id}><td><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: partyColor(x.winner), marginRight: 6 }} />{x.name}</td><td>{Math.round(x.voters / 1000).toLocaleString('fr-FR')} k</td>
              {PARTIES.map((p) => <td key={p.id} style={{ fontWeight: x.winner === p.id ? 700 : 400 }}>{pct(x.shares[p.id], 0)}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

function Elections() {
  const snap = useStore((s) => s.snap);
  const P = snap?.politics;
  if (!snap || !P) return null;
  const OUT: Record<string, string> = { majorite: 'Majorité conservée', coalition_elargie: 'Coalition élargie', cohabitation: 'Cohabitation', defaite: 'Défaite' };
  return (
    <>
      <div className="kpis">
        <Kpi label="Prochaines élections" value={monthLabel(P.nextElection, snap.startYear)} sub={`dans ${Math.max(0, P.nextElection - snap.month)} mois (tous les 4 ans)`} />
        <Kpi label="Élections gagnées" value={String(P.electionsWon)} />
        <Kpi label="Sondage du camp gouvernemental" value={pct(P.parties.filter((p) => P.coalition.includes(p.id)).reduce((s, p) => s + p.popularity, 0))} />
      </div>
      <Section title="Règles">
        <ul className="small">
          <li>Sièges ({P.seatsTotal}) répartis à la proportionnelle (plus forte moyenne), seuil de 5 % des voix.</li>
          <li>Si votre coalition garde la majorité absolue, vous restez au pouvoir.</li>
          <li>Sinon, elle s'élargit à un parti proche, moins puissant qu'elle, si cela suffit à retrouver la majorité.</li>
          <li>Sinon, si votre parti reste une force majeure et votre camp conserve au moins 35 % des sièges : cohabitation (vos lois doivent convaincre une majorité d'opposition).</li>
          <li>Sinon, ou en cas de nouvel échec en cohabitation : fin de mandat (défaite politique).</li>
        </ul>
      </Section>
      <Section title="Résultats">
        {P.elections.length === 0 && <p className="muted small">Aucune élection depuis votre arrivée au pouvoir.</p>}
        {[...P.elections].reverse().map((e) => (
          <div key={e.month} className={`notice ${e.outcome === 'defaite' ? 'bad' : e.outcome === 'cohabitation' ? 'warn' : 'good'}`}>
            {/* résultats par arrondissement affichés sous le tableau national */}
            <div className="notice-head"><b>{e.anticipated ? 'Élections anticipées' : 'Élections législatives'} — {OUT[e.outcome]}</b><span>{monthLabel(e.month, snap.startYear)}</span></div>
            <p className="small">{e.text}</p>
            <table className="table"><thead><tr><th>Parti</th><th>Voix</th><th>Sièges</th></tr></thead>
              <tbody>{PARTIES.map((d) => <tr key={d.id}><td>{d.name}</td><td>{pct(e.shares[d.id])}</td><td>{e.seats[d.id]}</td></tr>)}</tbody>
            </table>
            {e.districts && e.districts.length > 0 && <Districts e={e} />}
          </div>
        ))}
      </Section>
    </>
  );
}
