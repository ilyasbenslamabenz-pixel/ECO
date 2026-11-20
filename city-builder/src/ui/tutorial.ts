/**
 * « Premiers pas » : objectifs guidés des premières minutes (facultatifs), vérifiés automatiquement d'après l'état
 * de la ville (routes et bâtiments du miroir, zones du module Zonage). Chaque étape : une phrase, la progression
 * détaillée et une surbrillance (avec flèche) sur le bouton de la barre d'outils à utiliser.
 * Bouton « Passer » ; réactivable dans Réglages (case « Premiers pas ») ; état mémorisé dans ce navigateur.
 * Aucune récompense en argent. Propriétaire : agent interface.
 *
 * Une fois les premiers pas terminés (ou passés), le même encadré rappelle l'objectif en cours (module `objectifs`,
 * docs/PROGRESSION.md) : intitulé, avancement, récompense, boutons « Voir » et « Progression » (`setGoal`).
 */
import { zoningView } from '../client/zoning-view';
import type { WorldMirror } from '../client/tools/mirror';
import { $, el } from './dom';

const KEY = 'aube.tutorial.v1';
/** Repli automatique du message « Premiers pas terminés » (ms) vers l'objectif en cours. */
export const TUTO_FINISH_AUTO_MS = 20_000;

interface TutoPrefs { skipped: boolean; open: boolean; done: boolean }

/** Rappel de l'objectif en cours (après les premiers pas). */
export interface GoalInfo {
  title: string;
  /** Petit compteur à droite de l'intitulé (« 42 % »). */
  count: string;
  /** Avancement 0..100. */
  pct: number;
  lines: string[];
  actions: { label: string; run: () => void; primary?: boolean }[];
}

export function loadTutoPrefs(): TutoPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const o = JSON.parse(raw) as Partial<TutoPrefs>; return { skipped: !!o.skipped, open: o.open !== false, done: !!o.done }; }
  } catch { /* stockage indisponible : valeurs par défaut */ }
  return { skipped: false, open: true, done: false };
}
function saveTutoPrefs(p: TutoPrefs): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* navigation privée */ } }

/** État de la ville lu pour vérifier les étapes. */
export interface CityFacts {
  roads: number;
  zones: { R: number; C: number; I: number };
  tags: Set<string>;
  /** Raccordements aux réseaux voisins (modules électricité et eau). */
  raccord?: { power: boolean; water: boolean };
}

interface Part { label: string; ok: (f: CityFacts) => boolean }
interface Step {
  id: string;
  title: string;
  text: string;
  /** Boutons à mettre en évidence (le premier visible est retenu : bureau puis téléphone). */
  targets: string[];
  parts: Part[];
}

const has = (tag: string) => (f: CityFacts): boolean => f.tags.has(tag);
const hasPrefix = (p: string) => (f: CityFacts): boolean => { for (const t of f.tags) if (t.startsWith(p)) return true; return false; };

export const TUTO_STEPS: readonly Step[] = [
  { id: 'roads', title: 'Tracer des routes', text: 'Ouvrez Routes et tracez une rue, ou un quadrillage (option « Quadrillage ») : tout se construit le long des routes.',
    targets: ['#toolbar [data-tool=road]'], parts: [{ label: 'Route', ok: (f) => f.roads > 0 }] },
  { id: 'zones', title: 'Zoner R, C et I', text: 'Dans Zones, peignez du résidentiel, des commerces et de l’industrie le long des routes : les bâtiments poussent seuls.',
    targets: ['#toolbar [data-cat=zones]'], parts: [
      { label: 'Résidentiel', ok: (f) => f.zones.R > 0 }, { label: 'Commerces', ok: (f) => f.zones.C > 0 }, { label: 'Industrie', ok: (f) => f.zones.I > 0 }] },
  { id: 'power', title: 'Amener l’électricité', text: 'Raccordez-vous au réseau voisin (tableau de bord Énergie › Réglages) ou construisez une centrale (Réseaux › Énergie) : sans courant, les bâtiments restent vides.',
    targets: ['#toolbar [data-cat=energy]', '#toolbar [data-family=reseaux]'], parts: [{ label: 'Centrale ou raccordement', ok: (f) => hasPrefix('elec:centrale')(f) || !!f.raccord?.power }] },
  { id: 'water', title: 'Amener l’eau', text: 'Raccordez-vous au réseau d’eau voisin (tableau de bord Eau › Réglages) ou posez une station de pompage (Réseaux › Eau) ; l’eau suit les routes.',
    targets: ['#toolbar [data-cat=water]', '#toolbar [data-family=reseaux]'], parts: [{ label: 'Pompage ou raccordement', ok: (f) => has('service:eau')(f) || !!f.raccord?.water }] },
  { id: 'waste', title: 'Collecter les déchets', text: 'Un dépôt de camions ramasse les ordures, une décharge ou un incinérateur les traite (Réseaux › Déchets).',
    targets: ['#toolbar [data-cat=waste]', '#toolbar [data-family=reseaux]'], parts: [
      { label: 'Dépôt', ok: has('dechets:depot') }, { label: 'Décharge ou incinérateur', ok: (f) => f.tags.has('dechets:decharge') || f.tags.has('dechets:incinerateur') }] },
  { id: 'school', title: 'Ouvrir une école', text: 'Les familles veulent une école à proximité (Services › Éducation).',
    targets: ['#toolbar [data-cat=services]'], parts: [{ label: 'École', ok: has('service:education') }] },
  { id: 'safety', title: 'Santé et sécurité', text: 'Ajoutez un centre de santé, un commissariat et une caserne de pompiers (Services).',
    targets: ['#toolbar [data-cat=services]'], parts: [
      { label: 'Santé', ok: has('service:sante') }, { label: 'Police', ok: has('service:police') }, { label: 'Pompiers', ok: has('service:incendie') }] },
];

export function stepDone(s: Step, f: CityFacts): boolean { return s.parts.every((p) => p.ok(f)); }

/** Faits de la ville : tronçons de route, cases zonées par secteur, étiquettes des bâtiments posés. */
export function cityFacts(mirror: WorldMirror, raccord?: { power: boolean; water: boolean }): CityFacts {
  const tags = new Set<string>();
  const seen = new Set<string>();
  for (const b of mirror.buildings.values()) {
    if (seen.has(b.assetId)) continue;
    seen.add(b.assetId);
    for (const t of mirror.asset(b.assetId)?.tags ?? []) tags.add(t);
    const cat = mirror.asset(b.assetId)?.category;
    if (cat) tags.add(`cat:${cat}`);
  }
  const c = zoningView.stats?.cells;
  const zones = c
    ? { R: (c.res_faible ?? 0) + (c.res_moyen ?? 0) + (c.res_dense ?? 0), C: (c.commerce ?? 0) + (c.bureaux ?? 0), I: c.industrie ?? 0 }
    : { R: 0, C: 0, I: 0 };
  // Sans module Zonage : des bâtiments de chaque secteur posés à la main valident aussi l'étape.
  if (c) return { roads: mirror.edges.size, zones, tags, raccord };
  if (!zones.R &&['house', 'townhouse', 'apartment_low', 'apartment_mid', 'apartment_high'].some((k) => tags.has(`cat:${k}`))) zones.R = 1;
  if (!zones.C && tags.has('cat:commercial')) zones.C = 1;
  if (!zones.I && tags.has('cat:industrial') && tags.has('service:emplois_industriels')) zones.I = 1;
  return { roads: mirror.edges.size, zones, tags, raccord };
}

export class Tutorial {
  private prefs = loadTutoPrefs();
  private readonly box = $('objectives');
  private readonly toggle = $('obj-toggle');
  private readonly body = $('obj-body');
  private readonly count = $('obj-count');
  private readonly title = this.box.querySelector('.obj-t') as HTMLElement;
  private current = -1;
  private lastKey = '';
  private target: HTMLElement | null = null;
  private facts: CityFacts | null = null;
  private lastRead = -1e9;
  private pending = false;
  private goal: GoalInfo | null = null;
  private goalKey = '';
  private finishTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly notify: (t: string, k?: 'info' | 'error' | 'ok') => void) {
    this.toggle.addEventListener('click', () => { this.prefs.open = !this.prefs.open; saveTutoPrefs(this.prefs); this.render(true); });
    // Surbrillance : recalculée quand la barre d'outils change de disposition (téléphone ↔ bureau).
    window.addEventListener('resize', () => this.highlight());
  }

  get enabled(): boolean { return !this.prefs.skipped && !this.prefs.done; }

  /** Étape en cours (null : tutoriel masqué, terminé ou pas encore évalué). */
  get currentStepId(): string | null { return this.enabled && this.current >= 0 ? TUTO_STEPS[this.current]?.id ?? null : null; }

  /** Réglages : réactive (ou coupe) le tutoriel. */
  setEnabled(on: boolean): void {
    this.prefs.skipped = !on;
    if (on) { this.prefs.done = false; this.prefs.open = true; }
    saveTutoPrefs(this.prefs);
    this.lastKey = '';
    this.render(true);
  }

  /** Nouvel état de la ville (≈ 1 fois/s et à chaque changement du miroir). */
  /** Raccordements aux réseaux voisins (lus dans les charges utiles des modules). */
  raccord = { power: false, water: false };

  update(mirror: WorldMirror | null): void {
    if (!mirror || !this.enabled) { if (!this.enabled) this.render(false); return; }
    // Le miroir change à chaque construction : relecture limitée à 4 fois par seconde.
    const now = performance.now();
    if (now - this.lastRead < 250) { if (!this.pending) { this.pending = true; setTimeout(() => { this.pending = false; this.update(mirror); }, 260); } return; }
    this.lastRead = now;
    this.facts = cityFacts(mirror, this.raccord);
    this.render(false);
  }

  /** Rappel de l'objectif en cours : affiché quand les premiers pas sont terminés ou masqués. */
  setGoal(g: GoalInfo | null): void {
    this.goal = g;
    if (!this.enabled) this.render(false);
  }

  private renderGoal(force: boolean): void {
    const g = this.goal;
    this.setTarget(null);
    delete document.body.dataset['tutoCat'];
    this.box.classList.toggle('tuto-off', !g);
    this.box.classList.toggle('goal-mode', !!g);
    this.box.setAttribute('aria-label', g ? 'Objectif en cours' : 'Premiers pas');
    if (!g) { this.goalKey = ''; return; }
    const key = `${g.title}|${g.count}|${g.pct.toFixed(1)}|${g.lines.join('|')}|${this.prefs.open}`;
    if (!force && key === this.goalKey) return;
    this.goalKey = key;
    this.lastKey = '';
    this.box.classList.toggle('open', this.prefs.open);
    this.toggle.setAttribute('aria-expanded', String(this.prefs.open));
    this.toggle.dataset['tip'] = 'Objectif en cours (détail dans Progression)';
    this.body.classList.toggle('hidden', !this.prefs.open);
    this.title.textContent = g.title;
    this.count.textContent = g.count;
    const bar = el('div', { cls: 'gov-bar' }, el('i', { attrs: { style: `width:${Math.max(0, Math.min(100, g.pct)).toFixed(1)}%` } }));
    const acts = el('div', { cls: 'obj-actions' }, ...g.actions.map((a) => {
      const b = el('button', { cls: a.primary ? 'primary' : '', text: a.label, attrs: { type: 'button' } });
      b.addEventListener('click', () => a.run());
      return b;
    }));
    this.body.replaceChildren(bar, ...g.lines.map((t) => el('p', { cls: 'obj-text', text: t })), acts);
  }

  private render(force: boolean): void {
    const f = this.facts;
    const on = this.enabled;
    if (!on) { this.renderGoal(force); return; }
    this.box.classList.remove('goal-mode');
    this.box.setAttribute('aria-label', 'Premiers pas');
    this.toggle.dataset['tip'] = 'Premiers pas : objectifs guidés (facultatifs)';
    this.goalKey = '';
    this.box.classList.toggle('tuto-off', !on);
    if (!on || !f) { this.setTarget(null); delete document.body.dataset['tutoCat']; return; }
    const idx = TUTO_STEPS.findIndex((s) => !stepDone(s, f));
    const step = idx >= 0 ? TUTO_STEPS[idx]! : null;
    const key = `${idx}|${step ? step.parts.map((p) => (p.ok(f) ? 1 : 0)).join('') : 'fin'}|${this.prefs.open}`;
    if (!force && key === this.lastKey) { this.highlight(); return; }
    // Étape franchie : courte notification (une fois par étape, jamais d'argent).
    // (Chargement d'une ville avancée : plusieurs étapes d'un coup, aucune notification.)
    if (this.current >= 0 && (idx === this.current + 1 || (idx < 0 && this.current === TUTO_STEPS.length - 1))) {
      const doneStep = TUTO_STEPS[this.current];
      if (doneStep) this.notify(`Objectif atteint : ${doneStep.title}`, 'ok');
    }
    const prev = this.current;
    this.current = idx;
    this.lastKey = key;
    const n = TUTO_STEPS.length;
    this.box.classList.toggle('open', this.prefs.open);
    this.toggle.setAttribute('aria-expanded', String(this.prefs.open));
    this.body.classList.toggle('hidden', !this.prefs.open);
    if (!step) {
      // Ville chargée déjà avancée (étapes non franchies pendant cette session) : rien à féliciter, le panneau passe
      // directement à l'objectif en cours (il restait ouvert sur « Premiers pas terminés » jusqu'au clic sur Fermer).
      const finish = (): void => { if (this.prefs.done) return; this.prefs.done = true; saveTutoPrefs(this.prefs); this.render(true); };
      if (prev !== n - 1) { finish(); return; }
      // Terminés à l'instant : message affiché, puis repli automatique.
      clearTimeout(this.finishTimer);
      this.finishTimer = setTimeout(() => { if (this.current < 0) finish(); }, TUTO_FINISH_AUTO_MS);
      this.title.textContent = 'Premiers pas terminés';
      this.count.textContent = `${n}/${n}`;
      const close = el('button', { cls: 'primary', text: 'Fermer' });
      close.addEventListener('click', () => { this.prefs.done = true; saveTutoPrefs(this.prefs); this.render(true); });
      this.body.replaceChildren(el('p', { cls: 'obj-text', text: 'Votre ville a ses réseaux et ses services de base. Place aux objectifs : ils suivent ses problèmes du moment et rapportent argent et points d’expansion pour franchir les paliers (Progression).' }),
        el('div', { cls: 'obj-actions' }, close));
      this.setTarget(null);
      delete document.body.dataset['tutoCat'];
      return;
    }
    this.title.textContent = step.title;
    this.count.textContent = `${idx + 1}/${n}`;
    const parts = step.parts.length > 1
      ? el('ul', { cls: 'obj-parts' }, ...step.parts.map((p) => el('li', { cls: p.ok(f) ? 'ok' : '', text: `${p.ok(f) ? '✓' : '○'} ${p.label}` })))
      : null;
    const show = el('button', { text: 'Montrer', attrs: { type: 'button' } });
    show.dataset['tip'] = 'Faire clignoter le bouton à utiliser';
    show.addEventListener('click', () => { this.highlight(); this.target?.classList.remove('tuto-flash'); void this.target?.offsetWidth; this.target?.classList.add('tuto-flash'); });
    const skip = el('button', { cls: 'link', text: 'Passer', attrs: { type: 'button' } });
    skip.dataset['tip'] = 'Masquer les premiers pas (réactivables dans Réglages)';
    skip.addEventListener('click', () => { this.setEnabled(false); this.notify('Premiers pas masqués : réactivables dans Réglages', 'info'); });
    this.body.replaceChildren(el('p', { cls: 'obj-text', text: step.text }));
    if (parts) this.body.append(parts);
    this.body.append(el('div', { cls: 'obj-actions' }, show, skip));
    this.highlight();
  }

  /** Met en évidence le bouton de l'étape courante (premier visible de la liste). */
  private highlight(): void {
    const step = this.enabled && this.current >= 0 ? TUTO_STEPS[this.current] : null;
    let t: HTMLElement | null = null;
    for (const sel of step?.targets ?? []) {
      const e = document.querySelector<HTMLElement>(sel);
      if (e && e.offsetParent !== null && getComputedStyle(e).display !== 'none') { t = e; break; }
    }
    this.setTarget(t);
    // Choix « Réseaux » du téléphone : la catégorie de l'étape y est aussi mise en évidence (voir styles.css).
    const cat = step?.targets.map((s) => /data-cat=(\w+)/.exec(s)?.[1]).find((c) => !!c) ?? '';
    if (document.body.dataset['tutoCat'] !== cat) { if (cat) document.body.dataset['tutoCat'] = cat; else delete document.body.dataset['tutoCat']; }
  }

  private setTarget(t: HTMLElement | null): void {
    if (t === this.target) return;
    this.target?.classList.remove('tuto-target', 'tuto-flash');
    this.target = t;
    t?.classList.add('tuto-target');
  }
}
