// Équipements et urbanisme : catalogue (coûts, durées, capacités), programmes d'investissement à placement
// automatique, chantiers en cours, parc d'équipements (amélioration, rénovation, démolition), parcs par quartier.
import { useEffect, useState } from 'react';
import { BUILDINGS, BUILD_TYPES, MAX_LEVEL, type BuildCategory } from '../../../shared/sim/construction';
import type { CityFacilities } from '../../../shared/sim/services';
import type { InfraType } from '../../../shared/sim/types';
import { useStore } from '../store';
import { fetchFacilities, serviceAction } from '../net';
import { int, money, people } from '../format';
import { Drawer, Kpi, Meter, Section, Tabs } from './common';
import { ProgrammeBox, SitesList, usePriceRel } from './servicesCommon';
import { Icon } from './Icon';

const CATS: [BuildCategory, string][] = [
  ['sante', 'Santé'], ['education', 'Éducation & recherche'], ['securite', 'Sécurité & justice'], ['logement', 'Logement'],
  ['zones', 'Activités'], ['transport', 'Transports'], ['energie', 'Énergie'], ['loisirs', 'Loisirs'],
];

export function ConstructionPanel() {
  const [tab, setTab] = useState<'programmes' | 'catalogue' | 'parc' | 'quartiers'>('programmes');
  return (
    <Drawer title="Équipements & Urbanisme" icon="equipements" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['programmes', 'Programmes & chantiers'], ['catalogue', 'Catalogue'], ['parc', 'Parc d\'équipements'], ['quartiers', 'Par quartier']]} />
      {tab === 'programmes' && <Programmes />}
      {tab === 'catalogue' && <Catalogue />}
      {tab === 'parc' && <Parc />}
      {tab === 'quartiers' && <Quartiers />}
    </Drawer>
  );
}

function Programmes() {
  const snap = useStore((s) => s.snap);
  const [cat, setCat] = useState<BuildCategory>('sante');
  const K = snap?.construction;
  if (!snap || !K) return null;
  const types = BUILD_TYPES.filter((t) => BUILDINGS[t].category === cat);
  return (
    <>
      <div className="kpis">
        <Kpi label="Dépenses d'équipement" value={`${money(K.spend.total)}/an`} sub="chantiers, entretien, logement, démolitions" />
        <Kpi label="Chantiers" value={money(K.spend.chantiers)} sub="€/an (paiements mensuels)" />
        <Kpi label="Entretien des nouveaux équipements" value={money(K.spend.entretien)} sub="€/an" />
        <Kpi label="Recettes des équipements" value={money(K.revenue)} sub="€/an" />
        <Kpi label="Chantiers en cours" value={int(K.sites.length)} />
        <Kpi label="Mises en service" value={int(K.completed)} sub="depuis le début" />
      </div>
      <Section title="Famille d'équipements">
        <Tabs<BuildCategory> value={cat} onChange={setCat} tabs={CATS} />
      </Section>
      <ProgrammeBox key={cat} types={types} />
      <Section title="Tous les chantiers"><SitesList /></Section>
    </>
  );
}

function Catalogue() {
  const pr = usePriceRel();
  const snap = useStore((s) => s.snap);
  return (
    <>
      {CATS.map(([c, label]) => (
        <Section key={c} title={label}>
          <table className="table">
            <thead><tr><th>Équipement</th><th>Coût</th><th>Durée</th><th>Capacité</th><th>Entretien/an</th><th>Emplois</th><th>Énergie MWh/an</th><th>CO₂ t/an</th><th>Recettes/an</th></tr></thead>
            <tbody>
              {BUILD_TYPES.filter((t) => BUILDINGS[t].category === c).map((t) => {
                const d = BUILDINGS[t];
                const locked = d.requires && !snap?.research?.unlocked.includes(d.requires);
                return (
                  <tr key={t} title={d.description} className={locked ? 'muted' : ''}>
                    <td><Icon name={d.icon} size={15} />{d.name}{locked && <> <Icon name="verrou" size={13} title="Technologie requise" /></>}</td><td>{money(d.cost * pr)}</td><td>{d.months} mois</td><td>{int(d.capacity)} {d.capacityUnit}</td>
                    <td>{money(d.maintenance * pr)}</td><td>{int(d.employees)}</td><td>{int(d.energyMWh)}</td><td>{int(d.emissions)}</td><td>{d.revenue ? money(d.revenue * pr) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ))}
      <p className="small muted">Montants aux prix actuels. L'entretien des équipements construits pendant la partie est payé sur la trésorerie (poste « équipements ») ; le personnel est financé par le budget du ministère. Amélioration : 45 % du coût × niveau, capacité +30 % ; rénovation : 25 % du coût, état remis à neuf et énergie −20 %.</p>
    </>
  );
}

function Parc() {
  const country = useStore((s) => s.country);
  const snap = useStore((s) => s.snap);
  const pr = usePriceRel();
  const [cat, setCat] = useState<BuildCategory>('sante');
  const [district, setDistrict] = useState<number | -1>(-1);
  if (!country || !snap) return null;
  const works = new Map((snap.construction?.sites ?? []).filter((s) => s.infraId !== null).map((s) => [s.infraId, s]));
  const list = country.infra.filter((i) => BUILDINGS[i.type]?.category === cat && (district < 0 || i.cityId === district));
  const districts = [...country.cities].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return (
    <>
      <div className="row">
        <Tabs<BuildCategory> value={cat} onChange={setCat} tabs={CATS} />
        <select value={district} onChange={(e) => setDistrict(Number(e.target.value))}>
          <option value={-1}>Tous les quartiers</option>
          {districts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <table className="table">
        <thead><tr><th>Équipement</th><th>Quartier</th><th>Capacité</th><th>Niveau</th><th>État</th><th>Actions</th></tr></thead>
        <tbody>
          {list.map((i) => {
            const d = BUILDINGS[i.type];
            const w = works.get(i.id);
            const building = i.status === 'chantier';
            return (
              <tr key={i.id}>
                <td><Icon name={d.icon} size={15} />{i.name}</td>
                <td>{i.cityId !== null ? country.cities[i.cityId]?.name : '—'}</td>
                <td>{people(i.capacity)} {i.capacityUnit}</td>
                <td>{i.level}</td>
                <td>{building ? `Chantier ${Math.round((i.progress ?? 0) * 100)} %` : <Meter value={i.condition ?? 1} max={1} />}</td>
                <td>
                  {building ? <span className="small muted">en construction</span> : w ? <span className="small muted">travaux en cours</span> : (
                    <div className="row">
                      <button className="btn ghost" disabled={i.level >= MAX_LEVEL} title={`Coût ≈ ${money(d.cost * 0.45 * i.level * pr)}`} onClick={() => serviceAction({ type: 'ameliorer', infraId: i.id })}>Améliorer</button>
                      <button className="btn ghost" title={`Coût ≈ ${money(d.cost * 0.25 * pr)}`} onClick={() => serviceAction({ type: 'renover', infraId: i.id })}>Rénover</button>
                      <button className="btn ghost" title={`Coût ≈ ${money(d.cost * 0.08 * pr)}`} onClick={() => { if (confirm(`Démolir « ${i.name} » ? La capacité correspondante sera perdue.`)) void serviceAction({ type: 'demolir', infraId: i.id }); }}>Démolir</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {!list.length && <tr><td colSpan={6} className="muted">Aucun équipement de ce type sur la carte : les capacités existent dans des établissements plus petits, non représentés individuellement.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Quartiers() {
  const country = useStore((s) => s.country);
  const month = useStore((s) => s.snap?.month);
  const [rows, setRows] = useState<CityFacilities[]>([]);
  useEffect(() => { void fetchFacilities().then(setRows); }, [month]);
  if (!country) return null;
  return (
    <Section title="Parc de capacités par quartier" hint="Équipements de la carte situés dans le quartier, complétés au prorata de la population par les établissements non représentés individuellement.">
      <table className="table">
        <thead><tr><th>Quartier</th><th>Lits</th><th>Médecins</th><th>Places scolaires</th><th>Enseignants</th><th>Policiers</th><th>Pompiers</th><th>Logements</th><th>Chantiers</th></tr></thead>
        <tbody>
          {[...rows].sort((a, b) => b.housing - a.housing).map((r) => (
            <tr key={r.cityId}>
              <td>{country.cities[r.cityId]?.name}</td><td>{int(r.beds)}</td><td>{int(r.doctors)}</td><td>{people(r.schoolPlaces)}</td><td>{int(r.teachers)}</td>
              <td>{int(r.police)}</td><td>{int(r.firefighters)}</td><td>{people(r.housing)}</td><td>{r.underConstruction || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export type { InfraType };
