// Ministère des Affaires étrangères et du Commerce extérieur de la cité-État : États voisins, relations, accords, droits de douane.
import { useState } from 'react';
import { AGREEMENT_EFFECTS, AGREEMENT_MIN_RELATION, AGREEMENT_NAMES, type AgreementKind } from '../../../shared/sim/international';
import { useStore } from '../store';
import { govAction } from '../net';
import { dec2, money, pct } from '../format';
import { Drawer, Kpi, Meter, Section, Slider, Tabs, usePolicy } from './common';
import { LineChart, monthLabel } from './charts';
import { Icon } from './Icon';

const KINDS: AgreementKind[] = ['commerce', 'energie', 'climat', 'investissement'];

export function InternationalPanel() {
  const [tab, setTab] = useState<'voisins' | 'commerce'>('voisins');
  return (
    <Drawer title="Affaires étrangères & commerce extérieur" icon="international" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['voisins', 'États voisins & accords'], ['commerce', 'Commerce & droits de douane']]} />
      {tab === 'voisins' ? <Voisins /> : <Commerce />}
    </Drawer>
  );
}

function Voisins() {
  const snap = useStore((s) => s.snap);
  const I = snap?.international;
  if (!snap || !I) return null;
  return (
    <>
      <div className="kpis">
        <Kpi label="Relations moyennes" value={`${Math.round(I.avgRelation)}/100`} tone={I.avgRelation < 40 ? 'bad' : I.avgRelation > 65 ? 'good' : undefined} hint="Moyenne pondérée par nos exportations." />
        <Kpi label="Demande étrangère" value={`× ${dec2(I.demandFactor)}`} hint="Facteur appliqué à la demande adressée aux exportations de la cité-État, port et place financière compris (conjoncture des États voisins, accords, chocs)." />
        <Kpi label="Prix de l'énergie importée" value={`× ${dec2(I.energyFactor)}`} hint="Facteur appliqué à l'indice du prix de l'énergie, presque entièrement importée par la cité-État (États exportateurs, accords énergétiques, crises)." />
        <Kpi label="Représailles commerciales" value={pct(I.retaliation)} tone={I.retaliation > 0.02 ? 'bad' : undefined} />
      </div>
      {I.neighbors.map((n) => (
        <Section key={n.id} title={`${n.flag} ${n.name}`}>
          <div className="kpis compact">
            <Kpi label="PIB" value={money(n.gdp)} sub="€/an" />
            <Kpi label="Croissance" value={pct(n.growth)} tone={n.growth < 0 ? 'bad' : undefined} />
            <Kpi label="Conjoncture" value={`${n.gap >= 0 ? '+' : ''}${pct(n.gap)}`} hint="Écart de production : au-dessus de 0, cet État achète davantage nos biens et services." />
            <Kpi label="Part de nos exportations" value={pct(n.exportWeight, 0)} />
            <Kpi label="Énergie" value={n.energyExporter ? `exportateur (indice ${dec2(n.energyPrice)})` : 'importateur'} />
            <Kpi label="Droits de rétorsion" value={pct(n.retaliation)} tone={n.retaliation > 0.01 ? 'bad' : undefined} hint={`Cet État tolère jusqu'à ${pct(n.tolerance)} de droits de douane avant de riposter.`} />
          </div>
          <div className="bar-row"><span className="bar-label">Relations diplomatiques</span><div style={{ flex: 1 }}><Meter value={n.relation} /></div><span className="bar-val">{Math.round(n.relation)}/100</span></div>
          <table className="table">
            <tbody>
              {KINDS.map((k) => {
                const has = n.agreements.includes(k);
                const blocked = k === 'energie' && !n.energyExporter;
                return (
                  <tr key={k}>
                    <td><b>{AGREEMENT_NAMES[k]}</b><br /><span className="muted small">{AGREEMENT_EFFECTS[k]} Relation requise : {AGREEMENT_MIN_RELATION[k]}.</span></td>
                    <td>{has
                      ? <button className="btn ghost" onClick={() => govAction({ type: 'rompreAccord', neighbor: n.id, kind: k })}>Dénoncer</button>
                      : <button className="btn" disabled={blocked} onClick={() => govAction({ type: 'accord', neighbor: n.id, kind: k })}>{blocked ? 'Non exportateur' : 'Proposer'}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn" onClick={() => govAction({ type: 'diplomatie', neighbor: n.id })}><Icon name="avion" size={14} />Mission diplomatique (relations +8)</button>
        </Section>
      ))}
      {I.log.length > 0 && (
        <Section title="Journal diplomatique">
          {[...I.log].reverse().slice(0, 12).map((l, i) => <p key={i} className="small"><span className="muted">{monthLabel(l.month, snap.startYear)}</span> — {l.text}</p>)}
        </Section>
      )}
    </>
  );
}

function Commerce() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const { policy, effective, edit } = usePolicy();
  const [years, setYears] = useState<number | 'all'>(10);
  if (!snap || !policy || !effective) return null;
  const A = snap.accounts;
  const tariff = policy.trade?.tariff ?? 0;
  return (
    <>
      <div className="kpis">
        <Kpi label="Exportations" value={money(A.exports)} sub={`${pct(A.exports / A.gdp)} du PIB`} />
        <Kpi label="Importations" value={money(A.imports)} sub={`${pct(A.imports / A.gdp)} du PIB`} />
        <Kpi label="Solde commercial" value={money(A.exports - A.imports)} tone={A.exports >= A.imports ? 'good' : 'bad'} />
        <Kpi label="Recettes douanières" value={money(A.revenue.douanes ?? 0)} sub="€/an" />
      </div>
      <Section title="Droits de douane" hint="Renchérissent et réduisent les importations (élasticité 1,5), relèvent les prix (≈ 15 % de la consommation est importée), dégradent les relations et déclenchent des représailles sur nos exportations au-delà du seuil toléré par chaque voisin. Au-dessus de 5 %, les accords de libre-échange sont suspendus. Création ou variation ≥ 3 points : projet de loi.">
        <Slider label="Droits de douane moyens sur les importations" value={tariff} min={0} max={0.4} step={0.005} fmt={(v) => pct(v)} current={effective.trade?.tariff ?? 0}
          onChange={(v) => edit((p) => { p.trade = { tariff: v }; })} />
        <p className="muted small">Validez avec « Adopter les réformes » dans la barre des réformes.</p>
      </Section>
      <Section title="Évolution">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['all', 'Tout']]} />
        <LineChart years={years} fmt={money} startYear={snap.startYear} series={[
          { key: 'x', label: 'Exportations', values: history.exports ?? [], color: '#06d6a0' },
          { key: 'm', label: 'Importations', values: history.imports ?? [], color: '#ef476f' },
        ]} />
        <LineChart years={years} height={130} fmt={(v) => pct(v)} startYear={snap.startYear} series={[
          { key: 't', label: 'Droits de douane', values: history.tariff ?? [], color: '#ffd166' },
          { key: 'r', label: 'Représailles', values: history.retaliation ?? [], color: '#ef476f' },
        ]} />
      </Section>
    </>
  );
}
