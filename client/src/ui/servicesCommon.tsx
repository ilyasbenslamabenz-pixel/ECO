// Briques communes aux ministères des services publics : budget, leviers, recrutements, programmes d'investissement.
import { useState } from 'react';
import type { BudgetLine } from '../../../shared/sim/data';
import { BUILDINGS } from '../../../shared/sim/construction';
import type { InfraType, Policy } from '../../../shared/sim/types';
import { useStore } from '../store';
import { serviceAction } from '../net';
import { int, money } from '../format';
import { Section, Slider, usePolicy } from './common';
import { Icon } from './Icon';

/** Indice des coûts des services publics (salaire moyen / salaire moyen initial), comme côté serveur. */
export function usePriceRel() {
  const snap = useStore((s) => s.snap);
  if (!snap) return 1;
  return snap.baseline.meanWage > 0 && snap.accounts.meanWage > 0 ? snap.accounts.meanWage / snap.baseline.meanWage : snap.macro.priceLevel;
}

/** Curseur du budget annuel d'une ligne (modifie le brouillon de réformes). */
export function BudgetSlider({ line, label }: { line: BudgetLine; label: string }) {
  const { policy, effective, edit } = usePolicy();
  if (!policy || !effective) return null;
  const cur = effective.budget[line];
  return (
    <Slider label={label} value={policy.budget[line]} current={cur} min={0} max={Math.max(cur * 2, policy.budget[line])} step={Math.max(1e6, Math.round(cur / 400))}
      fmt={money} onChange={(v) => edit((p) => { p.budget[line] = v; })}
      hint="Enveloppe annuelle. Elle finance les postes, le fonctionnement, l'investissement et la prévention ; une coupe se traduit d'abord par des départs non remplacés et des achats reportés, puis par une dégradation progressive." />
  );
}

type Sub = 'health' | 'education' | 'housing' | 'security' | 'research';
/** Curseur d'un levier d'une sous-politique (santé, éducation…). */
export function Lever<K extends Sub>({ sub, k, label, min, max, step, fmt, hint }: { sub: K; k: keyof Policy[K] & string; label: string; min: number; max: number; step: number; fmt: (v: number) => string; hint?: string }) {
  const { policy, effective, edit } = usePolicy();
  if (!policy || !effective || !policy[sub]) return null;
  const val = Number((policy[sub] as unknown as Record<string, number>)[k]);
  const cur = Number((effective[sub] as unknown as Record<string, number>)?.[k] ?? val);
  return <Slider label={label} value={val} current={cur} min={min} max={max} step={step} fmt={fmt} hint={hint}
    onChange={(v) => edit((p) => { (p[sub] as unknown as Record<string, number>)[k] = v; })} />;
}

/** Formulaire de recrutement exceptionnel (postes créés et financés immédiatement, prise de poste différée). */
export function RecruitBox({ service, roles }: { service: 'sante' | 'education' | 'securite'; roles: { id: string; label: string; cost: number; delay: number; staff: number }[] }) {
  const [role, setRole] = useState(roles[0]?.id ?? '');
  const [count, setCount] = useState(1000);
  const pr = usePriceRel();
  const r = roles.find((x) => x.id === role) ?? roles[0];
  if (!r) return null;
  const max = Math.max(100, Math.floor(r.staff * 0.15 / 100) * 100);
  return (
    <Section title="Plan de recrutement" hint="Les postes sont créés et le budget du ministère relevé de leur coût annuel. Les recrues prennent leur poste après le délai de recrutement et de formation.">
      <div className="row">
        <select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <input type="number" min={100} max={max} step={100} value={count} onChange={(e) => setCount(Math.max(0, Math.min(max, Number(e.target.value))))} style={{ width: 110 }} />
        <button className="btn primary" disabled={count <= 0} onClick={() => serviceAction({ type: 'recruter', service, role: role as never, count })}>Recruter</button>
      </div>
      <p className="small muted">Coût : ≈ {money(count * r.cost * pr)}/an · prise de poste dans {r.delay} mois · effectif actuel {int(r.staff)} · maximum {int(max)} par plan.</p>
    </Section>
  );
}

/** Programme d'investissement : le moteur choisit et valide lui-même les emplacements dans le quartier ciblé. */
export function ProgrammeBox({ types, title = 'Programme d\'investissement' }: { types: InfraType[]; title?: string }) {
  const country = useStore((s) => s.country);
  const snap = useStore((s) => s.snap);
  const pr = usePriceRel();
  const [type, setType] = useState<InfraType>(types[0]);
  const [cityId, setCityId] = useState<number>(() => country?.cities.find((c) => c.capital)?.id ?? 0);
  const [count, setCount] = useState(1);
  if (!country || !snap) return null;
  const def = BUILDINGS[type];
  const locked = def.requires && !snap.research?.unlocked.includes(def.requires);
  const districts = [...country.cities].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return (
    <Section title={title} hint="Choisissez un équipement et un quartier : l'emplacement est déterminé et vérifié automatiquement (terre ferme, pente, espacement, accès à une voie). Le chantier apparaît sur la carte jusqu'à sa mise en service ; il est payé chaque mois sur la trésorerie.">
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value as InfraType)}>{types.map((t) => <option key={t} value={t}>{BUILDINGS[t].name}</option>)}</select>
        <select value={cityId} onChange={(e) => setCityId(Number(e.target.value))}>{districts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value))))} style={{ width: 60 }} />
        <button className="btn primary" disabled={!!locked} onClick={() => serviceAction({ type: 'programme', building: type, cityId, count })}>Lancer</button>
      </div>
      <p className="small muted">
        {def.description} — {count} × {money(def.cost * pr)} = <b>{money(count * def.cost * pr)}</b>, {def.months} mois de chantier, capacité {int(def.capacity)} {def.capacityUnit}, entretien {money(def.maintenance * pr)}/an
        {def.revenue > 0 && <>, recettes {money(def.revenue * pr)}/an</>}.
        {locked && <b className="bad"> Technologie requise.</b>}
      </p>
    </Section>
  );
}

/** Chantiers en cours d'une famille d'équipements. */
export function SitesList({ types }: { types?: InfraType[] }) {
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  const sites = (snap?.construction?.sites ?? []).filter((s) => !types || types.includes(s.type));
  if (!sites.length) return <p className="small muted">Aucun chantier en cours.</p>;
  return (
    <table className="table">
      <thead><tr><th>Chantier</th><th>Quartier</th><th>Avancement</th><th>Coût</th><th /></tr></thead>
      <tbody>
        {sites.map((s) => (
          <tr key={s.id}>
            <td><Icon name={BUILDINGS[s.type]?.icon} size={15} />{s.name}{s.kind !== 'construction' && <em className="muted"> ({s.kind === 'amelioration' ? 'amélioration' : 'rénovation'})</em>}</td>
            <td>{s.cityId !== null ? country?.cities[s.cityId]?.name : '—'}</td>
            <td><div className="meter"><div style={{ width: `${(s.elapsed / s.months) * 100}%`, background: 'var(--accent)' }} /></div><span className="small">{s.elapsed}/{s.months} mois</span></td>
            <td>{money(s.cost)}</td>
            <td><button className="btn ghost" onClick={() => { if (confirm(`Annuler « ${s.name} » ? Les sommes déjà engagées sont perdues.`)) void serviceAction({ type: 'annulerChantier', siteId: s.id }); }}>Annuler</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const x100 = (v: number) => `${Math.round(v * 100)}`;
export const idx = (v: number) => `${Math.round(v * 100)} %`;
