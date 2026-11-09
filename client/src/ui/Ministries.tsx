// Ministères : Finances (budget & dette), Travail, Économie, Population & société.
import { useState } from 'react';
import { BUDGET_DEFS, CATEGORY_IDS, CATEGORY_NAMES, SECTORS } from '../../../shared/sim/data';
import { FACTOR_NAMES, type Factor } from '../../../shared/sim/social';
import { useStore } from '../store';
import { financeAction } from '../net';
import { dec1, eur, int, money, pct, people } from '../format';
import { Bars, Drawer, Kpi, Meter, Section, Slider, Tabs, Toggle, usePolicy } from './common';
import { LineChart, Pyramid } from './charts';
import { REVENUE_LABELS, SPENDING_LABELS } from './indicators';
import { camApi } from '../game/world';
import { Icon } from './Icon';

// ---------- Finances ----------
export function FinancesPanel() {
  const [tab, setTab] = useState<'budget' | 'dette' | 'synthese'>('synthese');
  return (
    <Drawer title="Ministère des Finances" icon="finances" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['synthese', 'Synthèse'], ['budget', 'Budget & dépenses'], ['dette', 'Dette & trésorerie']]} />
      {tab === 'synthese' && <FinanceSummary />}
      {tab === 'budget' && <Budget />}
      {tab === 'dette' && <Debt />}
    </Drawer>
  );
}

function FinanceSummary() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  if (!snap) return null;
  const A = snap.accounts;
  const F = snap.finance;
  const pop = snap.demography.cohorts.reduce((s, v) => s + v, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Recettes totales" value={money(A.revenueTotal)} sub={`${pct(A.revenueTotal / A.gdp)} du PIB · €/an`} />
        <Kpi label="Dépenses totales" value={money(A.spendingTotal)} sub={`${pct(A.spendingTotal / A.gdp)} du PIB · €/an`} />
        <Kpi label={A.balance >= 0 ? 'Excédent' : 'Déficit'} value={money(Math.abs(A.balance))} sub={`${pct(Math.abs(A.balance) / A.gdp)} du PIB`} tone={A.balance >= 0 ? 'good' : A.balance / A.gdp < -0.04 ? 'bad' : 'warn'} />
        <Kpi label="Solde primaire" value={money(A.primaryBalance)} sub="hors intérêts" hint="Solde avant paiement des intérêts de la dette." />
        <Kpi label="Dette publique" value={money(F.debt)} sub={`${pct(F.debt / A.gdp)} du PIB`} tone={F.debt / A.gdp > 1 ? 'bad' : undefined} />
        <Kpi label="Dette par habitant" value={eur(F.debt / pop)} />
        <Kpi label="Charge des intérêts" value={money(A.spending.interets)} sub={`taux moyen ${pct(F.avgRate, 2)}`} />
        <Kpi label="Trésorerie" value={money(F.cash)} sub={`réserve ${money(F.reserve)}`} />
        <Kpi label="Capacité d'investissement" value={money(Math.max(0, F.cash + F.reserve - snap.policy.finance.minCash))} hint="Liquidités mobilisables au-delà du coussin de trésorerie minimal." />
      </div>
      <Section title="Recettes et dépenses">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['50', '50 ans'], ['all', 'Tout']]} />
        <LineChart years={years} fmt={money} series={[
          { key: 'r', label: 'Recettes', values: history.revenue ?? [], color: '#06d6a0' },
          { key: 'd', label: 'Dépenses', values: history.spending ?? [], color: '#ef476f' },
        ]} />
        <LineChart years={years} fmt={(v) => pct(v)} height={140} series={[
          { key: 'dr', label: 'Dette / PIB', values: history.debtRatio ?? [], color: '#ffd166' },
          { key: 'df', label: 'Déficit / PIB', values: history.deficitRatio ?? [], color: '#ef476f' },
        ]} />
      </Section>
      <div className="cols">
        <Section title="Recettes (€/an)"><Bars fmt={money} items={Object.entries(A.revenue).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: REVENUE_LABELS[k] ?? k, value: v, color: '#06d6a0' }))} /></Section>
        <Section title="Dépenses (€/an)"><Bars fmt={money} items={Object.entries(A.spending).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: SPENDING_LABELS[k] ?? k, value: v, color: '#ef476f' }))} /></Section>
      </div>
    </>
  );
}

function Budget() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  const [view, setView] = useState<'annuel' | 'mensuel'>('annuel');
  if (!policy || !effective || !snap) return null;
  const A = snap.accounts;
  const div = view === 'mensuel' ? 12 : 1;
  const fmtB = (v: number) => money(v / div);
  const total = BUDGET_DEFS.reduce((s, b) => s + policy.budget[b.id], 0);
  const delta = total - BUDGET_DEFS.reduce((s, b) => s + effective.budget[b.id], 0);
  return (
    <>
      <div className="row between">
        <Tabs value={view} onChange={setView} tabs={[['annuel', 'Budget annuel'], ['mensuel', 'Budget mensuel']]} />
        <span className="muted">Dépenses discrétionnaires : <b>{fmtB(total)}</b> {Math.abs(delta) > 1 && <em className={delta > 0 ? 'bad' : 'good'}>({delta > 0 ? '+' : ''}{fmtB(delta)})</em>}</span>
      </div>
      <Section title="Dépenses discrétionnaires des ministères" hint="Les services publics s'ajustent progressivement (recrutements, constructions) : ~3,5 % de l'écart par mois. La qualité dépend de la dépense par habitant, corrigée du coût salarial.">
        {BUDGET_DEFS.map((b) => {
          const q = (snap.services as unknown as Record<string, number>)[b.id];
          return (
            <div key={b.id} className="budget-line">
              <Slider label={`${b.icon} ${b.name}`} value={policy.budget[b.id]} current={effective.budget[b.id]} min={0} max={Math.max(effective.budget[b.id] * 3, 1e9)} step={Math.max(1e7, Math.round(A.gdp * 0.0005 / 1e7) * 1e7)}
                fmt={(v) => `${fmtB(v)} · ${pct(v / A.gdp)} du PIB`} onChange={(v) => edit((p) => { p.budget[b.id] = v; })} />
              {q !== undefined && <div className="quality">Qualité du service <Meter value={q * 100} /> <b>{Math.round(q * 100)}/100</b></div>}
            </div>
          );
        })}
      </Section>
      <Section title="Dépenses de prestations (déterminées par les règles)" hint="Modifiables via le ministère du Travail : âge et taux des retraites, allocations chômage, prestations familiales.">
        <Bars fmt={fmtB} items={(['retraites', 'chomage', 'allocations', 'creditActivite', 'interets'] as const).map((k) => ({ label: SPENDING_LABELS[k], value: A.spending[k], color: '#8d99ae' }))} />
      </Section>
      <Section title="Options">
        <Toggle label="Indexation automatique (budgets sur les salaires, barème et SMIC sur l'inflation)" value={policy.finance.indexBudgets} onChange={(v) => edit((p) => { p.finance.indexBudgets = v; })} />
        <Toggle label="Émission automatique d'obligations si la trésorerie passe sous le seuil" value={policy.finance.autoBorrow} onChange={(v) => edit((p) => { p.finance.autoBorrow = v; })} hint="Sans émission automatique, un découvert déclenche un emprunt d'urgence majoré de 1 point." />
        <Slider label="Trésorerie minimale" value={policy.finance.minCash} current={effective.finance.minCash} min={0} max={A.gdp * 0.1} step={Math.round(A.gdp * 0.001)} fmt={money} onChange={(v) => edit((p) => { p.finance.minCash = v; })} />
      </Section>
    </>
  );
}

function Debt() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const [amount, setAmount] = useState(5);
  if (!snap) return null;
  const F = snap.finance;
  const A = snap.accounts;
  const amt = amount * 1e9;
  return (
    <>
      <div className="kpis">
        <Kpi label="Dette brute" value={money(F.debt)} sub={`${pct(F.debt / A.gdp)} du PIB`} />
        <Kpi label="Taux moyen de la dette" value={pct(F.avgRate, 2)} hint="Le stock se renouvelle d'environ 1/96 par mois au taux de marché." />
        <Kpi label="Taux d'emprunt actuel (10 ans)" value={pct(F.marketRate, 2)} sub={`taux directeur ${pct(snap.macro.policyRate, 2)}`} />
        <Kpi label="Trésorerie" value={money(F.cash)} />
        <Kpi label="Fonds de réserve" value={money(F.reserve)} sub="rémunéré au taux directeur" />
      </div>
      <Section title="Opérations financières (effet immédiat)">
        <Slider label="Montant de l'opération" value={amount} min={0.5} max={Math.max(5, Math.round(A.gdp * 0.1 / 1e9))} step={0.5} fmt={(v) => `${dec1(v)} Md€`} onChange={setAmount} />
        <div className="btn-row">
          <button className="btn" onClick={() => financeAction({ type: 'bonds', amount: amt })}><Icon name="parchemin" size={14} />Émettre des obligations</button>
          <button className="btn" disabled={amt > F.cash} onClick={() => financeAction({ type: 'repay', amount: amt })}><Icon name="monnaie" size={14} />Rembourser la dette</button>
          <button className="btn" disabled={amt > F.cash} onClick={() => financeAction({ type: 'toReserve', amount: amt })}><Icon name="coffre" size={14} />Placer en réserve</button>
          <button className="btn" disabled={amt > F.reserve} onClick={() => financeAction({ type: 'fromReserve', amount: amt })}><Icon name="retour" size={14} />Retirer de la réserve</button>
        </div>
      </Section>
      <Section title="Historique">
        <LineChart years={20} fmt={money} series={[{ key: 'debt', label: 'Dette', values: history.debt ?? [], color: '#ffd166' }, { key: 'cash', label: 'Trésorerie', values: history.cash ?? [], color: '#4cc9f0' }]} />
        <LineChart years={20} fmt={(v) => pct(v, 2)} height={130} series={[{ key: 'mr', label: "Taux d'emprunt", values: history.marketRate ?? [], color: '#ef476f' }, { key: 'pr', label: 'Taux directeur', values: history.policyRate ?? [], color: '#8d99ae' }]} />
      </Section>
      <Section title="Dernières émissions">
        <table className="table"><thead><tr><th>Date</th><th>Montant</th><th>Taux</th><th>Type</th></tr></thead>
          <tbody>{[...F.bondsIssued].reverse().slice(0, 12).map((b, i) => <tr key={i}><td>{monthName(b.month, snap.startYear)}</td><td>{money(b.amount)}</td><td>{pct(b.rate, 2)}</td><td>{b.auto ? 'automatique' : 'décision'}</td></tr>)}</tbody>
        </table>
      </Section>
    </>
  );
}
function monthName(m: number, y: number) { return `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][m % 12]} ${y + Math.floor(m / 12)}`; }

// ---------- Travail ----------
export function TravailPanel() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  if (!policy || !effective || !snap) return null;
  const D = snap.demography;
  const A = snap.accounts;
  const L = policy.labour;
  const E = effective.labour;
  const vacancies = snap.sectors.reduce((s, x) => s + x.vacancies, 0);
  return (
    <Drawer title="Ministère du Travail" icon="travail" wide>
      <div className="kpis">
        <Kpi label="Actifs" value={people(D.labourForce)} />
        <Kpi label="Chômeurs" value={people(D.unemployed)} />
        <Kpi label="Taux de chômage" value={pct(D.unemployed / D.labourForce)} tone={D.unemployed / D.labourForce > 0.1 ? 'bad' : D.unemployed / D.labourForce < 0.06 ? 'good' : undefined} />
        <Kpi label="Emplois vacants" value={people(vacancies)} hint="Écart entre l'emploi souhaité par les entreprises et l'emploi actuel." />
        <Kpi label="Salaire moyen" value={eur(A.meanWage)} sub="brut/an" />
        <Kpi label="Salaire médian" value={eur(A.medianWage)} sub="brut/an" />
        <Kpi label="Entreprises" value={int(snap.sectors.reduce((s, x) => s + x.firms, 0))} />
        <Kpi label="Faillites" value={int(A.failures)} sub="par an" />
      </div>
      <Section title="Droit du travail et coût du travail">
        <Slider label="Salaire minimum brut mensuel" value={L.minWage} current={E.minWage} min={800} max={4000} step={10} fmt={eur} onChange={(v) => edit((p) => { p.labour.minWage = v; })} hint="Relève les bas salaires mais augmente le coût du travail des emplois peu qualifiés." />
        <Slider label="Durée légale hebdomadaire" value={L.hours} current={E.hours} min={30} max={45} step={0.5} fmt={(v) => `${dec1(v)} h`} onChange={(v) => edit((p) => { p.labour.hours = v; })} hint="Moins d'heures : moins de production par salarié, plus d'emplois partagés et de bien-être." />
        <Slider label="Aide à l'embauche (par emploi peu qualifié)" value={L.hiringAid} current={E.hiringAid} min={0} max={8000} step={100} fmt={(v) => eur(v) + '/an'} onChange={(v) => edit((p) => { p.labour.hiringAid = v; })} />
        <p className="muted small">Charges patronales et salariales : voir Fiscalité → G. Cotisations.</p>
      </Section>
      <Section title="Assurance chômage et formation">
        <Slider label="Taux de remplacement des allocations" value={L.benefitRate} current={E.benefitRate} min={0} max={0.9} step={0.01} fmt={(v) => pct(v, 0)} onChange={(v) => edit((p) => { p.labour.benefitRate = v; })} />
        <Slider label="Durée maximale d'indemnisation" value={L.benefitMonths} current={E.benefitMonths} min={0} max={48} step={1} fmt={(v) => `${v} mois`} onChange={(v) => edit((p) => { p.labour.benefitMonths = v; })} hint="Des droits longs protègent mais augmentent le chômage frictionnel." />
        <Slider label="Budget de formation professionnelle et reconversion" value={policy.budget.formation} current={effective.budget.formation} min={0} max={effective.budget.formation * 4 + 1e8} step={5e7} fmt={money} onChange={(v) => edit((p) => { p.budget.formation = v; })} hint="Réduit le chômage structurel et augmente la productivité." />
      </Section>
      <Section title="Retraites et prestations familiales">
        <Slider label="Âge légal de départ à la retraite" value={L.retirementAge} current={E.retirementAge} min={58} max={70} step={0.25} fmt={(v) => `${dec1(v)} ans`} onChange={(v) => edit((p) => { p.labour.retirementAge = v; })} />
        <Slider label="Taux de remplacement des pensions" value={L.pensionRate} current={E.pensionRate} min={0.3} max={0.8} step={0.005} fmt={(v) => pct(v)} onChange={(v) => edit((p) => { p.labour.pensionRate = v; })} hint="Pension moyenne brute rapportée au salaire moyen brut." />
        <Slider label="Allocation familiale par enfant" value={L.familyAllowance} current={E.familyAllowance} min={0} max={500} step={5} fmt={(v) => eur(v) + '/mois'} onChange={(v) => edit((p) => { p.labour.familyAllowance = v; })} />
      </Section>
      <Section title="Évolution">
        <LineChart years={20} fmt={(v) => pct(v)} series={[{ key: 'u', label: 'Chômage', values: history.unemployment ?? [], color: '#ef476f' }]} />
        <LineChart years={20} fmt={eur} height={140} series={[{ key: 'mw', label: 'Salaire moyen', values: history.meanWage ?? [], color: '#06d6a0' }, { key: 'md', label: 'Salaire médian', values: history.medianWage ?? [], color: '#4cc9f0' }]} />
      </Section>
    </Drawer>
  );
}

// ---------- Économie ----------
export function EconomiePanel() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  if (!snap) return null;
  const A = snap.accounts;
  const M = snap.macro;
  const pop = snap.demography.cohorts.reduce((s, v) => s + v, 0);
  const last = snap.last;
  return (
    <Drawer title="Ministère de l'Économie" icon="economie" wide>
      <div className="kpis">
        <Kpi label="PIB" value={money(A.gdp)} sub="€ courants/an" />
        <Kpi label="PIB par habitant" value={eur(A.gdp / pop)} />
        <Kpi label="Croissance réelle" value={pct(last.growth ?? 0)} sub="sur 12 mois" tone={(last.growth ?? 0) < 0 ? 'bad' : (last.growth ?? 0) > 0.02 ? 'good' : undefined} />
        <Kpi label={M.inflation < 0 ? 'Déflation' : 'Inflation'} value={pct(M.inflation)} sub="sur 12 mois" tone={M.inflation > 0.05 || M.inflation < 0 ? 'bad' : undefined} />
        <Kpi label="Productivité" value={pct(M.productivityGrowth, 2)} sub="gain annuel" />
        <Kpi label="Consommation" value={money(A.consumption)} sub={`${pct(A.consumptionNet / A.gdp)} du PIB (hors taxes)`} />
        <Kpi label="Épargne des ménages" value={money(A.savings)} sub={`taux ${pct(A.savings / Math.max(1, A.disposableIncome))}`} />
        <Kpi label="Investissement" value={money(A.investment)} sub={`${pct(A.investment / A.gdp)} du PIB`} />
        <Kpi label="Exportations" value={money(A.exports)} />
        <Kpi label="Importations" value={money(A.imports)} />
        <Kpi label="Balance commerciale" value={money(A.exports - A.imports)} tone={A.exports - A.imports < 0 ? 'warn' : 'good'} />
        <Kpi label="Pouvoir d'achat" value={eur(A.disposableIncome / pop / M.priceLevel)} sub="revenu disponible/hab. en € de 2030" />
        <Kpi label="Coût de la vie" value={`${dec1(M.priceLevel * 100)}`} sub="indice des prix (2030 = 100)" />
        <Kpi label="Taux directeur" value={pct(M.policyRate, 2)} />
      </div>
      <Section title="Tendances">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['50', '50 ans'], ['all', 'Tout']]} />
        <LineChart years={years} fmt={(v) => pct(v)} series={[
          { key: 'g', label: 'Croissance', values: history.growth ?? [], color: '#06d6a0' },
          { key: 'i', label: 'Inflation', values: history.inflation ?? [], color: '#ef476f' },
          { key: 'u', label: 'Chômage', values: history.unemployment ?? [], color: '#ffd166' },
        ]} />
      </Section>
      <Section title="Secteurs économiques" hint="Valeur ajoutée annuelle, emploi, salaire moyen de base, marge (bénéfice avant impôt / valeur ajoutée), émissions directes.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Secteur</th><th>Entreprises</th><th>Valeur ajoutée</th><th>Emplois</th><th>Salaire</th><th>Marge</th><th>Faillites/an</th><th>CO₂</th></tr></thead>
            <tbody>
              {snap.sectors.map((s, i) => (
                <tr key={i}>
                  <td><Icon name={SECTORS[i].icon} size={15} />{SECTORS[i].name}</td>
                  <td>{int(s.firms)}</td>
                  <td>{money(s.output)}</td>
                  <td>{people(s.employees)}</td>
                  <td>{eur(s.wage)}</td>
                  <td className={s.profit < 0 ? 'bad' : ''}>{pct(s.profit / Math.max(1, s.output))}</td>
                  <td>{int(s.failures * 12 / 12)}</td>
                  <td>{dec1((A.emissionsBySector[i] ?? 0) / 1e6)} Mt</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Pour développer un secteur : subventions, crédits d'impôt, budget de recherche, fiscalité de la consommation (TVA par catégorie). Les entreprises ouvrent, recrutent, investissent ou font faillite selon leur rentabilité.</p>
      </Section>
    </Drawer>
  );
}

// ---------- Population & société ----------
export function PopulationPanel() {
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  const set = useStore((s) => s.set);
  const [tab, setTab] = useState<'satisfaction' | 'demo' | 'villes'>('satisfaction');
  if (!snap || !country) return null;
  const D = snap.demography;
  const S = snap.satisfaction;
  const pop = D.cohorts.reduce((s, v) => s + v, 0);
  return (
    <Drawer title="Population & société" icon="population" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['satisfaction', 'Satisfaction'], ['demo', 'Démographie'], ['villes', 'Quartiers']]} />
      {tab === 'satisfaction' && (
        <>
          <div className="kpis">
            <Kpi label="Satisfaction générale" value={`${dec1(S.overall)}/100`} tone={S.overall < 40 ? 'bad' : S.overall > 60 ? 'good' : 'warn'} />
            <Kpi label="Confiance dans le gouvernement" value={`${dec1(S.trust)}/100`} />
            <Kpi label="Risque de manifestations" value={pct(S.protestRisk, 0)} tone={S.protestRisk > 0.5 ? 'bad' : undefined} />
            <Kpi label="Risque de grèves" value={pct(S.strikeRisk, 0)} tone={S.strikeRisk > 0.5 ? 'bad' : undefined} />
            <Kpi label="Risque de troubles sociaux" value={pct(S.unrestRisk, 0)} tone={S.unrestRisk > 0.3 ? 'bad' : undefined} />
            <Kpi label="Inégalités (Gini)" value={snap.accounts.gini.toFixed(3).replace('.', ',')} />
            <Kpi label="Taux de pauvreté" value={pct(snap.accounts.poverty)} />
          </div>
          <div className="cols">
            <Section title="Par catégorie sociale">
              {CATEGORY_IDS.map((c) => (
                <div key={c} className="sat-row"><span>{CATEGORY_NAMES[c]} <em className="muted">{people(D.categories[c] ?? 0)}</em></span><Meter value={S.byCategory[c] ?? 0} /><b>{Math.round(S.byCategory[c] ?? 0)}</b></div>
              ))}
            </Section>
            <Section title="Facteurs de satisfaction" hint="Notes sur 100 (moyenne pondérée). Chaque catégorie accorde un poids différent à chaque facteur.">
              {Object.entries(S.factors).map(([k, v]) => (
                <div key={k} className="sat-row"><span>{FACTOR_NAMES[k as Factor] ?? k}</span><Meter value={v} /><b>{Math.round(v)}</b></div>
              ))}
            </Section>
          </div>
        </>
      )}
      {tab === 'demo' && (
        <>
          <div className="kpis">
            <Kpi label="Population" value={people(pop)} />
            <Kpi label="Naissances" value={int(D.births)} sub="par an" />
            <Kpi label="Décès" value={int(D.deaths)} sub="par an" />
            <Kpi label="Solde migratoire" value={int(D.migration)} sub="par an" />
            <Kpi label="Fécondité" value={D.fertility.toFixed(2).replace('.', ',')} sub="enfants par femme" />
            <Kpi label="Espérance de vie" value={`${dec1(D.lifeExpectancy)} ans`} />
            <Kpi label="Ménages" value={people(D.households)} />
          </div>
          <div className="cols">
            <Section title="Pyramide des âges"><Pyramid cohorts={D.cohorts} /></Section>
            <Section title="Catégories socio-économiques" hint="Revenus moyens et charge fiscale : voir Fiscalité → Tableau fiscal.">
              <Bars fmt={people} items={CATEGORY_IDS.map((c) => ({ label: CATEGORY_NAMES[c], value: D.categories[c] ?? 0 }))} />
            </Section>
          </div>
        </>
      )}
      {tab === 'villes' && (
        <div className="table-wrap">
          <table className="table clickable">
            <thead><tr><th>Quartier</th><th>Type</th><th>Population</th><th>Chômage</th><th>Revenu/hab.</th><th>Satisfaction</th></tr></thead>
            <tbody>
              {country.cities.map((c, i) => ({ c, s: snap.cities[i] })).sort((a, b) => b.s.population - a.s.population).map(({ c, s }) => (
                <tr key={c.id} onClick={() => { set({ selection: { kind: 'city', id: c.id } }); camApi.focus(c.x, c.z, c.kind === 'metropole' ? 40 : 20); }}>
                  <td>{c.capital && <Icon name="etoile" size={13} title="Capitale" />}{c.name}</td><td>{c.kind === 'metropole' ? 'Grand quartier' : c.kind === 'ville' ? 'Arrondissement' : 'Quartier périphérique'}</td>
                  <td>{people(s.population)}</td><td>{pct(s.unemployment)}</td><td>{eur(s.income)}</td><td>{Math.round(s.satisfaction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}
