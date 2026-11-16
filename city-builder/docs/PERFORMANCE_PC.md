# Performances sur PC portable à GPU intégré

Cible : PC portable Windows, Edge, fenêtre 1280 × 800 à densité 1,5, GPU Intel intégré.
Mesures du 16 novembre 2026, branche de travail partie de `3743fb8`.

## À lire d'abord : ce qui est mesuré, et ce qui ne l'est pas

Toutes les mesures ci-dessous viennent de **Chromium headless avec SwiftShader**, un rendu **logiciel** sur le
processeur. Ses temps GPU et ses images par seconde (0,1 à 0,5 img/s) ne disent rien d'un GPU Intel. On rapporte
donc surtout ce qui ne dépend pas du GPU :

- **appels de dessin** et **triangles** par image (`renderer.info`, ombres comprises) ;
- **temps processeur des mises à jour** (culling, LOD, instances des bâtiments, de la végétation, des véhicules et
  des piétons) : `__aube.cpuFrames`, médiane de 15 images, GPU attendu avant chaque image (`gl.finish`) ;
- **densité de rendu** (taille du canevas) et **palier de qualité** atteint.

Le temps « rendu three » (préparation et envoi des commandes) est aussi relevé, mais il est très bruité sous
SwiftShader (9 à 53 ms pour des scènes semblables) : on ne s'en sert pas pour conclure.

Aucun gain d'img/s n'est annoncé pour le GPU Intel : il faut une mesure sur la machine. La page `?bench` produit
maintenant un **rapport court** à copier (voir plus bas).

## Méthode

Script : `node tests/e2e/perf-pc.mjs <étiquette> "<paramètres d'adresse>"`, après `npm run build`
(résultat brut : `tests/e2e/out/perf-pc-<étiquette>.json` ; copies des passages de ce document dans `docs/perf-pc/`). `PERF_DIST=<dossier>` sert un autre build.

- Fenêtre 1280 × 800, `deviceScaleFactor` 1,5, agent utilisateur Edge 131 sur Windows.
- Scènes :
  - **demo** : ville moyenne (`?demo`, 126 bâtiments, ≈ 8 800 plantes, 70 à 130 véhicules simulés) ;
  - **stress** : grande ville (`?stress`, 500 bâtiments, ≈ 17 200 plantes, 330 à 480 véhicules simulés au moment de
    la mesure ; ils sont créés au fil de la simulation, d'où des écarts entre passages).
- Vues : **aérienne** (vue de la démo, 560 m de la cible), **rue**, **large** (900 m, inclinaison 0,7).
- Par vue : 4 s de boucle d'affichage (la résolution et les paliers s'adaptent), puis boucle suspendue, 3 images,
  mesure des appels / triangles, `cpuFrames(15, 0)` (caméra fixe) puis `cpuFrames(15, 0.02)` (caméra qui tourne :
  recalcul des instances à chaque image).
- « Avant » : build de `3743fb8` (copie de `dist/`). « Après » : build de cette branche. Le GPU intégré est simulé
  par `?gpu=integre` (SwiftShader n'est pas reconnu comme tel).

## Résultats bruts

Colonnes : densité de rendu (« ? » : non exposée par l’ancien build) et canevas en fin de vue ; palier (0 élevé … 3 minimal) ; appels de dessin ; triangles ;
CPU des mises à jour, caméra fixe / en mouvement ; CPU « rendu three » (bruité, voir plus haut) ; véhicules dessinés ;
img/s de la boucle sous SwiftShader (indicatif seulement).

### Qualité Auto (réglage par défaut)

« avant » = qualité Auto de `3743fb8` ; « après » = qualité Auto avec GPU intégré (`?gpu=integre`). Sous SwiftShader,
la cadence est toujours trop basse : les deux versions descendent au plus bas de ce qu'elles savent faire
(avant : densité 0,9 ; après : densité 1, puis palier 3).

Synthèse, avant → après (final), mêmes scènes :

| Scène | Vue | Canevas avant → après | Appels avant → après | Triangles avant → après | CPU màj fixe / mouv. avant → après (ms) |
|---|---|---|---|---|---|
| demo | aerienne | 1152x720 → 1280x800 | 905 → 766 (−15 %) | 1,12 M → 637 k (−43 %) | 0,3 / 0,8 → 0,4 / 0,6 |
| demo | rue | 1152x720 → 1280x800 | 788 → 724 (−8 %) | 1,87 M → 1,44 M (−23 %) | 0,3 / 0,3 → 0,2 / 0,2 |
| demo | large | 1152x720 → 1280x800 | 856 → 782 (−9 %) | 859 k → 580 k (−32 %) | 0,4 / 0,7 → 0,4 / 0,6 |
| stress | aerienne | 1152x720 → 1280x800 | 1093 → 909 (−17 %) | 2,17 M → 1,17 M (−46 %) | 0,7 / 1,3 → 0,5 / 1 |
| stress | rue | 1152x720 → 1280x800 | 1195 → 1118 (−6 %) | 3,2 M → 2,33 M (−27 %) | 0,6 / 0,5 → 0,5 / 0,5 |
| stress | large | 1152x720 → 1280x800 | 1244 → 1057 (−15 %) | 1,71 M → 1,28 M (−25 %) | 1 / 1,2 → 0,5 / 0,8 |

Tableau complet (« après v2 » : paliers sans coupure des ombres du décor routier ; « après v3 » : avec, y compris en vue rue ; « après (final) » : décor routier de nouveau ombré quand la caméra est au niveau de la rue) :

| Mesure | Scène | Vue | Densité (canevas) | Palier | Appels | Triangles | CPU màj fixe / mouv. (ms) | CPU rendu three fixe / mouv. (ms) | Véhicules dessinés | img/s SwiftShader |
|---|---|---|---|---|---|---|---|---|---|---|
| avant | demo | aerienne | ? (1152x720) | — | 905 | 1,12 M | 0,3 / 0,8 | 25,1 / 40 | 133 | 0,5 |
| avant | demo | rue | ? (1152x720) | — | 788 | 1,87 M | 0,3 / 0,3 | 13,5 / 18,5 | 45 | 0,3 |
| avant | demo | large | ? (1152x720) | — | 856 | 859 k | 0,4 / 0,7 | 14,4 / 25 | 105 | 0,4 |
| avant | stress | aerienne | ? (1152x720) | — | 1093 | 2,17 M | 0,7 / 1,3 | 50,5 / 36,9 | 647 | 0,2 |
| avant | stress | rue | ? (1152x720) | — | 1195 | 3,20 M | 0,6 / 0,5 | 23,5 / 28,3 | 289 | 0,3 |
| avant | stress | large | ? (1152x720) | — | 1244 | 1,71 M | 1 / 1,2 | 31,2 / 34,9 | 334 | 0,3 |
| après v2 | demo | aerienne | 1 (1280x800) | 3 | 841 | 753 k | 0,3 / 0,6 | 21,2 / 28,6 | 125 | 0,4 |
| après v2 | demo | rue | 1 (1280x800) | 3 | 730 | 1,49 M | 0,3 / 0,4 | 10,8 / 18,4 | 69 | 0,3 |
| après v2 | demo | large | 1 (1280x800) | 3 | 819 | 600 k | 0,3 / 0,6 | 18,1 / 23,1 | 85 | 0,4 |
| après v2 | stress | aerienne | 1 (1280x800) | 3 | 1030 | 1,32 M | 0,7 / 1,3 | 52,7 / 30 | 250 | 0,2 |
| après v2 | stress | rue | 1 (1280x800) | 3 | 1114 | 2,32 M | 0,4 / 0,4 | 16,5 / 25,5 | 213 | 0,3 |
| après v2 | stress | large | 1 (1280x800) | 3 | 1209 | 1,41 M | 0,6 / 1,1 | 22,6 / 31,8 | 242 | 0,4 |
| après v3 | demo | aerienne | 1 (1280x800) | 3 | 766 | 643 k | 0,3 / 0,8 | 19,2 / 31,3 | 136 | 0,5 |
| après v3 | demo | rue | 1 (1280x800) | 3 | 687 | 1,43 M | 0,2 / 0,3 | 8,1 / 16,8 | 50 | 0,3 |
| après v3 | demo | large | 1 (1280x800) | 3 | 786 | 598 k | 0,4 / 0,7 | 15,8 / 21,7 | 122 | 0,5 |
| après v3 | stress | aerienne | 1 (1280x800) | 3 | 913 | 1,18 M | 0,7 / 1,2 | 19,1 / 35,5 | 250 | 0,4 |
| après v3 | stress | rue | 1 (1280x800) | 3 | 998 | 2,14 M | 0,7 / 0,6 | 18,1 / 26,5 | 236 | 0,3 |
| après v3 | stress | large | 1 (1280x800) | 3 | 1057 | 1,30 M | 0,8 / 1,4 | 24,5 / 32,5 | 116 | 0,4 |
| **après (final)** | demo | aerienne | 1 (1280x800) | 3 | 766 | 637 k | 0,4 / 0,6 | 17,8 / 29,9 | 133 | 0,3 |
| **après (final)** | demo | rue | 1 (1280x800) | 3 | 724 | 1,44 M | 0,2 / 0,2 | 9 / 16,9 | 49 | 0,3 |
| **après (final)** | demo | large | 1 (1280x800) | 3 | 782 | 580 k | 0,4 / 0,6 | 15,3 / 25,1 | 97 | 0,5 |
| **après (final)** | stress | aerienne | 1 (1280x800) | 3 | 909 | 1,17 M | 0,5 / 1 | 21,9 / 31,7 | 250 | 0,4 |
| **après (final)** | stress | rue | 1 (1280x800) | 3 | 1118 | 2,33 M | 0,5 / 0,5 | 17,7 / 27,4 | 225 | 0,3 |
| **après (final)** | stress | large | 1 (1280x800) | 3 | 1057 | 1,28 M | 0,5 / 0,8 | 23,9 / 31,2 | 122 | 0,4 |

Une toute première version (véhicules masqués au-delà de 420 m au palier 3) dessinait 11 véhicules en vue aérienne de la démo et 0 en vue large : rues vides, rejetée (journal brut : `docs/perf-pc/apres-auto-v1-vehicules420m.log`).

### Palier 0 imposé (`?palier=0`, GPU intégré) : contrôle « rien ne change au palier élevé »

| Mesure | Scène | Vue | Densité (canevas) | Palier | Appels | Triangles | CPU màj fixe / mouv. (ms) | CPU rendu three fixe / mouv. (ms) | Véhicules dessinés | img/s SwiftShader |
|---|---|---|---|---|---|---|---|---|---|---|
| avant | demo | aerienne | ? (1152x720) | — | 905 | 1,12 M | 0,3 / 0,8 | 25,1 / 40 | 133 | 0,5 |
| avant | demo | rue | ? (1152x720) | — | 788 | 1,87 M | 0,3 / 0,3 | 13,5 / 18,5 | 45 | 0,3 |
| avant | demo | large | ? (1152x720) | — | 856 | 859 k | 0,4 / 0,7 | 14,4 / 25 | 105 | 0,4 |
| avant | stress | aerienne | ? (1152x720) | — | 1093 | 2,17 M | 0,7 / 1,3 | 50,5 / 36,9 | 647 | 0,2 |
| avant | stress | rue | ? (1152x720) | — | 1195 | 3,20 M | 0,6 / 0,5 | 23,5 / 28,3 | 289 | 0,3 |
| avant | stress | large | ? (1152x720) | — | 1244 | 1,71 M | 1 / 1,2 | 31,2 / 34,9 | 334 | 0,3 |
| apres-p0 | demo | aerienne | 1 (1280x800) | 0 | 905 | 1,12 M | 0,3 / 0,5 | 26,7 / 34,5 | 136 | 0,5 |
| apres-p0 | demo | rue | 1 (1280x800) | 0 | 800 | 1,96 M | 0,4 / 0,4 | 13,4 / 19,7 | 50 | 0,3 |
| apres-p0 | demo | large | 1 (1280x800) | 0 | 860 | 862 k | 0,3 / 0,6 | 23,1 / 30,6 | 109 | 0,4 |
| apres-p0 | stress | aerienne | 1 (1280x800) | 0 | 1100 | 2,22 M | 0,5 / 1 | 24,1 / 36,7 | 639 | 0,4 |
| apres-p0 | stress | rue | 1 (1280x800) | 0 | 1187 | 3,17 M | 0,8 / 0,7 | 22,3 / 27,3 | 285 | 0,3 |
| apres-p0 | stress | large | 1 (1280x800) | 0 | 1223 | 1,80 M | 0,7 / 1,1 | 25,4 / 33,6 | 429 | 0,4 |

### Qualité Haute (`?qualite=haute`) : contrôle « le joueur peut toujours forcer la qualité haute »

| Mesure | Scène | Vue | Densité (canevas) | Palier | Appels | Triangles | CPU màj fixe / mouv. (ms) | CPU rendu three fixe / mouv. (ms) | Véhicules dessinés | img/s SwiftShader |
|---|---|---|---|---|---|---|---|---|---|---|
| avant-haute | demo | aerienne | ? (1920x1200) | — | 908 | 1,12 M | 0,5 / 1 | 33,8 / 38,7 | 125 | 0,3 |
| avant-haute | demo | rue | ? (1920x1200) | — | 746 | 1,76 M | 0,4 / 0,3 | 14,1 / 17,9 | 30 | 0,2 |
| avant-haute | demo | large | ? (1920x1200) | — | 850 | 835 k | 0,3 / 0,6 | 18 / 25,1 | 73 | 0,2 |
| avant-haute | stress | aerienne | ? (1920x1200) | — | 1091 | 2,14 M | 0,8 / 1,5 | 40,3 / 44,6 | 639 | 0,2 |
| avant-haute | stress | rue | ? (1920x1200) | — | 1163 | 2,92 M | 0,8 / 0,8 | 21,5 / 32,9 | 186 | 0,1 |
| avant-haute | stress | large | ? (1920x1200) | — | 1216 | 1,79 M | 0,8 / 1,3 | 20,2 / 32,6 | 352 | 0,2 |
| apres-haute | demo | aerienne | 1,5 (1920x1200) | 0 | 905 | 1,11 M | 0,6 / 1 | 26,9 / 32,9 | 122 | 0,1 |
| apres-haute | demo | rue | 1,5 (1920x1200) | 0 | 757 | 1,75 M | 0,3 / 0,3 | 9,1 / 18,2 | 33 | 0,2 |
| apres-haute | demo | large | 1,5 (1920x1200) | 0 | 876 | 836 k | 0,2 / 0,5 | 16,3 / 25,4 | 61 | 0,3 |
| apres-haute | stress | aerienne | 1,5 (1920x1200) | 0 | 1084 | 2,17 M | 0,6 / 1 | 33,8 / 36,2 | 639 | 0,2 |
| apres-haute | stress | rue | 1,5 (1920x1200) | 0 | 1166 | 2,82 M | 0,7 / 0,7 | 27 / 28,8 | 115 | 0,1 |
| apres-haute | stress | large | 1,5 (1920x1200) | 0 | 1211 | 1,84 M | 0,9 / 1,6 | 29,9 / 30,5 | 518 | 0,2 |

## Lecture

- **Qualité Auto, GPU intégré, palier atteint (3)** : −15 à −17 % d'appels de dessin et −43 à −46 % de triangles en vue
  aérienne (moyenne et grande ville), −15 % / −25 % en vue large de la grande ville, −6 à −8 % d'appels et −23 à −27 % de
  triangles en vue rue. Les appels viennent surtout des ombres coupées (décor routier et bordures : 146 → 12 appels
  d'ombre pour les routes de la grande ville en vue aérienne, d’après `drawBreakdown`, estimation statique par groupe), de la végétation (ombres des LOD
  lointains) et du plafond de véhicules ; les triangles, des LOD de bâtiments et de végétation rapprochés.
- **Pixels** : sur l'écran cible, la qualité Auto rend désormais au départ 1600 × 1000 (1,6 M pixels) au lieu de
  1920 × 1200 (2,3 M), soit −31 %, avant toute adaptation. Sous SwiftShader, l'ancienne version finissait plus bas
  (1152 × 720, densité 0,9) que la nouvelle (1280 × 800, plancher 1) : la nouvelle préfère baisser le palier plutôt que
  rendre une image floue. Sur un vrai GPU Intel, le palier et la densité atteints dépendront de la cadence réelle.
- **Palier 0 imposé et qualité Haute** : appels et triangles identiques à l'avant aux écarts de simulation près
  (±3 % : nombre de véhicules et position des piétons au moment de la mesure). Le joueur qui choisit Haute retrouve
  exactement l'ancien rendu (densité 1,5, carte d'ombre de son réglage, aucun palier).
- **Processeur** : les mises à jour de rendu restent sous 1,5 ms par image (0,2 à 1,4 ms), caméra en mouvement
  comprise, avant comme après : le processeur n'est pas le facteur limitant ; le surcoût du contrôleur de paliers
  et du plafond de véhicules n'est pas mesurable à cette échelle.
- **Non mesuré** : img/s, 1 % bas et temps GPU sur un GPU Intel (SwiftShader n'est pas représentatif).

## Ce qui a été fait

1. **Détection du GPU intégré** (`src/render/device-profile.ts`) : nom du GPU lu une fois (`WEBGL_debug_renderer_info`
   dans un petit contexte jetable, ordinateur seulement) ; Intel HD / UHD / Iris (pas les Arc A3xx–A7xx dédiées),
   AMD « Radeon Graphics » / Vega d'APU. `?gpu=integre` / `?gpu=dedie` forcent le choix.
2. **Densité plafonnée à 1,25 en qualité Auto sur GPU intégré** (au lieu de 1,5) : 1600 × 1000 pixels au lieu de
   1920 × 1200 sur l'écran cible (−31 % de pixels). La résolution dynamique ne remonte jamais au-dessus, et son
   plancher est 1 (en dessous, l'image d'un écran 1,5× devient floue). Avec la densité 1,25, l'anticrénelage
   « auto » reste désactivé (comme à 1,5). Haute et Moyenne choisies à la main : inchangées.
3. **Paliers de qualité automatiques** (`src/render/quality-tiers.ts`, qualité Auto sur ordinateur) :

   | Palier | Carte d'ombre max | Ombres des petits objets coupées au-delà de | Ombre végétation | LOD bâtiments | Distances végétation | Véhicules max / distance | Piétons |
   |---|---|---|---|---|---|---|---|
   | 0 élevé | réglage du joueur | 320 m | tous LOD | × 1 | × 1 | sans limite | 1 400 m |
   | 1 moyen | 2048 | 200 m (+ bordures et décor routier, sauf caméra au niveau de la rue) | LOD 0–1 | × 0,8 | × 0,85 | 600 / 1 800 m | 500 m |
   | 2 réduit | 1024 | 140 m (idem) | LOD 0–1 | × 0,65 | × 0,7 | 400 / 1 400 m | 260 m |
   | 3 minimal | 1024 | 90 m (idem) | LOD 0 | × 0,5 | × 0,55 | 250 / 1 100 m | 160 m |

   Ordre d'adaptation (`src/render/scene.ts`) : quand la cadence décroche, la **résolution baisse d'abord** jusqu'à
   son plancher, **puis le palier** descend ; quand la cadence a de la marge, le **palier remonte d'abord**, puis la
   résolution. Anti-scintillement : une descente de palier au plus toutes les 4 s, 12 s de cadence tenue (et 20 s
   après la dernière baisse) avant une montée, pas de retour vers un palier qui a décroché dans les 2 dernières
   minutes. Un changement de palier ne recompile aucun shader (seule la carte d'ombre est recréée).
   Plafond de véhicules : sans tri, par une distance de coupure qui se resserre / se relâche de quelques % par image
   (les plus proches restent, seuls les plus lointains apparaissent ou disparaissent).
   `?palier=0..3` impose un palier fixe (mesures). Qualités Haute / Moyenne / Basse : palier 0, réglages d'avant.
4. **Page `?bench`** : bloc « Rapport à m'envoyer » en tête des résultats, avec bouton « Copier le rapport » :
   configuration (GPU, intégré ou non, navigateur, fenêtre, densité, qualité, paliers, ombres, anticrénelage) et, par
   scène, img/s moyennes, **1 % bas**, appels de dessin, triangles, **palier**, densité. Le tableau détaillé gagne
   les colonnes « 1 % bas » et « palier », et des liens « Palier fixe 0 / 3 » et « Paliers automatiques ».
5. Réglages : libellé « Auto (s'adapte à l'appareil et à la cadence) ». Aucun réglage retiré.

## Ce qui n'a pas été fait

- **Imposteurs de bâtiments lointains** : non faits. Les bâtiments ont déjà trois LOD et le palier rapproche leurs
  bascules ; les imposteurs demanderaient un atlas par modèle et une validation visuelle.
- **Cascades d'ombre** : non faites (une seule carte d'ombre qui suit la vue, inchangée). Le palier n'agit que sur sa
  taille et sur les objets qui y projettent une ombre.
- Les temps GPU et img/s sur un vrai GPU Intel n'ont pas été mesurés (pas de machine) : à faire avec `?bench`.

## Comment mesurer sur le PC

1. Ouvrir le jeu avec `?bench` (ou le lien « Mesurer les performances » sous le menu), laisser l'onglet au premier plan
   environ 1 min 30.
2. Cliquer « Copier le rapport » et coller le texte dans un message. Pour comparer : liens « Relancer en Haute »,
   « Palier fixe 0 (élevé) », « Palier fixe 3 (minimal) ».
