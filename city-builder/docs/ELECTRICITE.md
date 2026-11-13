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

Toitures solaires (option, réglage du panneau) : 4 kWc par logement habité, 6 installations par jour, 90 CHF l'unité
(ligne d'investissement), production injectée au poste du quartier.

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
5. **Répartition** `Networks.allocate` : ordre de mérite (solaire, éolien, hydro, thermique), délestage des classes les
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
`setRooftops {enabled}`, `forceWind {ms|null}`, `checkSite {kind,x,z}`, `effects {limit}`.

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
