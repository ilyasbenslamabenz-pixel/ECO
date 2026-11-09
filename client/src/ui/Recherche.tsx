// Recherche et innovation : arbre technologique visuel (colonnes par profondeur de prérequis), file, effets.
import { useMemo } from 'react';
import { TECHS, TECH_INDEX, type TechDef } from '../../../shared/sim/research';
import { SECTORS } from '../../../shared/sim/data';
import { useStore } from '../store';
import { serviceAction } from '../net';
import { money, pct } from '../format';
import { Drawer, Kpi, Section } from './common';
import { BudgetSlider, Lever, usePriceRel } from './servicesCommon';
import { Icon } from './Icon';

const DOMAIN_COLOR: Record<string, string> = { energie: '#cfae78', industrie: '#8f8a82', agriculture: '#86b494', transport: '#8fa7c9', sante: '#d9705f', education: '#a98bb5', urbanisme: '#93b597', securite: '#c98a5e' };

function depth(t: TechDef, memo: Record<string, number> = {}): number {
  if (memo[t.id] !== undefined) return memo[t.id];
  const d = t.requires.length ? 1 + Math.max(...t.requires.map((r) => depth(TECH_INDEX[r], memo))) : 0;
  return (memo[t.id] = d);
}

export function RecherchePanel() {
  const snap = useStore((s) => s.snap);
  const pr = usePriceRel();
  const columns = useMemo(() => {
    const cols: TechDef[][] = [];
    for (const t of TECHS) (cols[depth(t)] ??= []).push(t);
    return cols;
  }, []);
  const R = snap?.research;
  if (!snap || !R) return null;
  const rate = R.effortMonthly;
  const status = (t: TechDef) => (R.unlocked.includes(t.id) ? 'fait' : R.active === t.id ? 'actif' : R.queue.includes(t.id) ? 'file' : t.requires.every((r) => R.unlocked.includes(r)) ? 'dispo' : 'verrou');
  const months = (t: TechDef) => Math.ceil((t.cost - (R.progress[t.id] ?? 0)) / Math.max(1, Math.min(t.cost / t.months, rate)));
  const enqueue = (t: TechDef) => {
    // ajoute la technologie et ses prérequis manquants, dans l'ordre
    const order: string[] = [...R.queue];
    const add = (id: string) => {
      if (R.unlocked.includes(id) || R.active === id || order.includes(id)) return;
      TECH_INDEX[id].requires.forEach(add);
      order.push(id);
    };
    add(t.id);
    void serviceAction({ type: 'fileRecherche', techs: order });
  };
  const E = R.effects;
  const prod = Object.entries(E.productivity).filter(([, v]) => v !== 1);
  const emis = Object.entries(E.emissions).filter(([, v]) => v !== 1);
  const sectorName = (id: string) => SECTORS.find((s) => s.id === id)?.name ?? id;
  return (
    <Drawer title="Recherche & Innovation" icon="recherche" wide>
      <div className="kpis">
        <Kpi label="Effort technologique" value={`${money(rate * 12 * pr)}/an`} sub="budget appliqué × efficacité" />
        <Kpi label="Efficacité de la recherche" value={pct(R.efficiency, 0)} hint="Capital humain, enseignants-chercheurs, centres de recherche et savoir fondamental accumulé." />
        <Kpi label="Technologies maîtrisées" value={`${R.unlocked.length} / ${TECHS.length}`} />
        <Kpi label="Programme en cours" value={R.active ? TECH_INDEX[R.active].name : '—'} sub={R.active ? `≈ ${months(TECH_INDEX[R.active])} mois` : 'effort versé à la recherche fondamentale'} />
      </div>
      <Section title="Financement">
        <BudgetSlider line="recherche" label="Budget de la recherche publique (€/an)" />
        <Lever sub="research" k="applied" label="Part affectée aux programmes technologiques" min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} hint="Le reste finance la recherche fondamentale, qui améliore l'efficacité future." />
      </Section>
      <Section title="Arbre technologique" hint="Cliquez sur une technologie disponible pour la lancer, ou ajoutez-la à la file (ses prérequis sont ajoutés automatiquement).">
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {columns.map((col, d) => (
            <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
              <div className="small muted">{d === 0 ? 'Fondations' : `Niveau ${d + 1}`}</div>
              {col.map((t) => {
                const st = status(t);
                const p = (R.progress[t.id] ?? 0) / t.cost;
                const border = st === 'fait' ? 'var(--good)' : st === 'actif' ? 'var(--accent)' : st === 'verrou' ? 'rgba(255,255,255,0.15)' : DOMAIN_COLOR[t.domain];
                return (
                  <div key={t.id} title={t.description} style={{ border: '1px solid var(--line)', borderTop: `3px solid ${border}`, borderRadius: 3, padding: '9px 10px', opacity: st === 'verrou' ? 0.55 : 1, background: st === 'fait' ? 'rgba(141,191,154,0.08)' : st === 'actif' ? 'rgba(176,141,87,0.1)' : 'var(--ink-2)' }}>
                    <div className="row" style={{ margin: 0, gap: 6 }}><Icon name={t.icon} size={16} /><b>{t.name}</b></div>
                    <div className="small muted">{money(t.cost * pr)} · {t.months} mois min.</div>
                    {t.requires.length > 0 && <div className="small">Requiert : {t.requires.map((r) => TECH_INDEX[r].name).join(', ')}</div>}
                    <div className="small">{t.description}</div>
                    {p > 0 && st !== 'fait' && <div className="meter"><div style={{ width: `${p * 100}%`, background: 'var(--accent)' }} /></div>}
                    <div className="row" style={{ marginTop: 4 }}>
                      {st === 'fait' && <span className="good small row" style={{ margin: 0, gap: 4 }}><Icon name="valide" size={14} />Maîtrisée</span>}
                      {st === 'actif' && <><span className="small">En cours · ≈ {months(t)} mois</span><button className="btn ghost" onClick={() => serviceAction({ type: 'annulerRecherche' })}>Suspendre</button></>}
                      {st === 'dispo' && <button className="btn primary" onClick={() => serviceAction({ type: 'rechercher', tech: t.id })}>Lancer</button>}
                      {(st === 'dispo' || st === 'verrou') && <button className="btn ghost" onClick={() => enqueue(t)}>+ File</button>}
                      {st === 'file' && <span className="small muted">En file ({R.queue.indexOf(t.id) + 1})</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {R.queue.length > 0 && <p className="small">File : {R.queue.map((q) => TECH_INDEX[q].name).join(' → ')} <button className="btn ghost" onClick={() => serviceAction({ type: 'fileRecherche', techs: [] })}>Vider</button></p>}
      </Section>
      <Section title="Effets des technologies maîtrisées">
        {R.unlocked.length === 0 ? <p className="small muted">Aucune technologie maîtrisée pour l'instant.</p> : (
          <ul className="small">
            {prod.map(([k, v]) => <li key={'p' + k}>Productivité {sectorName(k)} : +{pct(v - 1)}</li>)}
            {emis.map(([k, v]) => <li key={'e' + k}>Émissions {sectorName(k)} : −{pct(1 - v)}</li>)}
            {E.energy.solarYield !== 1 && <li>Rendement solaire ×{E.energy.solarYield.toFixed(2)}</li>}
            {E.energy.windYield !== 1 && <li>Rendement éolien ×{E.energy.windYield.toFixed(2)}</li>}
            {E.energy.storage !== 1 && <li>Stockage ×{E.energy.storage.toFixed(1)}</li>}
            {E.energy.gridLosses !== 1 && <li>Pertes réseau ×{E.energy.gridLosses.toFixed(2)}</li>}
            {E.energy.nuclearCost !== 1 && <li>Coût du nucléaire ×{E.energy.nuclearCost.toFixed(2)}</li>}
            {E.health.doctorProductivity !== 1 && <li>Temps médical +{pct(E.health.doctorProductivity - 1)}</li>}
            {E.health.qualityBonus > 0 && <li>Qualité des soins +{Math.round(E.health.qualityBonus * 100)} points</li>}
            {E.education.teacherProductivity !== 1 && <li>Efficacité des enseignants +{pct(E.education.teacherProductivity - 1)}</li>}
            {E.education.dropout !== 1 && <li>Décrochage −{pct(1 - E.education.dropout)}</li>}
            {E.housing.energy !== 1 && <li>Consommation des logements −{pct(1 - E.housing.energy)}</li>}
            {E.security.response !== 1 && <li>Délais d'intervention −{pct(1 - E.security.response)}</li>}
            {E.waste !== 1 && <li>Déchets −{pct(1 - E.waste)}</li>}
          </ul>
        )}
      </Section>
    </Drawer>
  );
}
