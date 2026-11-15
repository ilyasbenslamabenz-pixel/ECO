/**
 * Satisfaction et aide de croissance : lecture TOLÉRANTE des champs facultatifs du rapport de démographie
 * (`satisfactionFactors`, `vacancyReasons`, `growthHint`). Un champ absent masque simplement la section : aucun
 * chiffre n'est inventé côté interface. Les conseils d'action sont des textes fixes associés aux facteurs.
 * Propriétaire : agent interface.
 */
import type { SimReport } from '../sim/sim-protocol';
import { el, fmt } from './dom';

export interface SatisfactionFactor { key: string; label: string; delta: number }
export type GrowthHint = 'need-roads' | 'need-zones' | 'need-power' | 'need-water';
export const GROWTH_HINTS: readonly GrowthHint[] = ['need-roads', 'need-zones', 'need-power', 'need-water'];

/** Champs ajoutés au rapport de démographie par la simulation (facultatifs tant qu'ils n'existent pas partout). */
interface DemographyExtras {
  satisfactionFactors?: unknown;
  vacancyReasons?: unknown;
  growthHint?: unknown;
}

const extras = (r: SimReport | null): DemographyExtras | null => (r?.demography ?? null) as DemographyExtras | null;

/** Facteurs de satisfaction valides, triés du plus négatif au plus positif ; null si la simulation ne les envoie pas. */
export function satisfactionFactors(r: SimReport | null): SatisfactionFactor[] | null {
  const raw = extras(r)?.satisfactionFactors;
  if (!Array.isArray(raw)) return null;
  const out: SatisfactionFactor[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const delta = Number(o['delta']);
    if (!Number.isFinite(delta)) continue;
    const key = String(o['key'] ?? '');
    out.push({ key, label: String(o['label'] ?? key), delta });
  }
  return out.sort((a, b) => a.delta - b.delta);
}

const VACANCY_FR: Record<string, string> = {
  sansAcces: 'sans accès routier', sansEau: 'sans eau', sansElectricite: 'sans électricité', demandeFaible: 'demande faible',
  water: 'sans eau', eau: 'sans eau', 'no-water': 'sans eau', noWater: 'sans eau',
  power: 'sans électricité', electricite: 'sans électricité', 'no-power': 'sans électricité', noPower: 'sans électricité',
  road: 'sans accès routier', roads: 'sans accès routier', 'no-road': 'sans accès routier', noRoad: 'sans accès routier',
  demand: 'peu de demande', attractiveness: 'ville peu attirante', unhappy: 'satisfaction trop basse', happiness: 'satisfaction trop basse',
  construction: 'en chantier', building: 'en chantier', other: 'autres raisons', autre: 'autres raisons',
};

/** Logements vides par raison (le plus grand nombre d'abord) ; null si absent. Accepte un objet ou une liste. */
export function vacancyReasons(r: SimReport | null): { label: string; count: number }[] | null {
  const raw = extras(r)?.vacancyReasons;
  if (!raw || typeof raw !== 'object') return null;
  const rows: { label: string; count: number }[] = [];
  const push = (key: string, label: unknown, count: unknown): void => {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    rows.push({ label: typeof label === 'string' && label ? label : VACANCY_FR[key] ?? key, count: n });
  };
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const key = String(o['key'] ?? o['reason'] ?? '');
      push(key, o['label'], o['count'] ?? o['value'] ?? o['units']);
    }
  } else {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v && typeof v === 'object') { const o = v as Record<string, unknown>; push(k, o['label'], o['count'] ?? o['value']); } else push(k, undefined, v);
    }
  }
  return rows.sort((a, b) => b.count - a.count);
}

export function growthHint(r: SimReport | null): GrowthHint | null {
  const h = extras(r)?.growthHint;
  return (GROWTH_HINTS as readonly unknown[]).includes(h) ? h as GrowthHint : null;
}

/** Texte joueur de l'aide de croissance (pastille de la jauge de demande et notification). */
export const GROWTH_HINT_FR: Record<GrowthHint, string> = {
  'need-roads': 'Plus de place constructible : tracez des routes et zonez le long',
  'need-zones': 'Aucune zone résidentielle libre : zonez du résidentiel le long des routes (Zones)',
  'need-power': 'Les nouveaux bâtiments attendent l’électricité : raccordez-vous au réseau voisin (Énergie › Réglages) ou construisez une centrale',
  'need-water': 'Les nouveaux bâtiments attendent l’eau : raccordez-vous au réseau voisin (Eau › Réglages) ou posez une station de pompage',
};

/** Conseil d'action pour un facteur négatif (reconnu par sa clé ou son libellé) ; null si aucun conseil fixe. */
export function factorAdvice(f: SatisfactionFactor): string | null {
  const s = `${f.key} ${f.label}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rules: [RegExp, string][] = [
    [/acces|routier/, 'Reliez chaque bâtiment à une route (Routes).'],
    [/remarquable|monument/, 'Construisez un équipement remarquable : musée, gare, hôtel de ville (Services).'],
    [/politique/, 'Ajustez les politiques publiques (tableau de bord Politiques).'],
    [/eau|water|egout|sewage/, 'Raccordez-vous au réseau d’eau voisin ou posez une station de pompage (Réseaux › Eau).'],
    [/electr|power|courant|energie/, 'Raccordez-vous au réseau électrique voisin ou construisez une centrale (Réseaux › Énergie).'],
    [/dechet|waste|garbage|ordure/, 'Dépôt de camions + décharge ou incinérateur (Réseaux › Déchets).'],
    [/educ|ecole|school/, 'Construisez une école près des logements (Services › Éducation).'],
    [/sante|health|hopital|medical/, 'Ajoutez un centre de santé ou un hôpital (Services › Santé).'],
    [/police|securi|crime/, 'Ajoutez un commissariat (Services › Sécurité).'],
    [/incend|fire|pompier/, 'Ajoutez une caserne de pompiers (Services › Sécurité).'],
    [/pollu/, 'Éloignez l’industrie des logements et plantez des arbres (Paysage › Nature).'],
    [/bruit|noise/, 'Séparez les logements des grands axes et de l’industrie.'],
    [/trafic|traffic|circul|commute|trajet|embouteill/, 'Ouvrez le calque Circulation et élargissez ou doublez les axes saturés.'],
    [/impot|tax/, 'Baissez les impôts résidentiels (Finances › Impôts).'],
    [/chomage|emploi|job|unemploy/, 'Zonez des commerces et de l’industrie pour créer des emplois.'],
    [/loisir|parc|leisure|culture/, 'Ajoutez un parc ou un équipement culturel (Services › Loisirs).'],
    [/logement|housing|loyer|rent/, 'Zonez davantage de résidentiel desservi par les réseaux.'],
  ];
  for (const [re, txt] of rules) if (re.test(s)) return txt;
  return null;
}

const pts = (d: number): string => {
  const v = Math.round(d * 10) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pt${Math.abs(v) >= 2 ? 's' : ''}`;
};

/**
 * Section « Satisfaction » de Population > Aperçu : facteurs triés (effet en points), conseil pour les pires,
 * logements vides expliqués, aide de croissance. Renvoie null si la simulation n'envoie aucun de ces champs.
 */
export function renderSatisfaction(r: SimReport | null): HTMLElement | null {
  const factors = satisfactionFactors(r);
  const vac = vacancyReasons(r);
  const hint = growthHint(r);
  if (!factors && !vac && !hint) return null;
  const box = el('div', { cls: 'satisf' });
  if (hint) box.append(el('p', { cls: 'satisf-hint', text: GROWTH_HINT_FR[hint] }));
  if (factors) {
    box.append(el('div', { cls: 'sec-title', text: 'Satisfaction : ce qui compte' }));
    if (!factors.length) box.append(el('p', { cls: 'muted small', text: 'Aucun facteur pour l’instant : la satisfaction apparaît avec les premiers habitants.' }));
    const list = el('ul', { cls: 'satisf-list' });
    // Conseils : les deux pires facteurs négatifs.
    const worst = new Set(factors.filter((f) => f.delta < 0).slice(0, 2));
    const shown = factors.filter((f) => Math.abs(f.delta) >= 0.05);
    for (const f of shown) {
      const li = el('li', { cls: f.delta < 0 ? 'neg' : f.delta > 0 ? 'pos' : '' },
        el('span', { cls: 'sf-label', text: f.label }), el('b', { cls: 'sf-delta', text: pts(f.delta) }));
      const tip = worst.has(f) ? factorAdvice(f) : null;
      if (tip) li.append(el('span', { cls: 'sf-tip', text: tip }));
      list.append(li);
    }
    if (shown.length) box.append(list);
    const neutral = factors.length - shown.length;
    if (factors.length && neutral > 0) box.append(el('p', { cls: 'muted small', text: shown.length ? `${neutral} autre${neutral > 1 ? 's' : ''} facteur${neutral > 1 ? 's' : ''} sans effet pour l’instant.` : 'Aucun facteur ne pèse pour l’instant.' }));
  }
  if (vac) {
    // Raisons : bâtiments résidentiels entièrement vides ; « libres » : logements libres (unités) du rapport.
    const total = vac.reduce((s, v) => s + v.count, 0);
    const free = Number(r?.demography.housingFree ?? 0);
    if (total > 0) {
      box.append(el('div', { cls: 'sec-title', text: 'Logements vides' }));
      const head = free > 0 ? `${fmt(free)} logement${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}` : 'Logements libres';
      box.append(el('p', { cls: 'satisf-vac', text: `${head} — ${fmt(total)} bâtiment${total > 1 ? 's' : ''} vide${total > 1 ? 's' : ''} : ${vac.map((v) => `${v.label} (${fmt(v.count)})`).join(' · ')}` }));
    }
  }
  return box;
}
