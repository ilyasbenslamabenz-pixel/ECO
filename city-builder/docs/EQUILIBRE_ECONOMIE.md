# Équilibre de l'économie — étude (budget, recettes, dépenses)

Retour joueur : « réfléchis si le budget, l'argent gagné et les dépenses sont jouables, je galère un peu » (PC,
« Nouvelle partie », 3 M CHF). Étude seulement : **aucun fichier du jeu n'est modifié**. Tous les chiffres ci-dessous
sont mesurés par la simulation complète (tous les modules), aucun n'est estimé à la main sauf mention « catalogue ».

## 1. Méthode

Script : `tests/perf/equilibre-economie.ts` (non branché sur `npm test`), tableaux : `tests/perf/equilibre-economie-rapport.ts`.

```
npx tsx tests/perf/equilibre-economie.ts --parcours=prudent|typique|ambitieux|manuel|depart --mois=24 --pas=30 \
    [--reglages=import_elec,logements_main,dechets,tarif_elec] --json=sortie.json
npx tsx tests/perf/equilibre-economie-rapport.ts sortie1.json sortie2.json … [--detail] [--tous-les=6]
```

- Partie créée comme « Nouvelle partie » : catalogue réel avec prix des logements posés à la main ÷ 4 et dépôt de tram
  dérivé (`withResidentialPricing(withTransitAssets(…))`), 3 M CHF, déblocages progressifs (`paliers.mode { verrous }`),
  avril, 9 h, impôts par défaut 9 %. Carte plate sans eau (graine 4242, 8 chunks) pour la reproductibilité.
- Pas de simulation de 30 min (`--pas=30`) : résultats identiques au pas de 10 min vérifiés sur 3 mois (parcours prudent,
  mêmes valeurs mensuelles au franc près). 24 mois par parcours.
- Joueur scripté : il lit les barres de demande et zone une rangée de 800 m (rue + zone, R faible / R moyen / C / I /
  bureaux) quand les lots résidentiels sont presque pleins ou qu'une demande C, I, B dépasse 0,25 ; il garde une réserve
  (prudent 250 000, typique 120 000, ambitieux 0) ; raccordements électricité et eau au départ (premier conseil des
  Premiers pas), éolienne quand le raccordement sature (≥ 85 % de 3 000 kW) ou qu'il y a des coupures, pompage +
  potabilisation quand la desserte d'eau tombe sous 90 %. Déchets : dépôt de camions + décharge dès le départ (tous).

| Parcours | Ce que fait le joueur |
|---|---|
| (a) prudent | routes + zones R/C/I + raccordements + déchets ; éoliennes / eau seulement quand ça sature ; aucun service |
| (b) typique | (a) + école (400 hab.), centre de santé (700), commissariat (1 000), caserne (1 200), équipement suivant quand la couverture < 80 % ; dépôt de bus + ligne à 1 500 hab. |
| (c) ambitieux | dès le jour 1 : école, santé, police, pompiers, parcs ×4, 2 éoliennes, pompage + potabilisation + épuration (+ raccordement électrique de secours) ; bus au jour 30 ; tram au jour 120 ; emprunt de 500 000 sur 10 ans dès que la trésorerie < 150 000 |
| (e) manuel | (b), mais les **logements sont posés à la main** (prix ÷ 4) au lieu d'être zonés — jusqu'à 8 par jour tant que la demande R est positive et que la trésorerie le permet ; C et I zonés |
| (d) départ | « Nouvelle partie (ville de départ) » : 150 M CHF, `buildCity demo`, puis la ville tourne sans intervention |

Relevés : chaque mois clos (bilan de l'économie + montants des modules attribués par module appelant via
`applyService`, lignes du grand livre municipal, entretien et salaires par famille d'équipement), et chaque jour
(population, trésorerie, « rythme » = solde horaire × 720 tel que l'affiche le HUD).

Limites : joueur scripté (il ne gère ni la satisfaction ni les objectifs : la satisfaction s'effondre vers 5–15 dans
les grandes villes scriptées, ce qui fait baisser les impôts entre M6 et M9) ; carte plate ; une graine.

## 2. Résultats avec les réglages actuels

| Parcours | Faillite | Trésorerie min (mois) | Pop. M1 / M2 / M6 / M12 / M24 | Solde M1 / M2 / M6 / M12 / M24 (k CHF) | Investi par le joueur |
|---|---|---|---|---|---|
| prudent | non | 226 k (M4) | 1 493 / 3 000 / 6 099 / 7 509 / 8 117 | 26 / 212 / 569 / 432 / 471 | 12 645 k |
| typique | non | 51 k (M13) | 1 401 / 2 914 / 5 633 / 6 328 / 7 733 | 19 / 192 / 557 / 352 / 375 | 14 276 k |
| ambitieux | non (4 emprunts) | −25 k (M5) | 815 / 894 / 5 171 / 7 782 / 8 518 | −1 / 20 / 415 / 396 / 327 | 9 770 k |
| manuel | non | 70 k (M11) | 867 / 900 / 934 / 996 / 1 268 | 12 / 20 / 22 / 28 / 64 | 4 560 k |
| départ | non | 52 349 k (M1) | 2 804 (stable) | 17 / 25 / 26 / 29 / 35 | 99 066 k (ville) |

Solde = recettes récurrentes − dépenses récurrentes (impôts, entretien, salaires, emprunts, services des modules), hors
investissements et primes. Le solde devient positif dès le **1er mois** pour prudent, typique, manuel et départ, au
**2e mois** pour l'ambitieux. Aucun parcours ne fait faillite : la trésorerie basse des parcours zonés vient de ce que le
joueur scripté réinvestit tout au-dessus de sa réserve (rangées, 4 à 8 éoliennes à 400 000).

### Les 60 premiers jours (relevé quotidien)

| Parcours | Trésorerie j10 / j20 / j30 / j60 (k) | Min. des 60 j | « Rythme » HUD j20 / j29 (k/mois) | Solde réel M1 (k) |
|---|---|---|---|---|
| prudent | 2 011 / 1 878 / 1 839 / 257 | 257 k (j60) | 75 / 157 | 26 |
| typique | 2 011 / 1 659 / 1 394 / 127 | 127 k (j60) | 66 / 128 | 19 |
| ambitieux | 315 / 9 / 8 / 29 | 6 k (j12) | 25 / 35 | −1 |
| manuel | 129 / 154 / 134 / 78 | 78 k (j60) | 74 / 74 | 12 |
| départ | 52 304 / 52 284 / 52 348 / 52 373 | — | −60 / −60 | 17 |

### Où part l'argent (1er et 2e mois, CHF, mesuré)

| | prudent M1 (1 493 hab.) | typique M2 (2 914 hab.) | ambitieux M1 (815 hab.) | manuel M2 (900 hab.) |
|---|---|---|---|---|
| Impôts (R / C / I / B) | 65 730 (23 k / 3 k / 40 k / 0) | 231 994 | 41 430 | 96 221 |
| Achat d'électricité au voisin | −49 070 | −82 134 | −20 809 | −82 095 |
| Vente d'électricité aux habitants | +25 257 | +65 102 | +21 353 | +35 399 |
| Eau (vente − achat − entretien) | +875 | +11 125 | +5 454 | +1 775 |
| Déchets : camions (4 × 1 800) | −7 200 | −7 200 | −7 200 | −7 200 |
| Entretien des bâtiments de la ville | −3 225 | −10 380 | −11 526 | −14 381 (logements posés : 11 300 en fin de mois) |
| Salaires des agents publics | −3 896 | −20 438 | −26 087 (fin de mois : police 8 280, santé 7 452, école 6 762, eau 5 520) | −7 038 |
| Investissements ponctuels du mois | raccordements −100 000 | — | raccordement −60 000 | — |
| Primes (paliers + objectifs) | +779 000 | +600 000 | +378 000 | 0 |

## 3. Diagnostic

1. **Le raccordement électrique est un gouffre** (le poste n° 1 des petites villes). L'électricité achetée au voisin
   coûte 4,5 ¢/kWh et se revend 2 ¢/kWh aux habitants (`src/shared/power/model.ts:118` et `:127`) : chaque kWh importé
   perd 2,5 ¢. La demande est forte (0,55 kW par habitant, 3,2 kW par ouvrier d'industrie, `model.ts:228-236`) : le
   plafond de 3 000 kW est atteint vers 1 000–1 500 habitants. Mesuré : −24 k net au M1 du prudent (36 % des impôts),
   −47 k net au M2 du manuel (49 % des impôts) ; et tous les parcours zonés achètent encore ~90 k/mois au voisin au M24
   (ils n'ajoutent une éolienne qu'à la coupure). Or c'est le premier conseil des Premiers pas (`src/ui/tutorial.ts:67`).
   Dans CS2, se brancher sur une connexion extérieure est un démarrage neutre, pas une perte structurelle.
2. **Les logements posés à la main coûtent un entretien mensuel à la ville** (le prix a été divisé par 4, pas
   l'entretien : 9 à 155 CHF par habitant et par mois selon le modèle, catalogue), alors qu'un lot zoné ne coûte rien.
   Un joueur qui pose ses maisons (parcours manuel) dépense ~1,9 M en logements en 9 jours, plafonne à ~900 habitants, paie 11–16 k/mois
   d'entretien de logements et reste **2 ans sous 200 000 CHF** de trésorerie (solde +12 à +64 k/mois) : c'est le profil
   « je galère ». La ville de départ paie 194 k/mois d'entretien (dont 131 k pour les logements, commerces et bureaux posés par `buildCity`)
   pour 2 804 habitants. Il n'y a pas d'équivalent dans CS2 (les logements sont toujours zonés).
3. **Le « rythme » affiché trompe le joueur pendant le 1er mois** : avant la première clôture, la prévision des services
   n'extrapole que les montants déjà versés dans le mois (`src/sim/economy.ts:258-261`) ; l'achat d'électricité, la vente
   d'électricité et les camions-bennes ne sont versés qu'à la clôture (`src/sim/power/system.ts:1551-1557`,
   `src/sim/waste/system.ts:669-672`). Mesuré : le HUD annonce +74 k/mois au manuel (j20–j29) pour un solde réel de +12 k ;
   +157 k annoncés au prudent (j29) pour +26 k ; −60 k annoncés pour la ville de départ (solde réel +17 k). Le joueur
   investit sur une promesse, puis la facture tombe d'un coup au 1er du mois (−42 k le j30 du manuel).
4. **Déchets : coût fixe élevé pour un bourg.** Dépôt + décharge = 650 000 à poser (22 % des 3 M), puis ~14 k/mois quelle
   que soit la population (camions 7 200, entretien 2 700, salaires 4 416, mesurés). NB : le commentaire de
   `truckCostPerMonth` (`src/shared/waste/types.ts:52-53`) annonce des centimes, la valeur est débitée en CHF.
5. **Services publics : supportables.** Salaires à 6 % de 2 300 (138 CHF par agent, `economy.ts:35-36`) : école + santé +
   police + parc coûtent 23 k/mois de salaires + 4 k d'entretien (ambitieux, fin du M1). Cela rend
   l'ambitieux tendu au départ (trésorerie 6–9 k de j12 à j30, 4 emprunts, −25 k au M5) mais jamais en faillite : c'est
   la tension recherchée. Pas de changement proposé.
6. **Entretien des routes et réseaux : négligeable** (2–9 k/mois, rue 0,4 CHF/m). Impôts par défaut 9 % : pas en cause.
7. **Milieu de partie très riche** (constat, hors plainte) : +240 à +570 k/mois à 6 000–8 000 habitants, primes de paliers 2,25 M en 4 mois. L'argent n'est plus un défi après ~3 000 habitants ; le défi
   devient la satisfaction. La croissance zonée est aussi très rapide (3 000 hab. au M2), plus que dans CS2.

En résumé : le jeu est confortable pour qui **zone** et reste prudent (comme CS2) ; il devient pénible pour qui
**pose ses logements à la main** et vit sur le **raccordement électrique**, avec un HUD qui surestime le solde le 1er mois.

## 4. Ajustements proposés et effet mesuré

Surcharges locales du script (`--reglages`), équivalentes aux changements proposés ; rien n'est commité dans le jeu.

| # | Réglage (`--reglages`) | Valeur actuelle → proposée | Fichier:ligne |
|---|---|---|---|
| R1 | `import_elec` | achat au réseau voisin 4,5 → **2,5 ¢/kWh** (perte 0,5 ¢/kWh au lieu de 2,5) | `src/shared/power/model.ts:127` (`IMPORT_SPEC.priceCentsPerKwh`) |
| R1 bis | `tarif_elec` (variante écartée) | tarif de vente 2 → 3 ¢/kWh | `src/shared/power/model.ts:118` |
| R2 | `logements_main` | entretien des logements posés à la main **÷ 4** (comme leur prix) | `src/shared/transit-assets.ts:45-52` (`withResidentialPricing`) |
| R3 | `dechets` | camion-benne 1 800 → **900 CHF/mois** | `src/shared/waste/types.ts:53` |
| R4 | (interface, non chiffrable en trésorerie) | prévision du 1er mois : inclure les postes mensuels des modules (achat/vente d'électricité, camions) au prorata | `src/sim/economy.ts:258-261` + `src/sim/power/system.ts:1551-1557` |

### Effet de chaque réglage seul (parcours manuel, 24 mois)

| Réglages | Pop. M6 / M12 / M24 | Solde M6 / M12 / M24 (k) | Trésorerie min (mois) |
|---|---|---|---|
| actuels | 934 / 996 / 1 268 | 22 / 28 / 64 | 70 k (M11) |
| R1 `import_elec` | 1 024 / 1 233 / 1 881 | 68 / 93 / 157 | 108 k (M6) |
| R1 bis `tarif_elec` | 957 / 1 120 / 1 607 | 45 / 71 / 114 | 93 k (M8) |
| R2 `logements_main` | 957 / 1 047 / 1 447 | 34 / 49 / 87 | 66 k (M4) |
| R3 `dechets` | 939 / 1 021 / 1 305 | 28 / 32 / 67 | 70 k (M5) |
| R1 + R2 + R3 | 1 053 / 1 329 / 2 318 | 86 / 121 / 238 | 108 k (M4) |

R1 est le levier principal ; il vise le démarrage (raccordement) sans enrichir la fin de partie autant que R1 bis, qui
augmente toutes les ventes d'électricité (et donc la richesse déjà excessive du milieu de partie). R3 est petit mais
utile aux bourgs (+3,6 k/mois).

### Effet de R1 + R2 + R3 sur tous les parcours (24 mois)

| Parcours | Réglages | Faillite | Trésorerie min (mois) | Solde M1 / M2 / M6 / M12 / M24 (k) | Pop. M6 / M12 / M24 |
|---|---|---|---|---|---|
| prudent | actuels | non | 226 k (M4) | 26 / 212 / 569 / 432 / 471 | 6 099 / 7 509 / 8 117 |
| prudent | R1+R2+R3 | non | 305 k (M5) | 51 / 252 / 604 / 488 / 526 | 6 074 / 7 402 / 7 893 |
| typique | actuels | non | 51 k (M13) | 19 / 192 / 557 / 352 / 375 | 5 633 / 6 328 / 7 733 |
| typique | R1+R2+R3 | non | 147 k (M12) | 43 / 231 / 600 / 363 / 458 | 6 497 / 7 304 / 8 420 |
| ambitieux | actuels | non (4 emprunts) | −25 k (M5) | −1 / 20 / 415 / 396 / 327 | 5 171 / 7 782 / 8 518 |
| ambitieux | R1+R2+R3 | non (4 emprunts) | 19 k (M8) | 12 / 43 / 507 / 313 / 346 | 5 754 / 8 262 / 8 860 |
| manuel | actuels | non | 70 k (M11) | 12 / 20 / 22 / 28 / 64 | 934 / 996 / 1 268 |
| manuel | R1+R2+R3 | non | 108 k (M4) | 52 / 70 / 86 / 121 / 238 | 1 053 / 1 329 / 2 318 |
| départ | actuels | non | — | 17 / 25 / 26 / 29 / 35 | 2 804 |
| départ | R1+R2+R3 | non | — | 55 / 63 / 64 / 67 / 73 | 2 804 |

Lecture par rapport à l'objectif :
- prudent et typique : jamais en faillite, solde positif dès le M1 vers 1 400–1 500 habitants (avant et après) ; le
  typique double son solde du M1 (19 → 43 k) et sa trésorerie minimale triple (51 → 147 k).
- ambitieux : toujours tendu (trésorerie 6–21 k les 30 premiers jours, 4 emprunts) mais il ne passe plus sous zéro.
- manuel (profil « je galère ») : le solde passe de +12–28 k à +52–121 k la première année et la ville atteint
  2 318 habitants au M24 au lieu de 1 268 ; il reste le parcours le plus lent (le zonage reste la bonne stratégie).
- le milieu de partie reste très riche : ces réglages ne corrigent pas le point 7 (à traiter séparément, par exemple
  par la croissance ou les primes de paliers, non simulé ici).

R4 (prévision) ne change pas la trésorerie ; il supprime l'écart mesuré entre le « rythme » affiché et le solde réel
du 1er mois (+74 k annoncés / +12 k réels au manuel ; −60 k / +17 k pour la ville de départ).

## 5. Annexes : relevés mensuels bruts (tous les 6 mois)

Montants en milliers de CHF. « Investi » = constructions du mois + investissements ponctuels des modules.

### Réglages actuels

#### prudent — réglages actuels


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 493 | 1 837 | 26 | 23 / 3 / 40 / 0 | 3 | 3 | 4 | -24 | 1 | -7 | 0 | 0 | 779 | 1 968 | 44.3 | Bourg |
| 2 | 3 000 | 253 | 212 | 81 / 10 / 148 / 0 | 7 | 3 | 5 | -15 | 11 | -7 | 0 | 0 | 600 | 2 397 | 33.8 | Petite ville |
| 6 | 6 099 | 270 | 569 | 213 / 15 / 354 / 0 | 18 | 7 | 15 | -16 | 51 | -7 | 0 | 0 | 0 | 823 | 10.7 | Ville |
| 12 | 7 509 | 266 | 432 | 182 / 19 / 254 / 0 | 24 | 9 | 26 | -15 | 58 | -7 | 0 | 0 | 0 | 600 | 6.2 | Ville |
| 18 | 7 834 | 556 | 275 | 143 / 18 / 160 / 0 | 32 | 9 | 28 | -18 | 48 | -7 | 0 | 0 | 0 | 0 | 6.3 | Ville |
| 24 | 8 117 | 741 | 471 | 207 / 22 / 276 / 0 | 39 | 9 | 28 | -14 | 61 | -7 | 0 | 0 | 0 | 0 | 7 | Ville |

Dernier mois — entretien par famille : dechets 2 700, eau 27 000, electricite 8 800 ; salaires : dechets 4 416, eau 23 184
Lignes des modules : achat:assainissement_exterieur -12 342, achat:eau_exterieure -14 810, achat:electricite_exterieure -90 152, dechets:collecte -7 200, entretien:canalisations -3 859, entretien:reseau_electrique -120, exploitation:pompage -3 173, exploitation:potabilisation -7 138, vente:eau 102 725, vente:electricite 76 071


#### typique — réglages actuels


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 401 | 1 392 | 19 | 21 / 3 / 35 / 0 | 4 | 3 | 6 | -22 | 1 | -7 | 0 | 0 | 779 | 2 406 | 48.3 | Bourg |
| 2 | 2 914 | 123 | 192 | 83 / 11 / 138 / 0 | 10 | 3 | 20 | -17 | 11 | -7 | 8 | 0 | 600 | 2 061 | 45.8 | Petite ville |
| 6 | 5 633 | 112 | 557 | 222 / 19 / 357 / 0 | 18 | 7 | 38 | -17 | 39 | -7 | 9 | 0 | 0 | 661 | 16.9 | Ville |
| 12 | 6 328 | 53 | 352 | 174 / 27 / 218 / 0 | 24 | 9 | 57 | -16 | 39 | -7 | 6 | 0 | 0 | 400 | 7.7 | Ville |
| 18 | 7 169 | 262 | 240 | 163 / 9 / 152 / 0 | 34 | 9 | 71 | -18 | 50 | -7 | 4 | 0 | 0 | 1 050 | 6.4 | Grande ville |
| 24 | 7 733 | 191 | 375 | 216 / 11 / 233 / 0 | 42 | 9 | 75 | -15 | 59 | -7 | 5 | 0 | 0 | 450 | 6.5 | Grande ville |

Dernier mois — entretien par famille : dechets 2 700, education 9 100, eau 20 250, electricite 8 800, transports 1 200, sante 1 030 ; salaires : dechets 4 416, education 35 880, eau 23 184, transports 4 140, sante 7 728
Lignes des modules : achat:assainissement_exterieur -12 346, achat:eau_exterieure -15 490, achat:electricite_exterieure -91 754, dechets:collecte -7 200, entretien:canalisations -3 859, entretien:reseau_electrique -120, exploitation:pompage -3 057, exploitation:potabilisation -6 879, vente:eau 101 017, vente:electricite 76 455


#### ambitieux — réglages actuels


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 815 | 8 | -1 | 21 / 3 / 17 / 0 | 12 | 2 | 26 | 5 | 5 | -7 | 0 | 5 | 378 | 3 870 | 58.9 | Village |
| 2 | 894 | 28 | 20 | 34 / 3 / 37 / 0 | 12 | 2 | 30 | -7 | 10 | -7 | 0 | 5 | 0 | 0 | 53.2 | Village |
| 6 | 5 171 | 64 | 415 | 182 / 22 / 297 / 0 | 20 | 5 | 42 | -18 | 16 | -7 | 0 | 10 | 900 | 1 226 | 35 | Ville |
| 12 | 7 782 | 944 | 396 | 211 / 12 / 287 / 0 | 29 | 9 | 52 | -16 | 15 | -7 | 5 | 22 | 0 | 0 | 16.5 | Ville |
| 18 | 8 227 | 4 094 | 241 | 164 / 14 / 181 / 0 | 29 | 9 | 52 | -18 | 15 | -7 | 3 | 22 | 0 | 0 | 13.1 | Grande ville |
| 24 | 8 518 | 5 707 | 327 | 190 / 21 / 232 / 0 | 29 | 9 | 52 | -16 | 15 | -7 | 4 | 22 | 0 | 0 | 12.2 | Grande ville |

Dernier mois — entretien par famille : electricite 8 800, eau 4 150, dechets 1 500, education 2 800, sante 1 030, police 1 600, parcs 5 850, pompiers 1 700, transports 1 200 ; salaires : eau 6 348, dechets 3 312, education 10 764, sante 7 728, police 8 280, parcs 5 520, pompiers 6 210, transports 4 140
Lignes des modules : achat:electricite_exterieure -92 958, dechets:collecte -7 200, entretien:canalisations -3 888, entretien:reseau_electrique -120, exploitation:epuration -2 439, exploitation:pompage -1 006, exploitation:potabilisation -2 263, vente:eau 24 636, vente:electricite 76 663


#### manuel — réglages actuels


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 867 | 133 | 12 | 27 / 5 / 46 / 0 | 12 | 2 | 6 | -37 | 1 | -7 | 0 | 0 | 378 | 3 257 | 42.3 | Village |
| 2 | 900 | 77 | 20 | 33 / 5 / 58 / 0 | 14 | 2 | 7 | -47 | 2 | -7 | 0 | 0 | 0 | 77 | 42.5 | Village |
| 6 | 934 | 75 | 22 | 35 / 5 / 58 / 0 | 15 | 2 | 7 | -47 | 2 | -7 | 0 | 0 | 0 | 81 | 42.3 | Village |
| 12 | 996 | 499 | 28 | 38 / 5 / 64 / 0 | 16 | 2 | 7 | -49 | 2 | -7 | 0 | 0 | 400 | 0 | 42.3 | Bourg |
| 18 | 1 120 | 89 | 53 | 42 / 5 / 73 / 0 | 18 | 2 | 7 | -35 | 3 | -7 | 0 | 0 | 0 | 81 | 43 | Bourg |
| 24 | 1 268 | 93 | 64 | 48 / 5 / 83 / 0 | 20 | 2 | 7 | -38 | 3 | -7 | 0 | 0 | 0 | 77 | 43.1 | Bourg |

Dernier mois — entretien par famille : dechets 2 700, autre 15 980, education 700, electricite 1 100 ; salaires : dechets 4 416, education 2 760
Lignes des modules : achat:assainissement_exterieur -5 474, achat:eau_exterieure -14 698, achat:electricite_exterieure -83 744, dechets:collecte -7 200, entretien:canalisations -1 109, entretien:reseau_electrique -15, vente:eau 24 331, vente:electricite 45 437


#### depart — réglages actuels


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 804 | 52 349 | 17 | 100 / 0 / 38 / 37 | 191 | 4 | 67 | 87 | 18 | -3 | 0 | 0 | 1 397 | 99 066 | 74.8 | Petite ville |
| 2 | 2 804 | 52 374 | 25 | 108 / 0 / 41 / 40 | 194 | 4 | 72 | 88 | 19 | -2 | 0 | 0 | 0 | 0 | 75.1 | Petite ville |
| 6 | 2 803 | 52 499 | 26 | 108 / 0 / 40 / 40 | 194 | 4 | 72 | 90 | 19 | -2 | 0 | 0 | 0 | 0 | 75.1 | Petite ville |
| 12 | 2 803 | 52 683 | 29 | 114 / 5 / 40 / 55 | 194 | 4 | 96 | 93 | 19 | -2 | 0 | 0 | 0 | 0 | 75 | Petite ville |
| 18 | 2 804 | 53 808 | 34 | 116 / 7 / 41 / 59 | 194 | 4 | 99 | 91 | 19 | -2 | 0 | 0 | 0 | 0 | 74.9 | Ville |
| 24 | 2 804 | 54 062 | 35 | 116 / 7 / 41 / 59 | 194 | 4 | 99 | 93 | 19 | -2 | 0 | 0 | 0 | 0 | 75 | Ville |

Dernier mois — entretien par famille : dechets 10 200, electricite 18 000, eau 4 840, sante 7 530, autre 130 835, education 3 300, autre_public 9 240, parcs 450, transports 6 000, pompiers 1 700, police 1 600 ; salaires : dechets 10 488, eau 6 486, sante 16 146, education 4 554, autre_public 38 364, parcs 0, transports 14 076, pompiers 6 210, police 2 898
Lignes des modules : dechets:collecte -7 200, entretien:canalisations -969, entretien:reseau_electrique -90, exploitation:chateaux -35, exploitation:epuration -2 543, exploitation:pompage -1 037, exploitation:potabilisation -2 333, dechets:energie 3 212, dechets:recyclage 1 652, vente:eau 25 684, vente:electricite 93 141

### Avec R1 + R2 + R3

#### prudent — import_elec, logements_main, dechets


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 493 | 1 863 | 51 | 23 / 3 / 40 / 0 | 3 | 3 | 4 | -2 | 1 | -4 | 0 | 0 | 779 | 1 968 | 44.3 | Bourg |
| 2 | 3 000 | 318 | 252 | 81 / 10 / 148 / 0 | 7 | 3 | 5 | 21 | 11 | -4 | 0 | 0 | 600 | 2 397 | 33.8 | Petite ville |
| 6 | 6 074 | 535 | 604 | 208 / 16 / 349 / 0 | 19 | 7 | 17 | 25 | 52 | -4 | 0 | 0 | 0 | 375 | 9.9 | Ville |
| 12 | 7 402 | 365 | 488 | 184 / 32 / 256 / 0 | 26 | 9 | 28 | 24 | 58 | -4 | 0 | 0 | 0 | 450 | 5.9 | Ville |
| 18 | 7 712 | 654 | 310 | 135 / 36 / 144 / 0 | 35 | 9 | 28 | 24 | 45 | -4 | 0 | 0 | 0 | 0 | 5.8 | Ville |
| 24 | 7 893 | 1 696 | 526 | 208 / 35 / 275 / 0 | 39 | 9 | 28 | 26 | 61 | -4 | 0 | 0 | 0 | 0 | 6.4 | Ville |

Dernier mois — entretien par famille : dechets 2 700, electricite 8 800, eau 27 000 ; salaires : dechets 4 416, eau 23 184
Lignes des modules : achat:assainissement_exterieur -12 270, achat:eau_exterieure -14 178, achat:electricite_exterieure -50 070, dechets:collecte -3 600, entretien:canalisations -3 874, entretien:reseau_electrique -120, exploitation:pompage -3 160, exploitation:potabilisation -7 109, vente:eau 101 362, vente:electricite_exterieure 0, vente:electricite 75 872


#### typique — import_elec, logements_main, dechets


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 401 | 1 416 | 43 | 21 / 3 / 35 / 0 | 4 | 3 | 6 | -2 | 1 | -4 | 0 | 0 | 779 | 2 406 | 48.3 | Bourg |
| 2 | 2 999 | 186 | 231 | 83 / 11 / 138 / 0 | 10 | 3 | 21 | 20 | 11 | -4 | 8 | 0 | 600 | 2 061 | 46.1 | Petite ville |
| 6 | 6 497 | 288 | 600 | 225 / 20 / 357 / 0 | 19 | 8 | 45 | 25 | 39 | -4 | 9 | 0 | 0 | 567 | 14.7 | Ville |
| 12 | 7 304 | 147 | 363 | 172 / 20 / 202 / 0 | 25 | 9 | 64 | 25 | 39 | -4 | 6 | 0 | 0 | 400 | 7.4 | Ville |
| 18 | 7 943 | 246 | 311 | 179 / 20 / 164 / 0 | 37 | 9 | 83 | 24 | 52 | -4 | 4 | 0 | 0 | 600 | 6.5 | Grande ville |
| 24 | 8 420 | 161 | 458 | 227 / 25 / 253 / 0 | 44 | 9 | 83 | 25 | 62 | -4 | 5 | 0 | 0 | 600 | 6.9 | Grande ville |

Dernier mois — entretien par famille : dechets 2 700, education 9 100, electricite 8 800, transports 1 200, eau 23 150, sante 1 030 ; salaires : dechets 4 416, education 43 056, transports 4 140, eau 23 184, sante 7 728
Lignes des modules : achat:assainissement_exterieur -12 378, achat:eau_exterieure -15 101, achat:electricite_exterieure -51 283, dechets:collecte -3 600, entretien:canalisations -3 845, entretien:reseau_electrique -120, exploitation:pompage -3 180, exploitation:potabilisation -7 155, vente:eau 103 406, vente:electricite 76 696


#### ambitieux — import_elec, logements_main, dechets


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 815 | 21 | 12 | 21 / 3 / 17 / 0 | 12 | 2 | 26 | 14 | 5 | -4 | 0 | 5 | 378 | 3 870 | 58.9 | Village |
| 2 | 894 | 64 | 43 | 34 / 3 / 37 / 0 | 12 | 2 | 30 | 12 | 10 | -4 | 0 | 5 | 0 | 0 | 53.2 | Village |
| 6 | 5 754 | 127 | 507 | 201 / 21 / 316 / 0 | 22 | 6 | 47 | 25 | 17 | -4 | 16 | 10 | 900 | 1 361 | 26 | Ville |
| 12 | 8 262 | 640 | 313 | 178 / 15 / 208 / 0 | 30 | 9 | 60 | 24 | 15 | -4 | -3 | 22 | 0 | 0 | 12.1 | Ville |
| 18 | 8 742 | 3 617 | 195 | 142 / 22 / 124 / 0 | 30 | 9 | 60 | 24 | 15 | -4 | -7 | 22 | 0 | 0 | 10.7 | Grande ville |
| 24 | 8 860 | 5 009 | 346 | 198 / 27 / 208 / 0 | 30 | 9 | 60 | 26 | 15 | -4 | -4 | 22 | 0 | 0 | 10.6 | Grande ville |

Dernier mois — entretien par famille : electricite 8 800, eau 4 150, dechets 1 500, education 4 900, sante 1 030, police 1 600, parcs 3 150, transports 3 400, pompiers 1 700 ; salaires : eau 6 348, dechets 3 312, education 21 528, sante 7 728, police 8 280, parcs 2 760, transports 10 350, pompiers 0
Lignes des modules : achat:electricite_exterieure -51 707, dechets:collecte -3 600, entretien:canalisations -3 874, entretien:reseau_electrique -120, exploitation:epuration -2 487, exploitation:pompage -1 027, exploitation:potabilisation -2 311, vente:eau 25 120, vente:electricite 77 399


#### manuel — import_elec, logements_main, dechets


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 867 | 173 | 52 | 27 / 5 / 46 / 0 | 6 | 2 | 6 | -8 | 1 | -4 | 0 | 0 | 378 | 3 257 | 42.3 | Village |
| 2 | 900 | 167 | 70 | 34 / 5 / 59 / 0 | 6 | 2 | 7 | -10 | 2 | -4 | 0 | 0 | 0 | 77 | 42.3 | Village |
| 6 | 1 053 | 145 | 86 | 40 / 5 / 67 / 0 | 7 | 2 | 7 | -7 | 2 | -4 | 0 | 0 | 400 | 450 | 42.5 | Bourg |
| 12 | 1 329 | 169 | 121 | 50 / 6 / 86 / 0 | 9 | 2 | 8 | -2 | 3 | -4 | 0 | 0 | 0 | 130 | 42.7 | Bourg |
| 18 | 1 723 | 132 | 163 | 65 / 7 / 113 / 0 | 10 | 2 | 8 | -3 | 5 | -4 | 0 | 0 | 0 | 207 | 43 | Bourg |
| 24 | 2 318 | 153 | 238 | 88 / 12 / 153 / 0 | 13 | 2 | 8 | 7 | 6 | -4 | 0 | 0 | 0 | 813 | 37 | Petite ville |

Dernier mois — entretien par famille : dechets 2 700, autre 7 409, education 700, electricite 2 200 ; salaires : dechets 4 416, education 3 588
Lignes des modules : achat:assainissement_exterieur -9 378, achat:eau_exterieure -25 208, achat:electricite_exterieure -51 305, dechets:collecte -3 600, entretien:canalisations -1 109, entretien:reseau_electrique -30, vente:eau 41 680, vente:electricite 58 016


#### depart — import_elec, logements_main, dechets


| Mois | Pop. | Trésor. | Solde | Impôts R / C / I / B | Entretien bât. | Routes | Salaires | Élec. net | Eau net | Déchets net | Transp. net | Emprunts | Primes | Investi | Satisf. | Palier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 804 | 52 386 | 55 | 100 / 0 / 38 / 37 | 157 | 4 | 67 | 87 | 18 | 0 | 0 | 0 | 1 397 | 99 066 | 74.8 | Petite ville |
| 2 | 2 804 | 52 449 | 63 | 108 / 0 / 41 / 40 | 159 | 4 | 72 | 88 | 19 | 1 | 0 | 0 | 0 | 0 | 75.1 | Petite ville |
| 6 | 2 803 | 52 726 | 64 | 108 / 0 / 40 / 40 | 159 | 4 | 72 | 90 | 19 | 1 | 0 | 0 | 0 | 0 | 75.1 | Petite ville |
| 12 | 2 803 | 53 138 | 67 | 114 / 5 / 40 / 55 | 159 | 4 | 96 | 93 | 19 | 1 | 0 | 0 | 0 | 0 | 75 | Petite ville |
| 18 | 2 804 | 54 491 | 72 | 116 / 7 / 41 / 59 | 159 | 4 | 99 | 91 | 19 | 1 | 0 | 0 | 0 | 0 | 74.9 | Ville |
| 24 | 2 804 | 54 972 | 73 | 116 / 7 / 41 / 59 | 159 | 4 | 99 | 93 | 19 | 1 | 0 | 0 | 0 | 0 | 75 | Ville |

Dernier mois — entretien par famille : dechets 10 200, electricite 18 000, eau 4 840, sante 7 530, autre 96 506, education 3 300, autre_public 9 240, parcs 450, transports 6 000, pompiers 1 700, police 1 600 ; salaires : dechets 10 488, eau 6 486, sante 16 146, education 4 554, autre_public 38 364, parcs 0, transports 14 076, pompiers 6 210, police 2 898
Lignes des modules : dechets:collecte -3 600, entretien:canalisations -969, entretien:reseau_electrique -90, exploitation:chateaux -35, exploitation:epuration -2 543, exploitation:pompage -1 037, exploitation:potabilisation -2 333, dechets:energie 3 212, dechets:recyclage 1 652, vente:eau 25 684, vente:electricite 93 141
