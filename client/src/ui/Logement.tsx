// Ministère du Logement et de l'Urbanisme : parc, prix, loyers, vacance, construction, rénovation, plans.
import { useState } from 'react';
import { HOUSING_CONST } from '../../../shared/sim/housing';
import { useStore } from '../store';
import { serviceAction } from '../net';
import { dec1, eur, int, money, pct, people } from '../format';
import { Drawer, Kpi, Meter, Section, Tabs } from './common';
import { LineChart } from './charts';
import { BudgetSlider, Lever, ProgrammeBox, SitesList, usePriceRel } from './servicesCommon';

export function LogementPanel() {
  const [tab, setTab] = useState<'marche' | 'politique' | 'investir'>('marche');
  return (
    <Drawer title="Ministère du Logement et de l'Urbanisme" icon="logement" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['marche', 'Marché du logement'], ['politique', 'Leviers'], ['investir', 'Plans & quartiers']]} />
      {tab === 'marche' && <Marche />}
      {tab === 'politique' && <Politique />}
      {tab === 'investir' && <Investir />}
    </Drawer>
  );
}

function Marche() {
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  const L = snap?.housing;
  if (!snap || !L) return null;
  const crisis = L.tension > 1.03;
  return (
    <>
      {crisis && <p className="bad"><b>Crise du logement :</b> l'offre ne suit pas la demande ({pct(L.tension - 1)} de ménages en excès). Les prix et les loyers montent, la natalité et l'attractivité reculent.</p>}
      <div className="kpis">
        <Kpi label="Situation du logement" value={`${Math.round(L.quality * 100)}/100`} tone={L.quality < 0.6 ? 'bad' : L.quality > 0.78 ? 'good' : 'warn'} />
        <Kpi label="Tension" value={dec1(L.tension * 100)} sub="ménages / logements disponibles (100 = équilibre)" tone={crisis ? 'bad' : undefined} />
        <Kpi label="Prix moyen" value={`${eur(L.avgPrice)}/m²`} />
        <Kpi label="Loyer moyen" value={`${dec1(L.avgRent)} €/m²/mois`} />
        <Kpi label="Taux d'effort" value={pct(L.effortRate)} sub="part du revenu des locataires" />
        <Kpi label="Vacance" value={pct(L.vacancy)} sub={`dont rotation ${pct(L.structuralVacancy)}`} hint="La taxe sur les logements vacants (Fiscalité) remet des logements sur le marché." />
        <Kpi label="Parc" value={people(L.stock)} sub={`dont ${pct(L.social / L.stock)} sociaux`} />
        <Kpi label="Ménages" value={people(L.households)} sub={`${HOUSING_CONST.householdSize.toString().replace('.', ',')} pers./ménage`} />
        <Kpi label="Densité" value={`${int(L.density)} hab./km²`} />
      </div>
      <Section title="Construction et rénovation (logements/an)">
        <table className="table"><tbody>
          <tr><td>Mises en chantier privées</td><td>{int(L.startsPrivate)}</td></tr>
          <tr><td>Mises en chantier sociales</td><td>{int(L.startsSocial)}</td></tr>
          <tr><td>Livraisons</td><td>{int(L.completions)}</td></tr>
          <tr><td>Rénovations énergétiques</td><td>{int(L.renovations)}</td></tr>
          <tr><td>Demandeurs de logement social</td><td>{int(L.socialWaiting)}</td></tr>
          <tr><td>Dépense publique (hors aides)</td><td>{money(L.publicSpend)}/an</td></tr>
        </tbody></table>
        <p className="small">Logements performants <Meter value={L.efficient} max={1} tone="var(--good)" /> {pct(L.efficient)} · consommation d'énergie des logements : {Math.round(L.energyFactor * 100)} (100 = départ)</p>
      </Section>
      <Section title="Logements par quartier">
        <table className="table">
          <thead><tr><th>Quartier</th><th>Habitants</th><th>Logements</th></tr></thead>
          <tbody>{snap.cities.map((c, k) => ({ c, k })).sort((a, b) => b.c.population - a.c.population).slice(0, 12).map(({ c, k }) => (
            <tr key={k}><td>{country?.cities[k]?.name}</td><td>{people(c.population)}</td><td>{people(c.housingUnits)}</td></tr>
          ))}</tbody>
        </table>
      </Section>
      <Section title="Évolution">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['all', 'Tout']]} />
        <LineChart years={years} height={150} fmt={eur} series={[{ key: 'p', label: 'Prix (€/m²)', values: history.logement_prix ?? [], color: '#ef476f' }]} />
        <LineChart years={years} height={150} fmt={(v) => dec1(v * 100)} series={[{ key: 't', label: 'Tension (100 = équilibre)', values: history.logement_tension ?? [], color: '#ffd166' }]} />
      </Section>
    </>
  );
}

function Politique() {
  const pr = usePriceRel();
  return (
    <>
      <Section title="Aides au logement">
        <BudgetSlider line="logement" label="Aides personnelles au logement (€/an)" />
      </Section>
      <Section title="Urbanisme et marché" hint="Les réformes entrent en vigueur au 1er du mois suivant ; un chantier de logements dure environ 2 ans.">
        <Lever sub="housing" k="permits" label="Foncier constructible et permis" min={0.1} max={2.5} step={0.05} fmt={(v) => `${Math.round(v * 100)} %`} hint="Plafonne la construction privée : un urbanisme restrictif crée une pénurie." />
        <Lever sub="housing" k="rentControl" label="Encadrement des loyers" min={0} max={1} step={0.05} fmt={(v) => (v === 0 ? 'aucun' : `${Math.round(v * 100)} %`)} hint="Limite la hausse des loyers, mais freine la construction et la rénovation locatives." />
        <Lever sub="housing" k="buildSubsidy" label="Prime à la construction neuve" min={0} max={60000} step={1000} fmt={eur} hint="Par logement neuf, payée par l'État." />
        <Lever sub="housing" k="greenStandard" label="Part des logements neufs aux normes écologiques" min={0} max={1} step={0.05} fmt={(v) => pct(v)} hint="Bâtiments bas carbone : surcoût de construction, consommation réduite." />
      </Section>
      <Section title="Programmes annuels de l'État">
        <Lever sub="housing" k="socialProgram" label="Logements sociaux construits par an" min={0} max={50000} step={500} fmt={int} hint={`≈ ${money(HOUSING_CONST.socialUnitCost * pr)} par logement.`} />
        <Lever sub="housing" k="renovationProgram" label="Rénovations énergétiques publiques par an" min={0} max={100000} step={1000} fmt={int} hint={`≈ ${money(HOUSING_CONST.renovationCost * pr)} par logement.`} />
        <Lever sub="housing" k="insulationSubsidy" label="Subvention à l'isolation des logements privés" min={0} max={0.8} step={0.05} fmt={(v) => pct(v)} />
      </Section>
    </>
  );
}

function Investir() {
  const snap = useStore((s) => s.snap);
  const pr = usePriceRel();
  const [kind, setKind] = useState<'renovation' | 'social'>('renovation');
  const [units, setUnits] = useState(50000);
  const [months, setMonths] = useState(36);
  const L = snap?.housing;
  if (!L) return null;
  const unit = kind === 'renovation' ? HOUSING_CONST.renovationCost : HOUSING_CONST.socialUnitCost;
  return (
    <>
      <Section title="Plan ponctuel" hint="Par exemple : « rénover 50 000 logements en 3 ans ». Le coût est payé au fil de l'eau sur la trésorerie.">
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'renovation' | 'social')}>
            <option value="renovation">Rénovation énergétique</option>
            <option value="social">Construction de logements sociaux</option>
          </select>
          <input type="number" min={100} step={1000} value={units} onChange={(e) => setUnits(Number(e.target.value))} style={{ width: 110 }} /> logements en
          <input type="number" min={6} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ width: 60 }} /> mois
          <button className="btn primary" onClick={() => serviceAction({ type: 'planLogement', kind, units, months })}>Lancer le plan</button>
        </div>
        <p className="small muted">Coût estimé : {money(units * unit * pr)}.</p>
        {L.plans.length > 0 && (
          <table className="table">
            <thead><tr><th>Plan</th><th>Avancement</th><th /></tr></thead>
            <tbody>{L.plans.map((p) => (
              <tr key={p.id}><td>{p.kind === 'renovation' ? 'Rénovation' : 'Logements sociaux'} : {int(p.total)}</td><td><Meter value={p.done} max={p.total} tone="var(--accent)" /> {int(p.done)}</td>
                <td><button className="btn ghost" onClick={() => serviceAction({ type: 'annulerPlanLogement', planId: p.id })}>Arrêter</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </Section>
      <ProgrammeBox title="Nouveaux quartiers et résidences" types={['zone_residentielle', 'eco_quartier', 'logements_sociaux']} />
      <Section title="Chantiers"><SitesList types={['zone_residentielle', 'eco_quartier', 'logements_sociaux']} /></Section>
    </>
  );
}
