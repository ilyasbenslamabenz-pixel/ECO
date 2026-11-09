# 🌍 ECO NATION — simulateur de gouvernement

Gouvernez la **République d'Ilyas**, une cité-État de 10 millions d'habitants, pendant des décennies, directement dans votre navigateur. La mégapole est entièrement construite au départ. Vous ne bâtissez pas : vous gouvernez. Votre rôle couvre les impôts, le budget, les lois, les ministères et les programmes d'investissement, et chaque décision a des conséquences mesurables.

- **3D** : Babylon.js. La mégapole littorale de 64 × 48 km compte 47 quartiers, des dizaines de milliers de bâtiments, un métro, des périphériques, un port et un aéroport. Elle vit avec un cycle jour/nuit, les saisons et la météo. Les textures viennent de Poly Haven (licence CC0).
- **Interface** : React 19, TypeScript et Zustand.
- **Serveur** : Node.js, Express (API REST) et Socket.IO (temps réel). Le serveur est la source de vérité de la simulation.
- **Sauvegardes** : PostgreSQL via `DATABASE_URL`, ou SQLite par défaut en développement.
- **Moteur** : TypeScript pur et déterministe, couvert par 139 tests automatisés.

## Lancer le jeu

Prérequis : Node.js 22.13 ou plus récent (Node.js 24 recommandé).

```bash
npm install
npm run dev          # développement : http://localhost:5174 (serveur sur 3002)
npm run build && npm start   # production : tout sur http://localhost:3002
npm test             # tests du moteur
npm run calibrate    # rapport d'équilibre sur 50 ans sans intervention
npm run playtest     # parties simulées par 7 joueurs-robots (voir docs/EQUILIBRAGE.md)
npm run playtest -- --levers   # effet de chaque levier sur la satisfaction (3, 12 et 36 mois)
```

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (défaut 3002). |
| `HOST` | Interface d'écoute (défaut : toutes). |
| `DATABASE_URL` | Active PostgreSQL. Sans cette variable, le jeu utilise SQLite dans `DATA_DIR`. |
| `PGSSL=1` | Connexion SSL pour les bases PostgreSQL hébergées. |
| `DATA_DIR` | Dossier de la base SQLite `eco-nation.db` (défaut `server/data`, relatif à la racine du projet). En production, indiquez un **chemin absolu hors du dossier de l'application** : un dossier reconstruit ou remplacé à chaque déploiement perdrait les sauvegardes. Le dossier est créé s'il n'existe pas. |

Au démarrage, le serveur journalise le mode (production ou développement), la version de Node.js, le dossier des données, la base ouverte et le port. Il ouvre la base **avant** d'accepter des connexions. En cas d'échec, il s'arrête avec un message `[ECO NATION] ÉCHEC DU DÉMARRAGE : …` suivi de la cause technique et un code de sortie 1. Les causes possibles sont un Node.js trop ancien, un dossier de données inaccessible, une base PostgreSQL injoignable ou un port déjà utilisé. Si le client n'a pas été construit, un avertissement le signale.

## Héberger chez Infomaniak

Le jeu tourne sur un **site Node.js** d'un hébergement web Infomaniak. Il n'a pas besoin de base externe : les sauvegardes vont dans un fichier SQLite.

1. **Créer le site** : dans le Manager, ajoutez un site de type **Node.js**, version **24**.
2. **Récupérer le code** : clonez le dépôt dans le dossier du site (en SSH : `git clone <adresse du dépôt> .`), ou déployez-le depuis GitHub si l'option est proposée.
3. **Créer le dossier des données**. Il doit être persistant et placé **hors du dossier du site**, qui est reconstruit à chaque déploiement. Par exemple :
   ```bash
   mkdir -p ~/eco-data && cd ~/eco-data && pwd   # affiche le chemin absolu à reporter dans DATA_DIR
   ```
4. **Régler le site Node.js** :

   | Réglage | Valeur |
   |---|---|
   | Commande de construction (Build) | `npm ci --include=dev && npm run build` |
   | Commande d'exécution (Run) | `npm start` |
   | Port | `3002`, ou celui que l'hébergeur fournit dans la variable `PORT` (le serveur la lit) |
   | Variable d'environnement `DATA_DIR` | chemin absolu affiché à l'étape 3 |

   L'option `--include=dev` est nécessaire, même si `NODE_ENV=production` est défini : la construction du client (Vite) utilise des dépendances de développement. `npm start` lance `NODE_ENV=production tsx server/src/index.ts`. Le serveur sert l'API, le temps réel (WebSocket) et le client construit sur le même port.
5. **Vérifier** : le journal du site doit afficher `Dossier des données : …`, puis `Base de données : SQLite (…/eco-nation.db)` et `Serveur prêt sur le port …`. L'adresse `/api/health` répond `{"ok":true,…}`.

**Mise à jour** : récupérez la nouvelle version (`git pull` dans le dossier du site), puis relancez **Build** et **Run**, ou redémarrez le site. Les parties sont conservées, car elles se trouvent dans `DATA_DIR`. Les sauvegardes des versions précédentes sont migrées automatiquement à leur ouverture.

**En cas de problème**, lisez le journal du site. Toute erreur de démarrage y est signalée par `[ECO NATION] ÉCHEC DU DÉMARRAGE`, avec sa cause : dossier de données non accessible en écriture, port occupé ou version de Node.js. L'avertissement `ExperimentalWarning: SQLite` est normal : il vient du module `node:sqlite` intégré à Node.js.

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
| 🤝 Social | Population et satisfaction (par catégorie et par quartier, avec « pourquoi la satisfaction bouge »), Santé, Éducation, Logement, Sécurité et justice |
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
