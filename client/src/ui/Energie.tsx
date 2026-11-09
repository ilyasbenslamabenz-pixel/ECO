// Ministère de la Transition énergétique : mix électrique, bilan, prix, sécurité d'approvisionnement,
// programmes de construction et de fermeture (implantation automatique), électrification, émissions, objectifs.
import { useState } from 'react';
import { useStore } from '../store';
import { gameAction } from '../net';
import { money, pct, int, dec1 } from '../format';
import { Bars, Drawer, Info, Kpi, Meter, Section, Slider, Tabs, Toggle, usePolicy } from './common';
import { LineChart } from './charts';
import { fmtKind } from './energyIndicators';
import { BUILD_IDS, CARRIER_NAMES, CARRIERS, STORAGE, TECHS, TECH_IDS, type BuildId } from '../../../shared/sim/energyData';
import { ENERGY_INDICATORS } from '../../../shared/sim/energyIndicators';
import { Icon } from './Icon';

const TECH_COLORS: Record<string, string> = {
  charbon: '#5c5c5c', gaz: '#f4a261', petrole: '#9d4edd', nucleaire: '#ffd166', solaire: '#ffb703', eolien: '#90e0ef', eolienMer: '#4cc9f0',
  hydraulique: '#219ebc', geothermie: '#e76f51', biomasse: '#52b788', batteries: '#a8dadc',
};
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = (m: number, y0: number) => `${MONTHS[m % 12]} ${y0 + Math.floor(m / 12)}`;
const twh = (mwhPerYear: number) => `${dec1(mwhPerYear / 1e6)} TWh/an`;
const mt = (t: number) => `${dec1(t / 1e6)} Mt`;
const name = (t: BuildId) => (t === 'batteries' ? STORAGE.name : TECHS[t].name);
const icon = (t: BuildId) => (t === 'batteries' ? STORAGE.icon : TECHS[t].icon);
const hint = (k: string) => { const d = ENERGY_INDICATORS[k]; return d ? `${d.def} (${d.unit}, ${d.period})` : undefined; };

export function EnergiePanel() {
  const [tab, setTab] = useState<'synthese' | 'parc' | 'politique' | 'emissions' | 'historique'>('synthese');
  return (
    <Drawer title="Ministère de la Transition énergétique" icon="energie" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['synthese', 'Synthèse'], ['parc', 'Parc & programmes'], ['politique', 'Politiques'], ['emissions', 'Émissions & objectifs'], ['historique', 'Historique']]} />
      {tab === 'synthese' && <Synthese />}
      {tab === 'parc' && <Parc />}
      {tab === 'politique' && <Politiques />}
      {tab === 'emissions' && <Emissions />}
      {tab === 'historique' && <Historique />}
    </Drawer>
  );
}

function Synthese() {
  const snap = useStore((s) => s.snap);
  const E = snap?.energy;
  if (!snap || !E) return <p className="muted">Module énergie indisponible pour cette partie.</p>;
  const b = E.balance;
  const f = E.final;
  return (
    <>
      <div className="kpis">
        <Kpi label="Électricité renouvelable" value={pct(E.elecRenShare)} sub="12 derniers mois" hint={hint('elecRenShare')} />
        <Kpi label="Énergie finale renouvelable" value={pct(f.renewableShare)} sub="tous usages" hint={hint('finalRenShare')} />
        <Kpi label="Prix de l'électricité" value={`${int(E.retailPrice)} €/MWh`} sub={`gros : ${int(b.wholesale)} €/MWh`} hint={hint('elecPrice')} />
        <Kpi label="Indice des prix de l'énergie" value={dec1(snap.macro.energyPrice * 100)} sub="base 100 en 2030" hint={hint('energyPrice')} tone={snap.macro.energyPrice > 1.15 ? 'bad' : undefined} />
        <Kpi label="Risque de pénurie" value={pct(E.shortageRisk, 0)} sub={`marge ${pct(b.margin)}`} hint={hint('shortageRisk')} tone={E.shortageRisk > 0.5 ? 'bad' : E.shortageRisk > 0.15 ? 'warn' : 'good'} />
        <Kpi label="Intensité carbone" value={`${int(E.emissions.intensityElec)} g/kWh`} hint={hint('carbonIntensityElec')} />
        <Kpi label="Dépendance aux importations" value={pct(E.importDependence)} hint="Part de l'énergie (approche primaire) couverte par des combustibles fossiles importés et de l'électricité importée nette." />
      </div>
      {b.unserved > 0 && <p className="bad">Délestages ce mois-ci : {twh(b.unserved * 12)} non distribués. Construisez des moyens pilotables ou du stockage, ou renforcez les interconnexions.</p>}
      <div className="cols">
        <Section title="Production d'électricité du mois" hint="Rythme annuel. Merit order par blocs horaires (pointe, jour, nuit) : renouvelables et nucléaire d'abord, puis moyens pilotables par coût marginal croissant (prix du carbone inclus) et importations.">
          <Bars fmt={twh} items={TECH_IDS.filter((t) => b.byTech[t] > 0 || E.fleet[t].mw > 0).map((t) => ({ label: `${TECHS[t].icon} ${TECHS[t].name}`, value: b.byTech[t] * 12, color: TECH_COLORS[t] }))} />
        </Section>
        <Section title="Bilan électrique" hint="Production + importations = consommation + pertes + exportations + (charge − décharge du stockage).">
          <table className="table"><tbody>
            <tr><td>Production</td><td>{twh(b.production * 12)}</td></tr>
            <tr><td>Importations</td><td>{twh(b.imports * 12)}</td></tr>
            <tr><td>Exportations</td><td>{twh(b.exports * 12)}</td></tr>
            <tr><td>Consommation finale</td><td>{twh(b.consumption * 12)}</td></tr>
            <tr><td>Pertes en ligne ({pct(E.lossRate)})</td><td>{twh(b.losses * 12)}</td></tr>
            <tr><td>Stockage (charge / décharge)</td><td>{twh(b.storageCharge * 12)} / {twh(b.storageDischarge * 12)}</td></tr>
            <tr><td>Écrêtement</td><td>{twh(b.curtailment * 12)}</td></tr>
            <tr><td>Énergie non distribuée</td><td className={b.unserved > 0 ? 'bad' : ''}>{twh(b.unserved * 12)}</td></tr>
            <tr><td>Pointe / puissance garantie</td><td>{int(b.peakMW)} MW / {int(b.firmMW)} MW</td></tr>
            <tr><td>Interconnexions</td><td>{int(E.interconnectMw)} MW</td></tr>
          </tbody></table>
        </Section>
      </div>
      <Section title="Énergie finale par vecteur" hint="Énergie livrée aux utilisateurs (rythme annuel). L'électricité n'en est qu'une partie : ne pas confondre part renouvelable de l'électricité et de l'énergie finale.">
        <Bars fmt={twh} items={CARRIERS.map((c) => ({ label: CARRIER_NAMES[c], value: f.byCarrier[c], color: c === 'elec' ? '#4cc9f0' : c === 'biomasse' ? '#52b788' : c === 'chaleur' ? '#e76f51' : '#8d99ae' }))} />
        <p className="muted small">Total {twh(f.total)} · électricité {pct(f.elecShare)} · voitures électriques {pct(E.evShare)} du parc ({pct(E.evSales)} des ventes) · pompes à chaleur {pct(E.heatPumpShare)} du chauffage fossile remplacé · {int(E.chargers)} bornes publiques.</p>
      </Section>
    </>
  );
}

function Parc() {
  const snap = useStore((s) => s.snap);
  const [tech, setTech] = useState<BuildId>('eolienMer');
  const [mw, setMw] = useState(500);
  const [closeYear, setCloseYear] = useState(0);
  const E = snap?.energy;
  if (!snap || !E) return null;
  const year0 = snap.startYear + Math.floor(snap.month / 12);
  const def = tech === 'batteries' ? STORAGE : TECHS[tech];
  const Pl = snap.macro.priceLevel;
  const cost = def.capex * 1000 * mw * Pl;
  const installed = tech === 'batteries' ? E.storage.mw : E.fleet[tech].mw;
  const atMonth = closeYear > 0 ? (closeYear - snap.startYear) * 12 : undefined;
  return (
    <>
      <Section title="Parc installé" hint="Puissance en MW ; « public » = capacités financées par l'État. Les sites sont implantés automatiquement sur la carte (toitures, périphérie, port, mer).">
        <table className="table">
          <thead><tr><th>Filière</th><th>Installé</th><th>dont public</th><th>Production</th><th>CO₂ (t/MWh)</th><th>Coût marginal</th></tr></thead>
          <tbody>
            {TECH_IDS.map((t) => (
              <tr key={t}>
                <td><Icon name={TECHS[t].icon} size={15} />{TECHS[t].name}</td>
                <td>{int(E.fleet[t].mw)} MW</td>
                <td>{int(E.fleet[t].publicMw)} MW</td>
                <td>{twh(E.balance.byTech[t] * 12)}</td>
                <td>{TECHS[t].co2.toFixed(2).replace('.', ',')}</td>
                <td>{int(TECHS[t].fuel + TECHS[t].varOM + TECHS[t].co2 * snap.policy.eco.industrial)} €/MWh</td>
              </tr>
            ))}
            <tr><td><Icon name={STORAGE.icon} size={15} />{STORAGE.name}</td><td>{int(E.storage.mw)} MW</td><td>{int(E.storage.publicMw)} MW</td><td>{int(E.storage.mwh)} MWh</td><td>—</td><td>—</td></tr>
          </tbody>
        </table>
      </Section>
      <Section title="Décider un programme" hint="Construction : coût d'investissement payé par l'État pendant toute la durée du chantier, puis maintenance annuelle ; la recette des ventes d'électricité revient au budget. Fermeture : démantèlement et indemnisation des exploitants privés.">
        <div className="btn-row">
          {BUILD_IDS.map((t) => <button key={t} className={`btn ${tech === t ? 'primary' : 'ghost'}`} onClick={() => setTech(t)}><Icon name={icon(t)} size={15} />{name(t)}</button>)}
        </div>
        <Slider label="Puissance" value={mw} min={10} max={5000} step={10} fmt={(v) => `${int(v)} MW`} onChange={setMw} />
        <p className="muted small">
          {name(tech)} : {money(cost)} sur {def.buildMonths} mois · maintenance {money(def.fixedOM * 1000 * mw * Pl)}/an · {int((mw * def.jobsBuild) / Math.max(1, def.buildMonths / 12))} emplois de chantier puis {int(mw * def.jobsOp)} emplois permanents
          {tech !== 'batteries' && <> · production attendue ≈ {twh(mw * TECHS[tech].cf * 8760)} · contribution à la pointe {pct(TECHS[tech].firm, 0)}</>}.
          Installé : {int(installed)} MW.
        </p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => gameAction({ type: 'energyBuild', tech, mw })}><Icon name="construire" size={14} />Construire {int(mw)} MW</button>
        </div>
        <Slider label="Échéance de fermeture" value={closeYear} min={0} max={year0 + 30} step={1} fmt={(v) => (v < year0 ? 'immédiate' : `${v}`)} onChange={(v) => setCloseYear(v < year0 ? 0 : v)} />
        <div className="btn-row">
          <button className="btn" disabled={installed < 1} onClick={() => gameAction({ type: 'energyClose', tech, mw, atMonth })}><Icon name="arret" size={14} />Fermer {int(Math.min(mw, installed))} MW {atMonth !== undefined ? `en ${closeYear}` : 'maintenant'}</button>
          <button className="btn ghost" disabled={installed < 1} onClick={() => gameAction({ type: 'energyClose', tech, mw: Math.ceil(installed), atMonth })}>Fermer toute la filière</button>
        </div>
        <p className="muted small">Fermer des centrales pilotables réduit les émissions mais peut provoquer des délestages si renouvelables, stockage et interconnexions ne couvrent pas la pointe d'hiver.</p>
      </Section>
      <Section title="Programmes en cours">
        {E.projects.length === 0 ? <p className="muted">Aucun programme en cours.</p> : (
          <table className="table">
            <thead><tr><th>Programme</th><th>Échéance</th><th>Coût public</th><th>Avancement</th><th /></tr></thead>
            <tbody>
              {E.projects.map((p) => {
                const prog = p.kind === 'close' && !p.applied ? 0 : Math.min(1, (snap.month - p.start) / Math.max(1, p.done - p.start));
                return (
                  <tr key={p.id}>
                    <td><Icon name={p.kind === 'close' ? 'arret' : 'construire'} size={15} />{p.name}</td>
                    <td>{monthName(p.kind === 'close' && !p.applied ? p.start : p.done, snap.startYear)}</td>
                    <td>{p.public ? money(p.cost) : 'privé'}</td>
                    <td style={{ minWidth: 90 }}><Meter value={prog * 100} tone="var(--accent)" /></td>
                    <td>{p.public && (p.kind === 'build' || !p.applied) && <button className="btn ghost" onClick={() => gameAction({ type: 'energyCancel', id: p.id })}>Annuler</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function Politiques() {
  const { policy, effective, edit } = usePolicy();
  const snap = useStore((s) => s.snap);
  if (!policy || !effective || !snap || !policy.energy) return null;
  const P = policy.energy;
  const C = effective.energy;
  const gdp = snap.accounts.gdp;
  const F = snap.energy?.finance;
  return (
    <>
      <Section title="Marché de l'électricité" hint="Le prix du carbone sur les émissions industrielles et énergétiques se règle dans Fiscalité → fiscalité écologique ; il modifie l'ordre d'appel des centrales et les investissements.">
        <Toggle label="Laisser les opérateurs privés investir (sécurité d'approvisionnement et renouvelables rentables)" value={P.autoInvest} onChange={(v) => edit((p) => { p.energy.autoInvest = v; })} />
        <Slider label="Complément de rémunération des nouvelles capacités renouvelables" value={P.renewableSupport} current={C.renewableSupport} min={0} max={100} step={1} fmt={(v) => `${int(v)} €/MWh`} onChange={(v) => edit((p) => { p.energy.renewableSupport = v; })} hint="Versé par l'État sur la production solaire et éolienne installée depuis 2030 ; rend rentables davantage de projets privés." />
        <Slider label="Réseaux et interconnexions (investissement additionnel)" value={P.gridBudget} current={C.gridBudget} min={0} max={gdp * 0.01} step={Math.round(gdp * 0.0002)} fmt={money} onChange={(v) => edit((p) => { p.energy.gridBudget = v; })} hint="Réduit les pertes (jusqu'à −2 points), améliore la fiabilité et double à terme la capacité d'interconnexion." />
      </Section>
      <Section title="Électrification et sobriété">
        <Slider label="Bonus à l'achat d'une voiture électrique" value={P.evSubsidy} current={C.evSubsidy} min={0} max={10000} step={250} fmt={(v) => `${int(v)} €`} onChange={(v) => edit((p) => { p.energy.evSubsidy = v; })} />
        <Slider label="Bornes de recharge publiques" value={P.chargingBudget} current={C.chargingBudget} min={0} max={gdp * 0.002} step={Math.round(gdp * 0.00005)} fmt={money} onChange={(v) => edit((p) => { p.energy.chargingBudget = v; })} hint="25 000 € par borne. Le manque de bornes freine les ventes de voitures électriques." />
        <Slider label="Aide à l'installation d'une pompe à chaleur" value={P.heatPumpSubsidy} current={C.heatPumpSubsidy} min={0} max={15000} step={250} fmt={(v) => `${int(v)} €`} onChange={(v) => edit((p) => { p.energy.heatPumpSubsidy = v; })} />
        <Slider label="Rénovation énergétique des bâtiments" value={P.renovationBudget} current={C.renovationBudget} min={0} max={gdp * 0.02} step={Math.round(gdp * 0.0005)} fmt={money} onChange={(v) => edit((p) => { p.energy.renovationBudget = v; })} hint="180 MWh/an de chauffage économisés par M€ investi." />
        <Slider label="Incorporation de biocarburants" value={P.biofuelMandate} current={C.biofuelMandate} min={0} max={0.5} step={0.01} fmt={(v) => pct(v, 0)} onChange={(v) => edit((p) => { p.energy.biofuelMandate = v; })} hint="Part renouvelable des carburants ; renchérit les carburants (+60 % sur la part incorporée)." />
      </Section>
      {F && (
        <Section title="Coût budgétaire de la politique énergétique (€/an)">
          <Bars fmt={money} items={[
            { label: 'Chantiers publics', value: F.capex }, { label: 'Démantèlements', value: F.decommission }, { label: 'Maintenance des centrales publiques', value: F.om },
            { label: 'Complément de rémunération', value: F.support }, { label: 'Bonus voitures électriques', value: F.ev }, { label: 'Aides pompes à chaleur', value: F.heatPumps },
            { label: 'Bornes de recharge', value: F.charging }, { label: 'Rénovation', value: F.renovation }, { label: 'Réseaux', value: F.grid },
            { label: 'Recettes des centrales publiques', value: -F.revenue, color: 'var(--good)' },
          ]} />
        </Section>
      )}
    </>
  );
}

function Emissions() {
  const snap = useStore((s) => s.snap);
  const E = snap?.energy;
  if (!snap || !E) return null;
  const em = E.emissions;
  const SRC: Record<string, string> = { electricite: 'Production d\'électricité', autresEnergie: 'Raffinage, chaleur, autres énergies', industrie: 'Industrie', transport: 'Transports', batiments: 'Bâtiments (logements, tertiaire)', agriculture: 'Agriculture', construction: 'Construction' };
  return (
    <>
      <div className="kpis">
        <Kpi label="Brutes (territoriales)" value={mt(em.territorialGross)} sub="t CO₂e/an, directes" hint={hint('emissionsGross')} />
        <Kpi label="Absorptions" value={mt(em.absorptions)} hint={hint('absorptions')} />
        <Kpi label="Nettes" value={mt(em.net)} hint={hint('emissionsNet')} />
        <Kpi label="CO₂ fossile brut" value={mt(em.fossilCO2)} hint={hint('fossilCO2')} />
        <Kpi label="Empreinte carbone" value={mt(em.footprint)} hint={hint('footprint')} />
        <Kpi label="Importées" value={mt(em.imported)} hint="Contenu carbone des biens et de l'électricité importés." />
        <Kpi label="Indirectes" value={mt(em.indirect)} hint="Amont des combustibles, cycle de vie des équipements énergétiques et contenu des importations." />
        <Kpi label="Compensation achetée" value={mt(em.offsets)} sub={`nettes après compensation : ${mt(em.netAfterOffsets)}`} hint="Crédits carbone internationaux : affichés à part, ils ne réduisent jamais les émissions brutes ni les émissions territoriales nettes." />
      </div>
      <div className="cols">
        <Section title="Émissions brutes par source (t CO₂e/an)">
          <Bars fmt={mt} items={Object.entries(em.bySource).map(([k, v]) => ({ label: SRC[k] ?? k, value: v, color: k === 'electricite' ? '#f4a261' : '#ef476f' }))} />
          <p className="muted small">Autres gaz (CH₄, N₂O, gaz fluorés) : {mt(em.nonCO2)} · CO₂ biogénique (non compté) : {mt(em.biogenic)} · intensité {int(em.intensityGdp)} t/M€ de PIB · {dec1(em.intensityFinal * 1000)} kg CO₂/MWh d'énergie finale.</p>
        </Section>
        <Section title="Objectifs" hint="Avancement vers les objectifs de neutralité ; un objectif est atteint lorsque sa valeur atteint la cible.">
          {E.goals.map((g) => (
            <div key={g.id} className="budget-line">
              <div className="row between"><b className="row" style={{ margin: 0, gap: 6 }}><Icon name={g.achieved ? 'valide' : 'objectifs'} size={15} />{g.name}<Info text={g.definition} /></b><span>{g.unit === '%' ? pct(g.value) : fmtKind('tco2', g.value)}</span></div>
              <Meter value={g.progress * 100} />
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

function Historique() {
  const history = useStore((s) => s.history);
  const [years, setYears] = useState<number | 'all'>(10);
  const h = (k: string) => history[k] ?? [];
  return (
    <>
      <Tabs value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['50', '50 ans'], ['all', 'Tout']]} />
      <Section title="Parts renouvelables (électricité ≠ énergie finale)">
        <LineChart years={years} fmt={(v) => pct(v)} series={[{ key: 'e', label: 'Électricité', values: h('elecRenShare'), color: '#4cc9f0' }, { key: 'f', label: 'Énergie finale', values: h('finalRenShare'), color: '#52b788' }]} />
      </Section>
      <Section title="Émissions (t CO₂e/an)">
        <LineChart years={years} fmt={mt} series={[{ key: 'g', label: 'Brutes', values: h('emissionsGross'), color: '#ef476f' }, { key: 'n', label: 'Nettes', values: h('emissionsNet'), color: '#ffd166' }, { key: 'f', label: 'CO₂ fossile', values: h('fossilCO2'), color: '#8d99ae' }]} />
      </Section>
      <Section title="Électricité (TWh/an)">
        <LineChart years={years} fmt={(v) => fmtKind('mwh', v)} series={[{ key: 'd', label: 'Demande', values: h('elecDemand'), color: '#ffd166' }, { key: 'p', label: 'Production', values: h('elecProduction'), color: '#4cc9f0' }, { key: 'i', label: 'Importations', values: h('elecImports'), color: '#ef476f' }]} />
      </Section>
      <Section title="Prix">
        <LineChart years={years} height={140} fmt={(v) => `${int(v)} €/MWh`} series={[{ key: 'r', label: 'Électricité (consommateur)', values: h('elecPrice'), color: '#f4a261' }, { key: 'w', label: 'Gros', values: h('wholesalePrice'), color: '#8d99ae' }]} />
      </Section>
    </>
  );
}
