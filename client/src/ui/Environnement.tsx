// Ministère de l'Environnement : occupation des sols, puits de carbone, air, eau, biodiversité,
// programmes (reboisement périurbain, aires protégées, parcs urbains, zones humides littorales), objectifs.
import { useState } from 'react';
import { useStore } from '../store';
import { gameAction } from '../net';
import { money, pct, int, dec1 } from '../format';
import { Bars, Drawer, Info, Kpi, Meter, Section, Slider, Tabs, usePolicy } from './common';
import { LineChart } from './charts';
import { fmtKind } from './energyIndicators';
import { ENV_PROJECTS, LAND_CLASSES, LAND_NAMES, type EnvProjectKind } from '../../../shared/sim/environment';
import { ENERGY_INDICATORS } from '../../../shared/sim/energyIndicators';
import { Icon } from './Icon';

const LAND_COLORS: Record<string, string> = { foret: '#2d6a4f', jeuneForet: '#74c69d', agricole: '#e9c46a', naturel: '#b7e4c7', zonesHumides: '#48cae4', artificialise: '#8d99ae', espacesVerts: '#52b788', eau: '#0077b6' };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = (m: number, y0: number) => `${MONTHS[m % 12]} ${y0 + Math.floor(m / 12)}`;
const ha = (km2: number) => `${int(km2 * 100)} ha`;
const hint = (k: string) => { const d = ENERGY_INDICATORS[k]; return d ? `${d.def} (${d.unit}, ${d.period})` : undefined; };

export function EnvironnementPanel() {
  const [tab, setTab] = useState<'etat' | 'programmes' | 'historique'>('etat');
  return (
    <Drawer title="Ministère de l'Environnement et de la Biodiversité" icon="environnement" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['etat', 'État de l\'environnement'], ['programmes', 'Programmes & politiques'], ['historique', 'Historique']]} />
      {tab === 'etat' && <Etat />}
      {tab === 'programmes' && <Programmes />}
      {tab === 'historique' && <Historique />}
    </Drawer>
  );
}

function Etat() {
  const snap = useStore((s) => s.snap);
  const env = snap?.environment;
  const E = snap?.energy;
  if (!snap || !env) return <p className="muted">Module environnement indisponible pour cette partie.</p>;
  return (
    <>
      <div className="kpis">
        <Kpi label="Qualité environnementale" value={`${dec1(env.quality)}/100`} hint={hint('envQuality')} />
        <Kpi label="Biodiversité" value={`${dec1(env.biodiversity)}/100`} hint={hint('biodiversity')} tone={env.biodiversity < 45 ? 'bad' : undefined} />
        <Kpi label="Qualité de l'air" value={pct(env.airQuality, 0)} hint={hint('airQuality')} />
        <Kpi label="Qualité de l'eau" value={pct(env.waterQuality, 0)} hint={hint('waterQuality')} />
        <Kpi label="Espaces verts" value={`${dec1(env.greenPerCapita)} m²/hab.`} hint="Parcs et espaces verts urbains par habitant (référence : 50 m²)." />
        <Kpi label="Artificialisation" value={`${int(env.artificialisationRate * 100)} ha/an`} hint="Sols naturels, agricoles ou forestiers convertis en bâti, voirie ou emprises énergétiques (rythme annuel). Limitée par l'objectif « zéro artificialisation nette »." />
        <Kpi label="Absorptions" value={fmtKind('tco2', env.absorptions)} sub={`usage des sols : +${fmtKind('tco2', env.landUseEmissions)}`} hint={hint('absorptions')} />
      </div>
      <div className="cols">
        <Section title={`Occupation des sols (${int(env.landTotal)} km² de terres)`}>
          <Bars fmt={(v) => `${ha(v)} (${pct(v / env.landTotal)})`} items={LAND_CLASSES.map((k) => ({ label: LAND_NAMES[k], value: env.land[k], color: LAND_COLORS[k] }))} />
          <p className="muted small">Aires protégées : {ha(env.protectedKm2)} ({pct(env.protectedKm2 / env.landTotal)}) · mer : {int(env.seaKm2)} km².</p>
        </Section>
        <Section title="Puits de carbone (t CO₂/an)">
          <Bars fmt={(v) => fmtKind('tco2', v)} items={LAND_CLASSES.filter((k) => env.absorptionsBy[k] > 0).map((k) => ({ label: LAND_NAMES[k], value: env.absorptionsBy[k], color: LAND_COLORS[k] }))} />
          {E && <p className="muted small">Les absorptions réduisent les émissions nettes ({fmtKind('tco2', E.emissions.net)}), jamais les émissions brutes ({fmtKind('tco2', E.emissions.territorialGross)}).</p>}
        </Section>
      </div>
      {E && (
        <Section title="Objectifs climatiques">
          {E.goals.map((g) => (
            <div key={g.id} className="budget-line">
              <div className="row between"><b className="row" style={{ margin: 0, gap: 6 }}><Icon name={g.achieved ? 'valide' : 'objectifs'} size={15} />{g.name}<Info text={g.definition} /></b><span>{g.unit === '%' ? pct(g.value) : fmtKind('tco2', g.value)}</span></div>
              <Meter value={g.progress * 100} />
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function Programmes() {
  const snap = useStore((s) => s.snap);
  const { policy, effective, edit } = usePolicy();
  const [kind, setKind] = useState<EnvProjectKind>('reboisement');
  const [hectares, setHectares] = useState(500);
  const env = snap?.environment;
  if (!snap || !env || !policy?.energy || !effective?.energy) return null;
  const def = ENV_PROJECTS[kind];
  const km2 = hectares / 100;
  const cost = def.costPerKm2 * km2 * snap.macro.priceLevel;
  const gdp = snap.accounts.gdp;
  return (
    <>
      <Section title="Lancer un programme" hint="Le lieu est choisi automatiquement : parcs dans les quartiers, boisements en périphérie, zones humides sur le littoral. Le coût est réparti sur la durée du programme.">
        <div className="btn-row">
          {(Object.keys(ENV_PROJECTS) as EnvProjectKind[]).map((k) => <button key={k} className={`btn ${kind === k ? 'primary' : 'ghost'}`} onClick={() => setKind(k)}><Icon name={ENV_PROJECTS[k].icon} size={15} />{ENV_PROJECTS[k].name}</button>)}
        </div>
        <p className="muted small">{def.description}</p>
        <Slider label="Surface" value={hectares} min={10} max={kind === 'parc' ? 2000 : 20000} step={10} fmt={(v) => `${int(v)} ha`} onChange={setHectares} />
        <p className="muted small">Coût : {money(cost)} sur {def.months} mois{def.managementPerKm2 ? ` puis ${money(def.managementPerKm2 * km2 * snap.macro.priceLevel)}/an de gestion` : ''}.</p>
        <div className="btn-row"><button className="btn primary" onClick={() => gameAction({ type: 'envProject', kind, km2 })}><Icon name="construire" size={14} />Lancer : {int(hectares)} ha</button></div>
      </Section>
      <Section title="Programmes en cours">
        {env.projects.length === 0 ? <p className="muted">Aucun programme en cours.</p> : (
          <table className="table">
            <thead><tr><th>Programme</th><th>Achèvement</th><th>Coût</th><th>Avancement</th><th /></tr></thead>
            <tbody>{env.projects.map((p) => (
              <tr key={p.id}>
                <td><Icon name={ENV_PROJECTS[p.kind].icon} size={15} />{p.name}</td><td>{monthName(p.done, snap.startYear)}</td><td>{money(p.cost)}</td>
                <td style={{ minWidth: 90 }}><Meter value={Math.min(100, ((snap.month - p.start) / Math.max(1, p.done - p.start)) * 100)} tone="var(--accent)" /></td>
                <td><button className="btn ghost" onClick={() => gameAction({ type: 'envCancel', id: p.id })}>Abandonner</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>
      <Section title="Politiques environnementales">
        <Slider label="Objectif « zéro artificialisation nette »" value={policy.energy.zan} current={effective.energy.zan} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => edit((p) => { p.energy.zan = v; })} hint="Réduit jusqu'à 90 % l'extension urbaine sur les sols naturels et agricoles et freine le drainage des zones humides." />
        <Slider label="Assainissement et protection de l'eau" value={policy.energy.waterBudget} current={effective.energy.waterBudget} min={0} max={gdp * 0.005} step={Math.round(gdp * 0.0001)} fmt={money} onChange={(v) => edit((p) => { p.energy.waterBudget = v; })} />
        <Slider label="Crédits carbone internationaux" value={policy.energy.offsets} current={effective.energy.offsets} min={0} max={30e6} step={0.5e6} fmt={(v) => `${dec1(v / 1e6)} Mt/an`} onChange={(v) => edit((p) => { p.energy.offsets = v; })} hint="12 €/t. La compensation est affichée à part : elle ne réduit ni les émissions brutes ni les émissions territoriales nettes." />
        <p className="muted small">Le budget « Environnement » (Finances) améliore aussi la qualité de l'eau et la biodiversité.</p>
      </Section>
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
      <Section title="Indices (0–1)">
        <LineChart years={years} fmt={(v) => pct(v, 0)} series={[{ key: 'a', label: 'Air', values: h('airQuality'), color: '#4cc9f0' }, { key: 'w', label: 'Eau', values: h('waterQuality'), color: '#0077b6' }, { key: 'b', label: 'Biodiversité', values: h('biodiversity').map((v) => v / 100), color: '#52b788' }]} />
      </Section>
      <Section title="Occupation des sols">
        <LineChart years={years} height={140} fmt={(v) => pct(v)} series={[{ key: 'f', label: 'Forêts', values: h('forestShare'), color: '#2d6a4f' }, { key: 'a', label: 'Artificialisé', values: h('artifShare'), color: '#8d99ae' }, { key: 'p', label: 'Protégé', values: h('protectedShare'), color: '#ffd166' }]} />
      </Section>
      <Section title="Émissions nettes et absorptions">
        <LineChart years={years} height={140} fmt={(v) => fmtKind('tco2', v)} series={[{ key: 'n', label: 'Nettes', values: h('emissionsNet'), color: '#ffd166' }, { key: 'a', label: 'Absorptions', values: h('absorptions'), color: '#52b788' }]} />
      </Section>
    </>
  );
}
