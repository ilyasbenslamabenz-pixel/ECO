// Ministères sectoriels (phase 4b) : Transports & mobilité, Industrie, Agriculture & alimentation, Déchets & recyclage.
// Toutes les valeurs affichées viennent du moteur (serveur). Les programmes (nouvelles lignes, installations, plans)
// sont des décisions : le moteur les place automatiquement dans la cité et les met en service à la fin des travaux.
import { useState, type ReactNode } from 'react';
import { PT_DEFS, PT_MODES, TRANSPORT_PROJECTS, VEHICLE_DEFS, type TransportProjectKind, type VehicleKind } from '../../../shared/sim/transport';
import { INDUSTRY_FACILITIES, INDUSTRY_PROGRAMS, PROGRAM_DEFS, type IndustryFacility, type IndustryProgram } from '../../../shared/sim/industry';
import { AGRI_PROJECTS, PRACTICES, PRACTICE_DEFS, type AgricultureProject } from '../../../shared/sim/agriculture';
import { WASTE_CATS, WASTE_CAT_NAMES, WASTE_FACILITIES, WASTE_ROUTE_NAMES, type WasteFacility, type WasteRoute } from '../../../shared/sim/waste';
import type { Project, Site } from '../../../shared/sim/sectors';
import type { SectorAction } from '../../../shared/sim/engine';
import { useStore } from '../store';
import { programAction } from '../net';
import { dec1, int, money, pct, people } from '../format';
import { Bars, Drawer, Kpi, Meter, Section, Slider, Tabs, usePolicy } from './common';
import { LineChart } from './charts';

const mt = (t: number) => `${dec1(t / 1e6)} Mt`;
const kt = (t: number) => (t >= 1e6 ? `${dec1(t / 1e6)} Mt` : `${int(t / 1e3)} kt`);
const idx = (v: number) => dec1(v * 100);

/** Chantiers en cours d'un module (avancement, coût, mise en service prévue). */
function Projects({ list, sites }: { list: Project[]; sites?: Site[] }) {
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  if (!snap) return null;
  if (!list.length) return <p className="muted small">Aucun programme en cours.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Programme</th><th>Coût</th><th>Avancement</th><th>Mise en service</th></tr></thead>
        <tbody>
          {list.map((p) => {
            const site = sites?.find((s) => s.id === p.siteId);
            return (
              <tr key={p.id}>
                <td>{p.label}{site?.cityId !== null && site?.cityId !== undefined && <em className="muted"> · {country?.cities[site.cityId]?.name}</em>}</td>
                <td>{money(p.cost)}</td>
                <td><Meter value={(p.elapsed / p.months) * 100} tone="var(--accent)" /> {Math.round((p.elapsed / p.months) * 100)} %</td>
                <td>dans {p.months - p.elapsed} mois</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Ligne de programme : quantité, coût estimé, délai, bouton de lancement. */
function ProgramRow({ title, desc, unit, max, unitCost, months, make, step = 1, initial = 1, extra }: {
  title: string; desc?: string; unit: string; max: number; unitCost: number; months: (n: number) => number; make: (n: number) => SectorAction; step?: number; initial?: number; extra?: ReactNode;
}) {
  const snap = useStore((s) => s.snap);
  const [n, setN] = useState(initial);
  if (!snap) return null;
  const cost = unitCost * n * snap.macro.priceLevel;
  return (
    <div className="program" style={{ padding: "6px 0", borderBottom: "1px solid rgba(127,127,127,0.2)" }}>
      <div className="row between"><b>{title}</b><span className="muted small">{money(cost)} · {months(n)} mois</span></div>
      {desc && <p className="muted small">{desc}</p>}
      <div className="row">
        <input className="input" type="number" min={1} max={max} step={step} value={n} onChange={(e) => setN(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} style={{ width: 90 }} />
        <span className="muted small">{unit}</span>
        {extra}
        <button className="btn primary" onClick={() => programAction(make(n))}>Lancer</button>
      </div>
    </div>
  );
}

function QuarterSelect({ value, onChange, filter }: { value: number; onChange: (v: number) => void; filter?: (k: string) => boolean }) {
  const country = useStore((s) => s.country);
  const snap = useStore((s) => s.snap);
  if (!country || !snap) return null;
  const list = country.cities.filter((c) => !filter || filter(c.kind)).sort((a, b) => snap.cities[b.id].population - snap.cities[a.id].population);
  const kindName = (k: string) => (k === 'metropole' ? 'grand quartier' : k === 'ville' ? 'arrondissement' : 'quartier périphérique');
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>Choix automatique (quartier le moins desservi)</option>
      {list.map((c) => <option key={c.id} value={c.id}>{c.name} — {kindName(c.kind)}, {people(snap.cities[c.id].population)}</option>)}
    </select>
  );
}

// ---------- Transports ----------
export function TransportsPanel() {
  const [tab, setTab] = useState<'synthese' | 'reseau' | 'programmes' | 'politique'>('synthese');
  return (
    <Drawer title="Ministère des Transports et de la Mobilité" icon="transports" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['synthese', 'Synthèse'], ['reseau', 'Réseau & flottes'], ['programmes', 'Programmes'], ['politique', 'Politique']]} />
      {tab === 'synthese' && <TransportSummary />}
      {tab === 'reseau' && <TransportNetwork />}
      {tab === 'programmes' && <TransportPrograms />}
      {tab === 'politique' && <TransportPolicyView />}
    </Drawer>
  );
}

const MODE_NAMES: Record<string, string> = { voiture: 'Voiture', transportsCommuns: 'Transports en commun', velo: 'Vélo', marche: 'Marche', train: 'Train', avion: 'Avion' };

function TransportSummary() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const T = snap?.transport;
  if (!snap || !T) return null;
  return (
    <>
      <div className="kpis">
        <Kpi label="Satisfaction des usagers" value={`${Math.round(T.satisfaction)}/100`} tone={T.satisfaction < 45 ? 'bad' : T.satisfaction > 65 ? 'good' : undefined} hint="Temps de trajet, congestion, coût, confort et qualité de service, comparés à la situation de départ." />
        <Kpi label="Temps domicile-travail" value={`${Math.round(T.travelTime)} min`} sub="trajet moyen (aller)" />
        <Kpi label="Congestion" value={idx(T.congestion)} sub={`vitesse moyenne ${Math.round(T.roadSpeed)} km/h`} tone={T.congestion > 1.05 ? 'bad' : undefined} hint="Rapport volume / capacité du réseau routier (100 = saturation de référence)." />
        <Kpi label="Remplissage TC" value={pct(T.ptLoad, 0)} sub={`grandes lignes ${pct(T.longLoad, 0)}`} tone={T.ptLoad > 0.6 ? 'warn' : undefined} />
        <Kpi label="Coût des déplacements" value={money(T.monthlyCost)} sub="par ménage et par mois" />
        <Kpi label="Voitures électriques" value={pct(T.fleet.evShare)} sub={`${pct(T.evSalesShare, 0)} des ventes`} />
        <Kpi label="Émissions du transport" value={mt(T.emissions.total)} sub="tCO₂/an (voitures + secteur)" />
        <Kpi label="Électricité consommée" value={`${dec1(T.electricityMWh / 1e6)} TWh`} sub="par an" />
      </div>
      <div className="cols">
        <Section title="Parts modales du quotidien (voyageurs-km)"><Bars fmt={(v) => pct(v)} items={Object.entries(T.modal).map(([k, v]) => ({ label: MODE_NAMES[k], value: v }))} max={1} /></Section>
        <Section title="Voyages hors de la cité"><Bars fmt={(v) => pct(v)} items={Object.entries(T.modalLong).map(([k, v]) => ({ label: MODE_NAMES[k], value: v }))} max={1} /></Section>
      </div>
      <Section title="Évolution">
        <LineChart years={10} fmt={(v) => pct(v)} series={[
          { key: 'c', label: 'Voiture', values: history.tr_car ?? [], color: '#ef476f' },
          { key: 'p', label: 'Transports en commun', values: history.tr_pt ?? [], color: '#4cc9f0' },
          { key: 'b', label: 'Vélo', values: history.tr_bike ?? [], color: '#06d6a0' },
          { key: 'e', label: 'Part du parc électrique', values: history.tr_evShare ?? [], color: '#f7b801' },
        ]} />
        <LineChart years={10} height={140} fmt={mt} series={[{ key: 'em', label: 'Émissions du transport (t/an)', values: history.tr_emissions ?? [], color: '#b388eb' }]} />
      </Section>
      <Section title="Émissions par source (tCO₂/an)">
        <Bars fmt={mt} items={[
          { label: 'Voitures des ménages', value: T.emissions.voitures }, { label: 'Fret routier', value: T.emissions.fretRoutier }, { label: 'Bus et trains diesel', value: T.emissions.transportsCommuns },
          { label: 'Aviation', value: T.emissions.aviation }, { label: 'Maritime et port', value: T.emissions.maritime }, { label: 'Autres', value: T.emissions.autres },
        ]} />
        <p className="muted small">Aviation internationale (hors inventaire national) : {mt(T.emissions.aviationInternationale)}.</p>
      </Section>
    </>
  );
}

function TransportNetwork() {
  const snap = useStore((s) => s.snap);
  const T = snap?.transport;
  if (!snap || !T) return null;
  const N = T.network;
  const F = T.fleet;
  return (
    <>
      <div className="kpis">
        <Kpi label="Métro" value={`${int(N.metroKm)} km`} sub={`${int(F.metro)} rames`} />
        <Kpi label="Tramway" value={`${int(N.tramKm)} km`} sub={`${int(F.tram)} rames`} />
        <Kpi label="RER / trains" value={`${int(N.railKm)} km`} sub={`${int(F.train)} trains`} />
        <Kpi label="Liaison express" value={`${int(N.tgvKm)} km`} sub={`${int(F.tgv)} rames`} />
        <Kpi label="Bus" value={int(F.busDiesel + F.busElectric)} sub={`${pct(F.busElectric / Math.max(1, F.busDiesel + F.busElectric), 0)} électriques`} />
        <Kpi label="Voies rapides" value={`${int(N.motorwayKm)} km`} sub={`avenues ${int(N.roadKm)} km`} />
        <Kpi label="État de la voirie" value={`${Math.round(N.roadCondition * 100)}/100`} />
        <Kpi label="Pistes cyclables" value={`${int(N.cycleKm)} km`} />
        <Kpi label="Bornes de recharge" value={int(N.chargers)} sub={`${dec1(N.chargers / Math.max(1, F.cars * F.evShare) * 100)} pour 100 VE`} />
        <Kpi label="Voitures" value={people(F.cars)} sub={`${int(T.carSales)} ventes/an`} />
        <Kpi label="Aéroport" value={`${dec1(T.airports.passengers / 1e6)} M pass.`} sub={`capacité ${dec1(T.airports.capacity / 1e6)} M · ${pct(T.airports.utilisation, 0)}`} tone={T.airports.utilisation > 0.95 ? 'bad' : undefined} />
        <Kpi label="Port" value={kt(T.ports.tonnage)} sub={`capacité ${kt(T.ports.capacity)} · ${pct(T.ports.utilisation, 0)}`} tone={T.ports.utilisation > 0.95 ? 'bad' : undefined} />
        <Kpi label="Fret ferroviaire" value={pct(T.freightRailShare)} sub={`camions électriques ${pct(F.truckElectric, 0)}`} />
      </div>
      <Section title="Trafic des transports publics (voyageurs-km/an)">
        <Bars fmt={(v) => `${dec1(v / 1e9)} Md`} items={PT_MODES.map((m) => ({ label: PT_DEFS[m].name, value: T.pkmByPt[m] }))} />
      </Section>
      <Section title="Lignes et réseaux">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Élément</th><th>Taille</th><th>État</th></tr></thead>
          <tbody>{T.sites.filter((s) => s.kind !== 'bus').map((s) => <tr key={s.id}><td>{s.label}</td><td>{s.kind === 'bornes' ? `${int(s.size * 100)} bornes` : `${dec1(s.size)} km`}</td><td>{s.status === 'service' ? 'En service' : 'En construction'}</td></tr>)}</tbody>
        </table></div>
      </Section>
      <Section title="Exploitation">
        <p className="small">Coût d'exploitation des transports publics : <b>{money(T.opex)}</b>/an · recettes tarifaires : <b>{money(T.fareRevenue)}</b>/an · surcoûts imputés au budget : <b>{money(T.extraCost)}</b>/an · fiabilité : <b>{Math.round(T.reliability * 100)}/100</b> (budget « Transports publics »).</p>
      </Section>
    </>
  );
}

function TransportPrograms() {
  const snap = useStore((s) => s.snap);
  const [city, setCity] = useState(-1);
  const [vehicle, setVehicle] = useState<VehicleKind>('busElectrique');
  const [replace, setReplace] = useState(true);
  const T = snap?.transport;
  if (!snap || !T) return null;
  const urban: TransportProjectKind[] = ['metro', 'tram', 'velo', 'bornes'];
  const linear: TransportProjectKind[] = ['rail', 'tgv', 'autoroute'];
  const other: TransportProjectKind[] = ['renovation', 'fret', 'aeroport', 'port'];
  const cityId = city >= 0 ? city : undefined;
  return (
    <>
      <Section title="Chantiers en cours"><Projects list={T.projects} sites={T.sites} /></Section>
      <Section title="Réseaux de quartier" hint="Le tracé suit les avenues ou les lignes existantes du quartier choisi ; la ligne n'est utilisable qu'à la fin des travaux. Le matériel roulant initial est compris.">
        <QuarterSelect value={city} onChange={setCity} />
        {urban.map((k) => { const d = TRANSPORT_PROJECTS[k]; return <ProgramRow key={k} title={d.label} unit={d.unit} max={d.max} initial={k === 'bornes' ? 10 : k === 'velo' ? 50 : 8} unitCost={d.costPerUnit} months={d.months} make={(n) => ({ type: 'transport:build', kind: k, size: n, cityId })} />; })}
      </Section>
      <Section title="Grandes liaisons" hint="Le moteur choisit la liaison prioritaire (quartiers les plus peuplés non encore desservis) et reprend le tracé des voies existantes ; la longueur, donc le coût, découle du tracé.">
        {linear.map((k) => { const d = TRANSPORT_PROJECTS[k]; return <ProgramRow key={k} title={d.label} desc="Longueur déterminée par le tracé retenu (estimation pour 10 km)." unit="(tracé automatique)" max={1} unitCost={d.costPerUnit * 10} months={() => d.months(10)} make={() => ({ type: 'transport:build', kind: k, size: 1 })} />; })}
      </Section>
      <Section title="Équipements">
        {other.map((k) => { const d = TRANSPORT_PROJECTS[k]; return <ProgramRow key={k} title={d.label} unit={d.unit} max={d.max} unitCost={d.costPerUnit} months={d.months} make={(n) => ({ type: 'transport:build', kind: k, size: n })} />; })}
      </Section>
      <Section title="Acheter du matériel roulant">
        <div className="row">
          <select className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleKind)}>
            {(Object.keys(VEHICLE_DEFS) as VehicleKind[]).map((v) => <option key={v} value={v}>{VEHICLE_DEFS[v].label} — {money(VEHICLE_DEFS[v].cost)} l'unité</option>)}
          </select>
          {vehicle === 'busElectrique' && <label className="small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> remplacer des bus diesel</label>}
        </div>
        <ProgramRow key={vehicle} title={VEHICLE_DEFS[vehicle].label} desc="Les rames ne roulent que dans la limite de la longueur des lignes (densité maximale)." unit="unités" max={2000} initial={vehicle.startsWith('bus') ? 200 : 10} unitCost={VEHICLE_DEFS[vehicle].cost} months={() => VEHICLE_DEFS[vehicle].delivery} make={(n) => ({ type: 'transport:buy', vehicle, count: n, replace })} />
      </Section>
    </>
  );
}

function TransportPolicyView() {
  const { policy, effective, edit } = usePolicy();
  if (!policy?.transport || !effective?.transport) return null;
  const p = policy.transport;
  const e = effective.transport;
  return (
    <Section title="Politique de mobilité" hint="Entre en vigueur au mois suivant après adoption des réformes.">
      <Slider label="Fréquences des transports publics" value={p.frequency} current={e.frequency} min={0.5} max={2.5} step={0.05} fmt={(v) => `×${dec1(v)}`} onChange={(v) => edit((q) => { q.transport!.frequency = v; })} hint="Au-delà de ×1,25, il faut acheter des véhicules. Le surcoût d'exploitation est imputé au budget des transports." />
      <Slider label="Niveau des tarifs" value={p.fareLevel} current={e.fareLevel} min={0} max={2.5} step={0.05} fmt={(v) => (v === 0 ? 'Gratuité' : `×${dec1(v)}`)} onChange={(v) => edit((q) => { q.transport!.fareLevel = v; })} hint="L'État compense les exploitants pour l'écart au tarif de référence." />
      <Slider label="Bonus véhicule électrique" value={p.evBonus} current={e.evBonus} min={0} max={15000} step={250} fmt={(v) => `${int(v)} €`} onChange={(v) => edit((q) => { q.transport!.evBonus = v; })} />
      <Slider label="Malus véhicule thermique neuf" value={p.thermalMalus} current={e.thermalMalus} min={0} max={30000} step={250} fmt={(v) => `${int(v)} €`} onChange={(v) => edit((q) => { q.transport!.thermalMalus = v; })} />
      <p className="muted small">Les taxes sur les carburants, le carbone et la taxe annuelle sur les véhicules thermiques se règlent au ministère de la Fiscalité ; elles modifient le coût des trajets, le choix modal et les ventes de véhicules électriques.</p>
    </Section>
  );
}

// ---------- Industrie ----------
export function IndustriePanel() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const { policy, effective, edit } = usePolicy();
  const I = snap?.industry;
  if (!snap || !I) return null;
  return (
    <Drawer title="Ministère de l'Industrie" icon="industrie" wide>
      <div className="kpis">
        <Kpi label="Production industrielle" value={money(I.production)} sub="valeur ajoutée réelle / an" />
        <Kpi label="Emplois" value={people(I.employees)} />
        <Kpi label="Usines" value={int(I.factories)} sub={`${I.zones} zones · ${int(I.zoneCapacity)} places`} />
        <Kpi label="Centres logistiques" value={int(I.logisticsCenters)} />
        <Kpi label="Exportations" value={money(I.exports)} sub="estimation / an" />
        <Kpi label="Productivité (technologie)" value={`×${I.productivityIndex.toFixed(3)}`} />
        <Kpi label="Intensité carbone" value={`×${I.emissionIndex.toFixed(3)}`} sub="effet des programmes" />
        <Kpi label="Émissions directes" value={mt(I.emissions)} sub="tCO₂/an" />
        <Kpi label="Énergie" value={`${dec1(I.energyMWh / 1e6)} TWh`} sub={`dont électricité ${pct(I.electricityShare, 0)}`} />
        <Kpi label="Hydrogène bas carbone" value={kt(I.hydrogenT)} sub="par an" />
        <Kpi label="Matières recyclées" value={pct(I.recycledShare, 0)} sub="des intrants" />
      </div>
      <Section title="Adoption des technologies (part du parc industriel)">
        <Bars fmt={(v) => pct(v, 0)} max={1} items={INDUSTRY_PROGRAMS.map((p) => ({ label: PROGRAM_DEFS[p].name, value: I.adoption[p] }))} />
      </Section>
      <Section title="Évolution">
        <LineChart years={10} height={140} fmt={mt} series={[{ key: 'e', label: 'Émissions industrielles (t/an)', values: history.ind_emissions ?? [], color: '#ef476f' }]} />
      </Section>
      <Section title="Programmes en cours"><Projects list={I.projects} sites={I.sites} /></Section>
      <Section title="Plans de transformation" hint="Chaque tranche transforme une part du parc (rendements décroissants) à la fin du délai. Effets à adoption complète indiqués.">
        {INDUSTRY_PROGRAMS.map((p: IndustryProgram) => {
          const d = PROGRAM_DEFS[p];
          return <ProgramRow key={p} title={d.name} desc={`${d.desc} Productivité ${d.productivity >= 0 ? '+' : ''}${pct(d.productivity, 0)}, émissions −${pct(d.emission, 0)}.`} unit="tranches" max={10} unitCost={d.trancheCost} months={() => d.months} make={(n) => ({ type: 'industry:program', program: p, tranches: n })} />;
        })}
      </Section>
      <Section title="Équipements (placés dans la zone portuaire et les zones industrielles)">
        {(Object.keys(INDUSTRY_FACILITIES) as IndustryFacility[]).map((f) => { const d = INDUSTRY_FACILITIES[f]; return <ProgramRow key={f} title={d.name} desc={d.desc} unit="unités" max={5} unitCost={d.cost} months={() => d.months} make={(n) => ({ type: 'industry:build', facility: f, count: n })} />; })}
      </Section>
      {policy?.industry && effective?.industry && (
        <Section title="Politique industrielle">
          <Slider label="Subvention à l'investissement industriel propre" value={policy.industry.greenSubsidy} current={effective.industry.greenSubsidy} min={0} max={0.5} step={0.01} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.industry!.greenSubsidy = v; })} hint="Déclenche des investissements privés en électrification, récupération de chaleur et recyclage ; coût budgétaire actuel : affiché ci-dessous." />
          <p className="muted small">Investissement privé déclenché : {money(I.privateGreenInvestment)}/an · coût pour l'État : {money(I.subsidyCost)}/an.</p>
        </Section>
      )}
    </Drawer>
  );
}

// ---------- Agriculture ----------
export function AgriculturePanel() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const { policy, effective, edit } = usePolicy();
  const G = snap?.agriculture;
  if (!snap || !G) return null;
  const ap = policy?.agriculture;
  const ae = effective?.agriculture;
  return (
    <Drawer title="Ministère de l'Agriculture et de l'Alimentation" icon="agriculture" wide>
      <div className="kpis">
        <Kpi label="Surface agricole" value={`${int(G.landHa)} ha`} sub={`${int(G.farms)} exploitations`} />
        <Kpi label="Autosuffisance" value={pct(G.selfSufficiency, 0)} sub="production / consommation" tone={G.selfSufficiency < 0.08 ? 'warn' : undefined} />
        <Kpi label="Production" value={idx(G.production)} sub="indice (100 = départ)" />
        <Kpi label="Rendements" value={idx(G.yieldIndex)} sub="indice" />
        <Kpi label="Prix alimentaires" value={idx(G.foodPrice)} sub={`inflation alimentaire ${pct(G.foodInflation)}`} tone={G.foodInflation > 0.05 ? 'bad' : undefined} />
        <Kpi label="Importations" value={idx(G.imports)} sub="indice de volume" />
        <Kpi label="Sécheresse" value={G.drought > 0 ? `${Math.round(G.drought * 100)} %` : 'Aucune'} tone={G.drought > 0.3 ? 'bad' : undefined} />
        <Kpi label="Santé des sols" value={`${Math.round(G.soilHealth * 100)}/100`} />
        <Kpi label="Biodiversité" value={`${Math.round(G.biodiversity * 100)}/100`} />
        <Kpi label="Eau prélevée" value={`${dec1(G.waterM3 / 1e6)} Mm³`} sub={`irrigué ${pct(G.irrigatedShare, 0)} des cultures`} />
        <Kpi label="Pesticides" value={`${int(G.pesticideKg / 1000)} t`} sub="substances actives / an" />
        <Kpi label="Engrais azotés" value={`${int(G.nitrogenT)} t N`} />
        <Kpi label="Cheptel" value={int(G.livestock)} sub="UGB" />
        <Kpi label="Émissions agricoles" value={mt(G.emissions.total)} sub={`CH₄ ${kt(G.emissions.ch4t)} · N₂O ${kt(G.emissions.n2ot)}`} />
        <Kpi label="Aides versées" value={money(G.aidCost)} sub="par an" />
      </div>
      <div className="cols">
        <Section title="Pratiques (part des surfaces)"><Bars fmt={(v) => pct(v, 0)} max={1} items={PRACTICES.map((p) => ({ label: PRACTICE_DEFS[p].name, value: G.practices[p] }))} /></Section>
        <Section title="Émissions (tCO₂e/an)"><Bars fmt={mt} items={[{ label: 'Méthane (élevage)', value: G.emissions.ch4 }, { label: 'Protoxyde d\'azote (engrais)', value: G.emissions.n2o }, { label: 'CO₂ (engins, serres)', value: G.emissions.co2 }]} /></Section>
      </div>
      <Section title="Prix et production">
        <LineChart years={10} height={150} fmt={idx} series={[
          { key: 'f', label: 'Prix alimentaires', values: history.agri_foodPrice ?? [], color: '#ef476f' },
          { key: 'p', label: 'Production', values: history.agri_production ?? [], color: '#06d6a0' },
        ]} />
      </Section>
      {ap && ae && (
        <Section title="Politique agricole" hint="Effets progressifs : conversion bio ~3 ans, équipement de précision ~2 ans, réglementations sur 12 mois.">
          <Slider label="Aide à l'agriculture biologique" value={ap.bioAid} current={ae.bioAid} min={0} max={1500} step={25} fmt={(v) => `${int(v)} €/ha`} onChange={(v) => edit((q) => { q.agriculture!.bioAid = v; })} hint="Moins de pesticides et d'azote, sols et biodiversité en hausse, mais rendements −28 % et coûts plus élevés." />
          <Slider label="Aide à l'agriculture de précision" value={ap.precisionAid} current={ae.precisionAid} min={0} max={600} step={10} fmt={(v) => `${int(v)} €/ha`} onChange={(v) => edit((q) => { q.agriculture!.precisionAid = v; })} />
          <Slider label="Réduction des pesticides" value={ap.pesticideReduction} current={ae.pesticideReduction} min={0} max={0.8} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.agriculture!.pesticideReduction = v; })} />
          <Slider label="Réduction des engrais azotés" value={ap.fertilizerReduction} current={ae.fertilizerReduction} min={0} max={0.6} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.agriculture!.fertilizerReduction = v; })} />
          <Slider label="Protection des sols (couverts, rotations)" value={ap.soilProtection} current={ae.soilProtection} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.agriculture!.soilProtection = v; })} />
          <Slider label="Irrigation économe en eau" value={ap.waterEfficiency} current={ae.waterEfficiency} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.agriculture!.waterEfficiency = v; })} />
          <Slider label="Réduction aidée du cheptel" value={ap.herdReduction} current={ae.herdReduction} min={0} max={0.4} step={0.02} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.agriculture!.herdReduction = v; })} />
        </Section>
      )}
      <Section title="Programmes en cours"><Projects list={G.projects} sites={G.sites} /></Section>
      <Section title="Programmes (placés dans les quartiers périphériques agricoles)">
        {(Object.keys(AGRI_PROJECTS) as AgricultureProject[]).map((k) => { const d = AGRI_PROJECTS[k]; return <ProgramRow key={k} title={d.name} desc={d.desc} unit="unités" max={d.max} unitCost={d.cost} months={() => d.months} make={(n) => ({ type: 'agriculture:build', project: k, count: n })} />; })}
      </Section>
    </Drawer>
  );
}

// ---------- Déchets ----------
export function DechetsPanel() {
  const snap = useStore((s) => s.snap);
  const history = useStore((s) => s.history);
  const { policy, effective, edit } = usePolicy();
  const W = snap?.waste;
  if (!snap || !W) return null;
  const wp = policy?.waste;
  const we = effective?.waste;
  const capRows: [keyof typeof W.capacity, WasteRoute][] = [['tri', 'tri'], ['recyclage', 'recyclage'], ['compostage', 'compostage'], ['methanisation', 'methanisation'], ['incineration', 'incineration']];
  const years = W.landfillRemaining / Math.max(1, W.flows.enfouissement);
  return (
    <Drawer title="Ministère des Déchets et du Recyclage" icon="recyclage" wide>
      <div className="kpis">
        <Kpi label="Déchets produits" value={kt(W.household + W.industrial)} sub="par an" />
        <Kpi label="Déchets ménagers" value={`${int(W.perCapita)} kg`} sub="par habitant et par an" />
        <Kpi label="Taux de valorisation" value={pct(W.recyclingRate)} sub="recyclage + compost + méthanisation" />
        <Kpi label="Enfouissement" value={pct(W.landfillRate)} tone={W.landfillRate > 0.35 ? 'warn' : undefined} />
        <Kpi label="Tri des ménages" value={pct(W.sortingRate, 0)} sub="des recyclables" />
        <Kpi label="Stockage restant" value={W.flows.enfouissement > 0 ? `${dec1(years)} ans` : kt(W.landfillRemaining)} sub={kt(W.landfillRemaining)} tone={years < 3 && W.flows.enfouissement > 0 ? 'bad' : undefined} />
        <Kpi label="Coût de traitement" value={money(W.cost)} sub={`${int(W.costPerCapita)} €/hab/an`} />
        <Kpi label="Émissions" value={mt(W.emissions)} sub="tCO₂e/an" />
        <Kpi label="Énergie récupérée" value={`${int(W.energyMWh / 1000)} GWh`} sub="électricité / an" />
      </div>
      <div className="cols">
        <Section title="Production par catégorie (t/an)"><Bars fmt={kt} items={WASTE_CATS.map((c) => ({ label: WASTE_CAT_NAMES[c], value: W.generated[c] }))} /></Section>
        <Section title="Orientation des flux (t/an)"><Bars fmt={kt} items={(Object.keys(W.flows) as WasteRoute[]).map((r) => ({ label: WASTE_ROUTE_NAMES[r], value: W.flows[r], color: r === 'enfouissement' || r === 'export' ? 'var(--bad)' : undefined }))} /></Section>
      </div>
      <Section title="Capacités des installations">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Filière</th><th>Flux</th><th>Capacité</th><th>Utilisation</th><th>Installations</th></tr></thead>
          <tbody>{capRows.map(([k, r]) => <tr key={k}><td>{WASTE_ROUTE_NAMES[r]}</td><td>{kt(W.flows[r])}</td><td>{kt(W.capacity[k])}</td><td>{pct(W.flows[r] / Math.max(1, W.capacity[k]), 0)}</td><td>{W.sites.filter((s) => s.kind === k && s.status === 'service').length}{W.sites.some((s) => s.kind === k && s.status === 'construction') ? ' (+ en construction)' : ''}</td></tr>)}</tbody>
        </table></div>
      </Section>
      <Section title="Évolution">
        <LineChart years={10} height={140} fmt={kt} series={[{ key: 'l', label: 'Enfouissement (t/an)', values: history.waste_landfill ?? [], color: '#ef476f' }]} />
      </Section>
      {wp && we && (
        <Section title="Politique des déchets" hint="La taxe sur les déchets (ministère de la Fiscalité) réduit la production et incite au tri.">
          <Slider label="Tarification incitative et consignes de tri" value={wp.sortingIncentive} current={we.sortingIncentive} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.waste!.sortingIncentive = v; })} />
          <Slider label="Collecte séparée des biodéchets" value={wp.organicCollection} current={we.organicCollection} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((q) => { q.waste!.organicCollection = v; })} hint="Nécessite des capacités de compostage et de méthanisation." />
          <Slider label="Prévention (consigne, réemploi, emballages)" value={wp.prevention} current={we.prevention} min={0} max={0.4} step={0.02} fmt={(v) => `−${pct(v, 0)}`} onChange={(v) => edit((q) => { q.waste!.prevention = v; })} />
        </Section>
      )}
      <Section title="Programmes en cours"><Projects list={W.projects} sites={W.sites} /></Section>
      <Section title="Construire des installations (placées automatiquement dans les quartiers les moins équipés)">
        {(Object.keys(WASTE_FACILITIES) as WasteFacility[]).map((f) => { const d = WASTE_FACILITIES[f]; return <ProgramRow key={f} title={d.name} desc={`+${kt(d.capacity)} (${d.unit}) par unité, entretien ${money(d.maintenance)}/an.`} unit="unités" max={10} unitCost={d.cost} months={() => d.months} make={(n) => ({ type: 'waste:build', facility: f, count: n })} />; })}
      </Section>
    </Drawer>
  );
}
