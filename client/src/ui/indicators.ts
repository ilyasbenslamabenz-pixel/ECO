// Définitions des indicateurs : libellé, unité, période et définition (affichées dans l'interface).
import { money, people, pct, dec1, int } from '../format';
import { ENERGY_IND } from './energyIndicators';

export interface IndicatorDef { label: string; unit: string; period: string; def: string; fmt: (v: number) => string; good?: 'up' | 'down' }

export const IND: Record<string, IndicatorDef> = {
  gdp: { label: 'PIB nominal', unit: '€', period: 'rythme annuel', def: 'Somme des valeurs ajoutées des 12 secteurs (= consommation + investissement + achats publics + exportations − importations), en euros courants.', fmt: money, good: 'up' },
  gdpReal: { label: 'PIB réel', unit: '€ de 2030', period: 'rythme annuel', def: 'PIB corrigé de la hausse des prix (prix de 2030).', fmt: money, good: 'up' },
  growth: { label: 'Croissance', unit: '%', period: 'glissement sur 12 mois', def: 'Variation du PIB réel par rapport au même mois de l\'année précédente.', fmt: (v) => pct(v), good: 'up' },
  inflation: { label: 'Inflation', unit: '%', period: 'glissement sur 12 mois', def: 'Variation de l\'indice des prix à la consommation sur un an.', fmt: (v) => pct(v) },
  unemployment: { label: 'Chômage', unit: '% des actifs', period: 'mensuel', def: 'Part de la population active sans emploi (actifs = population en âge de travailler × taux d\'activité).', fmt: (v) => pct(v), good: 'down' },
  population: { label: 'Population', unit: 'habitants', period: 'fin de mois', def: 'Somme des cohortes d\'âge (naissances − décès + migrations).', fmt: people, good: 'up' },
  employment: { label: 'Emploi', unit: 'personnes', period: 'fin de mois', def: 'Nombre de personnes en emploi dans les 12 secteurs.', fmt: people, good: 'up' },
  debt: { label: 'Dette publique', unit: '€', period: 'fin de mois', def: 'Encours brut de la dette de l\'État.', fmt: money, good: 'down' },
  debtRatio: { label: 'Dette / PIB', unit: '% du PIB', period: 'fin de mois', def: 'Dette publique brute rapportée au PIB annuel.', fmt: (v) => pct(v), good: 'down' },
  deficitRatio: { label: 'Déficit / PIB', unit: '% du PIB', period: 'rythme annuel', def: 'Dépenses moins recettes publiques, en part du PIB (négatif = excédent).', fmt: (v) => pct(v), good: 'down' },
  balance: { label: 'Solde public', unit: '€/an', period: 'rythme annuel', def: 'Recettes totales − dépenses totales (intérêts compris).', fmt: money, good: 'up' },
  revenue: { label: 'Recettes publiques', unit: '€/an', period: 'rythme annuel', def: 'Somme de tous les impôts, taxes, cotisations et revenus de l\'État.', fmt: money },
  spending: { label: 'Dépenses publiques', unit: '€/an', period: 'rythme annuel', def: 'Dépenses discrétionnaires + prestations (retraites, chômage, allocations) + intérêts.', fmt: money },
  cash: { label: 'Trésorerie', unit: '€', period: 'fin de mois', def: 'Liquidités disponibles de l\'État.', fmt: money },
  satisfaction: { label: 'Satisfaction', unit: '/100', period: 'mensuel', def: 'Moyenne, pondérée par les effectifs, de la satisfaction des catégories de population.', fmt: (v) => dec1(v), good: 'up' },
  trust: { label: 'Confiance', unit: '/100', period: 'moyenne lissée', def: 'Confiance dans le gouvernement : satisfaction lissée sur plusieurs mois.', fmt: (v) => dec1(v), good: 'up' },
  emissions: { label: 'Émissions de CO₂ territoriales directes', unit: 't/an', period: 'rythme annuel', def: 'Émissions directes des secteurs et des ménages sur le territoire (hors émissions importées, hors absorptions).', fmt: (v) => `${dec1(v / 1e6)} Mt`, good: 'down' },
  meanWage: { label: 'Salaire moyen', unit: '€ brut/an', period: 'mensuel', def: 'Masse salariale brute / emploi.', fmt: money, good: 'up' },
  medianWage: { label: 'Salaire médian', unit: '€ brut/an', period: 'mensuel', def: 'Salaire au-dessous duquel se situe la moitié des salariés (estimation).', fmt: money, good: 'up' },
  gini: { label: 'Indice de Gini', unit: '0–1', period: 'mensuel', def: 'Inégalité des revenus nets après impôts et prestations (0 = égalité parfaite).', fmt: (v) => v.toFixed(3).replace('.', ','), good: 'down' },
  poverty: { label: 'Taux de pauvreté', unit: '%', period: 'mensuel', def: 'Part des personnes dont le revenu net est inférieur à 60 % du revenu médian.', fmt: (v) => pct(v), good: 'down' },
  births: { label: 'Naissances', unit: '/an', period: 'rythme annuel', def: 'Naissances annualisées.', fmt: int },
  deaths: { label: 'Décès', unit: '/an', period: 'rythme annuel', def: 'Décès annualisés.', fmt: int },
  migration: { label: 'Solde migratoire', unit: '/an', period: 'rythme annuel', def: 'Immigration − émigration.', fmt: int },
  lifeExpectancy: { label: 'Espérance de vie', unit: 'ans', period: 'table du moment', def: 'Espérance de vie à la naissance selon la mortalité actuelle (qualité des soins, qualité de l\'air).', fmt: (v) => `${dec1(v)} ans`, good: 'up' },
  exports: { label: 'Exportations', unit: '€/an', period: 'rythme annuel', def: 'Ventes de biens et services au reste du monde.', fmt: money },
  imports: { label: 'Importations', unit: '€/an', period: 'rythme annuel', def: 'Achats de biens et services au reste du monde.', fmt: money },
  consumption: { label: 'Consommation des ménages', unit: '€/an TTC', period: 'rythme annuel', def: 'Dépense de consommation des ménages, taxes comprises.', fmt: money },
  investment: { label: 'Investissement privé', unit: '€/an', period: 'rythme annuel', def: 'Investissement des entreprises et des ménages.', fmt: money },
  policyRate: { label: 'Taux directeur', unit: '%', period: 'mensuel', def: 'Taux de la banque centrale (règle de Taylor : inflation et écart de production).', fmt: (v) => pct(v, 2) },
  marketRate: { label: 'Taux d\'emprunt de l\'État', unit: '%', period: 'mensuel', def: 'Taux auquel l\'État emprunte : taux directeur + prime de risque (dette et déficit).', fmt: (v) => pct(v, 2), good: 'down' },
  firms: { label: 'Entreprises', unit: 'nombre', period: 'fin de mois', def: 'Nombre d\'entreprises actives.', fmt: int, good: 'up' },
  failures: { label: 'Faillites', unit: '/an', period: 'rythme annuel', def: 'Défaillances d\'entreprises annualisées.', fmt: int, good: 'down' },
  disposablePerCap: { label: 'Revenu disponible / habitant', unit: '€/an', period: 'rythme annuel', def: 'Revenus nets des ménages après impôts et prestations, par habitant.', fmt: money, good: 'up' },
  govPopularity: { label: 'Popularité du gouvernement', unit: '% des intentions de vote', period: 'mensuel', def: 'Somme des intentions de vote des partis de la coalition gouvernementale.', fmt: (v) => pct(v), good: 'up' },
  coalitionSeats: { label: 'Sièges de la coalition', unit: 'sièges', period: 'fin de mois', def: 'Nombre de sièges détenus par les partis du camp gouvernemental (sur 350).', fmt: int, good: 'up' },
  tariff: { label: 'Droits de douane', unit: '%', period: 'mensuel', def: 'Droits de douane moyens sur les importations.', fmt: (v) => pct(v) },
  retaliation: { label: 'Représailles commerciales', unit: '%', period: 'mensuel', def: 'Droits de rétorsion moyens appliqués par les voisins à nos exportations (pondérés par nos exportations).', fmt: (v) => pct(v), good: 'down' },
  intlDemand: { label: 'Demande étrangère (facteur)', unit: 'indice', period: 'mensuel', def: 'Facteur appliqué à la demande mondiale : conjoncture des voisins, accords commerciaux, chocs.', fmt: (v) => v.toFixed(3).replace('.', ','), good: 'up' },
  intlEnergy: { label: 'Prix de l\'énergie importée (facteur)', unit: 'indice', period: 'mensuel', def: 'Facteur appliqué au prix de l\'énergie : voisins exportateurs, accords énergétiques, crises.', fmt: (v) => v.toFixed(3).replace('.', ','), good: 'down' },
  productivityGrowth: { label: 'Gains de productivité', unit: '%/an', period: 'tendance', def: 'Progression annuelle de la productivité (investissement, recherche, éducation, formation, infrastructures).', fmt: (v) => pct(v, 2), good: 'up' },
  ...ENERGY_IND, // module énergie et environnement
  // --- modules services publics/recherche/construction ---
  sante_qualite: { label: 'Qualité des soins', unit: '/100', period: 'mensuel', def: 'Capacité de soins (médecins, infirmiers, lits, approvisionnement, état des établissements) rapportée aux besoins pondérés par l\'âge.', fmt: (v) => `${Math.round(v * 100)}`, good: 'up' },
  sante_attente: { label: 'Attente pour un spécialiste', unit: 'jours', period: 'mensuel', def: 'Délai moyen d\'accès à une consultation spécialisée.', fmt: (v) => `${Math.round(v)} j`, good: 'down' },
  sante_medecins: { label: 'Médecins en poste', unit: 'personnes', period: 'fin de mois', def: 'Médecins du système de santé public.', fmt: int, good: 'up' },
  edu_reussite: { label: 'Réussite au baccalauréat', unit: '%', period: 'mensuel', def: 'Part des candidats reçus.', fmt: (v) => pct(v), good: 'up' },
  edu_decrochage: { label: 'Décrochage scolaire', unit: '%', period: 'mensuel', def: 'Part des jeunes sortant du système scolaire sans diplôme.', fmt: (v) => pct(v), good: 'down' },
  edu_capitalHumain: { label: 'Capital humain', unit: '/100', period: 'stock lent', def: 'Qualification moyenne de la population active ; détermine la productivité future.', fmt: (v) => `${Math.round(v * 100)}`, good: 'up' },
  logement_prix: { label: 'Prix des logements', unit: '€/m²', period: 'mensuel', def: 'Prix moyen au mètre carré (euros courants).', fmt: (v) => `${int(v)} €/m²` },
  logement_tension: { label: 'Tension du logement', unit: '100 = équilibre', period: 'mensuel', def: 'Ménages (population / 2,2) rapportés aux logements disponibles hors vacance de rotation.', fmt: (v) => dec1(v * 100), good: 'down' },
  crime: { label: 'Criminalité', unit: '‰ hab./an', period: 'mensuel', def: 'Crimes et délits enregistrés pour 1 000 habitants par an.', fmt: (v) => `${dec1(v)} ‰`, good: 'down' },
  recherche_technologies: { label: 'Technologies maîtrisées', unit: 'nombre', period: 'fin de mois', def: 'Technologies débloquées dans l\'arbre technologique.', fmt: int, good: 'up' },
  equipements: { label: 'Dépenses d\'équipement', unit: '€/an', period: 'rythme annuel', def: 'Chantiers, entretien des équipements construits, programmes de logement et démolitions (hors budgets des ministères).', fmt: money },
};

export const REVENUE_LABELS: Record<string, string> = {
  impotRevenu: 'Impôt sur le revenu', impotCapital: 'Prélèvement sur le capital', impotSocietes: 'Impôt sur les sociétés', tva: 'TVA',
  cotisationsPatronales: 'Cotisations patronales', cotisationsSalariales: 'Cotisations salariales', patrimoine: 'Impôt sur le patrimoine',
  foncier: 'Impôt foncier', transactions: 'Droits de mutation', vacance: 'Taxe sur les logements vacants', taxesLocales: 'Taxes locales',
  carbone: 'Taxe carbone', carburants: 'Taxe sur les carburants', emissionsIndustrielles: 'Taxe sur les émissions industrielles', dechets: 'Taxe sur les déchets',
  vehicules: 'Taxe sur les véhicules polluants', energivores: 'Taxe sur les activités énergivores', entreprisesPubliques: 'Dividendes des entreprises publiques',
  infrastructures: 'Péages et redevances', divers: 'Recettes diverses', douanes: 'Droits de douane',
  energiePublique: 'Ventes des centrales publiques (marge)',
};
export const SPENDING_LABELS: Record<string, string> = {
  sante: 'Santé', education: 'Éducation', securite: 'Sécurité & justice', defense: 'Défense', transports: 'Transports publics', infrastructures: 'Infrastructures',
  environnement: 'Environnement', administration: 'Administration', logement: 'Aides au logement', subventions: 'Subventions', recherche: 'Recherche', formation: 'Formation professionnelle',
  energie: 'Énergie (investissements et soutiens)', ecologie: 'Environnement, biodiversité et compensation',
  retraites: 'Retraites', chomage: 'Allocations chômage', allocations: 'Prestations familiales', creditActivite: "Crédit d'activité et aides à l'embauche", interets: 'Intérêts de la dette',
  equipements: 'Équipements et construction publique', // --- modules services publics/recherche/construction ---
};
