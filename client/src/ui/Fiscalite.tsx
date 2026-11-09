// Ministère des Finances — menu FISCALITÉ (A à H).
import { useState } from 'react';
import { BRANCHES, BRANCH_NAMES, VAT_CATS, type VatClass } from '../../../shared/sim/data';
import { progressiveTax } from '../../../shared/sim/fiscal';
import { useStore } from '../store';
import { eur, money, pct } from '../format';
import { Bars, Drawer, Kpi, Section, Slider, Tabs, usePolicy } from './common';
import { LineChart } from './charts';
import { REVENUE_LABELS } from './indicators';

type Tab = 'revenu' | 'societes' | 'tva' | 'patrimoine' | 'immobilier' | 'ecologie' | 'cotisations' | 'tableau';
const p1 = (v: number) => pct(v, 1);

export function FiscalitePanel() {
  const [tab, setTab] = useState<Tab>('tableau');
  return (
    <Drawer title="Fiscalité" icon="fiscalite" wide>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        ['tableau', 'H. Tableau fiscal'], ['revenu', 'A. Revenu'], ['societes', 'B. Sociétés'], ['tva', 'C. TVA'], ['patrimoine', 'D. Patrimoine'],
        ['immobilier', 'E. Immobilier'], ['ecologie', 'F. Écologie'], ['cotisations', 'G. Cotisations'],
      ]} />
      {tab === 'revenu' && <IncomeTax />}
      {tab === 'societes' && <Corporate />}
      {tab === 'tva' && <Vat />}
      {tab === 'patrimoine' && <Wealth />}
      {tab === 'immobilier' && <Property />}
      {tab === 'ecologie' && <Eco />}
      {tab === 'cotisations' && <Contributions />}
      {tab === 'tableau' && <TaxBoard />}
    </Drawer>
  );
}

function IncomeTax() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  const it = policy.incomeTax;
  const employeeRate = Object.values(policy.contributions).reduce((s, b) => s + b.employee, 0);
  const samples = [15000, 22000, 30000, 45000, 70000, 120000, 250000];
  return (
    <>
      <Section title="Barème progressif (par contribuable, revenu imposable annuel)" hint="Chaque taux s'applique uniquement à la fraction du revenu comprise dans sa tranche. Le revenu imposable = brut − cotisations salariales − abattement − déductions pour enfants.">
        <table className="table">
          <thead><tr><th>Tranche</th><th>Jusqu'à (€/an)</th><th>Taux</th><th /></tr></thead>
          <tbody>
            {it.brackets.map((b, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{b.upTo === null ? <span className="muted">au-delà</span> : (
                  <input className="num" type="number" step={500} value={Math.round(b.upTo)} onChange={(e) => edit((p) => { p.incomeTax.brackets[i].upTo = Number(e.target.value); })} />
                )}</td>
                <td>
                  <input className="num sm" type="number" step={0.5} min={0} max={90} value={+(b.rate * 100).toFixed(2)} onChange={(e) => edit((p) => { p.incomeTax.brackets[i].rate = Number(e.target.value) / 100; })} /> %
                </td>
                <td>{it.brackets.length > 2 && b.upTo !== null && <button className="link" onClick={() => edit((p) => { p.incomeTax.brackets.splice(i, 1); })}>Supprimer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {it.brackets.length < 9 && <button className="btn sm" onClick={() => edit((p) => {
          const b = p.incomeTax.brackets;
          const lastFinite = b.filter((x) => x.upTo !== null).at(-1)?.upTo ?? 10000;
          b.splice(b.length - 1, 0, { upTo: Math.round(lastFinite * 1.6), rate: b[b.length - 1].rate });
        })}>+ Ajouter une tranche</button>}
      </Section>
      <Section title="Déductions, crédits et allocations fiscales">
        <Slider label="Abattement forfaitaire pour frais" value={it.deductionRate} current={effective.incomeTax.deductionRate} min={0} max={0.3} step={0.005} fmt={p1} onChange={(v) => edit((p) => { p.incomeTax.deductionRate = v; })} />
        <Slider label="Plafond de l'abattement" value={it.deductionCap} current={effective.incomeTax.deductionCap} min={0} max={40000} step={500} fmt={eur} onChange={(v) => edit((p) => { p.incomeTax.deductionCap = v; })} />
        <Slider label="Déduction par enfant à charge" value={it.childDeduction} current={effective.incomeTax.childDeduction} min={0} max={8000} step={100} fmt={eur} onChange={(v) => edit((p) => { p.incomeTax.childDeduction = v; })} />
        <Slider label="Crédit d'impôt forfaitaire (exonère les petits impôts)" value={it.taxCredit} current={effective.incomeTax.taxCredit} min={0} max={3000} step={50} fmt={eur} onChange={(v) => edit((p) => { p.incomeTax.taxCredit = v; })} />
        <Slider label="Crédit d'activité (bas salaires, remboursable)" value={it.activityCredit} current={effective.incomeTax.activityCredit} min={0} max={5000} step={50} fmt={eur} onChange={(v) => edit((p) => { p.incomeTax.activityCredit = v; })} hint="Versé en totalité jusqu'à 1 SMIC, dégressif jusqu'à 1,6 SMIC. Compté en dépense publique." />
        <Slider label="Prélèvement forfaitaire sur les revenus du capital" value={it.capitalRate} current={effective.incomeTax.capitalRate} min={0} max={0.6} step={0.005} fmt={p1} onChange={(v) => edit((p) => { p.incomeTax.capitalRate = v; })} />
      </Section>
      <Section title="Simulateur : impôt d'un contribuable célibataire" hint="Calcul direct du barème, avant crédit d'activité.">
        <table className="table">
          <thead><tr><th>Brut annuel</th><th>Imposable</th><th>Impôt</th><th>Taux moyen</th></tr></thead>
          <tbody>
            {samples.map((g) => {
              const base = g * (1 - employeeRate);
              const taxable = Math.max(0, base - Math.min(base * it.deductionRate, it.deductionCap));
              const t = Math.max(0, progressiveTax(taxable, it.brackets) - it.taxCredit);
              return <tr key={g}><td>{eur(g)}</td><td>{eur(taxable)}</td><td>{eur(t)}</td><td>{pct(t / g)}</td></tr>;
            })}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Corporate() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  const c = policy.corporate;
  const e = effective.corporate;
  return (
    <>
      <div className="kpis">
        <Kpi label="Recettes d'IS" value={money(snap.accounts.revenue.impotSocietes)} sub="€/an" />
        <Kpi label="Investissement privé" value={money(snap.accounts.investment)} sub={pct(snap.accounts.investment / snap.accounts.gdp) + ' du PIB'} />
        <Kpi label="Faillites" value={Math.round(snap.accounts.failures).toLocaleString('fr-FR')} sub="par an" />
      </div>
      <Section title="Impôt sur les sociétés" hint="Un taux bas stimule l'investissement et la compétitivité mais réduit les recettes immédiates.">
        <Slider label="Taux normal" value={c.rate} current={e.rate} min={0} max={0.5} step={0.005} fmt={p1} onChange={(v) => edit((p) => { p.corporate.rate = v; })} />
        <Slider label="Taux réduit PME (≈30 % des bénéfices)" value={c.smeRate} current={e.smeRate} min={0} max={0.5} step={0.005} fmt={p1} onChange={(v) => edit((p) => { p.corporate.smeRate = v; })} />
        <Slider label="Crédit d'impôt investissement" value={c.investCredit} current={e.investCredit} min={0} max={0.25} step={0.005} fmt={p1} onChange={(v) => edit((p) => { p.corporate.investCredit = v; })} />
        <Slider label="Crédit d'impôt pour investissements verts" value={c.greenCredit} current={e.greenCredit} min={0} max={0.4} step={0.005} fmt={p1} onChange={(v) => edit((p) => { p.corporate.greenCredit = v; })} hint="Augmente la part verte de l'investissement et accélère la décarbonation." />
        <Slider label="Surtaxe sur les secteurs polluants" value={c.pollutingSurtax} current={e.pollutingSurtax} min={0} max={0.15} step={0.005} fmt={(v) => '+' + pct(v)} onChange={(v) => edit((p) => { p.corporate.pollutingSurtax = v; })} />
      </Section>
    </>
  );
}

const VAT_CLASS_LABEL: Record<VatClass, string> = { normal: 'Normal', reduit: 'Réduit', special: 'Spécial', exonere: 'Exonéré' };
function Vat() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  const v = policy.vat;
  return (
    <>
      <div className="kpis">
        <Kpi label="Recettes de TVA" value={money(snap.accounts.revenue.tva)} sub="€/an" />
        <Kpi label="Consommation des ménages" value={money(snap.accounts.consumption)} sub="€/an TTC" />
      </div>
      <Section title="Taux" hint="Une hausse excessive de la TVA renchérit les prix et réduit le volume consommé.">
        <Slider label="Taux normal" value={v.normal} current={effective.vat.normal} min={0} max={0.35} step={0.005} fmt={p1} onChange={(x) => edit((p) => { p.vat.normal = x; })} />
        <Slider label="Taux réduit" value={v.reduit} current={effective.vat.reduit} min={0} max={0.35} step={0.005} fmt={p1} onChange={(x) => edit((p) => { p.vat.reduit = x; })} />
        <Slider label="Taux spécial" value={v.special} current={effective.vat.special} min={0} max={0.35} step={0.005} fmt={p1} onChange={(x) => edit((p) => { p.vat.special = x; })} />
      </Section>
      <Section title="Taux applicable par catégorie de produits">
        <table className="table">
          <thead><tr><th>Catégorie</th><th>Part du budget</th><th>Taux</th><th>Recette</th></tr></thead>
          <tbody>
            {VAT_CATS.map((c) => (
              <tr key={c.id}>
                <td>{c.name}{c.essential && <span className="tag">essentiel</span>}</td>
                <td>{pct(c.share, 0)}</td>
                <td>
                  <select value={v.classes[c.id]} onChange={(e) => edit((p) => { p.vat.classes[c.id] = e.target.value as VatClass; })}>
                    {(Object.keys(VAT_CLASS_LABEL) as VatClass[]).map((k) => <option key={k} value={k}>{VAT_CLASS_LABEL[k]} ({k === 'exonere' ? '0 %' : pct(v[k])})</option>)}
                  </select>
                </td>
                <td>{money(snap.accounts.vatByCategory[c.id] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Wealth() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  return (
    <>
      <div className="kpis"><Kpi label="Recettes" value={money(snap.accounts.revenue.patrimoine)} sub="€/an" /></div>
      <Section title="Impôt sur les grands patrimoines" hint="Assise sur le patrimoine net au-delà du seuil (distribution de Pareto). Un taux élevé provoque de l'évasion et pèse sur l'investissement.">
        <Slider label="Taux annuel" value={policy.wealth.rate} current={effective.wealth.rate} min={0} max={0.03} step={0.0005} fmt={(x) => pct(x, 2)} onChange={(x) => edit((p) => { p.wealth.rate = x; })} />
        <Slider label="Seuil d'imposition" value={policy.wealth.threshold} current={effective.wealth.threshold} min={300000} max={10000000} step={50000} fmt={money} onChange={(x) => edit((p) => { p.wealth.threshold = x; })} />
      </Section>
    </>
  );
}

function Property() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  const r = snap.accounts.revenue;
  return (
    <>
      <div className="kpis">
        <Kpi label="Foncier" value={money(r.foncier)} />
        <Kpi label="Mutations" value={money(r.transactions)} />
        <Kpi label="Logements vacants" value={money(r.vacance)} />
        <Kpi label="Taxes locales" value={money(r.taxesLocales)} />
      </div>
      <Section title="Taxes immobilières">
        <Slider label="Impôt foncier (part de la valeur/an)" value={policy.property.landRate} current={effective.property.landRate} min={0} max={0.015} step={0.0001} fmt={(x) => pct(x, 2)} onChange={(x) => edit((p) => { p.property.landRate = x; })} />
        <Slider label="Droits de mutation sur les transactions" value={policy.property.transferRate} current={effective.property.transferRate} min={0} max={0.15} step={0.001} fmt={p1} onChange={(x) => edit((p) => { p.property.transferRate = x; })} hint="Un taux élevé réduit le nombre de transactions." />
        <Slider label="Taxe sur les logements vacants" value={policy.property.vacancyRate} current={effective.property.vacancyRate} min={0} max={0.05} step={0.0005} fmt={(x) => pct(x, 2)} onChange={(x) => edit((p) => { p.property.vacancyRate = x; })} hint="Incite à remettre les logements vides sur le marché." />
        <Slider label="Taxe locale par ménage" value={policy.property.localTax} current={effective.property.localTax} min={0} max={2000} step={10} fmt={(x) => eur(x) + '/an'} onChange={(x) => edit((p) => { p.property.localTax = x; })} />
      </Section>
    </>
  );
}

function Eco() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  const r = snap.accounts.revenue;
  const e = policy.eco;
  const c = effective.eco;
  return (
    <>
      <div className="kpis">
        <Kpi label="Émissions territoriales directes" value={`${(snap.accounts.emissions / 1e6).toFixed(1).replace('.', ',')} Mt CO₂/an`} hint="Hors émissions importées et hors absorptions." />
        <Kpi label="Recettes écologiques" value={money(r.carbone + r.carburants + r.emissionsIndustrielles + r.dechets + r.vehicules + r.energivores)} />
      </div>
      <Section title="Taxes écologiques" hint="Elles réduisent progressivement l'intensité carbone (substitution, investissements) mais renchérissent les coûts et les prix.">
        <Slider label="Taxe carbone (ménages et secteurs diffus)" value={e.carbon} current={c.carbon} min={0} max={400} step={5} fmt={(x) => `${x} €/t`} onChange={(x) => edit((p) => { p.eco.carbon = x; })} />
        <Slider label="Accise sur les carburants" value={e.fuel} current={c.fuel} min={0} max={1.2} step={0.01} fmt={p1} onChange={(x) => edit((p) => { p.eco.fuel = x; })} />
        <Slider label="Taxe sur les émissions industrielles et électriques" value={e.industrial} current={c.industrial} min={0} max={400} step={5} fmt={(x) => `${x} €/t`} onChange={(x) => edit((p) => { p.eco.industrial = x; })} />
        <Slider label="Taxe sur les déchets" value={e.waste} current={c.waste} min={0} max={300} step={5} fmt={(x) => `${x} €/t`} onChange={(x) => edit((p) => { p.eco.waste = x; })} />
        <Slider label="Taxe annuelle sur les véhicules thermiques" value={e.vehicle} current={c.vehicle} min={0} max={2000} step={10} fmt={(x) => `${x} €/véh.`} onChange={(x) => edit((p) => { p.eco.vehicle = x; })} />
        <Slider label="Taxe sur la valeur ajoutée des activités énergivores" value={e.energyIntensive} current={c.energyIntensive} min={0} max={0.05} step={0.0005} fmt={(x) => pct(x, 2)} onChange={(x) => edit((p) => { p.eco.energyIntensive = x; })} />
      </Section>
    </>
  );
}

function Contributions() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap) return null;
  return (
    <>
      <div className="kpis">
        <Kpi label="Cotisations patronales" value={money(snap.accounts.revenue.cotisationsPatronales)} />
        <Kpi label="Cotisations salariales" value={money(snap.accounts.revenue.cotisationsSalariales)} />
      </div>
      <Section title="Taux par branche (en % du salaire brut)" hint="Les cotisations patronales augmentent le coût du travail ; les salariales réduisent le salaire net.">
        <table className="table">
          <thead><tr><th>Branche</th><th>Patronale</th><th>Salariale</th></tr></thead>
          <tbody>
            {BRANCHES.map((b) => (
              <tr key={b}>
                <td>{BRANCH_NAMES[b]}</td>
                <td><input className="num sm" type="number" step={0.1} min={0} max={30} value={+(policy.contributions[b].employer * 100).toFixed(2)} onChange={(e) => edit((p) => { p.contributions[b].employer = Number(e.target.value) / 100; })} /> %</td>
                <td><input className="num sm" type="number" step={0.1} min={0} max={30} value={+(policy.contributions[b].employee * 100).toFixed(2)} onChange={(e) => edit((p) => { p.contributions[b].employee = Number(e.target.value) / 100; })} /> %</td>
              </tr>
            ))}
            <tr className="total"><td>Total</td>
              <td>{pct(BRANCHES.reduce((s, b) => s + policy.contributions[b].employer, 0))}</td>
              <td>{pct(BRANCHES.reduce((s, b) => s + policy.contributions[b].employee, 0))}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </>
  );
}

function TaxBoard() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  const [key, setKey] = useState('impotRevenu');
  if (!snap) return null;
  const A = snap.accounts;
  const pop = snap.demography.cohorts.reduce((s, v) => s + v, 0);
  const items = Object.entries(A.revenue).map(([k, v]) => ({ label: REVENUE_LABELS[k] ?? k, value: v, key: k })).sort((a, b) => b.value - a.value);
  return (
    <>
      <div className="kpis">
        <Kpi label="Recettes fiscales totales" value={money(A.revenueTotal)} sub={`${pct(A.revenueTotal / A.gdp)} du PIB · €/an`} />
        <Kpi label="Impôts moyens par habitant" value={money(A.revenueTotal / pop)} sub="€/an" />
        <Kpi label="Recettes issues des entreprises" value={money(A.revenue.impotSocietes + A.revenue.cotisationsPatronales + A.revenue.emissionsIndustrielles + A.revenue.energivores)} sub="IS, cotisations patronales, taxes industrielles" />
      </div>
      <Section title="Recettes par impôt (€/an)">
        <Bars items={items} fmt={money} />
      </Section>
      <Section title="Évolution des recettes">
        <div className="row">
          <select value={key} onChange={(e) => setKey(e.target.value)}>{items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}</select>
          <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['50', '50 ans'], ['all', 'Tout']]} />
        </div>
        <LineChart years={years} fmt={money} series={[{ key, label: REVENUE_LABELS[key], values: history['rev_' + key] ?? [], color: '#4cc9f0' }, { key: 'revenue', label: 'Total', values: history.revenue ?? [], color: '#f7b801' }]} />
      </Section>
      <Section title="Charge fiscale par catégorie" hint="Impôt sur le revenu + cotisations salariales − crédit d'activité, rapportés au revenu brut. Moyennes par personne.">
        <table className="table">
          <thead><tr><th>Catégorie</th><th>Effectif</th><th>Revenu brut moyen</th><th>Impôt sur le revenu</th><th>Cotisations</th><th>Taux effectif</th></tr></thead>
          <tbody>
            {Object.entries(A.taxByCategory).map(([k, v]) => (
              <tr key={k}><td>{CAT_LABEL[k] ?? k}</td><td>{Math.round(v.people).toLocaleString('fr-FR')}</td><td>{eur(v.grossIncome)}</td><td>{eur(v.incomeTax)}</td><td>{eur(v.contributions)}</td><td>{pct(v.effectiveRate)}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}
const CAT_LABEL: Record<string, string> = { cadres: 'Cadres', employes: 'Employés', ouvriers: 'Ouvriers', independants: 'Indépendants', entrepreneurs: 'Entrepreneurs', retraites: 'Retraités', chomeurs: 'Chômeurs indemnisés' };
