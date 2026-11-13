# Module `hubs` : port et aéroport (phase 2C, ROADMAP §7)

Propriété de la branche `claude/p2c-port-aeroport`. Demandes hors périmètre : `docs/requests/hubs.md`.

| Couche | Fichiers |
|---|---|
| Partagé (pur) | `src/shared/hubs/types.ts` (types, `HUB_SPECS`, API publiées), `layout.ts` (gabarits, servitudes, bruit), `paths.ts` (trajectoires) |
| Simulation | `src/sim/hubs/validate.ts`, `system.ts` (`HubsSystem`), `save.ts` ; plugin `src/sim/plugins/hubs.ts` |
| Protocole / sauvegarde | `src/shared/protocol-ext/hubs.ts`, `src/sim/save-sections/hubs.ts` (v1) |
| Rendu | `src/render/hubs/scene.ts` (`HubsRenderer`), plugin `src/render/plugins/hubs.ts` |
| Interface | `src/ui/panels/transports.ts` (panneau « Transports », id `hubs`) ; onglet « Transports » du tiroir Services |
| Outils / assets | `tools/transport/**` (générateur 35 modèles, `catalog.ts` : fusion + entrées de construction), `assets/models/transport/**` |
| Tests | `tests/hubs/hubs.test.ts` (15 tests), `tests/hubs/captures.mjs` (`npm run hubs:captures`) |

## 1. Pôles constructibles (catalogue, catégorie `transport`, tag `hub`)

| Entrée | Emprise | Coût / entretien | Emplois | Capacité mensuelle | Transit |
|---|---|---|---|---|---|
| `hub_port` Port de commerce | 224 × 96 m | 18,5 M / 85 k | 380 | 90 000 t export + 90 000 t import | 12 ¢/t, 6 j |
| `hub_port_passagers` Port de commerce et de passagers | 384 × 96 m | 29 M / 120 k | 520 | idem + 40 000 passagers | 12 ¢/t, 6 j |
| `hub_aeroport` Aéroport (piste de 900 m) | 960 × 320 m | 64 M / 240 k | 650 | 900 t de fret + 80 000 passagers | 380 ¢/t, 1 j |

Les 35 pièces (quais, grues, conteneurs, entrepôt, capitainerie, gare maritime, navires, piste, voies de
circulation, aire, aérogare, tour, hangar, passerelles, avions, véhicules de piste) sont dans le catalogue
(catégorie `transport`, hors bâtiments : ni la démo ni les onglets de bâtiments ne les utilisent).

**Pose** (outil de construction, onglet Services › Transports) : le fantôme montre l'emprise ; chaque position est
validée par la simulation (`pluginCommand hubs.place { assetId, x, z, rot, dryRun: true }`) → aperçu vert / rouge
avec le motif. Placement libre (pas d'aimantation aux routes), `R` = rotation par huitièmes de tour (orientation de
la piste, alignement du quai sur la côte). Une seule exception à la machine de pose existante, documentée dans
`src/client/tools/machine.ts` (`isHubAsset`). `src/input/**` n'est pas modifié.

## 2. Validation par la simulation (`src/sim/hubs/validate.ts`)

Commune : dans la carte, aucun bâtiment / route / autre pôle sur l'emprise.

- **Port** — mer côté flèche (+Z local) :
  - terre-plein sec (≤ 12 % d'échantillons en eau, anses comblées par la dalle), dénivelé ≤ 8 m ;
  - **littoral ou cours d'eau navigable** : bassin de 64 m devant le quai en eau à ≥ 75 % ; chenal d'approche le
    long du quai (± 240 m au-delà des extrémités) en eau à ≥ 75 % (hors carte = mer ouverte) ;
  - en mer, profondeur médiane du bassin ≥ 3 m (en rivière, la surface de l'eau n'est pas exposée aux modules :
    la largeur du chenal fait foi — demande §5) ;
  - sol fini = point haut du terre-plein (dalle béton avec mur jusque sous l'eau au rendu).
- **Aéroport** : entièrement hors d'eau, dénivelé ≤ 6 m sur 960 × 320 m, un seul par ville, et **aucun bâtiment
  existant au-dessus des servitudes**.

## 3. Servitudes aéronautiques (`easementLimitLocal`)

Surfaces de limitation d'obstacles simplifiées, repère de la piste (axe X local, z = −90) :
bande de ± 75 m le long de la piste : 0 m ; **approche** dans l'axe au-delà de chaque seuil sur 3 km, divergence
15 %, pente 2 % (10 m à 500 m du seuil, 60 m à 3 km) ; **transition** 1/7 depuis le bord de la bande et du cône
d'approche, jusqu'à 45 m. Contrôle d'un bâtiment : hauteur du modèle × échelle de variante ≤ limite minimale sur
ses coins, milieux d'arêtes et centre.
Appliquée : commande `checkBuilding` (outil de pose : aperçu rouge, clic refusé), service `servitudes`
(`limitAt`, `checkBuilding`), refus de poser un aéroport si un bâtiment existant dépasse (message avec le nombre
et le pire cas), panneau (liste des infractions). Veto dans le cœur demandé (`docs/requests/hubs.md` §1).

## 4. Activité, API d'export (`provide('port' | 'aeroport', HubFreightApi)`)

```ts
const port = ctx.use<HubFreightApi>('port');            // module hubs absent -> undefined
port?.available();                                        // au moins un port en service
port?.capacity();   // { exportT, importT, usedExportT, usedImportT, costPerT, delayDays, paxPerMonth }
port?.quote(5000, 'export');                              // { accepted, costPerT, total, delayDays }
port?.book(5000, 'export', 'contrat-ble');                // { ok, accepted, total, delayDays, arrivalMinutes }
```
Capacité cumulée des pôles du type, remise à zéro chaque mois ; une réservation entame la capacité, compte dans le
fret du pôle (`bookedExportT`) et ses recettes. Activité de base (journalière, plafonnée par la capacité) :
import 0,12 t/hab/mois, export 1,5 t par emploi industriel/mois, ferry 0,02 pax/hab + 3 000 touristes, aérien
0,05 pax/hab + 6 000 touristes, fret aérien 0,004 t/hab. Camions/jour = fret / 18 t. Recettes : 4 ¢/t et 6 ¢/pax
(port), 9 ¢/pax et 120 ¢/t (aéroport). Emplois = emplois nominaux × taux d'activité × population.
Budget municipal (service `transports`) : `construction:<kind>`, `entretien:<kind>`, `droits:<kind>`,
`demolition:<kind>` (application à la trésorerie : demande §2).

## 5. Nuisances (grilles du contrat municipal)

Contrat partagé si le module `municipal` est enregistré (avant `hubs`), sinon instance locale (repli, même calcul).

- **Bruit** : champ analytique (`airportNoiseLocal` : 78 dB le long de la piste, axe d'approche jusqu'à ~3 km,
  atténuation latérale ; port : 50 sur l'emprise, décroissance sur 160 m), converti en indice 0..100 ; appliqué
  comme **plancher horaire** de la grille `bruit` après sa propagation (×0,7 la nuit).
- **Satisfaction** : −0,45 par point de bruit au-dessus de 10 ; **valeur foncière** : −0,6 ¢/m² par point.
  Contribution réversible : on applique la différence entre la cible et ce qui a déjà été appliqué (pas
  d'accumulation, retirée à la démolition), suivie cellule par cellule et sauvegardée.
- **Attractivité des bureaux** : indicateur propre `hubs:attractivite_bureaux` (+40 près de l'aérogare,
  décroissance sur 2,5 km).
- **Pollution** : émissions horaires `pollution_air` (port 180 m, aéroport 400 m) et `pollution_eau` (bassin),
  proportionnelles à l'activité.
- Registre d'effets : cause `construction_<kind>` / `demolition_<kind>`, effet mesuré sur la satisfaction.
- Relevé horaire par pôle (panneau) : bruit moyen et cellules exposées (≥ 20), habitants exposés, variations de
  satisfaction et de valeur foncière, pollution de l'eau et de l'air.

## 6. Mouvements visibles

Échantillon représentatif de l'activité, horodaté en **temps physique** (0,1 s par minute de jeu, comme le trafic
routier ; le rendu extrapole `phys += dt × vitesse`). Trajectoires pures (`src/shared/hubs/paths.ts`) :
- navire : approche le long du quai depuis 340 m (120 s), à quai (300 à 540 s, grues en service), appareillage ;
  remorqueur d'escorte pour les cargos ; ferry au poste passagers (rampe abaissée) ;
- avion : approche à 3° depuis 1,5 km, atterrissage, roulage vers son poste, stationnement (passerelle déployée),
  repoussage, roulage, décollage, montée à 8° ; cargo au poste fret ; piste jamais occupée par deux mouvements.
Postes : 1 (ou 2) au port, 4 passagers + 1 fret à l'aéroport ; réapparition après 30 à 240 s (PRNG du module).

## 7. Protocole, sauvegarde

`delta.ext.hubs` : `{ hubs?, movements?, phys?, speed? }` (structure à chaque changement, temps à chaque avance) ;
`snapshot.ext.hubs` complet ; rien sans pôle. Commandes : `place`, `remove`, `checkBuilding`, `summary`, `probe`,
`suggest` (emplacements valides), `movements` (phases courantes). Sauvegarde `save.plugins.hubs` v1 : pôles,
mouvements, temps physique, activité, réservations, contributions appliquées (Float32 base64).

## 8. Preuves (2026-11-13)

Voir le compte rendu de la session (typecheck, `npm test`, build, e2e, captures regardées).
