# Électricité (phase 2B, sous-étape 4)

Module `electricite` branché sur le contrat municipal (`docs/MUNICIPAL.md`) : centrales, postes, lignes haute tension,
production, consommation, délestage par priorité, pannes, entretien, effets sur la ville, rendu et panneau Énergie.
Demandes au superviseur : `docs/requests/electricite.md`.

| Fichier | Rôle |
|---|---|
| `src/shared/power/types.ts` | types partagés (vues, bilans, réglages, commandes, service), constantes |
| `src/shared/power/model.ts` | modèle pur : spécifications des installations, courbes de charge, vent, soleil, débit, site des barrages, fiabilité, coûts |
| `src/shared/power/render-spec.ts` | géométrie partagée générateur / rendu (moyeu, pylône, portiques, fichiers des éléments) |
| `src/shared/power/view.ts` | état d'affichage partagé panneau / rendu (thread principal) |
| `src/sim/power/system.ts` | moteur (`PowerSystem`) : installations, lignes, pannes, répartition, effets, budget, messages |
| `src/sim/power/save.ts`, `src/sim/save-sections/electricite.ts` | section de sauvegarde v1 |
| `src/sim/plugins/electricite.ts` | `SimPlugin` (tâches de l'ordonnanceur municipal, commandes, service `electricite`) |
| `src/shared/protocol-ext/electricite.ts` | types du protocole (`delta.ext.electricite`, commandes) |
| `src/render/power/renderer.ts`, `src/render/plugins/electricite.ts` | rotors animés, pylônes, câbles, calque réseau |
| `src/ui/panels/electricite.ts` | panneau Énergie (`UiPanel`) + lanceur provisoire « ⚡ Énergie » |
| `tools/power/models.ts`, `tools/power/build.ts` | générateur des modèles (kit `tools/buildings/kit`) -> `assets/models/power/` |
| `tests/electricite/*.test.ts`, `tests/electricite/e2e.mjs` | tests unitaires, tests d'effet, parcours e2e avec captures |

## 1. Installations

**Distribution (14/11)** : le courant suit les ROUTES, comme l'eau. Un bâtiment est raccordé à l'installation la
plus proche reliée à lui par le réseau routier (bâtiment et installation à moins de 80 m d'une route) ; deux
installations du même réseau routier sont reliées sans ligne. Les lignes HT relient des réseaux routiers séparés
(centrale éloignée, hameau). Les rayons du tableau ne servent plus à la desserte.

Les centrales et postes sont des **bâtiments du catalogue** (onglet Industrie de la barre de construction), reconnus
par leurs étiquettes : `elec:centrale:thermique|eolien|solaire|hydro`, `elec:poste`, puissance facultative
`elec:kw:N`. Coût de construction, entretien mensuel et emplois sont ceux du catalogue (appliqués par la simulation de
base, donc réels). Valeurs par défaut (`FACILITY_SPECS`) :

| Modèle | Puissance | Rayon de distribution | Coût | Entretien / mois | Emplois | Particularités |
|---|---|---|---|---|---|---|
| `elec_centrale_gaz` | 60 MW | 450 m | 85 000 CHF | 95 CHF | 60 | pollution de l'air ∝ production appelée, bruit, ordre de mérite 40 (appelée en dernier) |
| `elec_eolienne` | 2,3 MW | 250 m | 12 000 CHF | 11 CHF | 2 | courbe de puissance : 0 sous 3 m/s, cubique jusqu'à 12 m/s, arrêt à 25 m/s |
| `elec_ferme_solaire` | 6 MW crête | 300 m | 24 000 CHF | 9 CHF | 3 | ensoleillement selon l'heure, la saison (durée du jour, hauteur) et la nébulosité |
| `elec_barrage` | 30 MW | 400 m | 90 000 CHF | 50 CHF | 30 | débit saisonnier (printemps 100 %, été 50 %) ; **site validé** : au bord d'un cours d'eau |
| `elec_poste` | 45 MW (transformation) | 700 m | 6 500 CHF | 7 CHF | 4 | étend la desserte quand il est relié par une ligne HT |
| `elec_batteries` | 2 MW (charge / décharge), 8 MWh | 300 m | 450 000 CHF | 800 CHF | 2 | stockage, rendement aller-retour 85 % (voir §1 bis) |

(Les coûts et entretiens réels sont ceux du catalogue `assets/catalog.json` ; les colonnes ci-dessus datent de la
première version pour les cinq premières lignes.)

Toitures solaires (option, réglage du panneau) : 4 kWc par logement habité, 6 installations par jour, 90 CHF l'unité
(ligne d'investissement), production injectée au poste du quartier.

## 1 bis. Batteries de stockage (15/11)

Modèle `elec_batteries` (« Batteries de stockage », onglet **Énergie**, disponible dès le début : aucun palier).
Étiquettes `elec:batterie`, `elec:kw:2000` (puissance max), `elec:kwh:8000` (capacité). **Modèle 3D** : celui du
poste de transformation (`elec_poste`, transformateurs + local technique : silhouette d'un site de stockage en
conteneurs), réutilisé via l'étiquette `reutilise:elec_poste` (même mécanisme que le dépôt de bus) ; trois variantes
de couleur des conteneurs (`materialOverrides.transfo`).

- **Rattachement** : comme toute installation (route à moins de 80 m, même réseau routier, raccordement local ou
  ligne HT) ; les bâtiments proches peuvent lui être rattachés.
- **Décharge** : producteur du graphe municipal, coût de mérite 50 (après solaire, éolien, hydro et thermique, avant
  le réseau voisin à 90), plafonné par `min(puissance max, énergie stockée × √0,85)`.
- **Charge** : après la répartition, le SURPLUS des centrales locales (capacité disponible non appelée) de l'îlot de
  la batterie (installations reliées par la voirie, des raccordements locaux ou des lignes en service) la recharge,
  dans la limite de sa puissance max et de la place restante. Pas de charge depuis le réseau voisin. Le surplus utilisé
  est compté dans la production des centrales (pollution comprise) et retiré du surplus exportable.
- **Rendement** : 85 % aller-retour (√0,85 ≈ 92,2 % par sens, `batteryStep`). Énergie mise à jour seulement aux
  vraies heures de jeu. Une batterie neuve est vide.
- **Sauvegarde** : `facilities[id].storedKwh` (champ facultatif, section v1 inchangée : une ancienne partie se charge
  sans batterie — test `tests/electricite/stockage.test.ts`).
- **Bilan** : `summary.storage` (`count`, `storedKwh`, `capacityKwh`, `powerKw`, `chargeKw`, `dischargeKw`,
  `roundTrip`, `autonomyH` = énergie restituable / décharge en cours, sinon / demande raccordée) ; vues
  `FacilityView.storedKwh | capacityKwh | storageKw` (> 0 charge, < 0 décharge). La production `producedKw` exclut la
  décharge des batteries et le réseau voisin.

## 1 ter. Réseau seulement intermittent : conseil et raccordement

`summary.intermittentOnly` = des éoliennes / fermes solaires seulement, sans batterie, sans centrale pilotable
(thermique, hydro) et sans raccordement. À la **première** coupure faute de production dans cette situation, une
notification (et une ligne du journal) : « La nuit sans vent, vos éoliennes et panneaux solaires ne produisent rien.
Raccordez-vous au réseau voisin, construisez une centrale thermique ou des batteries. » Elle n'est envoyée qu'une fois
(`PowerState.adviceAt`), réarmée seulement si le réseau cesse d'être uniquement intermittent. Le toast porte un bouton
« Énergie » (ouvre le tableau de bord Énergie). Les messages de pénurie suivants proposent les mêmes solutions au lieu
de « Ajoutez une centrale ou une éolienne ».

Panneau : en cas de déficit (coupures) sans raccordement, bouton direct **« Se raccorder au réseau voisin
(60 000 CHF) »** (commande `raccordement {on:true}`) ; l'explication « Production à 0 » (`zeroReason`) distingue
désormais « ni soleil ni vent (démarrage à 3 m/s) », signale le relais des batteries (puissance, autonomie) ou du
réseau voisin, les batteries vides, et propose raccordement, batteries ou centrale pilotable. Section « Batteries de
stockage » : charge en %, énergie, charge / décharge en cours, autonomie estimée, rendement.

Rappel : la centrale thermique n'est débloquée qu'au palier « Bourg » (1 500 habitants) et le barrage au palier
« Ville » : en début de partie, le raccordement (3 MW) et les batteries sont les seules sources pilotables.

## 1 quater. Profil de vent (vérification du 15/11)

`windProfile` (moyenne 7,0 m/s) et la courbe cubique 3 → 12 m/s donnent, sur une année de jeu (360 jours, pas
horaire, graines 0, 1, 42, 1 234, 99 999) : **facteur de charge 21,3 à 21,4 %**, **8,0 % des heures à 0** (vent
< 3 m/s ; ≈ 17 % des heures entre 0 h et 7 h). À 7 m/s pile la courbe ne donne que 9 % du nominal, mais la
variabilité du vent (régimes de 2 à 4 jours, brise) relève la moyenne : le résultat est dans la fourchette terrestre
réaliste (20 à 35 %), en bas de fourchette. **Aucune correction appliquée** (une courbe en `(v³ − 27)/(12³ − 27)`
donnerait 28,1 %, gardée en réserve). Test : `profil de vent : facteur de charge annuel…` (bornes 20–35 %, heures à 0
entre 3 et 12 %).

Barrage : `hydroSiteCheck` échantillonne deux anneaux autour de l'ouvrage ; 8 % à 90 % de points dans l'eau = site
valide. Hors site, le barrage ne produit rien, le joueur est notifié et le panneau affiche « site invalide ». La
commande `checkSite` permet de vérifier avant de construire.

## 2. Réseau et répartition (chaque heure de jeu)

1. **Pannes** (PRNG propre au module) : probabilité horaire par installation (`failurePerHour`) et par km de ligne,
   × `1 / financement²` (×4 à 50 %, ×16 à 25 %, ×0,44 à 150 %) ; durée de réparation × `1 / financement`.
2. **Production disponible** de chaque centrale (vent, soleil, débit, panne, site).
3. **Demande** de chaque bâtiment : classe (hôpitaux, services publics, résidentiel, commerces et bureaux, industrie),
   emprise, habitants présents, emplois occupés, courbe horaire de la classe, facteur saisonnier (hiver +18 %, été +8 %).
   Chaque bâtiment est rattaché à l'installation la plus proche dont il est à portée ; hors portée = « non raccordé ».
4. **Graphe municipal** reconstruit (`m.networks`, réseau `electricite`) : centrale -> jeu de barres -> transformateur ->
   nœud de distribution -> un consommateur par classe (priorité = rang dans l'ordre réglé). Lignes HT : arêtes de
   150 MW, pertes 0,8 %/km. Installations proches (distance < plus petit des deux rayons) : raccordement moyenne
   tension automatique (20 MW, 1,5 %/km).
5. **Répartition** `Networks.allocate` : ordre de mérite (solaire, éolien, hydro, thermique, batteries, réseau voisin), délestage des classes les
   moins prioritaires d'abord. Dans une classe partiellement servie, les bâtiments sont alimentés dans un **ordre
   tournant** (hachage identifiant × heure : délestage tournant) ; l'énergie inutilisable (bâtiment trop gros pour le
   reliquat) est rendue aux classes suivantes (ré-itération).
6. **Effets** : bâtiments coupés (service `electricite`, `cutIds`, calque), emplois / habitants sans courant, pollution
   de l'air (thermique) et bruit (grilles municipales), satisfaction (pénalité réversible et bornée : +3/h quand coupé,
   jusqu'à 20, −1,5/h une fois rétabli), registre d'effets, notifications.

Le module ne fait rien tant qu'aucune installation n'existe (partie sans électricité : aucun delta, aucune section,
aucune écriture municipale — test « partie sans installation »).

## 3. Registre d'effets (causes et cibles)

| Cause (`kind`) | Cibles |
|---|---|
| `electricite:penurie` | `electricite:coupure:<classe>` (kW non servis), `emplois:sans_courant`, `habitants:sans_courant`, `electricite:retablissement` |
| `electricite:panne` (réf. installation ou ligne) | `electricite:capacite` / `electricite:transformation` / `electricite:transport` (kW perdus) |
| `electricite:reglage` (joueur) | `electricite:taux_panne` (multiplicateur), `budget:entretien_reseau`, `electricite:livre:<classe>`, `electricite:priorites` |
| `electricite:ligne` (joueur) | `budget:investissement` |

## 4. Budget du service (lignes municipales, service `electricite`)

Mensuel : `entretien:reseau_electrique` = (2 500 ¢/km de ligne + 1 500 ¢ par installation) × financement ;
`vente:electricite` = kWh livrés × 2 ¢. À la construction : `investissement:lignes_ht` (450 ¢/m),
`investissement:toitures_solaires`. Ces lignes ne sont pas encore appliquées à la trésorerie (contrat municipal §3.2).

## 5. Protocole, commandes, service

`delta.ext.electricite` (`ElectriciteDelta`, à chaque changement) : `summary` (production, demande, livré, pertes,
déficit, non raccordé, **surplus exportable**, vent et sa source, soleil, bilans par source et par classe, coupures,
emplois / habitants sans courant), `facilities`, `lines`, `settings`, `budget`, `events` (nouveaux), `coverage` (calque,
seulement quand il change), `cutIds`, `municipal` (mode). `snapshot.ext.electricite` : idem complet.

Commandes `pluginCommand { plugin: 'electricite', name, payload }` : `state`, `refresh`, `quoteLine {a,b}`,
`buildLine {a,b}`, `autoConnect {id}`, `removeLine {id}`, `setFunding {funding}`, `setPriorities {order}`,
`setRooftops {enabled}`, `forceWind {ms|null}`, `checkSite {kind,x,z}`, `effects {limit}`, `raccordement {on}`
(réseau voisin : 60 000 CHF une fois, 3 MW, 4,5 ct/kWh).

Service inter-modules `electricite` (`ElectriciteService`) : `powerFactor(id)`, `isPowered(id)`, `exportableKw()`,
`summary()`. Météo lue via `ctx.use('weather')` (`{ wind, cloud }`), sinon profil déterministe (`windProfile`).

## 6. Rendu et panneau

- Mâts, nacelles, centrales, fermes, barrages et postes : rendu de base des bâtiments (GLB du catalogue, 3 LOD).
- Rotors (`elec_eolienne_rotor`) : instanciés au moyeu, vitesse selon le vent (≈ 6 à 15 tr/min), arrêtés en panne ou
  sans vent. Pylônes (`elec_pylone`) tous les ≈ 140 m, orientés selon la ligne, 3 LOD par distance ; câbles en
  chaînette (4 conducteurs + câble de garde, flèche 3 % de la portée) jusqu'aux portiques des installations.
- Calque « réseau électrique » (bouton du panneau) : cellules vertes (alimentées), orange (partiel), rouges (coupées),
  violettes (non raccordées) ; cercles de distribution des installations ; lignes colorées selon leur charge.
- Panneau Énergie : production / consommation / réserve exportable / coupures, part par source, délestage par classe,
  budget du service, réglages (financement, ordre de priorité, toitures), installations (« Relier »), lignes (devis,
  construction, démolition), journal. Valeurs réelles uniquement (aucune valeur inventée).

## 7. Modèles 3D (`npm run power:build`)

Générés en code (kit de bâtiments, aucune texture nouvelle : réutilisation des jeux de textures du catalogue), CC0.
Triangles LOD0/1/2 : centrale 3 984/2 018/402, éolienne 520/304/116, ferme solaire 3 752/1 268/128, barrage
2 678/1 440/424, poste 2 724/1 436/282, rotor 696/182/57, pylône 1 676/496/136. Poids ajouté au build (GLB après
meshopt) : 0,84 Mo (budget de l'étape : 2 Mo).

## 8. Preuves (2026-11-13)

- `npm run typecheck` ✓ ; `npm test` 214/214 (dont 14 dans `tests/electricite` : pénurie -> coupures des moins
  prioritaires, entretien réduit -> pannes plus fréquentes, éolien sans vent -> production nulle, satisfaction et
  pollution, ligne HT / poste, sauvegarde aller-retour, partie sans installation) ; `npm run test:assets` 102/102.
- `npm run build` ✓ (dist 45,1 Mo / 60) ; ajout de l'étape : GLB 0,84 Mo + JS ≈ 89 Ko + catalogue 11,5 Ko ≈ 0,94 Mo.
- `npm run e2e` SUCCÈS ; `node tests/electricite/e2e.mjs` SUCCÈS (installations posées, ligne, 10 pylônes, rotors,
  panneau = simulation, financement relu, calque) ; `npm run validate:visual` SUCCÈS (94 assets dont les 5 `elec_*`).
- Captures regardées : `tests/electricite/out/elec-centrale.png`, `elec-eoliennes.png`, `elec-solaire.png`,
  `elec-ligne-rue.png`, `elec-calque.png`, `elec-calque-panneau.png`, `elec-barrage.png`, `elec-poste.png` ;
  planche-contact `tests/e2e/out/planche-contact.png`.
- `npm run assets:validate` : seule la règle de source `tools/power/` échoue (demande §4 de `docs/requests/electricite.md`).
- Batteries, conseil et raccordement (2026-11-15) : `npx tsc --noEmit -p .` ✓ ; `npm test` 603/603 (dont 7 dans
  `tests/electricite/stockage.test.ts` : rendement 85 %, catalogue, facteur de charge éolien, scénario 7 éoliennes +
  3 fermes solaires la nuit sans vent — sans batterie : coupure et conseil unique ; avec batteries chargées : 7 h
  sans coupure ; avec raccordement : alimentée —, sauvegarde ancienne partie et niveau de charge) ; `npm run build`
  ✓ (45,9 Mo / 60) ; `npm run e2e`, `npm run e2e:play`, `npm run e2e:mobile` SUCCÈS.
