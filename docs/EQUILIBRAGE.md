# ECO NATION — Équilibrage par parties simulées

Ce document rend compte de deux passes d'équilibrage. Elles s'appuient sur un harnais de joueurs-robots déterministes. On cherche un jeu **addictif et juste** :

- chaque décision a un effet **ressenti** en quelques mois, et le joueur comprend pourquoi ;
- les missions sont atteignables avec un effort raisonnable ;
- le facteur 4 est difficile mais faisable ;
- l'inaction est sanctionnée sans rendre le jeu injouable ;
- aucune stratégie unique ne règle tout.

La passe 1 a rendu les missions atteignables et les élections disputées (section 2). La passe 2 rend la satisfaction réactive et lisible. Elle rend aussi le jalon 2050 atteignable par un expert et l'austérité viable (sections 3 à 7).

## 1. Méthode

`npm run playtest` lance `tests/playtest.ts`, qui s'appuie sur la bibliothèque `tests/playtestLib.ts`. Le harnais joue des parties complètes avec les mêmes leviers que le joueur : diagnostic des besoins, recrutements, programmes, centrales, cartes du plan climat, budget et fiscalité votés au parlement.

| Robot | Comportement |
|---|---|
| **Passif** | Ne fait rien. |
| **Besoins** | Chaque mois, applique la première action payante du besoin le plus urgent (`assessNeeds`, niveau ≥ 1), si le budget le permet. Le budget le permet tant que le déficit reste sous 4 %, la dette sous 110 % et le coût sous 0,4 % du PIB. Un besoin traité n'est pas retraité avant 12 mois. |
| **Climat** | Chaque mois, joue la carte disponible qui évite le plus de CO₂ par point de soutien dépensé. |
| **Austérité** | Rigueur : −4 % sur toutes les lignes budgétaires chaque janvier (5 ans au plus) **tant que le déficit dépasse 0,5 % du PIB**. Une fois les comptes rétablis, l'excédent est rendu aux contribuables (−0,5 point de TVA par an). *Passe 2 : auparavant, −4 % par an pendant 5 ans sans condition, ce qui menait à un excédent de 3 % du PIB.* |
| **Dépensier** | +5 % sur toutes les lignes chaque janvier. Applique jusqu'à 3 actions de besoins par mois sans regarder le budget et jusqu'à 2 cartes climat par mois. |
| **Équilibré** | Lance la recherche orientée climat dès le départ. Lit ses missions : à l'apparition d'une mission, il actionne une fois le levier rapide évident, par exemple un recrutement, +1 point de TVA, une aide à l'embauche, une centrale solaire ou une carte. Il traite aussi les besoins sous contrainte budgétaire, joue une carte climat tous les deux mois si le déficit reste sous 4 %, et pilote la TVA chaque année selon le déficit. |
| **Expert** *(passe 2)* | Fait comme l'équilibré, avec en plus une stratégie énergétique suivie : 600 MW d'éolien en mer par an et fermeture du fossile (charbon, fioul, puis gaz) dès que la marge à la pointe dépasse 15 %. Il augmente le signal-prix carbone de 15 €/t par an jusqu'à 200 €/t, par décret. Il joue une carte climat par mois. Sa discipline budgétaire épargne les services : économies sur la défense, les subventions, l'administration et les infrastructures, avant toute hausse de TVA. |

Mesures relevées :

- missions réussies et échouées, délai moyen ;
- jalons 2035 et 2050, avec leur écart en points de la référence ;
- émissions nettes, dette, chômage, satisfaction, popularité du camp gouvernemental ;
- élections : G = gagnée (majorité ou coalition élargie), C = cohabitation, P = perdue ;
- défaites, crises (événements hors opportunités), premier trophée, XP et titre à 10 et 30 ans ;
- *(passe 2)* sensibilité de la satisfaction à dix leviers isolés, mesurée à 3, 12 et 36 mois contre une partie témoin (`leverSensitivity`).

Après une défaite, la partie continue en mode libre pour mesurer la suite. Les élections qui suivent une défaite ne comptent donc plus.

Protocole des tableaux : 3 graines de pays (2030, 7 et 99), 30 ans par partie. Quand une cellule contient trois valeurs, ce sont les trois graines. Les autres cellules donnent la moyenne. La colonne « avant » correspond au moteur précédent joué par **les mêmes robots** (y compris l'expert et la nouvelle austérité).

```bash
npm run playtest                     # 7 stratégies × 3 graines × 30 ans (≈ 40 s)
npm run playtest -- 50 2030          # 50 ans, une graine
npm run playtest -- 30 2030,7,99 --md --detail
npm run playtest -- --levers         # sensibilité de la satisfaction aux leviers (3, 12, 36 mois)
```

## 2. Passe 1 (rappel) : missions atteignables, élections disputées

### 2.1 Constats

1. **Missions quasi inatteignables.** Le joueur passif réussissait 0,5 % de ses missions et le joueur équilibré 18 %. Trois causes :
   - **Cibles trop raides par rapport aux leviers réels.** Les mesures sur 12 mois le montrent : un levier fort fait gagner environ 0,2 point de satisfaction, alors que la mission demandait +2,5 points en 12 mois. Pour le chômage, +1 500 € d'aide à l'embauche donnent −0,25 point, et la mission demandait −0,8 point. Pour les soins, 2 000 médecins donnent +1,9 point de capacité, et la mission demandait +3 points.
   - **Échéances plus courtes que les chantiers.** La mission « écoles » durait 12 à 15 mois, alors qu'un lycée se construit en 30 mois. La mission « universités » durait 15 mois, pour un chantier de 48 mois.
   - **Arrondis vers le haut.** Avec `Math.ceil(sat + 2.5)`, la cible pouvait demander jusqu'à +3,5 points. L'arrondi pouvait doubler l'effort réellement demandé.
2. **Missions gagnées sans agir la première année.** Le transitoire conjoncturel de départ fait déjà baisser le chômage d'environ 0,5 point, la dette d'environ 3 points et le déficit d'environ 0,6 point. La moyenne glissante des émissions suit la saison tant qu'elle ne couvre pas 12 mois.
3. **Personne ne perdait les élections, même sans rien faire** (GGGGGGG pour le passif). La satisfaction, donc la popularité, restait plate. De plus, l'élargissement de coalition faisait boule de neige : une coalition à 4 partis gagnait toutes les élections suivantes.
4. **Diagnostic des besoins peu efficace.** Les actions proposées étaient des constructions : construire un commissariat n'améliore que l'état des locaux (effet nul en 24 mois), et un hôpital sans budget de fonctionnement n'ouvre pas de lits. Les leviers rapides (recrutements) n'étaient pas proposés.
5. **XP gonflée par les cartes climat** (10 XP par carte et 20 XP par bilan). Le robot « climat » devenait Chef d'État en 10 ans en enchaînant les cartes.
6. **Anomalie comptable latente.** La dotation des missions réussies était versée directement en trésorerie, hors comptes. L'identité « Δ trésorerie = solde + emprunts » cassait dès qu'une mission réussissait. Le test l'ignorait seulement parce qu'aucune mission n'était réussie pendant les 36 premiers mois.
7. **Facteur 4.** Le jalon 2050 n'était atteint par aucun robot. Le robot « climat » épuise tout le catalogue de cartes vers 18 ans. Ensuite, le frein est la jauge de soutien de l'État, qui dépend du déficit et de la dette.

### 2.2 Réglages

| Domaine | Réglage | Avant | Après | Pourquoi |
|---|---|---|---|---|
| Missions (`missions.ts`) | Satisfaction (amélioration) | +2,5 pts (arrondi ↑) en 12 mois | +0,5 pt (arrondi au ½ point) en 18 mois | La satisfaction bouge d'environ 0,2 pt par levier : la cible demandait 10 leviers. |
| | Chômage | −0,8 pt en 15 à 18 mois | −0,2 pt (arrondi au plus proche) | Un levier d'emploi fait −0,25 pt en 12 mois. |
| | Dette | −4 pts en 24 mois | −2 pts (arrondi au ½ point) | Pente spontanée ≈ −1,2 pt par an ; −2 pts demandent un vrai effort. |
| | Déficit | −0,8 pt | −0,5 pt (−1 pt au-delà de 3,5 %) | +1 point de TVA ou −1,5 % de budget ≈ −0,5 pt. |
| | Pauvreté | −0,8 pt | −0,2 pt | Indicateur très inerte. |
| | Sécurité (besoin / amélioration) | +4 / +3 (arrondi ↑) | +1 (½ point) | 8 % de policiers en plus font environ +1,5 en 15 mois. |
| | Capacité de soins / attente | +3 pts ; −15 % ou −3 jours | +2 pts ; −10 % ou −2 jours | Calées sur un recrutement de médecins. |
| | Air | +3 à +4 pts en 18 mois | +0,6 à +0,8 pt en 18 à 24 mois, affichage au dixième | L'air progresse de 0,3 pt par an ; une fermeture de centrale à charbon apporte +0,9 pt. |
| | Écoles, universités | −5 à −6 pts en 12 à 15 mois | −3 pts en 24 mois | Échéance plus longue que le chantier. |
| | Logement (attente, tension) | −25 % ; −0,03 | −15 % ; −0,02 | Même principe. |
| | Échauffement macro (`MACRO_WARMUP`) | — | 12 mois sans mission chômage, dette, déficit ni émissions | Évite les missions gagnées sans agir (constat 2). |
| | Dotation de mission | `cash +=` hors comptes | Recette « divers » du mois (`addRevenue`) | Rétablit l'identité de trésorerie. |
| | Titres (XP) | 0 / 250 / 600 / 1 100 / 1 800 / 2 800 / 4 200 / 6 000 | 0 / 300 / 900 / 1 700 / 2 800 / 4 400 / 6 800 / 12 000 | Actif : Ministre vers 10 ans, Chef d'État vers 30 ans ; « visionnaire » reste exceptionnel. |
| Politique (`politics.ts`) | Usure du pouvoir | — | −0,04 par an sur le log du poids électoral du camp du chef du gouvernement, plafond 0,5, diminuée du **bilan** | Sanctionne l'inaction (élection perdue vers 8 à 12 ans) ; un bilan solide la compense. |
| | Bilan (`record`) | — | Mission réussie : +0,012 × difficulté (échec : −35 %) ; jalon climat atteint : +0,06 à +0,14 (manqué : −0,02 × k) | Relie la progression (missions, jalons) au destin électoral. |
| | Coalitions | Élargissement sans condition, définitif | Accords valables pour une législature : on se représente avec son camp d'origine (`core`), qui doit garder ≥ 44 % des sièges pour s'élargir | Supprime la boule de neige à 4 ou 5 partis. |
| Besoins (`needs.ts`, `Besoins.tsx`) | Santé, sécurité | Construction seulement | **Recrutement** de médecins ou de policiers proposé en premier (nouvelle action `recruit`, coût annuel affiché) | Effet mesurable en 6 à 9 mois ; un test le vérifie. |
| | Énergie verte | 300 MW solaire | Libellés avec les délais (éolien en mer 4 ans, solaire 600 MW en 1 an) | Information du joueur. L'éolien reste en tête : il produit plus. |
| Plan climat (`climate.ts`) | XP d'une carte / d'un bilan | 10 / 20 | 4 / 8 (`CARD_XP`, `CARD_REPORT_XP`) | Enchaîner les cartes ne suffit plus à monter en grade. |
| | Capital gagné par une mission réussie | État +1, Citoyens +3 | État +2, Citoyens +3 | Synergie missions ↔ climat : le jeu équilibré est récompensé. |
| | Jalon atteint | État +12, Entreprises +8, Citoyens +12 | État +20, Entreprises +10, Citoyens +15 | Le succès relance la capacité d'action (le soutien de l'État est le frein tardif). |
| | Cartes rejouables | — | Deux fois : complément renouvelable, prime pompe à chaleur, fonds rénovation, aide isolation, bonus VE, aide industrie propre. Plus de fois : solaire 5→8, éolien en mer 3→5, rénovation 5→8, tram 4→6, électrification 4→6 | Leviers tardifs pour le facteur 4, rendus chers par la lassitude (×1,3 par utilisation, inchangée). |
| Tests | `vitest.config.ts` | Délai 5 s | 30 s par test | Les tests de 30 ans dépassaient 5 s sur une machine chargée (échecs intermittents). |

**Aucun test existant n'a été modifié.** Les identités comptables sont préservées, et la dotation de mission les respecte désormais. `npm run calibrate` est inchangé au dixième près à 1, 10, 20 et 50 ans sur le PIB, le chômage, l'inflation, la dette, les émissions et la satisfaction. L'équilibre macroéconomique sans intervention n'a donc pas été touché. Seuls deux chiffres bougent : la confiance gagne 1 à 3 points, parce que le passif échoue à moins de missions, et le mois où tombe une dotation de mission voit ses recettes augmenter de 0,1 à 0,2 point.

Résultat de la passe 1 (moteur de la passe 1, anciens robots) : 50,5 % de missions réussies pour l'équilibré (contre 17,9 %), premier trophée à 12 mois, passif battu aux élections à 8 à 12 ans, jalon 2035 atteint par l'équilibré, jalon 2050 « proche » seulement. Les tableaux détaillés de la passe 1 sont remplacés par ceux de la section 5, qui incluent le robot expert et la nouvelle austérité.

## 3. Passe 2 : constats avant réglage

1. **La satisfaction ne réagissait presque pas.** Mesuré contre une partie témoin, un levier fort faisait gagner environ 0,2 point en 12 mois, et presque rien en 3 mois (tableau du § 5.1). La satisfaction est une moyenne de 13 facteurs pondérés selon 10 catégories. Le recrutement de 8 % de médecins améliore la qualité des soins de un à deux points sur 100. Dilué dans la moyenne, cela donnait +0,2. Le joueur ne voyait donc ni l'effet de ses décisions ni leur raison.
2. **Facteur 4.** Aucun robot n'atteignait le jalon 2050 (−50 %), pas même l'équilibré. La jauge de soutien de l'État bloquait la fin de partie : à partir de la 12e année, la meilleure carte était bloquée par la jauge État 94 % des mois chez l'équilibré. L'ancien robot « expert » ne jouait pas sur le signal-prix carbone. Avec une taxe carbone progressive, le même robot atteint 2050 sur l'ancien moteur (écart −2,4 à −5,3 points). Le jalon était donc faisable, mais rien dans le jeu ne guidait vers ce levier, et la jauge État restait à 30 en moyenne.
3. **Austérité.** Le robot d'origine coupait 4 % par an pendant 5 ans, même une fois les comptes en excédent (excédent de 3 % du PIB à 5 ans). Il perdait dès la première élection dans les 3 graines. Même avec une rigueur raisonnable (arrêt une fois les comptes rétablis, excédent rendu), l'ancien moteur la faisait perdre à 4 ans dans 2 graines sur 3. Il ne créditait pas le redressement des comptes : la stabilité ne réagissait qu'au-delà de 90 % de dette ou de 4 % de déficit.
4. **Hébergement.** Le serveur démarrait sans vérifier sa base : en cas d'échec, la promesse d'ouverture faisait quitter le processus sans contexte. Un port occupé provoquait une exception non interceptée. Les chemins (`client/dist`, `server/data`) dépendaient du dossier courant. Installé sous un dossier caché, le client renvoyait une erreur 404 (`sendFile` refuse les chemins absolus contenant un dossier caché).

## 4. Passe 2 : réglages

### 4.1 Satisfaction ressentie (`shared/sim/social.ts`)

Chaque facteur garde sa **note mesurée** (qualité des services, revenu réel, impôts, emploi, air…), inchangée. La satisfaction se calcule sur une **note ressentie** :

> ressenti = mesuré + 7 × tanh((GAIN − 1) × (mesuré − référence) / 7) + impulsions

- **Référence d'accoutumance** : elle suit lentement la note mesurée, à raison de 1/72 de l'écart par mois (constante de temps d'environ 6 ans). Un progrès est donc fortement ressenti, puis devient la norme. Au départ, la référence est égale à la note mesurée : **ressenti = mesuré, et le calibrage initial est intact**. À long terme, le ressenti rejoint le modèle d'origine.
- **Impulsions** : elles s'estompent de 15 % par mois (demi-vie d'environ 4 mois). Elles portent les effets d'annonce et de surprise.

| Réglage | Valeur | Rôle |
|---|---|---|
| `SAT_GAIN` | santé, éducation, sécurité, logement 5 ; transports, environnement 4,5 ; services publics 3 ; emploi, pouvoir d'achat 2,2 ; fiscalité, inégalités, stabilité 2 ; libertés 1 | Amplification des écarts : forte pour les services, que le joueur pilote directement ; plus modérée pour les agrégats économiques, déjà sensibles. |
| `SAT_AMP_CAP` | 7 points de note | Plafond doux : les petits écarts sont pleinement amplifiés, les grands chocs (coupe massive, crise) restent bornés. |
| `SAT_HABIT` | 1/72 par mois | Accoutumance (effet de fond durable, puis normalisation). |
| `SAT_SURPRISE` | 1,2 × la variation mensuelle de la note | Effet de surprise : hausse d'impôt, choc de prix, crise, dégradation brutale. |
| `SAT_ANNOUNCE`, `SAT_CUT_AVERSION` | 50 points par unité de variation relative du budget d'un service (±10 au plus) ; × 1,3 pour une coupe | Effet d'annonce budgétaire, avec des budgets rapportés aux besoins (l'indexation ne déclenche rien). Une coupe est plus mal vécue qu'une hausse n'est appréciée. |
| Annonces ponctuelles (`engine.ts`) | Recrutement : 90 × part d'effectifs ajoutée (+8 % ≈ +7 points sur le facteur) ; programme : +1,2 point par équipement (et effet local dans le quartier) ; plan logement : +4 points pour 10 000 logements sociaux (+2 en rénovation) | La décision se ressent avant que les recrues ou les chantiers n'arrivent. |
| `SAT_SPEED` | 0,25 → 0,35 par mois | La satisfaction d'une catégorie rejoint plus vite sa cible. |
| Stabilité | + 300 × (déficit de début de partie − déficit), borné à ±4 points de PIB | Crédibilité financière : des comptes redressés rassurent. |
| Risque de manifestation | sensibilité à la baisse mensuelle 0,8 → 0,5 | La satisfaction bouge plus vite ; le risque ne doit pas s'emballer pour autant. |
| Quartiers (`citiesStep`) | 12 × log de l'accès relatif aux soins, aux écoles et à la police (écart au départ, ±8 points) ; annonce locale = 0,6 × l'annonce nationale | Construire un hôpital ou une école dans un quartier y améliore la satisfaction. |
| Mission « satisfaction » (`missions.ts`) | +0,5 → +1 point en 18 mois | La cible suit la nouvelle sensibilité : un levier ressenti apporte +0,5 à +1,3 point. |

**« Pourquoi la satisfaction bouge »** : l'instantané expose `satisfaction.felt` (notes ressenties) et `satisfaction.drivers`. Pour chaque facteur et pour les « crises et événements » (chocs appliqués directement par les événements), `drivers` donne :

- la variation de sa contribution à la satisfaction générale sur le mois ;
- la contribution cumulée depuis le début de partie ;
- la part encore due aux annonces.

Les contributions sont lissées comme les catégories : leur somme suit exactement la satisfaction générale. Le panneau **Population → Satisfaction** affiche « Pourquoi la satisfaction bouge » (les 6 plus fortes variations du mois, avec « dont annonce ») et « Depuis le début du mandat ». Il utilise des pictogrammes `Icon` et des barres signées. Il affiche aussi la note ressentie à côté de la note mesurée. La mémoire du modèle (`satisfaction.dyn`) n'est pas envoyée au client. Les anciennes sauvegardes l'initialisent sans à-coup, avec ressenti = mesuré.

### 4.2 Politique (`shared/sim/politics.ts`)

| Réglage | Avant | Après | Pourquoi |
|---|---|---|---|
| Échelle de la satisfaction dans les intentions de vote (`SAT_POLITICAL_SCALE`) | 15 points | 25 points | La satisfaction réagit 2 à 8 fois plus : à 15, les élections se jouaient sur un levier. Les enjeux saillants lisent les notes mesurées, inchangées. |
| Crédit du redressement des comptes (`RIGOR_WEIGHT`) | — | +12 × (déficit initial − déficit) sur le log du poids des centristes et des libéraux, s'ils sont dans la coalition. Récompense seulement, bornée à 4 points de PIB. | « Équilibre budgétaire » et « dette maîtrisée » sont leurs priorités : une rigueur assumée trouve un électorat. |
| Mémoire du bilan (`RECORD_MEMORY`) | — | × 0,995 par mois (demi-vie d'environ 11 ans) | Un long règne exige des résultats renouvelés : sans elle, l'équilibré ne perdait plus jamais. |

### 4.3 Plan climat (`shared/sim/climate.ts`)

| Réglage | Avant | Après | Pourquoi |
|---|---|---|---|
| Retour du capital de soutien vers 0 | 6 %/mois dans les deux sens | Capital positif : 6 %/mois (inchangé) ; **capital dépensé (négatif) : 11 %/mois** (`CAPITAL_RECOVERY`, demi-vie d'environ 6 mois) | La jauge État ne reste plus bloquée au plancher en fin de partie. |
| Jauge État dérivée : pénalité de dette | 0,3 par point au-delà de 60 % | 0,2 | Idem ; le déficit reste le premier déterminant (6 par point). |
| Cartes rejouables | pompes à chaleur, fonds rénovation, aide isolation, bonus VE, aide industrie verte : 2 ; hydrogène, captage : 3 | 3 ; 4 | Leviers tardifs sur le bâtiment, le transport et l'industrie, qui restent les plus gros émetteurs en 2045. La lassitude (× 1,3 par utilisation) les rend chers. |
| Jalon manqué : effet sur le bilan | −0,02 × k | −0,05 × k | Négliger le climat se paie dans les urnes, presque autant qu'un jalon atteint est récompensé (+0,06 à +0,14). |

La trajectoire (2050 : −50 %) n'a **pas** été modifiée.

### 4.4 Hébergement (`server/src`)

- `config.ts` : chemins résolus depuis l'emplacement du code (`ROOT`), `PORT`, `HOST`, `DATA_DIR` (absolu ou relatif à la racine), vérification de Node.js ≥ 22.13. La fonction `fatal()` affiche `[ECO NATION] ÉCHEC DU DÉMARRAGE : …`, puis la cause technique, et sort avec le code 1.
- `db.ts` : la base est ouverte **avant** l'écoute (`db.ready()`). Le dossier de données est créé, puis son accès en écriture est vérifié. Les messages sont explicites pour SQLite comme pour PostgreSQL.
- `index.ts` : le serveur gère le port occupé ou réservé, journalise les erreurs de route (réponse 500 JSON), les exceptions et les promesses non traitées. Il avertit si le client n'est pas construit et sert `index.html` même sous un dossier caché.
- Vérifié avec `npm start` (production) : démarrage, `/api/health`, page d'accueil, création de partie. Trois échecs provoqués donnent chacun un message clair et le code 1 : dossier de données invalide, port occupé, PostgreSQL injoignable.
- README : nouvelle section « Héberger chez Infomaniak ».

## 5. Passe 2 : résultats

### 5.1 Sensibilité de la satisfaction aux leviers (graine 2030, levier appliqué au mois 3)

Écart de satisfaction générale avec la partie témoin, en points :

| Levier | Avant 3 mois | Avant 12 mois | Avant 36 mois | **Après 3 mois** | **Après 12 mois** | **Après 36 mois** |
|---|---|---|---|---|---|---|
| Recruter 8 % de médecins | +0,01 | +0,20 | +0,24 | **+0,62** | **+1,31** | **+0,63** |
| Recruter 8 % de policiers | +0,00 | +0,09 | +0,16 | **+0,33** | **+0,70** | **+0,53** |
| Recruter 5 % d'enseignants | +0,01 | +0,10 | +0,15 | **+0,17** | **+0,51** | **+0,36** |
| Budget transports +20 % | -0,00 | +0,07 | +0,24 | **+0,18** | **+0,36** | **+0,59** |
| Plan de 8 000 logements sociaux | +0,00 | +0,00 | +0,02 | **+0,11** | **+0,02** | **+0,09** |
| TVA normale −1 pt | +0,13 | +0,23 | +0,23 | **+0,46** | **+0,47** | **+0,32** |
| Crédit d'activité +400 € | +0,12 | +0,19 | +0,17 | **+0,43** | **+0,40** | **+0,25** |
| Aide à l'embauche +1 500 € | -0,00 | +0,04 | +0,18 | **-0,10** | **+0,05** | **+0,29** |
| Carte « sortie du charbon » | +0,00 | +0,01 | -0,04 | **+0,02** | **+0,06** | **-0,06** |
| Toutes les lignes −4 % | -0,18 | -0,92 | -1,32 | **-1,86** | **-3,54** | **-2,72** |

Un levier fort se ressent désormais dès le trimestre : c'est l'annonce. Il atteint +0,5 à +1,3 point en un an : c'est l'effet de fond. Ensuite, l'accoutumance le normalise. Une coupe de 4 % sur toutes les lignes coûte −1,9 point en 3 mois et −3,5 points en un an. La colère retombe ensuite en partie (−2,7 à 3 ans). Trois leviers restent peu visibles :

- le plan de 8 000 logements sociaux, petit à l'échelle d'un parc de 4,4 millions de logements ;
- l'aide à l'embauche, qui agit lentement sur l'emploi ;
- la sortie du charbon : son gain d'air est faible et compensé par les emplois perdus.

### 5.2 Parties simulées (3 graines × 30 ans)

#### Avant (moteur de la passe 1, mêmes robots)

| Indicateur | Passif | Besoins | Climat | Austérité | Dépensier | Équilibré | Expert |
|---|---|---|---|---|---|---|---|
| missions ✓/✗ | 8.7/53.7 | 15.7/44.3 | 16.7/49.3 | 10.0/55.0 | 27.3/38.3 | 32.7/31.7 | 53.7/28.3 |
| taux ✓ | 13.8% | 26.1% | 25.3% | 15.0% | 41.3% | 50.5% | 65.3% |
| délai ✓ (mois) | 12.4 | 13.8 | 14.3 | 11.1 | 10.4 | 12.7 | 8.9 |
| jalon 2035 | raté raté raté | raté raté raté | proche proche proche | raté raté raté | OK OK OK | OK OK OK | OK OK OK |
| écart 2035 | 13.7 12.8 14.2 | 11.8 11.4 12.3 | 2.0 1.8 2.4 | 13.0 12.1 13.7 | -1.3 -1.1 -1.3 | -1.8 -1.3 -0.2 | -2.3 -3.1 -0.7 |
| jalon 2050 | raté raté raté | raté raté raté | raté proche raté | raté raté raté | raté raté raté | proche proche proche | OK OK OK |
| CO₂ −% 10/30 ans | 10.3%/22.4% | 13.1%/27.9% | 28.3%/52.0% | 12.3%/27.0% | 31.2%/31.6% | 31.3%/55.8% | 34.6%/61.6% |
| dette 10/30 ans | 66.5%/35.4% | 69.6%/40.9% | 69.4%/36.4% | 54.6%/27.5% | 141.0%/563.6% | 75.8%/50.7% | 73.3%/44.0% |
| dette max | 78.0% | 78.0% | 78.0% | 78.0% | 577.7% | 78.6% | 78.5% |
| chômage 10 ans | 8.0% | 7.8% | 9.4% | 9.3% | 7.2% | 9.3% | 9.7% |
| satisf. 10/30 | 66.0/66.6 | 66.7/67.0 | 64.6/64.8 | 62.5/64.9 | 73.1/68.5 | 65.4/66.5 | 64.4/67.4 |
| popularité 10 ans | 48.3% | 67.0% | 63.3% | 35.4% | 37.9% | 48.3% | 59.1% |
| élections | GPP GGPP GPP | GGPGGGP GGGGGGG GGGPGGP | GGGGGGP GGGGPP GGGGPGP | PP PP GPP | GP GP GP | GGGGPGG GGGGGGG GGGGGGP | GGGGGGG GGGGGGG GGGGGGG |
| défaite | elections@8.0a elections@12.0a elections@8.0a | elections@12.0a aucune elections@16.0a | elections@28.0a elections@20.0a elections@20.0a | elections@4.0a elections@4.0a elections@8.0a | defaut@7.5a defaut@7.5a defaut@7.3a | elections@20.0a aucune elections@28.0a | aucune aucune aucune |
| crises | 14.7 | 14.3 | 14.7 | 17.7 | 15.7 | 13.3 | 12.7 |
| 1er trophée (mois) | 33 31 48 | 31 31 31 | 30 44 32 | 30 31 25 | 23 23 23 | 12 12 12 | 12 12 12 |
| XP 10/30 ans | 1123/3213 | 2163/5447 | 3208/7415 | 1307/3387 | 5443/8119 | 3932/9953 | 5642/13669 |
| titre 10/30 | Préfet / Ministre délégué | Ministre délégué / Premier ministre | Ministre / Chef d'État | Préfet / Ministre | Premier ministre / Chef d'État | Ministre / Chef d'État | Premier ministre / Chef d'État visionnaire |
| cartes/actions/leviers | 0.0/0.0/0.0 | 0.0/29.3/0.0 | 108.7/0.0/0.0 | 0.0/0.0/0.0 | 28.7/45.0/0.0 | 110.7/18.0/57.3 | 108.7/28.0/71.7 |

#### Après

| Indicateur | Passif | Besoins | Climat | Austérité | Dépensier | Équilibré | Expert |
|---|---|---|---|---|---|---|---|
| missions ✓/✗ | 7.7/53.7 | 16.7/43.3 | 18.3/48.3 | 9.0/55.3 | 27.7/39.0 | 35.0/33.0 | 61.3/26.3 |
| taux ✓ | 12.4% | 27.7% | 27.3% | 13.9% | 41.5% | 51.3% | 69.8% |
| délai ✓ (mois) | 14.1 | 14.6 | 14.6 | 11.7 | 9.8 | 11.3 | 8.4 |
| jalon 2035 | raté raté raté | raté raté raté | OK OK OK | raté raté raté | OK OK OK | OK OK OK | OK OK OK |
| écart 2035 | 13.7 12.8 14.2 | 11.8 11.3 12.3 | -1.3 -0.9 -0.5 | 12.8 11.6 13.6 | -3.3 -3.4 -3.6 | -2.0 -2.7 -1.7 | -5.1 -4.6 -3.3 |
| jalon 2050 | raté raté raté | raté raté raté | raté proche raté | raté raté raté | raté raté raté | proche OK proche | OK OK OK |
| CO₂ −% 10/30 ans | 10.4%/22.4% | 13.1%/27.8% | 30.5%/51.2% | 12.5%/26.8% | 32.1%/31.0% | 32.2%/56.5% | 36.3%/61.5% |
| dette 10/30 ans | 66.5%/35.3% | 69.5%/40.3% | 71.2%/37.8% | 55.1%/27.6% | 139.2%/550.2% | 76.3%/50.7% | 74.8%/39.4% |
| dette max | 78.0% | 78.0% | 78.0% | 78.0% | 569.3% | 79.1% | 79.4% |
| chômage 10 ans | 8.0% | 7.8% | 9.3% | 9.1% | 7.3% | 9.8% | 10.2% |
| satisf. 10/30 | 65.7/67.1 | 67.6/67.4 | 64.0/66.7 | 61.2/66.1 | 77.8/68.1 | 63.5/68.9 | 62.7/69.4 |
| popularité 10 ans | 41.4% | 59.7% | 58.4% | 40.9% | 36.6% | 62.5% | 49.3% |
| élections | GPP GPP GPP | GGPGGGG GGGGGGG GPP | GGGGGGG GGGGGGG GGGGGGG | GPP PP GPGCGGP | GP PP GP | GGGPP GGGGGGG GGGPGGG | GGGGGGG GGGGGGG GGGGGGG |
| défaite | elections@8.0a elections@8.0a elections@8.0a | elections@12.0a aucune elections@8.0a | aucune aucune aucune | elections@8.0a elections@4.0a elections@8.0a | defaut@7.3a elections@4.0a defaut@6.7a | elections@16.0a aucune elections@16.0a | aucune aucune aucune |
| crises | 15.0 | 14.3 | 15.0 | 18.3 | 16.0 | 15.7 | 12.7 |
| 1er trophée (mois) | 33 31 48 | 31 31 31 | 46 31 48 | 31 30 25 | 23 23 23 | 5 6 6 | 7 7 7 |
| XP 10/30 ans | 1077/3100 | 2220/5633 | 3799/7987 | 1470/3350 | 5402/8387 | 4186/10565 | 5885/14928 |
| titre 10/30 | Préfet / Ministre délégué | Ministre délégué / Premier ministre | Ministre / Chef d'État | Préfet / Ministre | Premier ministre / Chef d'État | Ministre / Chef d'État | Premier ministre / Chef d'État visionnaire |
| cartes/actions/leviers | 0.0/0.0/0.0 | 0.0/29.3/0.0 | 113.0/0.0/0.0 | 0.0/0.0/0.0 | 40.3/47.3/0.0 | 118.7/18.7/60.3 | 117.3/28.7/76.0 |

### 5.3 Facteur 4 et jauge État

| Mesure | Avant | Après |
|---|---|---|
| Écart au jalon 2050, équilibré (points, 3 graines) | 5,0 / 2,1 / 3,0 (moy. 3,4 : « proche ») | 4,1 / **−0,9** / 1,5 (moy. 1,6 : 1 atteint, 2 « proches ») |
| Écart au jalon 2050, expert | −2,4 / −5,3 / −4,5 | −2,6 / −5,7 / −4,6 (atteint ×3) |
| Jauge État moyenne de la 12e à la 22e année, équilibré / expert | 25,6 / 30,5 | 30,0 / **54,5** |
| Mois sans carte utile disponible à cause de la jauge État (12e à 22e année), équilibré / expert | 94 % / 88 % | 92 % / **47 %** |

L'expert atteint 2050 grâce à trois choses :

- le signal-prix carbone, qui fait le gros du chemin ;
- la fermeture du fossile ;
- une jauge État qui respire désormais, parce que ses recettes carbone réduisent le déficit et que le soutien dépensé se reconstitue plus vite.

L'équilibré s'approche du jalon, et l'atteint dans une graine. Il reste bloqué par la jauge État tant que son déficit tourne autour de 3 % : le jeu dit clairement « tenez vos finances pour tenir le plan climat ».

### 5.4 Calibrage sans intervention (`npm run calibrate`)

| Indicateur | Initial | 1 an | 10 ans | 20 ans | 50 ans |
|---|---|---|---|---|---|
| Satisfaction avant → après | 65,8 → 65,8 | 65,9 → 65,7 | 67,0 → 67,7 | 68,1 → 68,5 | 67,6 → 67,8 |
| PIB (Md€) avant → après | 376,8 → 376,8 | 393,6 → 393,6 | 553,6 → 553,4 | 760,9 → 763,6 | 2 201,7 → 2 218,5 |
| Chômage avant → après | 7,9 % → 7,9 % | 7,4 % → 7,4 % | 7,0 % → 7,0 % | 7,1 % → 7,2 % | 8,4 % → 8,7 % |
| Dette avant → après | 78,0 % → 78,0 % | 74,7 % → 74,7 % | 63,6 % → 63,6 % | 49,8 % → 49,7 % | 17,2 % → 17,1 % |
| Émissions (Mt) | 86,0 | 86,0 | 78,5 | 72,0 | 57,2 (identiques) |

L'état initial est identique : le ressenti est égal à la note mesurée au départ. Les petites dérives à long terme passent par la démographie, puisque la satisfaction joue sur les migrations, et restent sous 1 % du PIB à 50 ans. Les identités comptables ne sont pas touchées : aucun flux financier n'a été ajouté.

### 5.5 Lecture au regard des objectifs

| Objectif | Résultat |
|---|---|
| Chaque décision se ressent | ✔ 2 à 8 fois plus d'effet par levier à 12 mois (5 à 8 fois pour les services), et un effet visible dès 3 mois. Le panneau Population explique la variation du mois facteur par facteur, avec la part d'annonce. |
| Passif : perd ou stagne | ✔ Élection perdue à 8 ans dans les 3 graines ; jalon 2035 manqué de 13 à 14 points ; 12 % de missions. Ni défaut ni émeutes. |
| « Besoins » et « climat » seuls : résultats partiels | ✔ / ≈ Besoins : satisfaction la plus haute des stratégies prudentes (67,6 à 10 ans), mais 2035 manqué de 11 à 12 points et élection perdue à 8 ou 12 ans dans 2 graines sur 3. Climat : 2035 atteint de justesse, 2050 manqué, 27 % de missions, chômage 9,3 %. Il garde toutefois sa majorité : voir les limites. |
| Équilibré : peut atteindre 2035 et gagner des élections, sans garantie | ✔ 2035 atteint ×3, 2050 approché (atteint une fois) ; 51 % de missions ; élection perdue à 16 ans dans 2 graines sur 3. |
| Expert : peut atteindre le facteur 4 (jalon 2050) | ✔ 2050 atteint ×3, 70 % de missions, majorité tenue 30 ans, dette 39 % à 30 ans. |
| Dépensier : crise de dette | ✔ Défaut de paiement vers 7 ans, ou élection perdue avant. |
| Austérité : viable mais coûteuse | ≈ Première élection passée dans 2 graines sur 3 (avant : 1 sur 3 avec le même robot, 0 sur 3 avec l'ancien) ; dette 55 % à 10 ans contre 67 % ; satisfaction −4,5 points à 10 ans ; élection perdue à 8 ans. Dans la graine en récession (7), quatre coupes successives la font tomber dès 4 ans. |
| Environ 1 mission sur 2 pour un joueur actif | ✔ 51 % (équilibré), 70 % (expert). Premier trophée à 5 ou 6 mois : la mission « satisfaction » est réussie grâce à l'effet d'annonce. |

## 6. Tests de non-régression (`tests/balance.test.ts`)

Ces tests font jouer les robots sur une graine, pendant 8 à 22 ans selon la stratégie, avec des bornes larges :

- **Passif** : moins de 30 % de missions réussies, jalon 2035 manqué, élection perdue entre 6 et 14 ans, aucune défaite autre qu'électorale.
- **Besoins et climat** : meilleurs que le passif, moins bons que l'équilibré ; les besoins seuls manquent 2035, le climat seul passe à moins de 6 points de 2035.
- **Dépensier** : dette au-dessus de 120 % du PIB et défaut de paiement.
- **Austérité** *(passe 2)* : satisfaction à 5 ans inférieure d'au moins 3 points à celle du passif, première élection passée, élection perdue au plus tard à 8 ans, dette à 5 ans inférieure d'au moins 3 points.
- **Équilibré** :
  - 35 à 75 % de missions réussies, en 4 à 20 mois ;
  - premier trophée avant 24 mois ;
  - titre entre Ministre délégué et Premier ministre à 10 ans ;
  - écart au jalon 2035 inférieur à 3 points ;
  - majorité tenue plus longtemps que le passif, sans défaut, dette sous 100 % ;
  - moins de missions réussies que l'expert.
- **Facteur 4** *(passe 2)* : l'expert atteint le jalon 2050 sans défaut ; l'équilibré est à moins de 5 points.
- **Crises** : entre 0,2 et 1,2 par an.
- **Retour rapide d'une décision** :
  - un recrutement de 8 % de médecins améliore la capacité de soins et l'attente en 9 mois ;
  - *(passe 2)* il apparaît le mois suivant dans les contributions (« dont annonce ») ;
  - *(passe 2)* il donne plus de 0,3 point de satisfaction à 3 mois et plus de 0,8 point à 12 mois ; 8 % de policiers donnent plus de 0,4 point à 12 mois.
- **Calibrage** *(passe 2)* : à la création, le ressenti est égal à la note mesurée, les contributions sont nulles et la satisfaction vaut 65,8.
- **Accoutumance** *(passe 2)* : une coupe de 4 % coûte plus de 0,8 point en 3 mois, et l'écart se réduit entre 12 et 48 mois.

Le test existant `sectors.test.ts` (« la satisfaction transports provient du moteur des transports ») passe sans modification, parce que `factors` reste la note mesurée.

## 7. Limites et pistes

- **Stratégies isolées encore trop confortables politiquement.** Le climat seul garde sa majorité 30 ans dans les 3 graines. Il atteint 2035, ce qui lui vaut le bonus de bilan, et la jauge se reconstitue plus vite. Les besoins seuls gardent leur majorité dans 1 graine sur 3. Ces stratégies échouent ailleurs : climat seul, 2050 manqué et 27 % de missions ; besoins seuls, 2035 manqué de 12 points. Mais les urnes les sanctionnent peu. Une piste serait de lier la popularité à l'emploi (le climat seul a 9,3 % de chômage).
- **Austérité en récession.** Couper quatre années de suite pendant une récession reste perdant dès la première élection (graine 7). C'est un coût réaliste, mais un joueur pourrait trouver la sanction brutale. Une rigueur plus graduelle (−2 % par an) n'a pas été mesurée.
- **Équilibré bloqué par la jauge État.** Son déficit d'environ 3 % sature la jauge (92 % des mois sans carte utile en fin de partie). C'est voulu, mais le panneau Plan climat pourrait le dire explicitement : « réduisez le déficit pour regagner du soutien de l'État ».
- **Annonces répétées.** Chaque recrutement produit son effet d'annonce. Le multiplier coûte cher (chaque poste est budgété) et l'accoutumance l'absorbe. Une lassitude des annonces, comme pour les cartes, reste possible.
- **Leviers peu visibles.** La sortie du charbon, l'aide à l'embauche et les petits plans logement bougent peu la satisfaction. Leurs effets passent par d'autres indicateurs : émissions, chômage à 3 ans, file d'attente.
- **Missions après 30 ans.** Le taux de réussite baisse à mesure que les indicateurs s'améliorent (cibles relatives) : 42 % pour l'équilibré et 64 % pour l'expert sur 50 ans.
