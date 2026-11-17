/**
 * Essentiel d'un modèle du catalogue pour les cartes de construction : puissance des centrales (nominale et moyenne
 * attendue), capacité des équipements, rayon d'action et dépendances entre installations. Valeurs tirées du
 * catalogue et des modèles partagés de la simulation (électricité, eau) : rien n'est inventé.
 */
import type { CatalogAsset } from '../shared/catalog';
import { BATTERY_SPEC, capacityKwhOf, facilityKindOf, hydroShare, nominalKwOf, solarShare, windPowerShare, windProfile } from '../shared/power/model';
import { facilityKindOf as waterKindOf, WATER_FACILITIES } from '../shared/water-network/types';
import { fmt } from './dom';

const nf1 = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const mw = (kw: number): string => (kw >= 1000 ? `${nf1(kw / 1000)} MW` : `${fmt(kw)} kW`);
const SEASONS = ['printemps', 'ete', 'automne', 'hiver'];

/** Part moyenne de la puissance nominale attendue sur une année (profils de la simulation, sans météo). */
const avgShare = (() => {
  const cache = new Map<string, number>();
  return (kind: string): number | null => {
    if (cache.has(kind)) return cache.get(kind)!;
    let v: number | null = null;
    if (kind === 'thermique') v = 1;
    else if (kind === 'hydro') v = SEASONS.reduce((a, s) => a + hydroShare(s), 0) / SEASONS.length;
    else if (kind === 'solaire') { let t = 0; for (const s of SEASONS) for (let h = 0; h < 24; h += 0.5) t += solarShare(h, s); v = t / (SEASONS.length * 48); }
    else if (kind === 'eolien') { let t = 0, n = 0; for (let m = 0; m < 30 * 1440; m += 30) { t += windPowerShare(windProfile(m, 1)); n++; } v = t / n; }
    if (v !== null) cache.set(kind, v);
    return v;
  };
})();

const tagNum = (a: CatalogAsset, prefix: string): number | null => {
  const t = a.tags.find((x) => x.startsWith(prefix));
  const v = t ? Number(t.slice(prefix.length)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
};
const tonnes = (kg: number): string => `${fmt(kg / 1000)} t`;

/** Dépendances entre installations (texte joueur). */
const DEPENDS: Record<string, string> = {
  dechets_depot_camions: 'Nécessite une décharge ou un incinérateur (ou un centre de tri) où vider les camions.',
  dechets_centre_tri: 'Nécessite un dépôt de camions-bennes pour la collecte.',
  dechets_incinerateur: 'Nécessite un dépôt de camions-bennes pour la collecte.',
  dechets_decharge: 'Nécessite un dépôt de camions-bennes pour la collecte.',
  eau_station_pompage: 'Près d’une rivière ou d’un lac (sinon forage de la nappe), au bord d’une route : les canalisations suivent les routes ; à compléter par une usine de potabilisation.',
  eau_usine_potabilisation: 'Nécessite une station de pompage ; un château d’eau stocke l’eau traitée.',
  eau_chateau_eau: 'Stocke l’eau d’une usine de potabilisation et maintient la pression.',
  eau_station_epuration: 'Rejette l’eau épurée : au bord de l’eau ou avec un émissaire.',
  eau_emissaire: 'Au bord d’un cours d’eau ; une station d’épuration évite d’y rejeter des eaux sales.',
  elec_barrage: 'Au bord d’un cours d’eau ; reliez-le à une route (le courant suit les routes).',
  elec_centrale_gaz: 'Au bord d’une route : alimente tous les bâtiments du réseau routier connecté.',
  elec_ferme_solaire: 'Au bord d’une route : alimente tous les bâtiments du réseau routier connecté.',
  elec_eolienne: 'Au bord d’une route (une seule éolienne d’un parc suffit) ; 88 m minimum entre deux éoliennes pour que les rotors ne se chevauchent pas.',
  elec_poste: 'Transforme et distribue le courant ; le courant suit les routes, les lignes haute tension (facultatives) relient les sites éloignés.',
  elec_batteries: 'Se charge avec le surplus des centrales et alimente la ville la nuit ou sans vent ; près d’une route reliée aux centrales.',
};

/** Chiffre clé d'une carte : icône (src/ui/icons.ts) + texte court. */
export interface CardStat { icon: string; text: string }
export interface CardInfo { lines: string[]; stats: CardStat[]; depends: string | null }

export function cardInfo(a: CatalogAsset): CardInfo {
  const stats: CardStat[] = [];
  // `lines` (texte des info-bulles) est dérivé de `stats` : une seule source pour les deux affichages.
  const add = (text: string, icon: string): void => { stats.push({ icon, text }); };
  const pk = facilityKindOf(a);
  if (pk) {
    const kw = nominalKwOf(a, pk);
    if (pk === 'poste') add(`Transformation ${mw(kw)}`, 'pylon');
    else if (pk === 'batterie') { add(`Stockage ${nf1(capacityKwhOf(a) / 1000)} MWh`, 'energy'); add(`${mw(kw)} · rendement ${Math.round(BATTERY_SPEC.roundTrip * 100)} %`, 'pylon'); }
    else {
      const s = avgShare(pk);
      add(s !== null && s < 0.999 ? `${mw(kw)} nominal · moy. ≈ ${mw(kw * s)}` : `${mw(kw)} nominal`, 'energy');
    }
  }
  const wk = waterKindOf(a.id);
  if (wk) {
    const w = WATER_FACILITIES[wk];
    if (wk === 'chateau') add(`Réserve ${fmt(w.storage ?? 0)} m³ · ${fmt(w.capacity)} m³/h`, 'water');
    else if (wk !== 'emissaire') add(`${fmt(w.capacity)} m³/h`, 'water');
  }
  const cap = tagNum(a, 'capacite_service:');
  if (cap) {
    const svc = a.tags.find((t) => t.startsWith('service:'))?.slice(8) ?? '';
    const unit = svc === 'education' ? 'élèves' : svc === 'petite_enfance' ? 'enfants' : svc === 'sante' ? 'patients' : svc === 'sport' ? 'usagers' : svc === 'incendie' || svc === 'police' ? 'véhicules' : '';
    add(unit ? `${fmt(cap)} ${unit}` : `Capacité ${fmt(cap)}`, 'people');
  }
  const trucks = tagNum(a, 'camions:');
  if (trucks) add(`${fmt(trucks)} camions`, 'truck');
  const perDay = tagNum(a, 'capacite_jour:');
  if (perDay) add(`${tonnes(perDay)} / jour`, 'waste');
  const total = tagNum(a, 'capacite_totale:');
  if (total) add(`${tonnes(total)} au total`, 'landfill');
  const radius = tagNum(a, 'rayon:');
  if (radius) add(`Rayon ${radius >= 1000 ? `${nf1(radius / 1000)} km` : `${fmt(radius)} m`}`, 'target');
  return { lines: stats.map((x) => x.text), stats, depends: DEPENDS[a.id] ?? null };
}
