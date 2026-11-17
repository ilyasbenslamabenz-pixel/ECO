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

export interface CardInfo { lines: string[]; depends: string | null }

/** Chiffre clé d'une carte : pictogramme, valeur courte et libellé complet (info-bulle, lecteur d'écran). */
export interface CardStat { icon: string; text: string; label: string }

/** Chiffres clés structurés (mêmes valeurs que `cardInfo().lines`, avec un pictogramme par chiffre). */
export function cardStats(a: CatalogAsset): CardStat[] {
  const out: CardStat[] = [];
  const pk = facilityKindOf(a);
  if (pk) {
    const kw = nominalKwOf(a, pk);
    if (pk === 'poste') out.push({ icon: 'pylon', text: `Transformation ${mw(kw)}`, label: 'Puissance de transformation' });
    else if (pk === 'batterie') out.push({ icon: 'energy', text: `Stockage ${nf1(capacityKwhOf(a) / 1000)} MWh · ${mw(kw)} · rendement ${Math.round(BATTERY_SPEC.roundTrip * 100)} %`, label: 'Stockage, puissance et rendement' });
    else {
      const s = avgShare(pk);
      out.push({ icon: 'energy', text: s !== null && s < 0.999 ? `${mw(kw)} nominal · moy. ≈ ${mw(kw * s)}` : `${mw(kw)} nominal`, label: 'Puissance nominale (et moyenne attendue sur l’année)' });
    }
  }
  const wk = waterKindOf(a.id);
  if (wk) {
    const w = WATER_FACILITIES[wk];
    if (wk === 'chateau') out.push({ icon: 'watertower', text: `Réserve ${fmt(w.storage ?? 0)} m³ · ${fmt(w.capacity)} m³/h`, label: 'Réserve et débit' });
    else if (wk !== 'emissaire') out.push({ icon: 'water', text: `${fmt(w.capacity)} m³/h`, label: 'Débit traité' });
  }
  const cap = tagNum(a, 'capacite_service:');
  if (cap) {
    const svc = a.tags.find((t) => t.startsWith('service:'))?.slice(8) ?? '';
    const unit = svc === 'education' ? 'élèves' : svc === 'petite_enfance' ? 'enfants' : svc === 'sante' ? 'patients' : svc === 'sport' ? 'usagers' : svc === 'incendie' || svc === 'police' ? 'véhicules' : '';
    out.push({ icon: svc === 'incendie' || svc === 'police' ? 'truck' : 'people', text: unit ? `${fmt(cap)} ${unit}` : `Capacité ${fmt(cap)}`, label: 'Capacité du service' });
  }
  const trucks = tagNum(a, 'camions:');
  if (trucks) out.push({ icon: 'truck', text: `${fmt(trucks)} camions`, label: 'Camions de collecte' });
  const perDay = tagNum(a, 'capacite_jour:');
  if (perDay) out.push({ icon: 'recycle', text: `${tonnes(perDay)} / jour`, label: 'Déchets traités par jour' });
  const total = tagNum(a, 'capacite_totale:');
  if (total) out.push({ icon: 'landfill', text: `${tonnes(total)} au total`, label: 'Capacité totale de stockage' });
  const radius = tagNum(a, 'rayon:');
  if (radius) out.push({ icon: 'target', text: `Rayon ${radius >= 1000 ? `${nf1(radius / 1000)} km` : `${fmt(radius)} m`}`, label: 'Rayon d’action' });
  return out;
}

export function cardInfo(a: CatalogAsset): CardInfo {
  return { lines: cardStats(a).map((s) => s.text), depends: DEPENDS[a.id] ?? null };
}

/** Libellés des familles `service:*` du catalogue (sous-catégories des cartes). */
const SERVICE_FR: Record<string, string> = {
  alimentation: 'Alimentation', commerces: 'Boutiques et magasins', restauration: 'Cafés et restaurants', carburant: 'Carburant', tourisme: 'Hôtellerie',
  emplois_tertiaires: 'Bureaux', emplois_industriels: 'Usines et ateliers', fret: 'Logistique', stockage: 'Dépôts', stockage_agricole: 'Stockage agricole',
  eau: 'Eau potable', assainissement: 'Assainissement', electricite: 'Électricité', education: 'Écoles', petite_enfance: 'Petite enfance', sante: 'Santé',
  police: 'Police', incendie: 'Pompiers', culture: 'Culture', sport: 'Sport', loisirs: 'Loisirs', administration: 'Administration', patrimoine: 'Lieux de culte',
  transport: 'Gares', dechets: 'Déchets',
};
const DENSITE_FR: Record<string, string> = { faible: 'Densité faible', moyenne: 'Densité moyenne', forte: 'Densité forte', tres_forte: 'Très haute densité' };
const CATEGORY_GROUP_FR: Partial<Record<CatalogAsset['category'], string>> = { apartment_low: 'Petits immeubles (R+1 à R+3)', apartment_mid: 'Immeubles moyens (R+4 à R+8)' };

/**
 * Sous-catégorie d'un modèle dans un onglet du menu de construction, d'après ses étiquettes du catalogue (rien
 * d'inventé) : rôle électrique, étape des déchets, famille de service, catégorie, puis densité.
 */
export function subGroupOf(a: CatalogAsset, multiCats: boolean): string {
  const pk = facilityKindOf(a);
  if (pk) return pk === 'poste' ? 'Réseau électrique' : pk === 'batterie' ? 'Stockage d’électricité' : 'Production d’électricité';
  const d = a.tags.find((t) => t.startsWith('dechets:'))?.slice(8);
  if (d) return d === 'depot' ? 'Collecte' : d === 'decharge' ? 'Stockage des déchets' : 'Traitement';
  if (a.tags.includes('depot_bus')) return 'Dépôts';
  if (multiCats && CATEGORY_GROUP_FR[a.category]) return CATEGORY_GROUP_FR[a.category]!;
  const svc = a.tags.find((t) => t.startsWith('service:'))?.slice(8);
  if (svc && SERVICE_FR[svc]) return SERVICE_FR[svc]!;
  if (a.tags.includes('culte')) return 'Lieux de culte';
  const dens = a.tags.find((t) => t.startsWith('densite:'))?.slice(8);
  if (dens && DENSITE_FR[dens]) return DENSITE_FR[dens]!;
  return 'Autres';
}
