// Ministère de la Santé : personnels, lits, réseau de soins, attente, couverture, leviers budgétaires.
import { useState } from 'react';
import { HEALTH_ROLES } from '../../../shared/sim/health';
import { useStore } from '../store';
import { dec1, eur, int, pct } from '../format';
import { Drawer, Kpi, Meter, Section, Tabs } from './common';
import { LineChart } from './charts';
import { BudgetSlider, idx, Lever, ProgrammeBox, RecruitBox, SitesList, usePriceRel } from './servicesCommon';

export function SantePanel() {
  const [tab, setTab] = useState<'etat' | 'politique' | 'investir'>('etat');
  return (
    <Drawer title="Ministère de la Santé" icon="sante" wide>
      <Tabs value={tab} onChange={setTab} tabs={[['etat', 'État du système'], ['politique', 'Budget & leviers'], ['investir', 'Recruter & construire']]} />
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
  const H = snap?.health;
  if (!snap || !H) return null;
  const pop = snap.demography.cohorts.reduce((s, v) => s + v, 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="Qualité des soins" value={`${Math.round(H.quality * 100)}/100`} tone={H.quality < 0.6 ? 'bad' : H.quality > 0.78 ? 'good' : 'warn'} hint="Capacité de soins (médecins, infirmiers, lits, approvisionnement, état des établissements) rapportée aux besoins d'une population vieillissante." />
        <Kpi label="Espérance de vie" value={`${dec1(snap.demography.lifeExpectancy)} ans`} />
        <Kpi label="Mortalité" value={`${dec1(H.mortality)} ‰`} sub="décès / 1 000 hab./an" />
        <Kpi label="Attente spécialiste" value={`${Math.round(H.waitDays)} j`} tone={H.waitDays > 60 ? 'bad' : H.waitDays > 40 ? 'warn' : 'good'} />
        <Kpi label="Délai des secours" value={`${Math.round(H.emergencyWait)} min`} />
        <Kpi label="Couverture" value={pct(H.coverage)} sub="accès effectif aux soins" />
        <Kpi label="Satisfaction des patients" value={`${Math.round(H.patientSatisfaction)}/100`} />
        <Kpi label="Coût par habitant" value={eur(H.costPerCapita)} sub="budget public / an" />
        <Kpi label="Charge du personnel" value={idx(H.overload)} tone={H.overload > 1.15 ? 'bad' : undefined} hint="Au-delà de 100 %, la surcharge augmente les démissions." />
      </div>
      <Section title="Moyens">
        <table className="table">
          <thead><tr><th>Ressource</th><th>En poste / ouverts</th><th>Financés</th><th>Pour 1 000 hab.</th></tr></thead>
          <tbody>
            <tr><td>Médecins</td><td>{int(H.doctors.staff)}</td><td>{int(H.doctors.posts)}</td><td>{dec1(H.doctors.staff / pop * 1000)}</td></tr>
            <tr><td>Infirmiers</td><td>{int(H.nurses.staff)}</td><td>{int(H.nurses.posts)}</td><td>{dec1(H.nurses.staff / pop * 1000)}</td></tr>
            <tr><td>Lits</td><td>{int(H.openBeds)}</td><td>{int(H.plan.beds)} (installés {int(H.installedBeds)})</td><td>{dec1(H.openBeds / pop * 1000)}</td></tr>
            <tr><td>Cliniques</td><td colSpan={2}>{int(H.clinics)}</td><td>—</td></tr>
            <tr><td>Centres médicaux</td><td colSpan={2}>{int(H.medicalCenters)}</td><td>—</td></tr>
            <tr><td>Pharmacies</td><td colSpan={2}>{int(H.pharmacies)}</td><td>{dec1(H.pharmacies / pop * 1000)}</td></tr>
            <tr><td>Ambulances</td><td colSpan={2}>{int(H.ambulances)}</td><td>{dec1(H.ambulances / pop * 1000)}</td></tr>
            <tr><td>Services d'urgences</td><td colSpan={2}>{int(H.emergencyUnits)}</td><td>—</td></tr>
          </tbody>
        </table>
        <p className="small">Approvisionnement <Meter value={H.supply} max={1.2} /> État des établissements <Meter value={H.condition} max={1} /></p>
        <p className="small muted">Recrutements sur 12 mois : {int(H.hiredYear)} · vivier de diplômés : médecins {idx(H.trainingDoctors)}, infirmiers {idx(H.trainingNurses)}.</p>
      </Section>
      <Section title="Évolution">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['all', 'Tout']]} />
        <LineChart years={years} height={150} fmt={(v) => `${Math.round(v)} j`} series={[{ key: 'w', label: 'Attente (jours)', values: history.sante_attente ?? [], color: '#ef476f' }]} />
        <LineChart years={years} height={150} fmt={(v) => `${Math.round(v * 100)}`} series={[{ key: 'q', label: 'Qualité des soins', values: history.sante_qualite ?? [], color: '#06d6a0' }, { key: 'c', label: 'Couverture', values: history.sante_couverture ?? [], color: '#4cc9f0' }]} />
        <LineChart years={years} height={150} fmt={int} series={[{ key: 'd', label: 'Médecins', values: history.sante_medecins ?? [], color: '#ffd166' }]} />
      </Section>
    </>
  );
}

function Politique() {
  return (
    <>
      <Section title="Budget">
        <BudgetSlider line="sante" label="Budget de la santé (€/an)" />
      </Section>
      <Section title="Leviers" hint="Toutes les réformes entrent en vigueur au 1er du mois suivant.">
        <Lever sub="health" k="wageIndex" label="Rémunération du personnel" min={0.7} max={1.6} step={0.01} fmt={idx} hint="Mieux payer attire et retient les soignants, mais chaque poste coûte plus cher." />
        <Lever sub="health" k="bedOpening" label="Taux d'ouverture des lits installés" min={0.5} max={1} step={0.01} fmt={idx} hint="Fermer des lits libère des moyens pour le personnel, au prix d'une capacité moindre." />
        <Lever sub="health" k="investment" label="Part investissement (équipements, rénovation)" min={0} max={0.3} step={0.005} fmt={(v) => pct(v)} hint="Entretient l'état des hôpitaux, développe centres médicaux, ambulances et urgences." />
        <Lever sub="health" k="prevention" label="Part prévention" min={0} max={0.15} step={0.005} fmt={(v) => pct(v)} hint="Réduit les besoins de soins après quelques années." />
        <Lever sub="health" k="trainingSlots" label="Places de formation médicale" min={0.3} max={3} step={0.05} fmt={idx} hint="Effet sur le vivier de recrutement après 3 ans (infirmiers) à 6 ans (médecins)." />
        <Lever sub="health" k="copay" label="Reste à charge des patients" min={0} max={0.5} step={0.01} fmt={(v) => pct(v)} hint="Freine la demande de soins mais réduit l'accès et la satisfaction." />
      </Section>
    </>
  );
}

function Investir() {
  const snap = useStore((s) => s.snap);
  const H = snap?.health;
  const pr = usePriceRel();
  if (!H || !snap) return null;
  const w = snap.policy.health.wageIndex;
  return (
    <>
      <RecruitBox service="sante" roles={[
        { id: 'medecins', label: 'Médecins', cost: HEALTH_ROLES.medecins.cost * H.ref.costScale * w, delay: HEALTH_ROLES.medecins.delay, staff: H.doctors.staff },
        { id: 'infirmiers', label: 'Infirmiers', cost: HEALTH_ROLES.infirmiers.cost * H.ref.costScale * w, delay: HEALTH_ROLES.infirmiers.delay, staff: H.nurses.staff },
      ]} />
      <ProgrammeBox types={['hopital', 'clinique', 'centre_medical']} />
      <Section title="Chantiers de santé"><SitesList types={['hopital', 'clinique', 'centre_medical']} /></Section>
      <p className="small muted">Indice des coûts : {Math.round(pr * 100)} (salaires du secteur public).</p>
    </>
  );
}
