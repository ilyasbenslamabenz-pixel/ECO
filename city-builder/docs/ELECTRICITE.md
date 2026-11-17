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

**Réseau intégré aux routes (16/11, retour joueur « raccordements compliqués »)** — voir §1 quinquies : une centrale
au bord d'une route alimente tout le réseau routier connecté, sans plafond bloquant ; les bâtiments au bord d'une
route alimentée sont raccordés sans rien poser ; lignes HT facultatives ; centrale isolée signalée ; calque des
routes alimentées ; espacement minimal des éoliennes.

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

## 1 ter bis. Vente d'électricité aux villes voisines (16/11)

Demande joueur (mécanique façon Cities Skylines 2) : gagner de l'argent avec le surplus. `PowerSystem.exportStep`
(src/sim/power/system.ts), constantes `EXPORT_SPEC` (src/shared/power/model.ts).

- **Lien avec l'extérieur (règle retenue)** : la ville vend si le **raccordement au réseau voisin** est actif, **ou**
  si au moins une **connexion extérieure par route** est reliée (module `connexions`, docs/CONNEXIONS.md : impasse au
  bord de la carte dont le réseau dessert un bâtiment). Règle commune avec l'eau : `linkedToNeighbours`
  (src/sim/connexions/lien.ts). Pas besoin de payer le raccordement pour vendre : une route vers l'extérieur suffit
  (comme dans CS2, où l'export passe par les connexions extérieures).
- **Surplus vendable** (chaque vraie heure de jeu) : capacité disponible non appelée des éoliennes, fermes solaires
  et barrages **en service et reliés** (non isolés, non en panne) + toitures solaires, calculée **après** la
  répartition **et après la recharge des batteries** (la recharge est déjà ajoutée à la production appelée par
  `chargeBatteries`). Éolien / solaire suivent donc le vent et le soleil de l'heure : la nuit sans vent, rien à vendre.
  Les **centrales thermiques ne vendent pas** leur capacité inutilisée : pilotables, elles ne brûlent que le gaz
  appelé (pas de « production fantôme »). Les batteries ne revendent pas leur stock.
- **Vendu** = min(surplus, **10 MW**) ; plafond réduit comme le raccordement pendant une panne du réseau voisin
  (`powerImportFactor`). Rien n'est vendu une heure où la ville achète au voisin (`importedKw > 0`).
- **Prix : 1,5 ct/kWh** (< 2 ct/kWh tarif local < **4,5 ct/kWh** achat au voisin : acheter pour revendre fait
  toujours perdre). Ordre de grandeur : une ferme solaire (6 MW, facteur de charge ≈ 25 %) dont tout part à l'export
  rapporte ≈ 16 000 CHF/mois ; plafond = 150 CHF/h.
- **Recette** versée chaque heure à la trésorerie par `economy.applyService(chf, false, 'vente_electricite_exterieure')`
  (poste détaillé : `MonthRecord.serviceLines`, `EconomyReport.serviceLinesMonth`), cumulée dans
  `state.month.exportedKwh / exportIncome` (¢). À la clôture : ligne `vente:electricite_exterieure` inscrite au
  grand livre municipal par `budget.record` (déjà payée : pas de double versement), `lastMonth.exportIncome`.
- **Option** : réglage `settings.vente` (`false` = désactivé ; absent = activé, y compris pour les anciennes
  parties), commande `vente {on}`, case « Vendre le surplus aux villes voisines » du panneau.
- **Notification unique** à la première vente (`PowerState.exportNotified`, aussi au journal du panneau).
- **Affichage** : panneau Énergie, ligne « Vente d'électricité » (kW vendus cette heure, recette du mois, ou ce qui
  manque : aucune ville voisine reliée / désactivée / aucun surplus) et ligne « Vente d'électricité (aux villes
  voisines) » du budget du service (`budget.monthExportIncome`, `monthExportedKwh`, `lastExportIncome`) ; panneau
  Finances, onglet Budget : « dont Vente d'électricité (villes voisines) » dans le dernier mois clos, et le cumul du
  mois en cours. `summary.exportedKw` / `sellableKw` (absents sans lien avec l'extérieur).
- **Sauvegarde** : champs facultatifs (`settings.vente`, `exportNotified`, `month.exportedKwh`, `month.exportIncome`,
  `lastMonth.exportIncome`) ; section v1 inchangée, anciennes parties lisibles.
- Tests : tests/electricite/vente.test.ts (vente → trésorerie + recette exacte ; sans lien → rien ; sans surplus →
  rien ; option désactivée → rien ; batteries rechargées avant la vente ; connexion par route ; sauvegarde).

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
commande `checkSite` permet de vérifier avant de construire. **Au pied d'un barrage** (outil Terrain › Barrage,
`docs/TERRAFORMATION.md` §3) : site validé par la retenue, production = nominale × saison × (débit / 60 m³/s) ×
(chute / 10 m), plafonnée à 4 × nominale (`hydroDamKw`) ; ailleurs, règle ci-dessus inchangée.

## 1 quinquies. Réseau intégré aux routes (16/11)

Retour joueur : « je trouve compliqué les raccordements électricité, eau et déchets » (capture : parc éolien avec
pylônes enchevêtrés). Mécanique type city-builder récent, sans rien copier :

- **Routes = réseau basse / moyenne tension.** Chaque composante connexe de la voirie est un réseau. Une installation
  à moins de 80 m d'une route (`FacilityView.roadLinked`) alimente toute sa composante ; un bâtiment à moins de
  80 m d'une route alimentée est raccordé automatiquement. Aucune pose de câble.
- **Non bloquant.** Dans un même réseau routier, les liaisons entre installations et le transformateur de
  distribution des installations reliées à la route ont une capacité `ROAD_GRID_KW` (10 GW) : la puissance d'un
  poste (45 MW) ou l'ancien raccordement moyenne tension (20 MW) ne plafonnent plus la ville. Restent limités : la
  production, les lignes HT (150 MW) et les raccordements hors route (20 MW).
- **Parc éolien d'un seul tenant.** Deux installations à moins de `FACILITY_LINK_M` = 130 m l'une de l'autre sont
  reliées automatiquement même sans route (les mâts sont espacés d'au moins 88 m, voir ci-dessous) : une seule
  éolienne du parc près d'une route suffit.
- **Lignes HT facultatives** : outil « Ligne haute tension » et bouton « Relier » conservés, pour une centrale
  éloignée ou un hameau sans route commune. Les anciennes parties gardent leurs lignes : réseau manuel (lignes) et
  réseau routier sont fusionnés dans le même graphe (test « sauvegarde : une ancienne partie avec ligne HT… »).
- **Centrale isolée** (`FacilityView.isolated`, `summary.isolatedFacilities`) : son îlot (lignes, voisines à
  < 130 m) ne touche aucune route. Notification unique (« … isolée : reliez la centrale à une route… »), réarmée si
  elle est reliée puis isolée de nouveau (`PowerState.isolatedNotified`, champ facultatif : sauvegarde v1
  inchangée) ; panneau Énergie : bandeau « Reliez la centrale à une route », état « isolée (pas de route) ».
- **Routes alimentées** (`delta.ext.electricite.roads`, `ElectriciteRoads` : tracé échantillonné de chaque tronçon +
  `powered`, envoyé seulement quand il change ; `summary.roadsPowered / roadsUnpowered` ; `PowerSystem.roadPowered(seg)`).
  Un tronçon est alimenté si sa composante touche une installation reliée à une centrale en service (pannes
  comprises, indépendamment du vent de l'heure) ou si le raccordement au réseau voisin est actif. Calque
  Électricité : routes vertes (alimentées) / rouges (non alimentées), en plus des cases et des repères.
- **Éoliennes : espacement minimal** `WIND_MIN_SPACING_M` = ⌈2 × (rayon du rotor 37 m + avancée du moyeu 4,6 m) + 4⌉ =
  **88 m** entre deux mâts (`src/shared/power/render-spec.ts`). Contrôle de `placeBuilding` (donc aperçu rouge via
  `dryRun` et refus, code `COLLISION`, « Trop près d'une autre éolienne (… m) : les rotors se chevaucheraient… ») ;
  pas de contrôle au chargement ni pour l'annulation d'une démolition (anciennes parties conservées). Aucun asset
  modifié. Les tests posent désormais leurs éoliennes à 88 m (`buildFacilityStreet`, `tests/electricite/fixtures.ts`).
- Tests : `tests/electricite/routes.test.ts` (6 tests). Preuves (2026-11-16) : `npx tsc --noEmit -p tsconfig.json` ✓ ; `npm test` 689/689.

## 1 sexies. Câbles souterrains (16/11)

Demande joueur : « pour les éoliennes je dois pouvoir les raccorder avec des câbles sous terre ».

- **Outil** : barre de construction › Énergie › puce **« Câble souterrain »** (à côté de « Ligne haute tension » ;
  même ToolId `powerline`, sous-outil `ConstructionTools.powerSub = 'cable'`, `setPowerSub`). Tracé point à point :
  on touche une installation (éolienne, centrale, poste, batteries) puis une route ou une autre installation (ou
  l'inverse : route puis installation). L'extrémité « route » est aimantée sur l'axe de la route la plus proche
  (≤ 14 m côté client, tolérance de la simulation `CABLE_SPEC.roadSnapM` = 16 m). Devis par `dryRun`
  (`quoteCable`), infobulles en français (« Câble <installation> → route », coût, longueur, entretien, « sous terre, sans pylône »),
  enchaînement depuis une installation d'arrivée, arrêt après une route. Échap abandonne le départ.
- **Simulation** (`PowerSystem.quoteCable / buildCable / removeCable`, commandes `quoteCable {a,b}`,
  `buildCable {a,b}`, `removeCable {id}` ; extrémités `{ id }` ou `{ x, z }`, type `CableEnd`) :
  - câble **installation → route** : l'installation rejoint le réseau routier du point d'arrivée (`facComp`), comme
    si elle était au bord de la route ; si elle touche déjà une autre route ou a plusieurs câbles, les réseaux routiers
    concernés sont fusionnés (union-find des composantes, `applyCables`, `canonComp`). Distribution non bloquante
    (`ROAD_GRID_KW`), routes du calque alimentées, installation plus « isolée » ;
  - câble **installation → installation** : arête du graphe municipal de capacité `CABLE_SPEC.capacityKw` = 400 MW
    (un parc éolien entier ; non bloquant en pratique), pertes 0,4 %/km, sans panne ; compté dans les îlots
    (isolement, recharge des batteries, installations alimentées).
- **Refus** : deux routes (« pas deux routes »), point sans route à 16 m (« Aucune route à cet endroit »), bâtiment
  non électrique ou inconnu, même installation aux deux bouts, moins de 8 m, plus de 3 km (`maxLengthM`), doublon
  (même paire d'installations, ou même installation et même réseau routier), fonds insuffisants. **Aucune
  collision** : le câble passe sous les routes, les bâtiments et l'eau.
- **Coût** : 900 ¢/m (le double de la ligne HT, 450 ¢/m), débité à la pose (`investissement:cables_souterrains`),
  entretien 1 000 ¢/km/mois inclus dans `entretien:reseau_electrique` ; ni déchets ni véhicule d'entretien.
- **Démolition / annulation** : Ctrl+Z (étape `removeCable`), bouton « Démolir » de la section « Câbles souterrains »
  du panneau Énergie ; démolir l'installation retire ses câbles. Un câble dont la route a été démolie reste, inactif
  (`CableView.active = false`, « route démolie »).
- **Rendu** : aucun objet en vue normale (enterré, pas de pylône). Calque Électricité : tirets cyan 2,5 m au-dessus du
  sol (orange si inactif), `elec_cables_souterrains` (`PowerRenderer.rebuildCableLines`). Le calque s'affiche
  automatiquement pendant l'outil (même ToolId que la ligne HT).
- **Protocole** : `delta.ext.electricite.cables` (`CableView[]`, présent dès qu'un câble a été posé).
- **Sauvegarde** : `power.cables` (`CableState { id, a, b, bx?, bz?, lengthM, builtAt }`, `b` = 0 pour une route) et
  `power.nextCableId`, champs **facultatifs** : section v1 inchangée, une ancienne partie se charge sans câble ;
  `checkPowerState` lève si les câbles sont illisibles.
- Tests : `tests/electricite/cables.test.ts` (4 tests : parc éolien loin de toute route relié par câble -> la ville
  est alimentée, sans ligne ni pylône ; démolition par commande et par démolition de l'éolienne -> coupure ; câble
  entre installations, sauvegarde / rechargement identiques, ancienne partie sans câble ; refus des tracés
  invalides). Preuves (2026-11-16) : `npx tsc --noEmit -p tsconfig.json` ✓ ; `npm test` 698/698.

## 2. Réseau et répartition (chaque heure de jeu)

1. **Pannes** (PRNG propre au module) : probabilité horaire par installation (`failurePerHour`) et par km de ligne,
   × `1 / financement²` (×4 à 50 %, ×16 à 25 %, ×0,44 à 150 %) ; durée de réparation × `1 / financement`.
2. **Production disponible** de chaque centrale (vent, soleil, débit, panne, site).
3. **Demande** de chaque bâtiment : classe (hôpitaux, services publics, résidentiel, commerces et bureaux, industrie),
   emprise, habitants présents, emplois occupés, courbe horaire de la classe, facteur saisonnier (hiver +18 %, été +8 %).
   Chaque bâtiment est rattaché à l'installation la plus proche dont il est à portée ; hors portée = « non raccordé ».
4. **Graphe municipal** reconstruit (`m.networks`, réseau `electricite`) : centrale -> jeu de barres -> transformateur ->
   nœud de distribution -> un consommateur par classe (priorité = rang dans l'ordre réglé). Lignes HT : arêtes de
   150 MW, pertes 0,8 %/km. Installations du même réseau routier : liaison automatique non bloquante (§1 quinquies) ;
   installations à moins de 130 m sans route commune : raccordement moyenne tension automatique (20 MW, 1,5 %/km).
5. **Répartition** `Networks.allocate` : ordre de mérite (solaire, éolien, hydro, thermique, batteries, réseau voisin), délestage des classes les
   moins prioritaires d'abord. Dans une classe partiellement servie, les bâtiments sont alimentés dans un **ordre
   tournant** (hachage identifiant × heure : délestage tournant) ; l'énergie inutilisable (bâtiment trop gros pour le
   reliquat) est rendue aux classes suivantes (ré-itération).
   **Baisse de régime des lieux de travail** (commerces, industrie) : pas de coupure bâtiment par bâtiment ; tous
   reçoivent la même part du courant attribué à leur classe et tournent au ralenti (`powerFactor` = part, état
   `coupe` pour l'icône et le panneau). La démographie plafonne l'embauche à cette part (`activity` ∈ ]0, 1]) ; les
   salariés en poste restent. Sous `BROWNOUT_MIN_SHARE` (10 %), la classe est délestée. Avant : toute l'industrie
   était coupée d'un coup (mesuré sur une partie type de 7 000 hab. : 2 602 emplois sans courant, chômage 30–47 %).
   **Réserve faible** : le module `alertes` publie `powerReserve` (marge la plus basse sur 24 h, sous 15 %, sans
   coupure en cours) ; la fenêtre « Problèmes à régler » prévient le joueur avant la baisse de régime.
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
`buildLine {a,b}`, `autoConnect {id}`, `removeLine {id}`, `quoteCable {a,b}`, `buildCable {a,b}`, `removeCable {id}`
(câbles souterrains, §1 sexies), `setFunding {funding}`, `setPriorities {order}`,
`setRooftops {enabled}`, `forceWind {ms|null}`, `checkSite {kind,x,z}`, `effects {limit}`, `raccordement {on}`
(réseau voisin : 60 000 CHF une fois, 3 MW, 4,5 ct/kWh), `vente {on}` (vente du surplus aux voisins, §1 ter bis).

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

### Vente simplifiée et prix réglable (mise à jour)

Sur retour du joueur, la vente du surplus aux villes voisines n'exige plus ni raccordement ni route au bord de la
carte, et n'a plus de plafond de puissance. Le joueur règle le prix de vente (0,5 à 15 ct/kWh, défaut 1,5) dans le
panneau Énergie. Les voisins achètent tout le surplus jusqu'à 4,5 ct/kWh (leur propre prix d'achat), puis une part
décroissante jusqu'à 15 ct/kWh (rien). Recette maximale vers 7,5 ct/kWh. Champ de sauvegarde facultatif
`settings.prixVente`. Commande `electricite` / `prixVente` `{ price }`.
