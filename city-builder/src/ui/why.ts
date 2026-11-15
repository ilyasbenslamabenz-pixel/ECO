/**
 * Fiche « Pourquoi » d'un bâtiment (vague 5, docs/INTERFACE.md) : met en mots, dans l'ordre d'importance, pourquoi
 * un bâtiment est vide, pourquoi ses habitants sont mécontents ou pourquoi son entreprise perd de l'argent, avec une
 * action conseillée pour chaque raison. Fonction PURE (testée) : elle ne lit que les données de la simulation
 * (`BuildingOccupancy.diagnosis`, facteurs de satisfaction, raisons de vacance et de fermeture, services, réseaux,
 * déchets, bus) et le masque des icônes de problèmes. Aucun chiffre inventé.
 */
import type { BuildingOccupancy } from '../sim/demography';
import { ALERT_BITS } from '../shared/protocol-ext/alertes';

export type WhySeverity = 'high' | 'mid' | 'low';
export interface WhyItem { key: string; severity: WhySeverity; cause: string; action: string; weight: number }
export interface WhySection { kind: 'vacant' | 'unhappy' | 'company' | 'jobs' | 'ok'; title: string; items: WhyItem[] }

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const pts = (v: number): string => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pt`;
const sevOf = (w: number): WhySeverity => (w >= 8 ? 'high' : w >= 3 ? 'mid' : 'low');

/** Facteur de satisfaction négatif → cause et action (textes propres au jeu). */
function factorItem(o: BuildingOccupancy, key: string, delta: number): Omit<WhyItem, 'weight' | 'severity' | 'key'> | null {
  const d = o.diagnosis!;
  const p = ` (${pts(delta)})`;
  switch (key) {
    case 'emploi': return d.unemployed > 0
      ? { cause: `Chômage : ${d.unemployed} actif(s) sur ${d.labor} sans emploi${p}`, action: 'zonez des emplois (commerce, industrie, bureaux) à portée, ou reliez le quartier aux emplois par une ligne de bus' }
      : { cause: `Emplois en dessous de leur niveau d’études${p}`, action: 'zonez des bureaux pour les diplômés du supérieur' };
    case 'loyer': return { cause: `Loyer trop cher${d.rentBurden !== null ? ` (${pct(d.rentBurden)} des revenus, soutenable : ${pct(d.sustainableShare)})` : ''}${p}`, action: 'créez des emplois mieux payés, construisez plus de logements (le marché baisse) ou adoptez « Aide au logement »' };
    case 'logement': return { cause: `Pas d’accès routier${p}`, action: 'reliez le bâtiment à une route' };
    case 'electricite': return d.power === 1
      ? { cause: `Courant coupé : production insuffisante${p}`, action: 'construisez une centrale, des batteries ou achetez au réseau voisin (Énergie)' }
      : d.power === 2 ? { cause: `Pas de courant${p}`, action: 'raccordez-vous au réseau électrique ou construisez une centrale' }
        : { cause: `Électricité : nuisances ou coupures récentes${p}`, action: 'éloignez les centrales des logements, renforcez la production' };
    case 'eau': return d.water === 1
      ? { cause: `Eau coupée : pression ou production insuffisante${p}`, action: 'ajoutez une pompe ou un château d’eau' }
      : d.water === 2 ? { cause: `Pas d’eau courante${p}`, action: 'prolongez les canalisations depuis une station de pompage' }
        : { cause: `Eau : qualité ou égouts insuffisants${p}`, action: 'traitez les eaux usées, raccordez les égouts' };
    case 'dechets': return { cause: `Déchets : bacs pleins ou nuisances${p}`, action: 'construisez un dépôt de camions-bennes et une décharge à portée, loin des logements' };
    case 'sante': return { cause: `Santé : soins absents ou habitants malades${p}`, action: 'construisez un centre de santé à proximité ; éloignez l’industrie polluante' };
    case 'police': return { cause: `Insécurité${o.safety ? ` (criminalité ${o.safety.crime} / 100)` : ''}${p}`, action: 'construisez un commissariat à proximité et luttez contre le chômage' };
    case 'pompiers': return { cause: `Pas de caserne de pompiers à portée${p}`, action: 'construisez une caserne de pompiers' };
    case 'education': return { cause: `Pas d’école pour les enfants${p}`, action: 'construisez une école à proximité' };
    case 'loisirs': return { cause: `Pas de loisirs à proximité${p}`, action: 'ajoutez un parc ou un équipement de loisirs' };
    case 'pollution': return { cause: `Pollution industrielle${p}`, action: 'éloignez l’industrie des logements, plantez des parcs, adoptez « Filtres industriels »' };
    case 'bruit': return { cause: `Bruit et nuisances${p}`, action: 'éloignez les logements des centrales, gares, port, aéroport et décharges' };
    case 'trajet': return { cause: `Trajets trop longs${p}`, action: 'rapprochez emplois et logements, ou créez une ligne de bus' };
    case 'impots': return { cause: `Impôts élevés${p}`, action: 'baissez l’impôt résidentiel (Finances)' };
    case 'politiques': return { cause: `Politiques et quartier${p}`, action: 'revoyez les politiques de la ville et du secteur (Politiques)' };
    case 'equipements': return null;
    default: return { cause: `${key}${p}`, action: '' };
  }
}

const VACANCY: Record<string, { cause: string; action: string; weight: number }> = {
  sansAcces: { cause: 'Pas d’accès routier : personne ne peut s’y installer', action: 'reliez le bâtiment à une route', weight: 20 },
  sansEau: { cause: 'Pas d’eau', action: 'prolongez les canalisations ou ajoutez une pompe', weight: 18 },
  sansElectricite: { cause: 'Pas de courant', action: 'raccordez-vous au réseau ou construisez une centrale', weight: 18 },
  loyerEleve: { cause: 'Loyer trop cher pour les ménages de la ville', action: 'créez des emplois mieux payés ou adoptez « Aide au logement »', weight: 10 },
  demandeFaible: { cause: 'Pas assez de demande de logements', action: 'créez des emplois : les habitants viennent pour travailler', weight: 4 },
};

const COMPANY: Record<string, { action: string }> = {
  'main-doeuvre': { action: 'construisez des logements à proximité ou une ligne de bus vers les quartiers habités' },
  clients: { action: 'il faut plus d’habitants à proximité (ou moins de commerces concurrents) : zonez des logements autour' },
  qualification: { action: 'construisez des écoles : les employés sous-qualifiés produisent moins' },
  loyer: { action: 'le terrain est cher ici : zonez ce type d’activité dans un quartier moins cher' },
  charges: { action: 'baissez l’impôt de ce secteur (Finances) ; les salaires suivent le niveau d’études' },
};

/** Raisons classées par importance (pures), regroupées en sections. Liste vide : rien à expliquer. */
export function explainBuilding(o: BuildingOccupancy, alertMask = 0, opts: { isService?: boolean } = {}): WhySection[] {
  const d = o.diagnosis;
  const out: WhySection[] = [];
  if (!d) return out;
  const st = o.safety?.state;
  const ruined = st === 'ruine';
  // 1) Logement vide.
  if (o.residentCapacity > 0 && o.residents === 0) {
    const items: WhyItem[] = [];
    if (ruined) items.push({ key: 'ruine', severity: 'high', cause: 'Détruit par un incendie', action: 'reconstruisez-le ou démolissez la ruine', weight: 30 });
    else if (st === 'endommage') items.push({ key: 'endommage', severity: 'mid', cause: 'Endommagé par un incendie (en réparation)', action: 'attendez la fin des réparations ; construisez une caserne pour l’avenir', weight: 12 });
    const v = d.vacancy ? VACANCY[d.vacancy] : null;
    if (v) items.push({ key: d.vacancy!, severity: sevOf(v.weight), ...v });
    if (items.length) out.push({ kind: 'vacant', title: 'Pourquoi ce logement est vide', items: items.sort((a, b) => b.weight - a.weight) });
  }
  // 2) Emplois non pourvus (bâtiment d'activité ou équipement sans employé).
  if (o.jobCapacity > 0 && o.workers === 0 && !(o.residentCapacity > 0)) {
    const items: WhyItem[] = [];
    if (ruined) items.push({ key: 'ruine', severity: 'high', cause: 'Détruit par un incendie', action: 'reconstruisez-le ou démolissez la ruine', weight: 30 });
    if (!o.roadAccess) items.push({ key: 'route', severity: 'high', cause: 'Pas d’accès routier : aucun employé ne peut venir', action: 'reliez le bâtiment à une route', weight: 20 });
    if (o.company?.status === 'closed') items.push({ key: 'fermee', severity: 'high', cause: `Entreprise fermée${o.company.reason ? ` (${o.company.reason.toLowerCase()})` : ''} : local vacant`, action: 'une entreprise reprendra le local quand clientèle ou main-d’œuvre suffiront', weight: 15 });
    if (d.power === 1) items.push({ key: 'courant', severity: 'high', cause: 'Courant coupé : le bâtiment n’embauche pas', action: 'construisez une centrale, des batteries ou achetez au réseau voisin', weight: 18 });
    else if (!d.jobsOffered && o.company?.status !== 'closed' && !ruined && o.roadAccess) items.push({ key: 'inactif', severity: 'mid', cause: 'Emplois non offerts (bâtiment à l’arrêt)', action: 'vérifiez électricité et état du bâtiment', weight: 8 });
    if (!items.length) {
      if (d.cityUnemployed === 0) items.push({ key: 'personne', severity: 'mid', cause: 'Aucun chômeur dans la ville', action: 'construisez des logements : il manque des habitants pour ces emplois', weight: 8 });
      else if (d.requiredEducation) items.push({ key: 'diplome', severity: 'mid', cause: `Emplois réservés aux diplômés (${d.requiredEducation}) ou trop loin des chômeurs`, action: 'construisez des écoles, ou des logements et une ligne de bus à proximité', weight: 6 });
      else items.push({ key: 'loin', severity: 'mid', cause: 'Chômeurs trop loin de ce bâtiment', action: 'construisez des logements à proximité ou une ligne de bus', weight: 6 });
    }
    out.push({ kind: 'jobs', title: opts.isService ? 'Pourquoi aucun agent n’y travaille' : 'Pourquoi personne n’y travaille', items: items.sort((a, b) => b.weight - a.weight) });
  }
  // 3) Habitants mécontents : facteurs négatifs, du plus lourd au plus léger.
  if (o.residents > 0 && d.factors.length) {
    const items: WhyItem[] = [];
    for (const f of d.factors) {
      if (f.delta > -0.5) continue;
      const t = factorItem(o, f.key, f.delta);
      if (!t) continue;
      items.push({ key: f.key, severity: sevOf(-f.delta), weight: -f.delta, ...t });
    }
    // Réseaux coupés sans pénalité encore mesurée (période de grâce, délestage) : signalés quand même.
    if (d.power === 1 && !items.some((i) => i.key === 'electricite')) items.push({ key: 'electricite', severity: 'mid', weight: 3, cause: 'Courant coupé : production insuffisante', action: 'construisez une centrale, des batteries ou achetez au réseau voisin (Énergie)' });
    if (d.power === 2 && d.ramp > 0 && !items.some((i) => i.key === 'electricite')) items.push({ key: 'electricite', severity: 'mid', weight: 3, cause: 'Pas de courant', action: 'raccordez-vous au réseau électrique ou construisez une centrale' });
    if (d.water !== 0 && (d.water === 1 || d.ramp > 0) && !items.some((i) => i.key === 'eau')) items.push({ key: 'eau', severity: 'mid', weight: 3, cause: d.water === 1 ? 'Eau coupée' : 'Pas d’eau courante', action: 'posez des canalisations depuis une station de pompage, ajoutez une pompe' });
    // Icône « poubelles pleines » sans pénalité encore mesurée : signalée quand même.
    if (alertMask & ALERT_BITS.waste && !items.some((i) => i.key === 'dechets')) items.push({ key: 'dechets', severity: 'mid', weight: 2, cause: 'Poubelles pleines', action: 'construisez un dépôt de camions-bennes à portée' });
    items.sort((a, b) => b.weight - a.weight);
    if (items.length) out.push({ kind: 'unhappy', title: 'Pourquoi les habitants sont mécontents', items: items.slice(0, 6) });
  }
  // 4) Entreprise en difficulté (ou déficitaire).
  const co = o.company;
  if (co && co.status && co.sector !== 'Service public' && co.status !== 'closed' && (co.status === 'difficulty' || co.profit < 0)) {
    const items: WhyItem[] = [];
    const main = d.reasonKey;
    const staffing = o.jobCapacity > 0 ? o.workers / o.jobCapacity : 1;
    if (main) items.push({ key: main, severity: 'high', weight: 20, cause: `${co.reason ?? 'Difficultés'}${co.lossMonths ? ` (${co.lossMonths} mois de pertes)` : ''}`, action: COMPANY[main]?.action ?? '' });
    if (main !== 'main-doeuvre' && staffing < 0.75) items.push({ key: 'main-doeuvre', severity: staffing < 0.5 ? 'high' : 'mid', weight: (1 - staffing) * 12, cause: `Postes vacants : ${o.workers} employé(s) sur ${o.jobCapacity}`, action: COMPANY['main-doeuvre']!.action });
    if (main !== 'clients' && d.customers !== null && d.customers < 0.9) items.push({ key: 'clients', severity: d.customers < 0.75 ? 'high' : 'mid', weight: (1 - d.customers) * 14, cause: `Clientèle faible (${pct(d.customers)} de la normale)`, action: COMPANY['clients']!.action });
    if (main !== 'loyer' && d.rentShare !== null && d.rentShare > 0.2) items.push({ key: 'loyer', severity: d.rentShare > 0.35 ? 'high' : 'mid', weight: d.rentShare * 20, cause: `Loyer lourd (${pct(d.rentShare)} du chiffre d’affaires)`, action: COMPANY['loyer']!.action });
    if (main !== 'qualification' && o.workers > 0 && d.underqualified / o.workers > 0.25) items.push({ key: 'qualification', severity: 'mid', weight: (d.underqualified / o.workers) * 10, cause: `${d.underqualified} employé(s) sous-qualifié(s)${d.requiredEducation ? ` (exigé : ${d.requiredEducation})` : ''}`, action: COMPANY['qualification']!.action });
    if (d.power === 1) items.push({ key: 'courant', severity: 'high', weight: 16, cause: 'Courant coupé : l’activité est à l’arrêt', action: 'construisez une centrale ou achetez au réseau voisin' });
    if (!items.length) items.push({ key: 'charges', severity: 'mid', weight: 4, cause: `Bénéfice négatif (${Math.round(co.profit).toLocaleString('fr-FR')} CHF le dernier mois)`, action: COMPANY['charges']!.action });
    items.sort((a, b) => b.weight - a.weight);
    out.push({ kind: 'company', title: 'Pourquoi l’entreprise perd de l’argent', items: items.slice(0, 5) });
  }
  return out;
}
