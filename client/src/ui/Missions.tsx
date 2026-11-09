// Missions et progression du joueur : bandeau compact toujours visible, panneau « Missions & trophées »,
// retours « avant → après » (toasts) et fenêtre non bloquante du bilan annuel. Les données viennent du moteur
// (shared/sim/missions.ts) via l'instantané mensuel `snap.missions`.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { METRICS, TITLES, TROPHIES, rewardLabel, titleOf, type Mission, type MissionsState } from '../../../shared/sim/missions';
import { useStore, type Panel } from '../store';
import { Drawer, Meter, Section } from './common';
import { monthLabel } from './charts';
import { Icon, stripEmoji } from './Icon';

/** État local au module : bilan affiché, repli du bandeau (mémorisé dans le navigateur). */
const COLLAPSE_KEY = 'eco_missions_collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
const useMissionsUi = create<{ reviewOpen: number | null; collapsed: boolean; set: (p: Partial<{ reviewOpen: number | null; collapsed: boolean }>) => void }>((set) => ({
  reviewOpen: null, collapsed: readCollapsed(), set: (p) => set(p),
}));

const monthsLeft = (m: Mission, month: number) => Math.max(0, m.deadline - month);
const leftLabel = (n: number) => (n <= 0 ? 'échéance ce mois-ci' : n === 1 ? '1 mois' : `${n} mois`);
/** Titre court pour le bandeau : sans la date (affichée à part). */
const shortTitle = (t: string) => t.replace(/ d'ici [^ ]+ \d{4}$/, '');

// ---------- Bandeau ----------
export function MissionsBar() {
  const snap = useStore((s) => s.snap);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const { collapsed, set: setUi } = useMissionsUi();
  const M = snap?.missions as MissionsState | undefined;
  const lastFeedback = useRef<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Retours « avant → après » : un toast par nouveau retour (les réussites et trophées ont déjà leur notification).
  useEffect(() => {
    if (!M) return;
    const maxId = M.feedback.reduce((a, f) => Math.max(a, f.id), 0);
    if (lastFeedback.current === null) { lastFeedback.current = maxId; return; }
    const fresh = M.feedback.filter((f) => f.id > lastFeedback.current!);
    lastFeedback.current = Math.max(lastFeedback.current, maxId);
    for (const f of fresh) {
      if (f.kind === 'chantier' || f.kind === 'reforme' || f.kind === 'suivi') toast(stripEmoji(f.text), f.kind === 'suivi' ? 'info' : 'good');
      if (f.kind === 'mission') { setFlash(f.text); setTimeout(() => setFlash(null), 3200); }
    }
  }, [M, toast]);

  // Hauteur du bandeau publiée en variable CSS (les toasts et l'inspecteur se placent au-dessus / à côté).
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--missions-h', `${h}px`);
    return () => { document.documentElement.style.removeProperty('--missions-h'); };
  });

  if (!snap || !M) return null;
  const ti = titleOf(M.xp);
  const toggle = () => { const c = !collapsed; setUi({ collapsed: c }); try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch { /* stockage indisponible */ } };
  return (
    <div ref={ref} className={`missions-bar ${flash ? 'win' : ''}`}>
      <header>
        <button className="mb-title" onClick={() => set({ panel: 'missions' })} title="Missions & trophées">
          <Icon name="objectifs" size={16} /> <b>Missions</b> <span className="muted">· {ti.name} · {M.xp} XP</span>
        </button>
        <button className="icon-btn small" onClick={toggle} title={collapsed ? 'Déplier' : 'Replier'}>{collapsed ? '▴' : '▾'}</button>
      </header>
      {flash && <div className="mb-flash"><Icon name="valide" size={16} /> {flash}</div>}
      {!collapsed && M.active.map((m) => {
        const left = monthsLeft(m, snap.month);
        return (
          <button key={m.id} className={`mb-row ${left <= 2 ? 'urgent' : ''}`} onClick={() => set({ panel: m.panel as Panel })}
            title={`${m.title}\nDépart : ${METRICS[m.metric].fmt(m.start)} · actuel : ${METRICS[m.metric].fmt(m.value)} · cible : ${METRICS[m.metric].fmt(m.target)}\nRécompense : ${rewardLabel(m.reward)}\nCliquer pour ouvrir le ministère concerné.`}>
            <span className="mb-icon"><Icon name={m.icon} size={18} /></span>
            <span className="mb-body">
              <span className="mb-text">{shortTitle(m.title)}</span>
              <span className="mb-meter"><Meter value={m.progress} max={1} tone={m.progress >= 0.66 ? 'var(--good)' : m.progress >= 0.33 ? 'var(--warn)' : 'var(--accent)'} /></span>
              <span className="mb-meta"><span>{METRICS[m.metric].fmt(m.value)} → {METRICS[m.metric].fmt(m.target)}</span><span>⏳ {leftLabel(left)}</span><span className="mb-rew">+{m.reward.xp} XP</span></span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Panneau ----------
export function MissionsPanel() {
  const snap = useStore((s) => s.snap);
  const set = useStore((s) => s.set);
  const setUi = useMissionsUi((s) => s.set);
  const M = snap?.missions as MissionsState | undefined;
  if (!snap || !M) return null;
  const ti = titleOf(M.xp);
  const got = TROPHIES.filter((t) => M.trophies[t.id] !== undefined);
  const locked = TROPHIES.filter((t) => M.trophies[t.id] === undefined);
  return (
    <Drawer title="Missions & trophées" icon="objectifs" wide>
      <Section title="Carrière" hint="L'expérience de mandat s'obtient en réussissant des missions, en battant des records (chômage, électricité verte, satisfaction, dette, émissions) et en débloquant des trophées.">
        <div className="row between"><b className="mp-title"><Icon name="trophee" size={18} /> {ti.name}</b><span>{M.xp} XP{ti.nextXp !== null ? ` / ${ti.nextXp} XP` : ''}</span></div>
        <Meter value={ti.progress} max={1} tone="var(--gold)" />
        <p className="muted small">{ti.next ? `Prochain titre : ${ti.next} (encore ${ti.nextXp! - M.xp} XP).` : 'Titre le plus élevé atteint.'} Missions réussies : <b>{M.won}</b> · échouées : <b>{M.failed}</b> · série en cours : <b>{M.streak}</b> (record {M.bestStreak}).</p>
        <div className="mp-titles">{TITLES.map((t, k) => <span key={t.name} className={k <= ti.index ? 'on' : ''}>{t.name}</span>)}</div>
      </Section>

      <Section title="Missions en cours" hint="Trois missions sont actives en permanence. Elles découlent des besoins du pays ou visent une amélioration mesurable. Réussite : expérience, confiance, popularité et dotation exceptionnelle. Échec à l'échéance : petite perte de confiance et de popularité.">
        {M.active.map((m) => (
          <div key={m.id} className="mp-mission">
            <div className="row between"><b><Icon name={m.icon} size={16} /> {m.title}</b><span className="muted small">{m.source === 'besoin' ? 'besoin du pays' : 'amélioration'} · difficulté {'★'.repeat(m.difficulty)}</span></div>
            <Meter value={m.progress} max={1} tone="var(--accent)" />
            <div className="row between small">
              <span>Départ {METRICS[m.metric].fmt(m.start)} · actuel <b>{METRICS[m.metric].fmt(m.value)}</b> · cible <b>{METRICS[m.metric].fmt(m.target)}</b></span>
              <span>⏳ {leftLabel(monthsLeft(m, snap.month))}</span>
            </div>
            <div className="row between small">
              <span className="good">Récompense : {rewardLabel(m.reward)}</span>
              <button className="link" onClick={() => set({ panel: m.panel as Panel })}>Agir →</button>
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Trophées (${got.length}/${TROPHIES.length})`}>
        <div className="trophies">
          {got.map((t) => <div key={t.id} className="trophy on" title={t.desc}><span><Icon name={t.icon} size={20} /></span><b>{t.name}</b><em>{monthLabel(M.trophies[t.id], snap.startYear)} · +{t.xp} XP</em></div>)}
          {locked.map((t) => <div key={t.id} className="trophy" title={t.desc}><span><Icon name="verrou" size={20} /></span><b>{t.name}</b><em>{t.desc}</em></div>)}
        </div>
      </Section>

      {M.review && (
        <Section title="Bilan annuel">
          <button className="btn" onClick={() => setUi({ reviewOpen: M.review!.month })}><Icon name="parchemin" size={14} /> Revoir le bilan de l'année {M.review.year}</button>
        </Section>
      )}

      <Section title="Derniers retours">
        {M.feedback.length === 0 && <p className="muted small">Les mises en service et les réformes apparaîtront ici avec leur effet mesuré (avant → après), puis un suivi trois mois plus tard.</p>}
        {[...M.feedback].reverse().slice(0, 12).map((f) => <div key={f.id} className="small mp-fb"><span className="muted">{monthLabel(f.month, snap.startYear)}</span> <Icon name={f.icon} size={14} /> {stripEmoji(f.text)}</div>)}
      </Section>

      <Section title="Historique des missions">
        {M.history.length === 0 && <p className="muted small">Aucune mission terminée pour l'instant.</p>}
        <table className="table"><tbody>
          {[...M.history].reverse().map((m) => (
            <tr key={m.id}>
              <td><Icon name={m.status === 'reussie' ? 'valide' : 'interdit'} size={14} /> {shortTitle(m.title)}</td>
              <td className="muted">{METRICS[m.metric].fmt(m.start)} → {METRICS[m.metric].fmt(m.value)}</td>
              <td className="muted small">{m.endMonth !== undefined ? monthLabel(m.endMonth, snap.startYear) : ''}</td>
            </tr>
          ))}
        </tbody></table>
      </Section>
    </Drawer>
  );
}

// ---------- Bilan annuel (fenêtre non bloquante : le temps continue) ----------
export function YearReviewWindow() {
  const snap = useStore((s) => s.snap);
  const gameId = useStore((s) => s.gameId);
  const { reviewOpen, set: setUi } = useMissionsUi();
  const M = snap?.missions as MissionsState | undefined;
  const R = M?.review ?? null;
  const seen = useRef<{ game: string | null; month: number } | null>(null);
  // Ouverture automatique quand un nouveau bilan arrive (janvier), pas à l'ouverture d'une partie déjà avancée.
  // À vitesse élevée, l'instantané de janvier peut ne pas être rendu : on compare donc au dernier bilan vu.
  const month = snap?.month ?? null;
  useEffect(() => {
    if (month === null) return;
    if (!seen.current || seen.current.game !== gameId) seen.current = { game: gameId, month: R && R.month !== month ? R.month : -1 };
    if (R && R.month > seen.current.month) { seen.current.month = R.month; setUi({ reviewOpen: R.month }); }
  }, [R, month, gameId, setUi]);
  if (!snap || !R || reviewOpen !== R.month) return null;
  return (
    <div className="year-review" role="dialog" aria-label={`Bilan de l'année ${R.year}`}>
      <header><h3>Bilan de l'année {R.year}</h3><button className="icon-btn" onClick={() => setUi({ reviewOpen: null })} aria-label="Fermer">✕</button></header>
      <table className="table"><tbody>
        {R.rows.map((r) => (
          <tr key={r.metric}><td><Icon name={METRICS[r.metric].icon} size={14} /> {r.label}</td><td className="muted">{r.startTxt}</td><td>→</td><td className={r.better === null ? '' : r.better ? 'good' : 'bad'}><b>{r.endTxt}</b></td></tr>
        ))}
      </tbody></table>
      <div className="yr-stats">
        <span><Icon name="objectifs" size={14} /> Missions réussies : <b>{R.won}</b>{R.failed ? ` · échouées : ${R.failed}` : ''}</span>
        <span><Icon name="etoile" size={14} /> +{R.xp} XP · <b>{R.title}</b></span>
      </div>
      {R.trophies.length > 0 && <p className="small"><Icon name="trophee" size={14} /> Trophées : {R.trophies.join(' · ')}</p>}
      {R.moves.length > 0 && (
        <>
          <h4>Plus grosses variations</h4>
          {R.moves.map((m) => (
            <p key={m.label} className="small"><span className={m.better ? 'good' : 'bad'}>{m.better ? '▲' : '▼'}</span> <Icon name={m.icon} size={14} /> <b>{m.label}</b> : {m.text} <span className="muted">— cause probable : {m.cause}</span></p>
          ))}
        </>
      )}
      <div className="btn-row"><button className="btn primary" onClick={() => setUi({ reviewOpen: null })}>Continuer</button></div>
    </div>
  );
}
