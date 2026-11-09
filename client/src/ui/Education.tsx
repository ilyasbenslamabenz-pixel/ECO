// Ministère de l'Éducation et de la Recherche universitaire : élèves, enseignants, capacités, réussite, capital humain.
import { useState } from 'react';
import { EDUCATION_ROLES } from '../../../shared/sim/education';
import { useStore } from '../store';
import { dec1, eur, int, pct, people } from '../format';
import { Drawer, Kpi, Meter, Section, Tabs } from './common';
import { LineChart } from './charts';
import { BudgetSlider, idx, Lever, ProgrammeBox, RecruitBox, SitesList } from './servicesCommon';

export function EducationPanel() {
  const [tab, setTab] = useState<'etat' | 'politique' | 'investir'>('etat');
  return (
    <Drawer title="Ministère de l'Éducation" icon="education" wide>
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
  const D = snap?.education;
  if (!snap || !D) return null;
  return (
    <>
      <div className="kpis">
        <Kpi label="Qualité de l'enseignement" value={`${Math.round(D.quality * 100)}/100`} tone={D.quality < 0.6 ? 'bad' : D.quality > 0.78 ? 'good' : 'warn'} />
        <Kpi label="Réussite au baccalauréat" value={pct(D.successRate)} />
        <Kpi label="Décrochage scolaire" value={pct(D.dropout)} tone={D.dropout > 0.1 ? 'bad' : undefined} sub="jeunes sortis sans diplôme" />
        <Kpi label="Accès au supérieur" value={pct(D.enrollment)} sub={`${people(D.students)} étudiants`} />
        <Kpi label="Diplômés du supérieur" value={pct(D.qualification)} sub="25-64 ans" />
        <Kpi label="Capital humain" value={`${Math.round(D.humanCapital * 100)}/100`} hint="Qualification moyenne de la population active : évolue lentement (≈ 20 ans) et détermine la productivité future." />
        <Kpi label="Effet sur la productivité" value={`${D.productivityEffect >= 0 ? '+' : ''}${(D.productivityEffect * 100).toFixed(2).replace('.', ',')} pt/an`} />
        <Kpi label="Innovation" value={`${Math.round(D.innovation)}`} sub="100 = référence" />
        <Kpi label="Coût par élève" value={eur(D.costPerPupil)} sub="€/an" />
      </div>
      <Section title="Effectifs et capacités">
        <table className="table">
          <thead><tr><th>Niveau</th><th>Élèves / étudiants</th><th>Encadrement</th><th>Occupation des places</th></tr></thead>
          <tbody>
            <tr><td>École (3-10 ans)</td><td>{people(D.pupils.primaire)}</td><td rowSpan={3}>{dec1(D.pupilsPerTeacher)} élèves / enseignant ({int(D.teachers.staff)} en poste, {int(D.teachers.posts)} financés)</td><td rowSpan={3}>{pct(D.occupancySchool)} de {people(D.schoolPlaces)} places</td></tr>
            <tr><td>Collège (11-14 ans)</td><td>{people(D.pupils.college)}</td></tr>
            <tr><td>Lycée (15-17 ans)</td><td>{people(D.pupils.lycee)}</td></tr>
            <tr><td>Université</td><td>{people(D.students)}</td><td>{dec1(D.studentsPerLecturer)} étudiants / enseignant-chercheur ({int(D.lecturers.staff)})</td><td>{pct(D.occupancyUni)} de {people(D.uniPlaces)} places</td></tr>
            <tr><td>Formation professionnelle</td><td>{people(D.apprentices)}</td><td colSpan={2} className="muted">financée par la ligne « formation professionnelle »</td></tr>
          </tbody>
        </table>
        <p className="small">Moyens de fonctionnement <Meter value={D.supply} max={1.2} /> État du bâti scolaire <Meter value={D.condition} max={1} /></p>
      </Section>
      <Section title="Évolution">
        <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['all', 'Tout']]} />
        <LineChart years={years} height={150} fmt={(v) => pct(v)} series={[
          { key: 'r', label: 'Réussite', values: history.edu_reussite ?? [], color: '#06d6a0' },
          { key: 'd', label: 'Décrochage', values: history.edu_decrochage ?? [], color: '#ef476f' },
        ]} />
        <LineChart years={years} height={150} fmt={(v) => `${Math.round(v * 100)}`} series={[
          { key: 'q', label: 'Qualité', values: history.edu_qualite ?? [], color: '#4cc9f0' },
          { key: 'h', label: 'Capital humain', values: history.edu_capitalHumain ?? [], color: '#ffd166' },
        ]} />
      </Section>
    </>
  );
}

function Politique() {
  return (
    <>
      <Section title="Budget">
        <BudgetSlider line="education" label="Budget de l'éducation (€/an)" />
        <BudgetSlider line="formation" label="Formation professionnelle (€/an)" />
      </Section>
      <Section title="Leviers" hint="Les réformes entrent en vigueur au 1er du mois suivant ; leurs effets sur le capital humain prennent des années.">
        <Lever sub="education" k="wageIndex" label="Rémunération des enseignants" min={0.7} max={1.6} step={0.01} fmt={idx} hint="Attractivité du métier (vivier, démissions) contre coût par poste." />
        <Lever sub="education" k="investment" label="Part investissement (bâtiments, numérique)" min={0} max={0.3} step={0.005} fmt={(v) => pct(v)} />
        <Lever sub="education" k="trainingSlots" label="Postes ouverts aux concours" min={0.3} max={3} step={0.05} fmt={idx} hint="Augmente le vivier de recrutement après environ 4 ans." />
        <Lever sub="education" k="vocational" label="Part de la voie professionnelle" min={0.1} max={0.6} step={0.01} fmt={(v) => pct(v)} hint="Réduit le décrochage, diminue un peu l'accès au supérieur." />
        <Lever sub="education" k="tuition" label="Frais d'inscription universitaires" min={0} max={15000} step={100} fmt={eur} hint="Réduit le nombre d'étudiants." />
      </Section>
    </>
  );
}

function Investir() {
  const snap = useStore((s) => s.snap);
  const D = snap?.education;
  if (!D || !snap) return null;
  const w = snap.policy.education.wageIndex;
  return (
    <>
      <RecruitBox service="education" roles={[
        { id: 'enseignants', label: 'Enseignants', cost: EDUCATION_ROLES.enseignants.cost * D.ref.costScale * w, delay: EDUCATION_ROLES.enseignants.delay, staff: D.teachers.staff },
        { id: 'chercheurs', label: 'Enseignants-chercheurs', cost: EDUCATION_ROLES.chercheurs.cost * D.ref.costScale * w, delay: EDUCATION_ROLES.chercheurs.delay, staff: D.lecturers.staff },
      ]} />
      <ProgrammeBox types={['ecole', 'college', 'lycee', 'universite', 'centre_formation', 'laboratoire']} />
      <Section title="Chantiers"><SitesList types={['ecole', 'college', 'lycee', 'universite', 'centre_formation', 'laboratoire']} /></Section>
    </>
  );
}
