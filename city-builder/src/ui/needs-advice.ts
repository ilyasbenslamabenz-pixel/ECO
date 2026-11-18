/**
 * « Ce qu'il faut faire » : une phrase chiffrée en tête des tableaux Énergie, Eau et Déchets — l'état en clair et
 * la prochaine action, avec un bouton qui ouvre l'outil de construction concerné.
 * Fonctions pures (testées dans tests/unit/conseils-besoins.test.ts) : toutes les valeurs viennent du bilan reçu de
 * la simulation et des fiches techniques partagées (puissances, débits, raccordements) — rien n'est inventé.
 */
import { FACILITY_SPECS, IMPORT_SPEC } from '../shared/power/model';
import type { ElectriciteDelta, ElectriciteSummary } from '../shared/power/types';
import { WATER_FACILITIES, WATER_IMPORT, type WaterBalance } from '../shared/water-network/types';
import type { WasteSummary } from '../shared/waste/types';

export type AdviceLevel = 'ok' | 'warn' | 'bad';
export interface Advice {
  level: AdviceLevel;
  /** Phrase affichée (état + action). */
  text: string;
  /** Bouton : famille de construction à ouvrir. */
  action?: { label: string; build: 'energy' | 'water' | 'waste' | 'road' };
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const power = (kw: number): string => (Math.abs(kw) >= 1000 ? `${nf1.format(kw / 1000)} MW` : `${nf0.format(kw)} kW`);
const flow = (m3h: number): string => `${m3h < 10 ? nf1.format(m3h) : nf0.format(m3h)} m³/h`;
const plural = (n: number, one: string, many = `${one}s`): string => `${nf0.format(n)} ${n > 1 ? many : one}`;

/* --------------------------------------------- Énergie --------------------------------------------- */

/** Trésorerie et prix d'une centrale thermique (catalogue) : pour dire quand un emprunt est nécessaire. */
export interface AdviceMoney { treasury: number; thermalCost: number }
let moneySource: () => AdviceMoney | null = () => null;
/** Branché par l'interface (statistiques reçues + catalogue) ; sans source : conseil sans montant. */
export function setAdviceMoney(f: () => AdviceMoney | null): void { moneySource = f; }
const chf = (v: number): string => (Math.abs(v) >= 1e6 ? `${nf1.format(v / 1e6)} M CHF` : Math.abs(v) >= 1e3 ? `${nf0.format(v / 1e3)} k CHF` : `${nf0.format(v)} CHF`);

export function powerAdvice(s: ElectriciteSummary | undefined, st: Pick<ElectriciteDelta, 'facilities' | 'settings'>, money: AdviceMoney | null = moneySource()): Advice {
  const build = { label: 'Construire', build: 'energy' as const };
  const plants = (st.facilities ?? []).filter((f) => f.kind !== 'poste' && f.kind !== 'batterie');
  const raccorde = st.settings?.raccordement === true;
  if (!s || (s.buildings === 0 && !plants.length)) {
    return { level: 'warn', text: `Aucune source de courant. Le plus simple pour démarrer : le raccordement au réseau voisin (${nf0.format(IMPORT_SPEC.connectionChf)} CHF, jusqu'à ${power(IMPORT_SPEC.capacityKw)}), sinon une centrale au bord d'une route.`, action: build };
  }
  const iso = (st.facilities ?? []).filter((f) => f.isolated).length;
  if (iso > 0) return { level: 'bad', text: `${plural(iso, 'installation')} ne ${iso > 1 ? 'touchent' : 'touche'} aucune route : le courant suit les routes, reliez-${iso > 1 ? 'les' : 'la'} au réseau routier.`, action: { label: 'Routes', build: 'road' } };
  const missing = Math.max(s.shortfallKw, s.demandKw - s.deliveredKw);
  if (missing > 1 || s.cut > 0) {
    if (!plants.length && !raccorde) {
      return { level: 'bad', text: `Il manque ${power(missing)} et la ville n'a ni centrale ni raccordement : raccordez-vous au réseau voisin (jusqu'à ${power(IMPORT_SPEC.capacityKw)}) ou construisez une centrale.`, action: build };
    }
    if (!raccorde && missing <= IMPORT_SPEC.capacityKw) {
      return { level: 'bad', text: `Il manque ${power(missing)} (${plural(s.cut, 'bâtiment coupé', 'bâtiments coupés')}) : le raccordement au réseau voisin (jusqu'à ${power(IMPORT_SPEC.capacityKw)}) suffit, ou ajoutez une centrale.`, action: build };
    }
    const th = FACILITY_SPECS.thermique.nominalKw, wind = FACILITY_SPECS.eolien.nominalKw;
    const nWind = Math.ceil(missing / wind);
    // Centrale hors de portée de la trésorerie : le dire, avec le levier (emprunt) plutôt que laisser la ville se vider.
    const loan = money && money.thermalCost > 0 && money.treasury < money.thermalCost
      ? ` La centrale coûte ${chf(money.thermalCost)} pour ${chf(Math.max(0, money.treasury))} en caisse : un emprunt (Finances › Emprunts) la paie tout de suite, le courant revenu fait repartir l'emploi.`
      : '';
    return { level: 'bad', text: `Il manque ${power(missing)} (${plural(s.cut, 'bâtiment coupé', 'bâtiments coupés')}) : ${Math.ceil(missing / th) > 1 ? `${Math.ceil(missing / th)} centrales thermiques` : 'une centrale thermique'} (${power(th)}, pilotable)${nWind <= 12 ? ` ou ≈ ${nWind} éolienne${nWind > 1 ? 's' : ''} (${power(wind)} chacune, selon le vent)` : ''}.${loan}`, action: build };
  }
  if (s.unlinked > 0) return { level: 'warn', text: `${plural(s.unlinked, 'bâtiment')} hors réseau : prolongez la route jusqu'à eux (le courant suit les routes).`, action: { label: 'Routes', build: 'road' } };
  const margin = s.availableKw + (s.importedKw ?? 0) - s.demandKw;
  const share = s.demandKw > 0 ? margin / s.demandKw : 1;
  if (s.demandKw > 0 && share < 0.15) return { level: 'warn', text: `Tout est alimenté, mais la marge est faible (${power(Math.max(0, margin))}, ${nf0.format(Math.max(0, share) * 100)} % de la demande) : prévoyez une centrale avant de zoner davantage.`, action: build };
  return { level: 'ok', text: s.demandKw > 0 ? `Courant suffisant : ${power(s.deliveredKw)} livrés, marge ${power(Math.max(0, margin))}.` : `Centrale prête (${power(s.availableKw)} disponibles) : rien ne consomme encore.` };
}

/* --------------------------------------------- Eau --------------------------------------------- */

export function waterAdvice(b: WaterBalance | undefined, raccorde: boolean): Advice {
  const build = { label: 'Construire', build: 'water' as const };
  const pump = WATER_FACILITIES.pompage.capacity;
  if (!b) {
    return { level: 'warn', text: `Pas de service d'eau. Pour démarrer : le raccordement au réseau voisin (${nf0.format(WATER_IMPORT.connectionChf)} CHF, jusqu'à ${flow(WATER_IMPORT.capacity)}), puis une station de pompage au bord d'une rivière ou d'un lac (${flow(pump)} ; bien moins en forage loin de l'eau).`, action: build };
  }
  const deficit = b.demand - b.delivered;
  if (deficit > 0.5 && b.production < b.demand) {
    const n = Math.ceil((b.demand - b.production) / pump);
    const racc = !raccorde && deficit <= WATER_IMPORT.capacity ? ` Le raccordement au réseau voisin (jusqu'à ${flow(WATER_IMPORT.capacity)}) suffit pour l'instant.` : '';
    return { level: 'bad', text: `Il manque ${flow(deficit)} d'eau potable : ${n > 1 ? `${n} stations de pompage` : 'une station de pompage'} de plus au bord de l'eau (${flow(pump)} chacune).${racc}`, action: build };
  }
  if (b.unserved > 0) {
    return { level: 'warn', text: `${plural(b.unserved, 'bâtiment')} sans eau suffisante alors que la production suit : prolongez les routes jusqu'à eux (canalisations) ou ajoutez un château d'eau pour la pression.`, action: build };
  }
  const raw = b.sewageRaw + b.sewageOverflow;
  if (b.sewage > 0.5 && raw > 0.5) {
    const n = Math.ceil(raw / WATER_FACILITIES.epuration.capacity);
    return { level: 'warn', text: `${flow(raw)} d'eaux usées rejetées sans traitement (pollution des cours d'eau) : ${n > 1 ? `${n} stations d'épuration` : 'une station d\'épuration'} (${flow(WATER_FACILITIES.epuration.capacity)} chacune) reliée à un émissaire.`, action: build };
  }
  if (b.demand <= 0) return { level: 'ok', text: `Réseau prêt (${flow(b.production)} disponibles) : aucun bâtiment raccordé ne consomme encore.` };
  return { level: 'ok', text: `Eau suffisante : ${flow(b.delivered)} livrés sur ${flow(b.production)} disponibles, ${nf0.format(b.served)} / ${nf0.format(b.buildings)} bâtiments desservis.` };
}

/* --------------------------------------------- Déchets --------------------------------------------- */

export function wasteAdvice(s: WasteSummary | null | undefined): Advice {
  const build = { label: 'Construire', build: 'waste' as const };
  if (!s) return { level: 'warn', text: 'Pas de collecte des déchets : construisez un dépôt de camions et une décharge (ou un incinérateur) reliés par la route.', action: build };
  if (s.blocked) return { level: 'bad', text: `Collecte arrêtée : ${s.blocked}`, action: build };
  if ((s.unservedProducers ?? 0) > 0) return { level: 'bad', text: `${plural(s.unservedProducers!, 'bâtiment')} hors de portée des camions : reliez leurs routes à celle du dépôt.`, action: { label: 'Routes', build: 'road' } };
  if (s.overflowingBuildings > 0) {
    const fix = (s.diagnostics ?? []).find((d) => d.level === 'warn' && d.fix)?.fix;
    return { level: 'warn', text: `${plural(s.overflowingBuildings, 'bâtiment')} avec des bacs qui débordent : ${fix ?? 'collectez plus souvent ou ajoutez des camions (financement du service).'}`, action: build };
  }
  const warn = (s.diagnostics ?? []).find((d) => d.level === 'warn');
  if (warn) return { level: 'warn', text: warn.fix ? `${warn.text} → ${warn.fix}` : warn.text, action: build };
  return { level: 'ok', text: s.producers > 0 ? `Collecte en ordre : ${plural(s.producers, 'bâtiment')} desservis, aucun bac ne déborde.` : 'Collecte prête : aucun bâtiment ne produit encore de déchets.' };
}

/* --------------------------------------------- Affichage --------------------------------------------- */

const LEVEL_LABEL: Record<AdviceLevel, string> = { ok: 'Tout va bien', warn: 'À surveiller', bad: 'À faire maintenant' };
const escHtml = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Bloc HTML (panneaux rendus en chaîne) ; le bouton porte `data-act="goto"` et `data-build`. */
export function adviceHtml(a: Advice): string {
  const btn = a.action ? `<button class="todo-go" data-act="goto" data-build="${a.action.build}">${escHtml(a.action.label)} ›</button>` : '';
  return `<div class="todo-box ${a.level}" data-k="todo" data-level="${a.level}"><div class="todo-txt"><span class="todo-h">${LEVEL_LABEL[a.level]}</span><span>${escHtml(a.text)}</span></div>${btn}</div>`;
}

/** Bloc DOM (panneaux construits en éléments) ; `go(build)` ouvre l'outil. */
export function adviceEl(a: Advice, go: (build: NonNullable<Advice['action']>['build']) => void): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = adviceHtml(a);
  const root = box.firstElementChild as HTMLElement;
  root.querySelector('button')?.addEventListener('click', () => go(a.action!.build));
  return root;
}
