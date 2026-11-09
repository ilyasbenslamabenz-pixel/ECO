# ECO NATION — Plan d'architecture

## 1. Analyse de l'existant

Le dépôt contient :

| Élément | Contenu | Décision |
|---|---|---|
| `index.html`, `adhesion.html` | Application web « GE-Fais » sans lien avec le jeu | Non modifiés |
| `lunar-cleaners/` | Jeu 3D multijoueur de nettoyage lunaire (React, R3F, Zustand, Node, Socket.IO, PostgreSQL/SQLite) | Conservé tel quel, sert de **socle technique** |

**Réutilisé** depuis Lunar Cleaners (adapté) :
- Chaîne d'outils : Vite + React 19 + TypeScript + Three.js / React Three Fiber + Zustand ; serveur Node + Express + Socket.IO lancé par `tsx`.
- Persistance double PostgreSQL (`DATABASE_URL`) / SQLite (repli de développement) : `server/src/db.ts`.
- Bruit procédural déterministe (`shared/noise.ts`), techniques de terrain par shader, instanciation de modèles, sons synthétisés, base de styles UI.

**Remplacé intégralement** (incompatible avec le concept) : boucle de nettoyage, économie de ressources, outils, véhicules pilotés, zones lunaires, salles multijoueur temps réel à 15 Hz, contrôleur à la troisième personne.

Le dépôt contient uniquement ECO NATION (client, serveur, simulation partagée).

## 2. Principes

1. **Source de vérité unique côté serveur.** Toute la simulation tourne dans `shared/sim` (TypeScript pur, sans dépendance au navigateur) et est exécutée par le serveur. Le client ne calcule aucune statistique : il affiche des instantanés (`Snapshot`) produits par le moteur.
2. **Déterminisme.** Génération du pays et événements à partir d'une graine ; mêmes entrées → mêmes sorties (testable).
3. **Comptabilité cohérente.** Chaque euro est tracé : recettes = somme des impôts ; dépenses = somme des postes ; Δ dette = besoin de financement ; PIB = somme des valeurs ajoutées sectorielles. Ces identités sont vérifiées par des tests automatisés.
4. **Unités explicites.** Chaque indicateur a une définition, une unité et une période (`shared/sim/indicators.ts`).
5. **Délais et inerties.** Les politiques entrent en vigueur au mois suivant ; l'emploi, la qualité des services, les capacités et les émissions s'ajustent progressivement.

## 3. Pas de temps

- Pas de simulation : **1 mois**. Les montants annuels (budgets, salaires) sont divisés par 12.
- Vitesses : pause, ×1 (1 mois = 4 s), ×2, ×5, ×10.
- Historique mensuel conservé pour les graphiques (10, 20, 50 ans et plus).

## 4. Moteurs et flux de données

```
Policy (décisions du joueur)  ──►  tick(state, policy) ──►  nouvel état + Snapshot
                                     │
   démographie ─► marché du travail ─► revenus des ménages ─► fiscalité ─► consommation (TVA)
        ▲                │                                        │
        │                ▼                                        ▼
   satisfaction ◄── économie sectorielle (demande, production, emploi, profits, investissement,
        ▲            exportations, importations, prix, salaires, entreprises)
        │                                                         │
   services publics ◄── budget de l'État (recettes, dépenses, dette, intérêts, obligations)
```

| Moteur | Fichier | Rôle |
|---|---|---|
| Pays | `sim/country.ts` | Génération du territoire, villes, réseaux, infrastructures |
| Démographie | `sim/demography.ts` | Cohortes quinquennales, naissances, décès, migrations, catégories socio-économiques |
| Fiscal | `sim/fiscal.ts` | Barème progressif, IS, TVA par catégorie, patrimoine, immobilier, écotaxes, cotisations |
| Économie / emploi | `sim/economy.ts` | 12 secteurs, demande, production, emploi, salaires, profits, investissement, prix |
| Finances publiques | `sim/budget.ts` | Recettes, dépenses, solde, trésorerie, dette, obligations, taux |
| Social | `sim/social.ts` | Qualité des services, satisfaction par catégorie et par ville (notes mesurées puis **ressenties** : amplification des écarts, accoutumance, effets de surprise et d'annonce ; contributions du mois `satisfaction.drivers`, voir `docs/EQUILIBRAGE.md` § 4.1), confiance, risques |
| Orchestration | `sim/engine.ts` | Ordre des moteurs, historique, notifications |
| Politique | `sim/politics.ts` | Partis, popularité, parlement, coalition, groupes d'intérêt, décrets / projets de loi et votes, élections, censure |
| International | `sim/international.ts` | États voisins, relations, accords, droits de douane et représailles |
| Événements | `sim/events.ts` | Crises déterministes, décisions, options par défaut, crédits exceptionnels |
| Victoire | `sim/victory.ts` | Conditions de victoire, avancement, défaites |
| Transports | `sim/transport.ts` | Réseau, flottes, demande, choix modal (logit), congestion (BPR), fret, aéroport, port, émissions, satisfaction des usagers |
| Industrie | `sim/industry.ts` | Usines, zones, logistique, programmes (modernisation, électrification, hydrogène, chaleur, recyclage, technologies propres) |
| Agriculture | `sim/agriculture.ts` | Terres, pratiques (conventionnel/bio/précision), intrants, eau, sols, sécheresses, autosuffisance, prix alimentaires, CH₄/N₂O |
| Déchets | `sim/waste.ts` | Production par catégorie, filières et capacités, coûts, émissions, énergie récupérée |
| Outils sectoriels | `sim/sectors.ts`, `sim/sectorModules.ts` | Chantiers (coût, délai, entretien), placement automatique, écritures budgétaires, facteurs technologiques, orchestration |

Phases suivantes (même interface `tick`) : énergie, environnement, industrie, agriculture, transports, déchets, politique et parlement, relations internationales, crises, recherche, construction.

## 5. Modèle économique (résumé)

- **Revenus** : salaires sectoriels × emploi ; pensions = retraités × taux de remplacement × salaire moyen ; allocations chômage ; prestations familiales ; aides au logement ; revenus du capital.
- **Impôt sur le revenu** : chaque catégorie a une distribution log-normale des revenus, intégrée sur 20 quantiles ; le barème progressif s'applique au revenu imposable (brut − cotisations salariales − abattement), moins le crédit d'impôt.
- **Consommation** : propension à consommer × revenu disponible, répartie en 9 catégories de produits ; chaque catégorie est soumise au taux de TVA choisi (normal, réduit, spécial, exonéré). La TVA réduit le volume réel acheté et se répercute sur les prix.
- **Demande sectorielle** = consommation nette de TVA + achats publics + investissement + exportations − importations.
- **Emploi** : cible = production / productivité, corrigée par le coût du travail (salaire, cotisations patronales, aides à l'embauche) ; ajustement progressif borné par la population active.
- **Profits et IS** : valeur ajoutée − masse salariale chargée − énergie − amortissement ; IS sur bénéfices moins crédits d'investissement et crédits verts.
- **Investissement** : part des profits après impôt modulée par le taux d'IS, le taux d'intérêt et la confiance ; accroît la productivité.
- **Prix** : inflation = anticipations + écart de production + répercussion de la TVA et des taxes énergétiques + pression salariale ; banque centrale (règle de Taylor).
- **Exportations** : compétitivité (coût unitaire du travail, prix de l'énergie, fiscalité) à l'élasticité près.
- **Dette** : taux moyen convergeant lentement vers le taux de marché (taux directeur + prime de risque fonction de la dette/PIB).

L'état initial est **calibré** pour être à l'équilibre (exportations résiduelles), si bien que toute dynamique résulte des décisions du joueur et des chocs.

## 6. Serveur

- `POST /api/games` : nouvelle partie (configuration : nombre de villes, graine, nom du pays).
- `GET /api/games` : sauvegardes du joueur ; `GET /api/games/:id`.
- `POST /api/games/:id/save` (option « sauvegarder sous »), `DELETE /api/games/:id`.
- Socket.IO : `game:open`, `game:speed`, `game:policy` (procédure parlementaire), `game:action` (finances), `game:gov` (décisions d'événements, diplomatie, accords, confiance, dissolution, coalition, retrait de loi, poursuite après défaite) → `game:tick` (instantané + notifications) à chaque mois simulé et après chaque décision, `game:event` (nouvel événement en attente : le serveur ne met pas le jeu en pause, l'interface affiche une fenêtre de décision), `game:election`, `game:over` (fin de mandat : la partie est mise en pause).
- Sauvegarde automatique tous les 12 mois simulés et à la déconnexion. Une partie n'avance que lorsqu'elle est ouverte.

## 7. Client

- Carte 3D (1 unité = 1 km) : relief, mer, lacs, rivières, forêts, champs, villes instanciées, routes, autoroutes, voies ferrées, aéroports, ports, centrales ; voitures, trains, avions et bateaux animés ; cycle jour/nuit, saisons, météo.
- Caméra stratégique : panoramique, rotation, zoom, clavier ; sélection et inspection des villes et infrastructures.
- Interface : barre supérieure (date, trésorerie, population, PIB, chômage, inflation, satisfaction, solde), contrôle du temps, dock des ministères, panneaux détaillés, statistiques historiques, notifications.

## 8. Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 1 | Carte 3D, pays construit, population, villes, bâtiments, caméra, interface | Livrée |
| 2 | Économie, fiscalité, budget, dette, entreprises, emploi, salaires | Livrée |
| 3 | Satisfaction (socle livré), santé, éducation, logement, services publics, démographie avancée | À venir |
| 4 | Énergie, environnement, industrie, agriculture, transports, déchets | À venir |
| 5 | Politique, parlement, lois, élections, international, crises, conditions de victoire | Livrée (voir §9) |
| 6 | Recherche, événements, missions, progression | À venir |
| 7 | Optimisation, équilibrage, finitions graphiques | À venir |

## 9. Politique, international, événements et victoire (phase 5)

Les quatre modules sont des champs optionnels de `GameState` (`politics`, `international`, `events`, `victory`), créés par `initModules` (dans `createGame` et `migrate` pour les anciennes sauvegardes). Ordre dans `tick` : application des décrets → **votes des lois** → **événements** (décroissance des effets, options par défaut à échéance, tirage) → **international** (voisins, représailles, facteurs macro) → **crédits exceptionnels** ajoutés au budget → démographie, économie, services, satisfaction, quartiers → retrait des crédits exceptionnels → **politique** (popularité, groupes, censure, élections) → **victoire**.

### Lois : décret ou projet de loi
`schedulePolicy(S, p)` garde son comportement historique (procédure directe, utilisée par les tests et scripts). `schedulePolicy(S, p, { parliament: true })`, utilisé par le serveur, compare la proposition à la politique en vigueur groupe par groupe (`classifyChanges`) :
- petits ajustements → **décrets**, en vigueur au 1er du mois suivant ;
- changements majeurs → **projets de loi** (un par catégorie : fiscal, climat, retraites, santé, travail, logement, transports, commerce, budget), votés au début du mois suivant ; adoptés, ils s'appliquent aussitôt ; rejetés, ils n'entrent pas en vigueur.

Seuils (`LAW_THRESHOLDS`) : TVA ±2 pts (ou ≥ 2 catégories reclassées) ; tranche d'IR ±3 pts, nombre de tranches, seuil ±10 %, capital ±5 pts, crédits ±500 € ; IS ±3 pts, crédits ±5 pts ; création/suppression de l'impôt sur le patrimoine, taux ±0,5 pt ; foncier ±0,2 pt, mutation ±2 pts, vacance ±2 pts, taxes locales ±25 % ; création d'une écotaxe, carbone/industrie ±30 €/t, carburants ±10 pts ; cotisation ±2 pts ; tout changement d'âge de retraite (≥ 6 mois) ou pension ±3 pts ; SMIC ±5 %, durée ±1 h, chômage ±5 pts/±6 mois ; ligne budgétaire ±10 % ; création de droits de douane ou ±3 pts.

**Vote** : chaque texte a une orientation sur trois axes (gauche/droite, écologie, protection/libre-échange) ; chaque parti a une position. Part de « pour » d'un parti = σ(3 × adhésion + 2,2 × discipline [coalition] ou −1 [opposition, −1,6 pour la majorité de cohabitation] + 0,03 × (confiance − 55) [opposition]) ± 5 pts d'aléa tiré de la graine ; abstentions = 12 % × indécision. Adopté si pour > contre. Discipline = 0,55 + 0,012 × (confiance − 40) (+ bonus de question de confiance), bornée à [0,25 ; 1].

### Partis, popularité, groupes
Cinq partis (écologistes, sociaux-démocrates, centristes, libéraux, conservateurs). Intentions de vote = Σ catégories (effectif × affinité de la catégorie pour le parti × e^{±k·d}), où d = écart de satisfaction de la catégorie à sa référence initiale / 15 + indicateurs économiques (croissance, inflation > 3 %, chômage) ; les partis de la coalition gagnent quand d > 0 (k = 0,5), l'opposition quand d < 0 (k = 0,25). Puis enjeux saillants (environnement, inégalités/emploi, impôts, sécurité/stabilité, confiance) et humeur des électorats (lois adoptées). Lissage de 20 %/mois. Groupes d'intérêt (2 syndicats, patronat, agriculteurs, associations climat, retraités, locataires) : soutien = 50 + 1,5 × écart de satisfaction des catégories représentées + 40 × humeur (réformes). Syndicat < 40 → grèves plus probables ; patronat < 30 → confiance des entreprises érodée.

### Élections et censure
Tous les 48 mois : voix = popularité ± 1,5 pt, 350 sièges à la plus forte moyenne avec seuil de 5 %, résultats aussi par arrondissement (`districts`). Règle : majorité conservée → continue ; sinon élargissement à un parti proche (distance ≤ 1,25) moins puissant que la coalition si cela suffit ; sinon cohabitation si le parti du joueur reste une force majeure et le camp ≥ 35 % des sièges (pas deux fois de suite) ; sinon **défaite politique**. Motion de censure automatique si confiance < 35 pendant 3 mois (au plus une par an) : adoptée → élections anticipées dans 2 mois. Actions : question de confiance, dissolution (≥ 12 mois après une élection), inviter/exclure un parti, retirer un texte.

### International
3 à 5 États voisins (graine) : PIB tendanciel × (1 + cycle sinusoïdal + composante AR(1)), part de nos exportations, exportateur d'énergie ou non, relation, tolérance douanière. Les effets passent par `macro.worldDemand`, `macro.energyPrice`, `macro.worldPrice` et la productivité sectorielle sous forme de **facteurs appliqués en différentiel** (facteur cible / facteur déjà appliqué) : la tendance propre du moteur et l'équilibre initial sont préservés (facteurs = 1 au départ). `policy.trade.tariff` (economy.ts) : importations × (1 − 1,5 × tarif), recette « douanes », prix +0,15 × Δtarif. Au-delà de la tolérance d'un voisin : relations dégradées, rétorsion = 1,2 × excès (délai ≈ 6 mois) ; `international.retaliation` réduit les exportations × (1 − 1,5 × rétorsion) ; au-delà de 5 % les accords de libre-échange sont suspendus. Accords : commerce (+6 % de demande du partenaire), énergie (−12 % sur l'énergie du partenaire), climat (intensités d'émission −0,5 %/an, 0,02 % du PIB/an), investissement (productivité industrie/numérique +0,3 %/an).

### Événements
Tirage mensuel déterministe : pour chaque type, r = mulberry32(hash(graine|mois|type)) ; déclenché si r < p(état) ; au plus un par mois (plus petit r/p), pas avant le mois 6, 3 mois minimum entre deux, délai de réapparition par type, au plus 2 en attente. Probabilités (par mois) : crise énergétique 0,1 % + 1 % × dépendance aux importations d'énergie (`accounts.energyImportDependence` si fourni, 80 % par défaut pour la cité-État) ; grève nationale (0,05 % + 12 % × (risque de grève − 0,2)) × hostilité syndicale ; crise du logement, pénurie de médecins (qualité des services et budget santé), flambée des prix (inflation > 3 %), récession mondiale (conjoncture des voisins), pénurie d'eau, inondation littorale, canicule urbaine (saisonnières, × 1 + mois/480), tempête, panne du métro (qualité des transports), blocage du port, faillite d'un grand groupe (faillites, confiance), prix alimentaires, percée technologique (budget de recherche), crise internationale (relations). Chaque événement applique des effets chiffrés et propose 2 à 3 décisions de gestion (budget, aide, programme, loi) ; les coûts sont des **crédits exceptionnels** ajoutés aux lignes budgétaires pendant le mois, donc comptabilisés dans les dépenses. Sans décision sous 3 mois, l'option par défaut s'applique.

### Victoire et défaite
Victoires (critères tenus simultanément) : écologique (émissions −55 % vs 2030 ou émissions nettes ≤ 0 si `accounts.netEmissions` existe ; électricité renouvelable ≥ 80 % et énergie finale renouvelable ≥ 50 % si `accounts.renewableShareElec/Final` existent ; environnement ≥ 65 ; 24 mois), économique (croissance ≥ 1,5 %, chômage ≤ 5 %, inflation 0–3 %, dette ≤ 60 %, déficit ≤ 3 % ; 36 mois), sociale (satisfaction ≥ 70, pauvreté ≤ 10 %, Gini ≤ 0,27, espérance de vie +1 an, risque d'émeutes < 5 % ; 24 mois), politique (2 élections gagnées, majorité, confiance ≥ 70 ; 12 mois), totale (les quatre). Défaites : défaut de paiement (dette ≥ 200 % du PIB ou taux ≥ 12 % pendant 6 mois), perte des élections, troubles sociaux prolongés (12 mois de risque d'émeutes ≥ 50 % ou satisfaction < 25). Le joueur peut poursuivre en mode libre.

## 10. Services publics, recherche et construction

| Module | Fichier | Sortie lue par les autres moteurs |
|---|---|---|
| Effectifs (délais de recrutement, plan de financement) | `sim/workforce.ts` | — |
| Santé | `sim/health.ts` | `services.sante` (démographie : espérance de vie) |
| Éducation | `sim/education.ts` | `services.education`, `education.humanCapital` (productivité différée) |
| Logement | `sim/housing.ts` | `services.logement` (→ `housingPressure` : natalité, migrations), `housing.energyFactor` |
| Sécurité et justice | `sim/security.ts` | `services.securite` |
| Recherche | `sim/research.ts` | `research.unlocked`, `research.effects` (multiplicateurs énergie, secteurs, services) |
| Construction | `sim/construction.ts` | `country.infra` (`status: 'chantier'` puis en service), poste de dépense `equipements` |
| Orchestration | `sim/services.ts` | initialisation, pas mensuel, actions, historique |

**Principe commun.** Le budget d'un ministère (€/an, ramené aux prix de base par l'indice des salaires publics) finance un plan : postes budgétés (médecins, enseignants, policiers…), lits ou places ouverts, fonctionnement, investissement, prévention. Les effectifs rejoignent les postes avec un délai (3 à 18 mois) et un vivier limité (formation : 3 à 6 ans de retard) ; une coupe se traduit par des départs non remplacés, un fonctionnement comprimé puis une dégradation progressive (surcharge → démissions). La qualité vaut `0,05 + 0,75 · r^0,7` où `r` est la capacité rapportée aux besoins (Cobb-Douglas des moyens) : 0,80 à l'état initial, calibré à l'équilibre.

**Le pays est entièrement équipé au départ** : les équipements de la carte sont complétés par des capacités agrégées (petits établissements), réparties par quartier au prorata de la population (`cityFacilities`). Le joueur gère ; il ne place rien à la main.

**Actions (Socket.IO `game:service`, alias `game:build` ; moteur `applyServiceAction(S, a)`)** — réponse `{ ok, code?, msg, … }` :

| Action | Effet | Codes d'erreur |
|---|---|---|
| `{ type: 'recruter', service: 'sante'\|'education'\|'securite', role, count }` | postes créés, budget relevé de leur coût annuel, prise de poste après le délai du métier (rôles : `medecins`, `infirmiers`, `enseignants`, `chercheurs`, `policiers`, `pompiers`, `magistrats`) | `MONTANT`, `METIER_INCONNU` |
| `{ type: 'programme', building, cityId, count? }` | 1 à 10 équipements dans le quartier `cityId` ; emplacement choisi et validé par le moteur ; visibles aussitôt dans `country.infra` (`status: 'chantier'`, `progress`) | `TYPE_INCONNU`, `QUARTIER_INCONNU`, `AUCUN_EMPLACEMENT`, `TECHNOLOGIE`, `FINANCEMENT`, `TROP_DE_CHANTIERS` |
| `{ type: 'ameliorer' \| 'renover' \| 'demolir', infraId }` | niveau +1 (capacité +30 %) / remise à neuf (énergie −20 %) / suppression | `INTROUVABLE`, `EN_CHANTIER`, `NIVEAU_MAX`, `BON_ETAT`, `FINANCEMENT` |
| `{ type: 'annulerChantier', siteId }` | arrêt (sommes engagées perdues) | `INTROUVABLE` |
| `{ type: 'planLogement', kind: 'renovation'\|'social', units, months? }`, `{ type: 'annulerPlanLogement', planId }` | plan ponctuel payé au fil de l'eau | `MONTANT`, `INTROUVABLE` |
| `{ type: 'rechercher', tech }`, `{ type: 'fileRecherche', techs }`, `{ type: 'annulerRecherche' }` | programme technologique | `TECHNOLOGIE_INCONNUE`, `PREREQUIS`, `DEJA_DEBLOQUEE` |

Validation d'un emplacement (`validatePlacement(S, type, x, z)`) : dans les limites de la carte, terre ferme (`makeHeightFn` > 0,02 km), hors lac et lit de rivière, pente ≤ maximum du type, écart ≥ somme des emprises + 0,1 km avec tout autre équipement, distance à une voie (autoroute, avenue ; l'intérieur d'un quartier est desservi) ≤ 0,3 à 1 km selon le type, contraintes propres (littoral, cours d'eau, quartier habité), technologie, financement (sans emprunt automatique) et 40 chantiers simultanés au plus. Codes : `HORS_CARTE`, `MER`, `LAC`, `RIVIERE`, `PENTE`, `TROP_PROCHE`, `LOIN_ROUTE`, `LOIN_QUARTIER`, `COTE`, `EAU`, `TECHNOLOGIE`, `FINANCEMENT`, `TROP_DE_CHANTIERS`.

Le serveur émet `game:infra { infra, version }` dès que `country.infra` change (chantier ouvert, mise en service, démolition) ; `game:facilities` renvoie les parcs par quartier.
