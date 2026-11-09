// Vue 2D « tableau » : la capitale est une grande illustration (heure dorée) sur laquelle on se déplace et on zoome.
// Les lieux de la ville sont des repères cliquables qui ouvrent le ministère concerné ; ils portent l'état réel du
// pays (besoin urgent ou à surveiller, valeur de l'indicateur) et un cartouche liste les chantiers en cours.
// Aucune donnée n'est inventée : tout vient de l'instantané du serveur, comme en 3D.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILDINGS } from '../../../shared/sim/construction';
import { useStore, type Panel } from '../store';
import { useNeeds } from '../ui/Besoins';
import { Icon } from '../ui/Icon';
import { monthLabel } from '../ui/charts';

const SRC = '/assets/tableau/ville.jpg';
const RATIO = 1680 / 793; // largeur / hauteur de l'image recadrée

/** Repères : position en % de l'image recadrée, ministère ouvert, besoins associés (identifiants de needs.ts). */
const SPOTS: { id: string; x: number; y: number; label: string; icon: string; panel: Panel; needs?: string[] }[] = [
  { id: 'affaires', x: 43.5, y: 33, label: 'Quartier d\'affaires', icon: 'economie', panel: 'economie', needs: ['emploi'] },
  { id: 'tresor', x: 49, y: 46, label: 'Trésor public', icon: 'finances', panel: 'finances' },
  { id: 'palais', x: 10.5, y: 53, label: 'Palais du gouvernement', icon: 'politique', panel: 'politique' },
  { id: 'universite', x: 19, y: 61, label: 'Université', icon: 'education', panel: 'education', needs: ['ecoles', 'universites'] },
  { id: 'logement', x: 27, y: 80, label: 'Quartiers d\'habitation', icon: 'logement', panel: 'logement', needs: ['logement'] },
  { id: 'pont', x: 55, y: 71, label: 'Ponts et transports', icon: 'transports', panel: 'transports', needs: ['transports'] },
  { id: 'fleuve', x: 45, y: 60, label: 'Fleuve et environnement', icon: 'environnement', panel: 'environnement', needs: ['air'] },
  { id: 'hopital', x: 65.5, y: 59, label: 'Hôpital', icon: 'sante', panel: 'sante', needs: ['sante'] },
  { id: 'port', x: 88, y: 43, label: 'Port de commerce', icon: 'international', panel: 'international' },
  { id: 'eolien', x: 72, y: 20, label: 'Parc éolien en mer', icon: 'energie', panel: 'energie', needs: ['electricite', 'verte'] },
  { id: 'securite', x: 88.5, y: 61, label: 'Sécurité et justice', icon: 'securite', panel: 'securite', needs: ['securite'] },
  { id: 'industrie', x: 79, y: 52, label: 'Zone d\'activités', icon: 'industrie', panel: 'industrie' },
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function CityTableau() {
  const snap = useStore((s) => s.snap);
  const panel = useStore((s) => s.panel);
  const timeMode = useStore((s) => s.settings.timeMode);
  const set = useStore((s) => s.set);
  const needs = useNeeds();
  const wrap = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [view, setView] = useState({ z: 1, x: 0.5, y: 0.5 }); // zoom et centre (fractions de l'image)
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // l'image couvre toujours l'écran ; le zoom l'agrandit, le centre est borné pour ne jamais montrer de vide
  const base = Math.max(vp.w, vp.h * RATIO);
  const W = base * view.z, H = W / RATIO;
  const cx = clamp(view.x, vp.w / 2 / W, 1 - vp.w / 2 / W);
  const cy = clamp(view.y, vp.h / 2 / H, 1 - vp.h / 2 / H);
  const left = vp.w / 2 - cx * W, top = vp.h / 2 - cy * H;

  const onWheel = (e: React.WheelEvent) => {
    const z = clamp(view.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1, 2.6);
    // zoom vers le pointeur
    const fx = (e.clientX - left) / W, fy = (e.clientY - top) / H;
    const W2 = base * z, H2 = W2 / RATIO;
    setView({ z, x: fx - (e.clientX - vp.w / 2) / W2, y: fy - (e.clientY - vp.h / 2) / H2 });
  };
  const onDown = (e: React.PointerEvent) => { drag.current = { px: e.clientX, py: e.clientY, x: cx, y: cy, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    setView((v) => ({ ...v, x: d.x - dx / W, y: d.y - dy / H }));
  };
  const onUp = () => { drag.current = null; };

  const byNeed = useMemo(() => new Map(needs.map((n) => [n.id, n])), [needs]);
  const sites = snap?.construction?.sites ?? [];
  const energy = (snap?.energy?.projects ?? []).filter((p) => p.public && p.done > (snap?.month ?? 0));
  const works = [
    ...sites.map((s) => ({ key: `s${s.id}`, icon: BUILDINGS[s.type]?.icon ?? 'chantier', name: s.name, r: s.months > 0 ? s.elapsed / s.months : 1, end: s.started + s.months })),
    ...energy.map((p) => ({ key: `e${p.id}`, icon: 'energie', name: p.name, r: p.done > p.start ? clamp(((snap?.month ?? 0) - p.start) / (p.done - p.start), 0, 1) : 1, end: p.done })),
  ];

  return (
    <div ref={wrap} className={`tableau tableau-${timeMode}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="tableau-stage" style={{ width: W, height: H, left, top }}>
        <img src={SRC} alt="Vue de la capitale de la République d'Ilyas au coucher du soleil" draggable={false} />
        <div className="tableau-night" />
        {SPOTS.map((s) => {
          const linked = (s.needs ?? []).map((id) => byNeed.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
          const worst = linked.reduce((m, n) => Math.max(m, n.level), 0);
          const main = linked.sort((a, b) => b.level - a.level)[0];
          return (
            <button key={s.id} className={`spot spot-${worst} ${panel === s.panel ? 'on' : ''}`} style={{ left: `${s.x}%`, top: `${s.y}%` }}
              title={main ? `${s.label} — ${main.detail}` : s.label}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => set({ panel: panel === s.panel ? null : s.panel })}>
              <span className="spot-pin"><Icon name={s.icon} size={18} /></span>
              <span className="spot-text">
                <b>{s.label}</b>
                {main && <em>{main.value}</em>}
              </span>
              {worst > 0 && <i className={`stamp ${worst === 2 ? 'urgent' : 'watch'}`}>{worst === 2 ? 'Urgent' : 'À surveiller'}</i>}
            </button>
          );
        })}
        {/* cartouche des chantiers : placé sur l'angle bas droit de l'illustration */}
        <aside className="tableau-works panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="kicker"><Icon name="chantier" size={14} /> Chantiers en cours · {works.length}</div>
          {works.length === 0 && <p className="muted small">Aucun chantier. Ouvrez « Besoins » pour lancer un programme.</p>}
          {works.slice(0, 4).map((w) => (
            <div key={w.key} className="tw-row" title={w.name}>
              <span><Icon name={w.icon} size={12} /> {w.name}</span>
              <div className="meter"><div style={{ width: `${Math.round(w.r * 100)}%`, background: 'var(--gold-hi)' }} /></div>
              <em>{snap ? monthLabel(w.end, snap.startYear) : ''}</em>
            </div>
          ))}
          {works.length > 4 && <button className="link small" onClick={() => set({ panel: 'besoins' })}>+ {works.length - 4} autres</button>}
        </aside>
      </div>
      <div className="tableau-top" />
    </div>
  );
}
