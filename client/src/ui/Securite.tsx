// Ministère de l'Intérieur et de la Justice : police, pompiers, justice, prisons, criminalité.
import { useState } from 'react';
import { SECURITY_ROLES } from '../../../shared/sim/security';
import { useStore } from '../store';
import { dec1, eur, int, pct } from '../format';
import { Drawer, Kpi, Meter, Section, Tabs } from './common';
import { LineChart } from './charts';
import { BudgetSlider, idx, Lever, ProgrammeBox, RecruitBox, SitesList } from './servicesCommon';

const TYPES = ['commissariat', 'caserne_pompiers', 'tribunal', 'prison'] as const;

export function SecuritePanel() {
  const [tab, setTab] = useState<'etat' | 'politique' | 'investir'>('etat');
  return (
    <Drawer title="Sécurité & Justice" icon="securite" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['etat', 'Situation'], ['politique', 'Budget & leviers'], ['investir', 'Recruter & construire']]} />
      {tab === 'etat' && <Etat />}
      {tab === 'politique' && <Politique />}
      {tab === 'investir' && <Investir />}
    </Drawer>
  );
}

function Etat() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  const X = snap?.security;
  if (!snap || !X) return null;
  const pop = snap.demography.cohorts.reduce((s, v) => s + v, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Criminalité" value={`${dec1(X.crimeRate)} ‰`} sub="crimes et délits / 1 000 hab./an" tone={X.crimeRate > 58 ? 'bad' : X.crimeRate < 48 ? 'good' : undefined} hint="Liée au chômage, à la pauvreté, au décrochage scolaire, aux effectifs de police, à la justice et à la prévention." />
        <Kpi label="Délinquance juvénile" value={`${Math.round(X.delinquency)}`} sub="100 = référence" />
        <Kpi label="Sentiment de sécurité" value={`${Math.round(X.feeling)}/100`} />
        <Kpi label="Intervention police" value={`${Math.round(X.policeResponse)} min`} />
        <Kpi label="Intervention pompiers" value={`${Math.round(X.fireResponse)} min`} />
        <Kpi label="Délai de jugement" value={`${dec1(X.justiceDelay)} mois`} tone={X.justiceDelay > 18 ? 'bad' : undefined} />
        <Kpi label="Occupation des prisons" value={pct(X.prisonOccupancy, 0)} tone={X.prisonOccupancy > 1.15 ? 'bad' : undefined} sub={`${int(X.prisoners)} détenus / ${int(X.openPlaces)} places`} />
        <Kpi label="Qualité du service" value={`${Math.round(X.quality * 100)}/100`} />
        <Kpi label="Coût par habitant" value={eur(X.costPerCapita)} />
      </div>
      <Section title="Effectifs">
        <table className="table">
          <thead><tr><th>Corps</th><th>En poste</th><th>Postes financés</th><th>Pour 1 000 hab.</th></tr></thead>
          <tbody>
            <tr><td>Policiers et gendarmes</td><td>{int(X.police.staff)}</td><td>{int(X.police.posts)}</td><td>{dec1(X.police.staff / pop * 1000)}</td></tr>
            <tr><td>Pompiers et protection civile</td><td>{int(X.firefighters.staff)}</td><td>{int(X.firefighters.posts)}</td><td>{dec1(X.firefighters.staff / pop * 1000)}</td></tr>
            <tr><td>Magistrats et greffiers</td><td>{int(X.justice.staff)}</td><td>{int(X.justice.posts)}</td><td>{dec1(X.justice.staff / pop * 1000)}</td></tr>
          </tbody>
        </table>
        <p className="small">Moyens de fonctionnement <Meter value={X.supply} max={1.2} /> État des bâtiments <Meter value={X.condition} max={1} /> Prévention <Meter value={X.prevention} max={2} /></p>
      </Section>
      <Section title="Évolution">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['all', 'Tout']]} />
        <LineChart years={years} height={150} fmt={(v) => `${dec1(v)} ‰`} series={[{ key: 'c', label: 'Criminalité', values: history.crime ?? [], color: '#ef476f' }]} />
        <LineChart years={years} height={150} fmt={(v) => `${Math.round(v)} min`} series={[{ key: 'i', label: 'Intervention police', values: history.securite_intervention ?? [], color: '#4cc9f0' }]} />
      </Section>
    </>
  );
}

function Politique() {
  return (
    <>
      <Section title="Budget"><BudgetSlider line="securite" label="Budget sécurité & justice (€/an)" /></Section>
      <Section title="Leviers" hint="Les réformes entrent en vigueur au 1er du mois suivant.">
        <Lever sub="security" k="wageIndex" label="Rémunération des agents" min={0.7} max={1.6} step={0.01} fmt={idx} />
        <Lever sub="security" k="investment" label="Part investissement (véhicules, bâtiments)" min={0} max={0.3} step={0.005} fmt={(v) => pct(v)} />
        <Lever sub="security" k="prevention" label="Part prévention de la délinquance" min={0} max={0.2} step={0.005} fmt={(v) => pct(v)} hint="Médiation, éducateurs : réduit la délinquance après 2 à 3 ans." />
        <Lever sub="security" k="sentencing" label="Sévérité pénale" min={0.5} max={1.6} step={0.05} fmt={idx} hint="Effet dissuasif faible ; augmente le nombre de détenus et la surpopulation carcérale." />
      </Section>
    </>
  );
}

function Investir() {
  const snap = useStore((s) => s.snap);
  const X = snap?.security;
  if (!X || !snap) return null;
  const w = snap.policy.security.wageIndex;
  const role = (id: keyof typeof SECURITY_ROLES, staff: number) => ({ id, label: SECURITY_ROLES[id].label, cost: SECURITY_ROLES[id].cost * X.ref.costScale * w, delay: SECURITY_ROLES[id].delay, staff });
  return (
    <>
      <RecruitBox service="securite" roles={[role('policiers', X.police.staff), role('pompiers', X.firefighters.staff), role('magistrats', X.justice.staff)]} />
      <ProgrammeBox types={[...TYPES]} />
      <Section title="Chantiers"><SitesList types={[...TYPES]} /></Section>
    </>
  );
}
