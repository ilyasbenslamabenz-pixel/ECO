// Interface de jeu : barre supérieure, contrôle du temps, dock des ministères, réformes, inspection, notifications, statistiques.
import { useEffect, useState } from 'react';
import { HISTORY_KEYS } from '../../../shared/sim/engine';
import { SECTORS } from '../../../shared/sim/data';
import { useStore, type Panel } from '../store';
import { cancelPending, leaveGame, saveNow, setSpeed, stepOnce, submitPolicy, copyGame, openGame } from '../net';
import { dec1, eur, int, money, pct, people } from '../format';
import { Drawer, Kpi, Section, Tabs, Toggle } from './common';
import { LineChart, monthLabel } from './charts';
import { IND } from './indicators';
import { FiscalitePanel } from './Fiscalite';
import { EconomiePanel, FinancesPanel, PopulationPanel, TravailPanel } from './Ministries';
import { PolitiquePanel } from './Politique';
import { InternationalPanel } from './International';
import { EvenementsPanel, EventOverlay } from './Evenements';
import { ObjectifsPanel } from './Objectifs';
import { WEATHER_LABEL, weatherFor } from '../game/life';
import { camApi } from '../game/world';
import { EnergiePanel } from './Energie';
import { EnvironnementPanel } from './Environnement';
import { AgriculturePanel, DechetsPanel, IndustriePanel, TransportsPanel } from './Secteurs';
// --- modules services publics/recherche/construction ---
import { SantePanel } from './Sante';
import { EducationPanel } from './Education';
import { LogementPanel } from './Logement';
import { SecuritePanel } from './Securite';
import { RecherchePanel } from './Recherche';
import { ConstructionPanel } from './Construction';
import { BesoinsPanel, useNeeds } from './Besoins';
import { InfraActions } from './InfraActions';
import { BUILDINGS } from '../../../shared/sim/construction';
import { MissionsBar, MissionsPanel, YearReviewWindow } from './Missions'; // --- missions et trophées ---
import { ClimatMini, ClimatPanel } from './Climat'; // --- plan climat ---
import { Icon, Seal, stripEmoji, type IconName } from './Icon';

const SEASON: [IconName, string][] = [['flocon', 'Hiver'], ['flocon', 'Hiver'], ['pousse', 'Printemps'], ['pousse', 'Printemps'], ['pousse', 'Printemps'], ['soleil', 'Été'], ['soleil', 'Été'], ['soleil', 'Été'], ['feuille', 'Automne'], ['feuille', 'Automne'], ['feuille', 'Automne'], ['flocon', 'Hiver']];

/** Variation sur un mois d'un indicateur de l'historique : flèche colorée selon le sens souhaitable. */
function Delta({ k }: { k: string }) {
  const h = useStore((s) => s.history[k]);
  if (!h || h.length < 2) return null;
  const a = h[h.length - 2], b = h[h.length - 1];
  const d = b - a;
  const rel = Math.abs(a) > 1e-9 ? d / Math.abs(a) : 0;
  const isRatio = IND[k]?.unit?.startsWith('%');
  const flat = isRatio ? Math.abs(d) < 5e-4 : Math.abs(rel) < 5e-4;
  const good = IND[k]?.good;
  const tone = flat || !good ? 'flat' : (good === 'up') === d > 0 ? 'up' : 'down';
  const txt = isRatio ? `${(Math.abs(d) * 100).toFixed(1).replace('.', ',')} pt` : `${(Math.abs(rel) * 100).toFixed(1).replace('.', ',')} %`;
  return <span className={`delta ${tone}`} title="Variation sur un mois">{flat ? '=' : d > 0 ? '▲' : '▼'}<span className="delta-v">{flat ? '' : ` ${txt}`}</span></span>;
}

export function TopBar() {
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  const speed = useStore((s) => s.speed);
  if (!snap || !country) return null;
  const A = snap.accounts;
  const u = snap.demography.unemployed / snap.demography.labourForce;
  const pop = snap.demography.cohorts.reduce((s, v) => s + v, 0);
  const g = snap.last.growth ?? 0;
  const weather = weatherFor(country.seed, snap.month);
  const Item = ({ k, label, value, tone }: { k: string; label: string; value: string; tone?: string }) => (
    <div className={`tb-item ${tone ?? ''}`} title={IND[k] ? `${IND[k].label} — ${IND[k].def} (${IND[k].unit}, ${IND[k].period})` : label}>
      <span>{label}</span><div className="tb-v"><b>{value}</b><Delta k={k} /></div>
    </div>
  );
  return (
    <header className="topbar">
      <div className="tb-brand" title={`ECO NATION — ${snap.name}`}>
        <Seal size={40} />
        <div className="tb-brand-text"><span className="kicker">ECO NATION</span><b>{snap.name}</b></div>
      </div>
      <div className="tb-date">
        <i className="kicker">Journal officiel · n° {snap.month + 1}</i>
        <b>{snap.date}</b>
        <span><Icon name={SEASON[snap.month % 12][0]} size={13} />{SEASON[snap.month % 12][1]} · {stripEmoji(WEATHER_LABEL[weather])}</span>
      </div>
      <div className="tb-speed" role="group" aria-label="Écoulement du temps">
        {[0, 1, 2, 5, 10].map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)} title={s === 0 ? 'Pause (Espace)' : `Vitesse ×${s}`} aria-pressed={speed === s} aria-label={s === 0 ? 'Pause' : `Vitesse ×${s}`}>
            {s === 0 ? <Icon name="pause" size={15} /> : s === 1 ? <Icon name="lecture" size={15} /> : `×${s}`}
          </button>
        ))}
        <button onClick={stepOnce} disabled={speed !== 0} title="Avancer d'un mois" aria-label="Avancer d'un mois"><Icon name="suivant" size={15} /></button>
      </div>
      <div className="tb-items">
        <Item k="cash" label="Trésorerie" value={money(snap.finance.cash)} tone={snap.finance.cash < 0 ? 'bad' : ''} />
        <Item k="population" label="Population" value={people(pop)} />
        <Item k="gdp" label="PIB" value={money(A.gdp)} />
        <Item k="growth" label="Croissance" value={pct(g)} tone={g < 0 ? 'bad' : g > 0.02 ? 'good' : ''} />
        <Item k="unemployment" label="Chômage" value={pct(u)} tone={u > 0.1 ? 'bad' : u < 0.06 ? 'good' : ''} />
        <Item k="inflation" label="Inflation" value={pct(snap.macro.inflation)} tone={snap.macro.inflation > 0.05 || snap.macro.inflation < 0 ? 'bad' : ''} />
        <Item k="deficitRatio" label={A.balance >= 0 ? 'Excédent' : 'Déficit'} value={pct(Math.abs(A.balance) / A.gdp)} tone={A.balance / A.gdp < -0.04 ? 'bad' : A.balance >= 0 ? 'good' : ''} />
        <Item k="debtRatio" label="Dette" value={pct(snap.finance.debt / A.gdp, 0)} tone={snap.finance.debt / A.gdp > 1 ? 'bad' : ''} />
        <Item k="satisfaction" label="Satisfaction" value={`${Math.round(snap.satisfaction.overall)}/100`} tone={snap.satisfaction.overall < 40 ? 'bad' : snap.satisfaction.overall > 60 ? 'good' : ''} />
        <Item k="emissions" label="CO₂" value={`${dec1(A.emissions / 1e6)} Mt`} />
      </div>
      <ClimatMini /> {/* --- plan climat --- : jauges de soutien compactes */}
    </header>
  );
}

const MINISTRIES: { id: Panel; icon: IconName; label: string }[] = [
  { id: 'besoins', icon: 'besoins', label: 'Besoins du pays' },
  { id: 'missions', icon: 'objectifs', label: 'Missions & trophées' }, // --- missions ---
  { id: 'climat', icon: 'baisse', label: 'Plan climat' }, // --- plan climat ---
  { id: 'finances', icon: 'finances', label: 'Finances' },
  { id: 'fiscalite', icon: 'fiscalite', label: 'Fiscalité' },
  { id: 'economie', icon: 'economie', label: 'Économie' },
  { id: 'travail', icon: 'travail', label: 'Travail' },
  { id: 'population', icon: 'population', label: 'Population' },
  { id: 'politique', icon: 'politique', label: 'Politique' },
  { id: 'international', icon: 'international', label: 'International' },
  { id: 'evenements', icon: 'evenements', label: 'Événements' },
  { id: 'objectifs', icon: 'trophee', label: 'Objectifs' },
  { id: 'energie', icon: 'energie', label: 'Énergie' },
  { id: 'environnement', icon: 'environnement', label: 'Environnement' },
  { id: 'transports', icon: 'transports', label: 'Transports' },
  { id: 'industrie', icon: 'industrie', label: 'Industrie' },
  { id: 'agriculture', icon: 'agriculture', label: 'Agriculture' },
  { id: 'dechets', icon: 'recyclage', label: 'Déchets' },
  // --- modules services publics/recherche/construction ---
  { id: 'sante', icon: 'sante', label: 'Santé' },
  { id: 'education', icon: 'education', label: 'Éducation' },
  { id: 'logement', icon: 'logement', label: 'Logement' },
  { id: 'securite', icon: 'securite', label: 'Sécurité' },
  { id: 'recherche', icon: 'recherche', label: 'Recherche' },
  { id: 'construction', icon: 'equipements', label: 'Équipements' },
  { id: 'stats', icon: 'stats', label: 'Statistiques' },
];

const POLES: { id: string; icon: IconName; label: string; items: Panel[] }[] = [
  { id: 'eco', icon: 'monnaie', label: 'Économie', items: ['finances', 'fiscalite', 'economie', 'travail', 'industrie'] },
  { id: 'social', icon: 'population', label: 'Social', items: ['population', 'sante', 'education', 'logement', 'securite'] },
  { id: 'terr', icon: 'carte', label: 'Territoire', items: ['energie', 'environnement', 'transports', 'agriculture', 'dechets', 'construction', 'recherche'] },
  { id: 'etat', icon: 'politique', label: 'État', items: ['politique', 'international', 'evenements', 'objectifs'] },
];

export function Dock() {
  const panel = useStore((s) => s.panel);
  const unread = useStore((s) => s.unread);
  const pendingEvents = useStore((s) => s.snap?.events?.active.length ?? 0);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState<string | null>(null);
  const urgentNeeds = useNeeds().filter((n) => n.level === 2).length;
  const toggle = (p: Panel) => { set({ panel: panel === p ? null : p, ...(p === 'notifications' ? { unread: 0 } : {}) }); setOpen(null); };
  const byId = (id: Panel) => MINISTRIES.find((m) => m.id === id)!;
  return (
    <nav className="dock" aria-label="Ministères">
      <button className={`dock-needs ${panel === 'besoins' ? 'on' : ''}`} onClick={() => toggle('besoins')} title="Ce qui manque au pays et quoi construire ou démolir">
        <span><Icon name="besoins" size={22} /></span><em>Besoins</em>{urgentNeeds > 0 && <i className="badge">{urgentNeeds}</i>}
      </button>
      {/* --- missions --- */}
      <button className={`dock-missions ${panel === 'missions' ? 'on' : ''}`} onClick={() => toggle('missions')} title="Missions en cours, titre, trophées et historique">
        <span><Icon name="objectifs" size={22} /></span><em>Missions</em>
      </button>
      {/* --- plan climat --- */}
      <button className={`dock-climat ${panel === 'climat' ? 'on' : ''}`} onClick={() => toggle('climat')} title="Plan climat facteur 4 : trajectoire, jalons, soutien, mesures">
        <span><Icon name="baisse" size={22} /></span><em>Climat</em>
      </button>
      {POLES.map((pole) => {
        const active = pole.items.includes(panel);
        return (
          <div key={pole.id} className="pole">
            <button className={active || open === pole.id ? 'on' : ''} onClick={() => setOpen(open === pole.id ? null : pole.id)} aria-expanded={open === pole.id} aria-haspopup="menu">
              <span><Icon name={pole.icon} size={22} /></span><em>{pole.label}</em>
              {pole.id === 'etat' && pendingEvents > 0 && <i className="badge">{pendingEvents}</i>}
            </button>
            {open === pole.id && (
              <div className="flyout" role="menu">
                <div className="flyout-head kicker">{pole.id === 'etat' ? 'Affaires de l\'État' : `Pôle ${pole.label}`}</div>
                {pole.items.map((id) => { const m = byId(id); return (
                  <button key={id} className={panel === id ? 'on' : ''} onClick={() => toggle(id)}>
                    <span><Icon name={m.icon} size={18} /></span>{m.label}{id === 'evenements' && pendingEvents > 0 && <i className="badge">{pendingEvents}</i>}
                  </button>
                ); })}
              </div>
            )}
          </div>
        );
      })}
      <button className={panel === 'stats' ? 'on' : ''} onClick={() => toggle('stats')}><span><Icon name="stats" size={22} /></span><em>Chiffres</em></button>
      <div className="dock-sep" />
      <button className={panel === 'notifications' ? 'on' : ''} onClick={() => toggle('notifications')}><span><Icon name="alertes" size={22} /></span><em>Alertes</em>{unread > 0 && <i className="badge">{unread}</i>}</button>
      <button className={panel === 'help' ? 'on' : ''} onClick={() => toggle('help')}><span><Icon name="aide" size={22} /></span><em>Aide</em></button>
      <button className={panel === 'settings' ? 'on' : ''} onClick={() => toggle('settings')}><span><Icon name="menu" size={22} /></span><em>Menu</em></button>
    </nav>
  );
}

export function ReformBar() {
  const draft = useStore((s) => s.draft);
  const snap = useStore((s) => s.snap);
  const set = useStore((s) => s.set);
  if (!snap) return null;
  const pending = snap.pending;
  if (!draft && !pending) return null;
  const base = pending?.policy ?? snap.policy;
  const changes = draft ? countChanges(base, draft) : 0;
  return (
    <div className="reformbar">
      {draft && changes > 0 ? (
        <>
          <span className="kicker">Projet de réforme</span>
          <span><Icon name="plume" size={16} /><b>{changes}</b> modification{changes > 1 ? 's' : ''} en préparation — entrée en vigueur au 1er {monthLabel(snap.month + 1, snap.startYear)}</span>
          <button className="btn ghost" onClick={() => set({ draft: null })}>Abandonner</button>
          <button className="btn primary" onClick={() => submitPolicy(draft)}><Icon name="valide" size={15} />Adopter les réformes</button>
        </>
      ) : pending ? (
        <>
          <span className="kicker">Promulgué</span>
          <span><Icon name="sablier" size={16} />Réformes adoptées, en vigueur au 1er {monthLabel(pending.month, snap.startYear)}</span>
          <button className="btn ghost" onClick={cancelPending}>Annuler</button>
        </>
      ) : <span className="muted">Aucune modification</span>}
    </div>
  );
}

function countChanges(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > Math.max(1e-6, Math.abs(a) * 1e-6) ? 1 : 0;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a === b ? 0 : 1;
  let n = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) n += countChanges((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
  return n;
}

const INFRA_LABEL: Record<string, string> = {
  hopital: 'Hôpital', universite: 'Université', ecole: 'Établissement scolaire', aeroport: 'Aéroport', port: 'Port', gare: 'Gare',
  centrale_charbon: 'Centrale à charbon', centrale_gaz: 'Centrale à gaz', centrale_nucleaire: 'Centrale nucléaire', barrage: 'Barrage hydroélectrique',
  parc_eolien: 'Parc éolien', parc_solaire: 'Centrale solaire', zone_industrielle: 'Zone industrielle', zone_commerciale: 'Zone commerciale', commissariat: 'Commissariat', stade: 'Stade', caserne: 'Centre de secours (pompiers)', usine: 'Usine', ferme: 'Exploitation agricole',
  clinique: 'Clinique', centre_medical: 'Centre médical', college: 'Collège', lycee: 'Lycée', centre_formation: 'Centre de formation', laboratoire: 'Laboratoire de recherche',
  caserne_pompiers: 'Caserne de pompiers', tribunal: 'Tribunal', prison: 'Établissement pénitentiaire', zone_residentielle: 'Nouveau quartier résidentiel', eco_quartier: 'Écoquartier',
  logements_sociaux: 'Logements sociaux', centrale_smr: 'Petit réacteur modulaire', centrale_fioul: 'Turbine à fioul', centrale_geothermique: 'Centrale géothermique',
  centrale_biomasse: 'Centrale biomasse', parc_eolien_mer: 'Parc éolien en mer', stockage_batteries: 'Stockage par batteries',
};

const INFRA_ICON: Record<string, IconName> = {
  aeroport: 'avion', port: 'ancre', gare: 'transports', stade: 'trophee', zone_industrielle: 'industrie', zone_commerciale: 'commerce', usine: 'industrie',
  ferme: 'agriculture', barrage: 'goutte', centrale_charbon: 'centrale', centrale_gaz: 'flamme', centrale_nucleaire: 'nucleaire', parc_eolien: 'eolien',
  parc_solaire: 'solaire', parc_eolien_mer: 'eolien', centrale_smr: 'nucleaire', centrale_fioul: 'baril', centrale_geothermique: 'volcan', centrale_biomasse: 'pousse',
  stockage_batteries: 'batterie', hopital: 'hopital', ecole: 'ecole', universite: 'education',
};
const infraIcon = (t: string): IconName | string => INFRA_ICON[t] ?? BUILDINGS[t as keyof typeof BUILDINGS]?.icon ?? 'equipements';

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  const country = useStore((s) => s.country);
  const set = useStore((s) => s.set);
  if (!sel || !snap || !country) return null;
  if (sel.kind === 'city') {
    const c = country.cities[sel.id];
    const s = snap.cities[sel.id];
    const w = c.sectorWeights;
    const tot = w.reduce((a, b) => a + b, 0);
    const top = w.map((v, i) => ({ i, v: v / tot })).sort((a, b) => b.v - a.v).slice(0, 4);
    const infra = country.infra.filter((i) => i.cityId === c.id);
    return (
      <div className="inspector paper">
        <header>
          <span className="kicker"><Icon name="carte" size={13} />Fiche de quartier</span>
          <h3>{c.capital && <Icon name="etoile" size={18} title="Capitale" />}{c.name}</h3>
          <button className="icon-btn" onClick={() => set({ selection: null })} aria-label="Fermer la fiche"><Icon name="fermer" size={16} /></button>
        </header>
        <p className="muted">{c.capital ? 'Centre historique et politique · ' : ''}{c.kind === 'metropole' ? 'Grand quartier' : c.kind === 'ville' ? 'Arrondissement' : 'Quartier périphérique'}{c.coastal ? ' · littorale' : ''}</p>
        <div className="kpis compact">
          <Kpi label="Habitants" value={people(s.population)} />
          <Kpi label="Chômage" value={pct(s.unemployment)} />
          <Kpi label="Revenu disponible" value={eur(s.income)} sub="par habitant/an" />
          <Kpi label="Satisfaction" value={`${Math.round(s.satisfaction)}/100`} />
          <Kpi label="Logements" value={int(s.housingUnits)} />
          <Kpi label="Recettes locales" value={money(s.localRevenue)} sub="€/an" />
        </div>
        <h4>Activités du quartier</h4>
        {top.map((t) => <div key={t.i} className="spec"><Icon name={SECTORS[t.i].icon} size={15} />{SECTORS[t.i].name} <b>{pct(t.v, 0)}</b></div>)}
        {infra.length > 0 && <><h4>Équipements</h4>{infra.map((i) => <button key={i.id} className="eq-row" onClick={() => set({ selection: { kind: 'infra', id: i.id } })}><Icon name={infraIcon(i.type)} size={15} /><span>{i.name}</span><em>{INFRA_LABEL[i.type] ?? BUILDINGS[i.type]?.name}{i.status === 'chantier' ? ' · chantier' : ''}</em></button>)}</>}
      </div>
    );
  }
  const i = country.infra.find((q) => q.id === sel.id);
  if (!i) return null;
  const city = i.cityId !== null ? country.cities[i.cityId] : null;
  const produces = i.energyMWh < 0;
  return (
    <div className="inspector paper">
      <header>
        <span className="kicker"><Icon name={infraIcon(i.type)} size={13} />Fiche d'équipement</span>
        <h3>{i.name}</h3>
        <button className="icon-btn" onClick={() => set({ selection: null })} aria-label="Fermer la fiche"><Icon name="fermer" size={16} /></button>
      </header>
      <p className="muted">{INFRA_LABEL[i.type] ?? BUILDINGS[i.type]?.name}{city ? ` · ${city.name}` : ''}{i.status === 'chantier' ? ` · en construction (${Math.round((i.progress ?? 0) * 100)} %), mise en service prévue en ${i.builtYear}` : ` · mise en service ${i.builtYear}`}</p>
      <div className="kpis compact">
        <Kpi label="Capacité" value={`${int(i.capacity)} ${i.capacityUnit}`} />
        <Kpi label="Emplois" value={int(i.employees)} />
        <Kpi label="Coût d'entretien" value={money(i.maintenance)} sub="€/an" />
        <Kpi label={produces ? 'Production électrique' : 'Consommation électrique'} value={`${dec1(Math.abs(i.energyMWh) / 1000)} GWh`} sub="par an" />
        <Kpi label="Émissions directes" value={i.emissions >= 1e5 ? `${dec1(i.emissions / 1e6)} Mt CO₂` : `${int(i.emissions)} t CO₂`} sub="par an" />
        <Kpi label="Niveau" value={String(i.level)} />
      </div>
      <InfraActions infra={i} />
      {city && <button className="link" onClick={() => { set({ selection: { kind: 'city', id: city.id } }); camApi.focus(city.x, city.z); }}>Voir la fiche de {city.name} →</button>}
    </div>
  );
}

export function Notifications() {
  const notices = useStore((s) => s.notices);
  const snap = useStore((s) => s.snap);
  if (!snap) return null;
  return (
    <Drawer title="Notifications" icon="alertes">
      {[...notices].reverse().map((n) => (
        <div key={n.id} className={`notice ${n.kind}`}>
          <div className="notice-head"><b>{stripEmoji(n.title)}</b><span>{monthLabel(n.month, snap.startYear)}</span></div>
          <p>{stripEmoji(n.text)}</p>
        </div>
      ))}
    </Drawer>
  );
}

const STAT_COLORS = ['#cfae78', '#8fa7c9', '#d9705f', '#86b494', '#a98bb5'];
export function StatsPanel() {
  const history = useStore((s) => s.history);
  const snap = useStore((s) => s.snap);
  const [keys, setKeys] = useState<string[]>(['growth', 'unemployment', 'inflation']);
  const [years, setYears] = useState<number | 'all'>(10);
  const [yA, setYA] = useState(0);
  const [yB, setYB] = useState(-1);
  if (!snap) return null;
  const groups: [string, string[]][] = [
    ['Économie', ['gdp', 'gdpReal', 'growth', 'inflation', 'unemployment', 'productivityGrowth', 'consumption', 'investment', 'exports', 'imports', 'firms', 'failures']],
    ['Finances', ['revenue', 'spending', 'balance', 'deficitRatio', 'debt', 'debtRatio', 'cash', 'marketRate', 'policyRate']],
    ['Social', ['satisfaction', 'trust', 'meanWage', 'medianWage', 'disposablePerCap', 'gini', 'poverty', 'lifeExpectancy']],
    ['Démographie', ['population', 'employment', 'births', 'deaths', 'migration']],
    ['Écologie', ['emissions']],
    ['Services publics', ['sante_qualite', 'sante_attente', 'edu_reussite', 'edu_decrochage', 'edu_capitalHumain', 'logement_prix', 'logement_tension', 'crime', 'recherche_technologies', 'equipements']], // --- modules services publics/recherche/construction ---
  ];
  const unitOf = (k: string) => IND[k]?.unit;
  const sameUnit = keys.every((k) => unitOf(k) === unitOf(keys[0]));
  const toggle = (k: string) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks.slice(-4), k]));
  const nYears = Math.floor(((history.gdp?.length ?? 1) - 1) / 12);
  const yearIdx = (y: number) => Math.min((history.gdp?.length ?? 1) - 1, y * 12);
  const bYear = yB < 0 ? nYears : yB;
  return (
    <Drawer title="Centre de contrôle national" icon="stats" wide>
      <Section title="Indicateurs (cliquez pour comparer, 5 max)">
        {groups.map(([g, ks]) => (
          <div key={g} className="chip-group"><span>{g}</span>{ks.map((k) => <button key={k} className={`chip ${keys.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)}>{IND[k]?.label ?? k}</button>)}</div>
        ))}
      </Section>
      <Tabs<string> value={String(years)} onChange={(v) => setYears(v === 'all' ? 'all' : Number(v))} tabs={[['10', '10 ans'], ['20', '20 ans'], ['50', '50 ans'], ['all', 'Depuis le début']]} />
      {sameUnit ? (
        <LineChart years={years} height={240} fmt={IND[keys[0]]?.fmt ?? String} series={keys.map((k, i) => ({ key: k, label: IND[k]?.label ?? k, values: history[k] ?? [], color: STAT_COLORS[i] }))} />
      ) : keys.map((k, i) => (
        <LineChart key={k} years={years} height={140} fmt={IND[k]?.fmt ?? String} series={[{ key: k, label: `${IND[k]?.label} (${IND[k]?.unit})`, values: history[k] ?? [], color: STAT_COLORS[i] }]} />
      ))}
      <Section title="Définitions">
        {keys.map((k) => <p key={k} className="small"><b>{IND[k]?.label}</b> — {IND[k]?.def} <em className="muted">Unité : {IND[k]?.unit} · période : {IND[k]?.period}.</em></p>)}
      </Section>
      <Section title="Comparer deux années">
        <div className="row">
          <label>Année A <select value={yA} onChange={(e) => setYA(Number(e.target.value))}>{Array.from({ length: nYears + 1 }, (_, y) => <option key={y} value={y}>{snap.startYear + y}</option>)}</select></label>
          <label>Année B <select value={bYear} onChange={(e) => setYB(Number(e.target.value))}>{Array.from({ length: nYears + 1 }, (_, y) => <option key={y} value={y}>{snap.startYear + y}</option>)}</select></label>
        </div>
        <table className="table">
          <thead><tr><th>Indicateur</th><th>{snap.startYear + yA}</th><th>{snap.startYear + bYear}</th><th>Écart</th></tr></thead>
          <tbody>
            {HISTORY_KEYS.filter((k) => IND[k]).map((k) => {
              const a = history[k]?.[yearIdx(yA)];
              const b = history[k]?.[yearIdx(bYear)];
              if (a === undefined || b === undefined) return null;
              const d = b - a;
              const better = IND[k].good ? (IND[k].good === 'up' ? d > 0 : d < 0) : null;
              return <tr key={k}><td>{IND[k].label}</td><td>{IND[k].fmt(a)}</td><td>{IND[k].fmt(b)}</td><td className={better === null || Math.abs(d) < 1e-9 ? '' : better ? 'good' : 'bad'}>{(d >= 0 ? '+' : '') + IND[k].fmt(d)}</td></tr>;
            })}
          </tbody>
        </table>
      </Section>
    </Drawer>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const snap = useStore((s) => s.snap);
  const gameId = useStore((s) => s.gameId);
  const [name, setName] = useState('');
  return (
    <Drawer title="Menu & paramètres" icon="reglages">
      <Section title="Partie">
        <div className="btn-row">
          <button className="btn primary" onClick={saveNow}><Icon name="sauver" size={15} />Sauvegarder</button>
          <button className="btn" onClick={leaveGame}><Icon name="sortie" size={15} />Menu principal</button>
        </div>
        <div className="row">
          <input className="input" placeholder={`${snap?.name ?? ''} — ${snap?.date ?? ''}`} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={async () => { if (!gameId) return; const r = await copyGame(gameId, name || `${snap?.name} — ${snap?.date}`); useStore.getState().toast('Copie de sauvegarde créée.', 'good'); setName(''); void r; }}>Sauvegarder sous…</button>
        </div>
        <p className="muted small">Sauvegarde automatique chaque année simulée et à la fermeture.</p>
      </Section>
      <Section title="Qualité graphique">
        <Tabs value={settings.quality} onChange={(q) => setSettings({ quality: q })} tabs={[['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute']]} />
        <p className="muted small">Basse : sans ombres, relief allégé, moins d'arbres et de véhicules.</p>
      </Section>
      <Section title="Heure de la ville">
        <Tabs value={settings.timeMode} onChange={(m) => setSettings({ timeMode: m })} tabs={[['golden', 'Heure dorée'], ['cycle', 'Cycle jour/nuit'], ['day', 'Plein jour'], ['night', 'Nuit']]} />
      </Section>
      <Section title="Affichage">
        <Toggle label="Noms des quartiers sur la carte" value={settings.labels} onChange={(v) => setSettings({ labels: v })} />
        <label className="slider"><div className="slider-top"><span>Durée d'une journée (cycle jour/nuit)</span><b>{settings.dayLength} s</b></div>
          <input type="range" min={60} max={600} step={30} value={settings.dayLength} onChange={(e) => setSettings({ dayLength: Number(e.target.value) })} /></label>
      </Section>
      <Section title="Commandes">
        <table className="table keys"><tbody>
          {[['Clic gauche + glisser', 'Déplacer la carte'], ['Clic droit + glisser', 'Pivoter / incliner'], ['Molette', 'Zoom'], ['ZQSD / WASD / flèches', 'Déplacer la caméra'], ['A / E (Q / E)', 'Pivoter'], ['Clic', 'Sélectionner un quartier ou un équipement'], ['Espace', 'Pause / reprise'], ['1 · 2 · 3 · 4', 'Vitesse ×1 · ×2 · ×5 · ×10']].map(([k, v]) => <tr key={k}><td><span className="key">{k}</span></td><td>{v}</td></tr>)}
        </tbody></table>
      </Section>
    </Drawer>
  );
}

export function HelpPanel() {
  const set = useStore((s) => s.set);
  return (
    <Drawer title="Aide & tutoriel" icon="aide">
      <button className="btn primary" onClick={() => set({ tutorialStep: 0, panel: null })}><Icon name="lecture" size={14} />Relancer le tutoriel</button>
      <Section title="Objectif">
        <p>Vous dirigez le gouvernement. Chaque décision (impôts, budget, droit du travail) modifie les revenus de millions d'habitants, l'activité des entreprises, les finances publiques et la satisfaction. Tous les indicateurs sont calculés par le moteur de simulation à partir de ces décisions.</p>
      </Section>
      <Section title="Prendre une décision">
        <ol className="small">
          <li>Ouvrez un ministère dans le dock à gauche.</li>
          <li>Modifiez les curseurs : les valeurs modifiées s'affichent en jaune avec la valeur actuelle.</li>
          <li>Cliquez sur <b>Adopter les réformes</b> : elles entrent en vigueur le 1er du mois suivant.</li>
          <li>Lancez le temps (bouton lecture) et suivez les effets dans les indicateurs et le centre de contrôle.</li>
        </ol>
      </Section>
      <Section title="Délais et inerties">
        <p className="small">L'emploi s'ajuste d'environ 7 % de l'écart par mois, les services publics de 3,5 %, la décarbonation de 1,2 %. Les effets d'une réforme se mesurent donc sur plusieurs mois ou années.</p>
      </Section>
      <Section title="Feuille de route">
        <p className="small">Disponible : carte 3D, population, villes, économie, fiscalité complète, budget, dette, emploi, salaires, satisfaction. À venir : énergie, environnement, transports, industrie, agriculture, déchets, parlement et élections, relations internationales, crises, recherche, construction.</p>
      </Section>
    </Drawer>
  );
}

const TUTORIAL = [
  { title: 'Bienvenue au gouvernement', text: 'Vous êtes chef du gouvernement. La barre du haut résume l\'état du pays : trésorerie, population, PIB, croissance, chômage, inflation, solde public, dette, satisfaction, émissions. Survolez chaque indicateur pour voir sa définition.' },
  { title: 'La carte', text: 'Glissez pour vous déplacer, clic droit pour pivoter, molette pour zoomer. Cliquez sur un quartier ou un équipement pour l\'inspecter. Le trafic, les fumées et la densité des quartiers reflètent l\'économie.' },
  { title: 'Le temps', text: 'Le jeu est en pause. Utilisez les boutons lecture, ×2, ×5, ×10 (ou Espace et 1-4). Chaque pas correspond à un mois.' },
  { title: 'Les ministères', text: 'Le dock à gauche ouvre les ministères : Finances (budget, dette), Fiscalité (impôts A à H), Économie, Travail, Population. Modifiez une politique puis cliquez sur « Adopter les réformes ».' },
  { title: 'Conséquences', text: 'Chaque mesure a des effets directs et indirects, avec des délais. Exemple : baisser l\'impôt sur les sociétés stimule l\'investissement mais réduit les recettes. Suivez tout dans le Centre de contrôle (Statistiques). Bonne gouvernance !' },
];

export function Tutorial() {
  const step = useStore((s) => s.tutorialStep);
  const set = useStore((s) => s.set);
  if (step < 0 || step >= TUTORIAL.length) return null;
  const t = TUTORIAL[step];
  return (
    <div className="tutorial paper" role="dialog" aria-label={t.title}>
      <div className="tut-step kicker">Note de cabinet · {step + 1} / {TUTORIAL.length}</div>
      <h3>{t.title}</h3>
      <p>{t.text}</p>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => { set({ tutorialStep: -1 }); localStorage.setItem('eco_tuto', '1'); }}>Passer</button>
        <button className="btn primary" onClick={() => { const n = step + 1; set({ tutorialStep: n >= TUTORIAL.length ? -1 : n }); if (n >= TUTORIAL.length) localStorage.setItem('eco_tuto', '1'); }}>{step + 1 < TUTORIAL.length ? 'Suivant' : 'Commencer'}</button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const ICON: Record<string, IconName> = { good: 'valide', warn: 'evenements', bad: 'evenements' };
  return <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}><Icon name={ICON[t.kind] ?? 'info'} size={16} /><span>{stripEmoji(t.text)}</span></div>)}</div>;
}

export function Panels() {
  return <><PanelContent /><GameOverlays /></>;
}

/** Superpositions : fenêtre de décision des événements en attente ; bandeau des missions et bilan annuel. */
export function GameOverlays() {
  return <><EventOverlay /><MissionsBar /><YearReviewWindow /></>;
}

function PanelContent() {
  const panel = useStore((s) => s.panel);
  switch (panel) {
    case 'besoins': return <BesoinsPanel />;
    case 'missions': return <MissionsPanel />; // --- missions ---
    case 'climat': return <ClimatPanel />; // --- plan climat ---
    case 'finances': return <FinancesPanel />;
    case 'fiscalite': return <FiscalitePanel />;
    case 'travail': return <TravailPanel />;
    case 'economie': return <EconomiePanel />;
    case 'population': return <PopulationPanel />;
    case 'energie': return <EnergiePanel />;
    case 'environnement': return <EnvironnementPanel />;
    case 'transports': return <TransportsPanel />;
    case 'industrie': return <IndustriePanel />;
    case 'agriculture': return <AgriculturePanel />;
    case 'dechets': return <DechetsPanel />;
    case 'stats': return <StatsPanel />;
    case 'notifications': return <Notifications />;
    case 'settings': return <SettingsPanel />;
    case 'help': return <HelpPanel />;
    case 'politique': return <PolitiquePanel />;
    case 'international': return <InternationalPanel />;
    case 'evenements': return <EvenementsPanel />;
    case 'objectifs': return <ObjectifsPanel />;
    // --- modules services publics/recherche/construction ---
    case 'sante': return <SantePanel />;
    case 'education': return <EducationPanel />;
    case 'logement': return <LogementPanel />;
    case 'securite': return <SecuritePanel />;
    case 'recherche': return <RecherchePanel />;
    case 'construction': return <ConstructionPanel />;
    default: return null;
  }
}

export function useHotkeys() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      const st = useStore.getState();
      if (st.screen !== 'game') return;
      if (e.code === 'Space') { e.preventDefault(); setSpeed(st.speed === 0 ? 1 : 0); }
      const map: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 5, Digit4: 10 };
      if (map[e.code]) setSpeed(map[e.code]);
      if (e.code === 'Escape') st.set({ panel: null, selection: null });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

export { openGame, Kpi };
