# 🌍 ECO NATION — simulateur de gouvernement

Gouvernez la **République d'Ilyas**, une cité-État de 10 millions d'habitants, pendant des décennies, directement dans votre navigateur. La mégapole est entièrement construite au départ. Vous ne bâtissez pas : vous gouvernez. Votre rôle couvre les impôts, le budget, les lois, les ministères et les programmes d'investissement, et chaque décision a des conséquences mesurables.

- **3D** : Babylon.js. La mégapole littorale de 64 × 48 km compte 47 quartiers, des dizaines de milliers de bâtiments, un métro, des périphériques, un port et un aéroport. Elle vit avec un cycle jour/nuit, les saisons et la météo. Les textures viennent de Poly Haven (licence CC0).
- **Interface** : React 19, TypeScript et Zustand.
- **Serveur** : Node.js, Express (API REST) et Socket.IO (temps réel). Le serveur est la source de vérité de la simulation.
- **Sauvegardes** : PostgreSQL via `DATABASE_URL`, ou SQLite par défaut en développement.
- **Moteur** : TypeScript pur et déterministe, couvert par 103 tests automatisés.

## Lancer le jeu

Prérequis : Node.js 22.13 ou plus récent.

```bash
npm install
npm run dev          # développement : http://localhost:5174 (serveur sur 3002)
npm run build && npm start   # production : tout sur http://localhost:3002
npm test             # tests du moteur
npm run calibrate    # rapport d'équilibre sur 50 ans sans intervention
npm run playtest     # parties simulées par 6 joueurs-robots (voir docs/EQUILIBRAGE.md)
```

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (défaut 3002). |
| `DATABASE_URL` | Active PostgreSQL. Sans cette variable, le jeu utilise SQLite dans `DATA_DIR`. |
| `PGSSL=1` | Connexion SSL pour les bases PostgreSQL hébergées. |
| `DATA_DIR` | Dossier de la base SQLite (défaut `server/data`). |

## Mise en ligne gratuite (Render + GitHub)

Le fichier `render.yaml` décrit le service web et la base PostgreSQL.

1. Créez un compte sur render.com, puis reliez votre compte GitHub.
2. Choisissez **New → Blueprint**, sélectionnez le dépôt et la branche, puis cliquez sur **Apply**.
3. Render construit le jeu (`npm ci && npm run build`), crée la base, puis vous donne une adresse publique en `https://….onrender.com`.

L'offre gratuite met le service en veille après une période d'inactivité ; le premier chargement suivant est donc lent. La base gratuite a une durée limitée : vérifiez les conditions de Render.

Un `Dockerfile` est aussi fourni pour tout autre hébergeur.

## Ce que vous gérez

| Pôle | Ministères |
|---|---|
| 💶 Économie | Finances (budget annuel et mensuel, dette, obligations, réserve), Fiscalité A–H (barème progressif, IS, TVA par catégorie de produits, patrimoine, immobilier, taxes écologiques, cotisations, tableau fiscal), Économie (12 secteurs), Travail (SMIC, durée du travail, chômage, retraites), Industrie |
| 🤝 Social | Population et satisfaction (par catégorie et par quartier), Santé, Éducation, Logement, Sécurité et justice |
| 🌍 Territoire | Énergie (mix électrique, prix, pénuries, construction et fermeture de centrales), Environnement et biodiversité, Transports (métro, tram, bus, voiture électrique, congestion), Agriculture, Déchets, Équipements (programmes d'investissement), Recherche (arbre technologique) |
| 🏛️ État | Politique (partis, parlement de 350 sièges, lois votées, élections tous les 4 ans, censure), International (États voisins, accords, droits de douane), Événements et crises (décisions à prendre), Objectifs (victoires et défaites) |

Le panneau **🧭 Besoins du pays** (en haut du dock) diagnostique ce qui manque ou est en trop (écoles, soins, logement, électricité, énergie verte, sécurité, emploi, transports, air), indique le quartier le plus concerné et propose des actions en un clic : construire, démolir, installer ou fermer une centrale. Il suit aussi l'avancement de tous les chantiers. En cliquant sur un équipement de la carte, vous pouvez l'agrandir, le rénover, le démolir ou fermer une centrale.

Le temps se contrôle avec pause, ×1, ×2, ×5 et ×10, un pas valant un mois. Les réformes entrent en vigueur le mois suivant. Les lois importantes passent par un vote du parlement.

Il existe cinq victoires : écologique, économique, sociale, politique et totale. Les défaites possibles sont le défaut de paiement, la perte des élections et des troubles sociaux prolongés.

## Cohérence

Aucun indicateur n'est tiré au hasard. Toutes les valeurs découlent des moteurs : démographie, fiscalité, économie, budget, social, énergie, environnement, secteurs, services, politique et international. Les tests vérifient notamment :

- les identités comptables : PIB = C + I + G + X − M, recettes et dépenses égales à la somme de leurs postes, variation de la dette égale aux emprunts ;
- le bilan électrique ;
- les flux démographiques ;
- les effets attendus de chaque décision.

Chaque indicateur affiche son unité, sa période et sa définition. Les émissions distinguent territoriales, importées, directes, indirectes, brutes, absorptions et nettes, et une compensation n'efface jamais les émissions brutes.

Documentation technique : `docs/ARCHITECTURE.md`.
