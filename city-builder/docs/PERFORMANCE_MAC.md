# Performances sur Mac avec GPU réel (Metal) — phase 1

Mesures du 13 novembre 2026, branche `claude/amazing-meitner-vtryts` au commit `3b391d6`, build `npm run build`
(dist : 392 fichiers, 44,23 Mo). Tous les chiffres viennent de mesures réelles, rien n'est extrapolé.

## Configuration matérielle

| Élément | Valeur |
|---|---|
| Machine | MacBook Air (M1, 2020), identifiant `MacBookAir10,1` |
| Puce | Apple M1 : CPU 8 cœurs (4 performance + 4 efficacité), GPU 7 cœurs, Metal 4 |
| RAM | 8 Go |
| macOS | 26.4.1 (build 25E253) |
| Écran | écran principal 1920 × 1080 à 60 Hz |
| Alimentation | secteur (batterie à 24 %, pas en charge) |
| Navigateur | Chromium 158.0.8127.18 (Chrome for Testing, Playwright 1.65.0, révision 1254) |
| Renderer WebGL (`UNMASKED_RENDERER_WEBGL`) | `ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)`, vendeur `Google Inc. (Apple)` |
| Options de lancement | `--use-angle=metal --enable-gpu --enable-webgl --ignore-gpu-blocklist` (sans SwiftShader) |

## Tests navigateur sur GPU

Lancement de Chromium sur GPU via une modification locale de `tests/e2e/lib.mjs`
(`channel: 'chromium'` et les options ci-dessus), annulée après les tests et jamais commitée.

| Test | 1re passe (brute) | 2e passe (favicon ignoré) | Durée (2e passe) |
|---|---|---|---|
| `npm run e2e` | échec | **OK** | 8 s |
| `npm run validate:visual` | échec | **OK** | 31 s |
| `npm run e2e:signals` | échec | **OK** | 36 s |
| `node tests/e2e/qa2-fixes.mjs` | échec | **échec** (1 vérification) | 14 s |
| `node tests/e2e/iphone-layout.mjs` | échec (1 configuration sur 8) | **OK** | 41 s |

Durées de la 1re passe : 14 s, 40 s, 37 s, 14 s et 42 s.

- **Cause commune des échecs de la 1re passe : `GET /favicon.ico` → 404.** Le Chromium complet, nécessaire
  pour avoir Metal, demande `/favicon.ico`, ce que ne fait pas le `chromium_headless_shell` utilisé avec SwiftShader.
  Comme `dist/` ne contient pas de favicon, la console affiche « Failed to load resource », que
  `collectErrors` compte comme une erreur de page. C'est un artefact du mode de lancement, pas un défaut du
  jeu. Pour la 2e passe, seule l'erreur console dont l'URL se termine par `/favicon.ico` est ignorée (même
  modification locale, annulée). Pour éviter le problème en GPU réel, on peut ajouter un favicon dans `dist/` ou
  un `<link rel="icon" href="data:,">` dans `index.html`.
- **`qa2-fixes.mjs` échoue sur une assertion périmée**, pas à cause du GPU : « journée de jeu ≈ 2.4 min
  réelles à x1 (100.0 min de jeu en 10 s) ». Le test attend entre 9 et 30 min réelles par journée, mais le
  commit `e0e12ac` a fixé la journée à 2 min 24 s à x1 (`src/shared/constants.ts`, `tests/sim/day-length.test.ts`).
  La mesure correspond exactement à la nouvelle valeur, c'est le seuil du test qu'il faut mettre à jour. Les
  autres vérifications de qa2 passent, y compris « aucune erreur de page (0) ».
- `validate:visual` sur GPU : 89 assets inspectés, 40 bâtiments. Démo prête en 2 s : 119 bâtiments,
  40 modèles distincts, 141 véhicules, 42 tronçons, 29 éléments de décor. Vue aérienne : 2 952 appels de rendu
  et 2 214 518 triangles. Vue rue : 2 139 appels et 4 972 072 triangles.
- `e2e:signals` sur GPU : 7 maillages instanciés de feux, véhicules arrêtés au rouge, lentilles allumées visibles de jour comme de nuit.

## Mesures de performance

### Méthode

- Pages `dist/index.html?demo` et `dist/index.html?stress` (ville de charge, 500 bâtiments et 1 000 véhicules
  demandés), servies par le serveur statique de `tests/e2e/lib.mjs`.
- Chromium **en fenêtre visible** (pas headless), GPU Metal, `deviceScaleFactor: 1`, viewport 1440 × 900 puis
  1920 × 1080 (même page, redimensionnée).
- Vues fixées avec `__aube.setCamera('demo-aerial' | 'demo-street')`, 4 s de stabilisation puis **20 s de mesure**
  par cas. La simulation tourne à x1 pendant toute la mesure.
- **FPS moyen** : `__aube.frames()` (images rendues par le jeu) divisé par la durée.
- **FPS min** : pire fenêtre glissante d'1 s.
- **1 % low** : 1000 ÷ durée moyenne du 1 % d'images les plus lentes.
- FPS min et 1 % low sont calculés à partir des intervalles `requestAnimationFrame`.
- **Tick sim.** : `__aube.lastStats.tickMs`, temps de tick rapporté par le worker de simulation, relevé toutes les 250 ms (moyenne et max).
- **Draw calls et triangles** : `__aube.renderStats()` (`calls`, `triangles`), relevés toutes les 250 ms, en moyenne.
- **Heap JS** : `performance.memory.usedJSHeapSize` à la fin des 20 s.
- **Piétons** : 0, non implémentés (aucun compteur dans `lastStats` ni dans `sceneCheck`).
- **Véhicules** : `lastStats.vehicles`, véhicules simulés en fin de mesure. Le nombre augmente au fil de la
  simulation, ce qui explique les écarts entre les lignes.
- Temps de chargement jusqu'à `demoReady` : **3,7 s** pour `?demo`, **4,8 s** pour `?stress`.

### Résultats

| Scénario | Vue | Fenêtre | Bâtiments | Véhicules | Piétons | FPS moy. | FPS min (1 s) | 1 % low | Pire image | Tick sim. moy. / max | Draw calls | Triangles | Heap JS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demo | aérienne | 1440×900 | 119 | 261 | 0 | 37,7 | 36,6 | 27,2 | 50,1 ms | 0,27 / 0,33 ms | 2 954 | 2,23 M | 319 Mo |
| demo | rue | 1440×900 | 119 | 428 | 0 | 39,0 | 38,0 | 28,6 | 35,2 ms | 0,38 / 0,50 ms | 2 167 | 5,34 M | 298 Mo |
| demo | aérienne | 1920×1080 | 119 | 524 | 0 | 31,1 | 30,5 | 26,8 | 50,0 ms | 0,38 / 0,46 ms | 2 902 | 2,37 M | 311 Mo |
| demo | rue | 1920×1080 | 119 | 574 | 0 | 31,1 | 30,5 | 21,1 | 50,1 ms | 0,36 / 0,86 ms | 2 159 | 5,57 M | 301 Mo |
| stress | aérienne | 1440×900 | 500 | 1 267 | 0 | 30,4 | 30,0 | 20,1 | 50,1 ms | 0,73 / 1,07 ms | 3 180 | 5,25 M | 376 Mo |
| stress | rue | 1440×900 | 500 | 1 611 | 0 | 30,4 | 29,4 | 20,9 | 66,6 ms | 0,90 / 1,27 ms | 3 253 | 7,20 M | 343 Mo |
| stress | aérienne | 1920×1080 | 500 | 1 801 | 0 | 25,0 | 24,4 | 19,6 | 52,0 ms | 0,93 / 1,14 ms | 3 143 | 5,51 M | 345 Mo |
| stress | rue | 1920×1080 | 500 | 1 939 | 0 | 25,1 | 24,8 | 19,5 | 51,7 ms | 0,86 / 1,03 ms | 3 373 | 7,38 M | 340 Mo |

Données complémentaires :

- Population en fin de mesure : 4 330 à 4 493 en démo, 5 912 à 6 480 en stress.
- Durée CPU des mises à jour de rendu par image (`renderStats().frameMs`) : 0,11 à 0,22 ms.
- Heap JS total alloué (`totalJSHeapSize`) : 366 à 430 Mo.

### Lecture

- Le **GPU est le facteur limitant** : le tick de simulation reste sous 1,3 ms et les mises à jour de rendu côté
  CPU sous 0,25 ms, alors que les FPS restent sous les 60 Hz de l'écran. Passer de 1440×900 à 1920×1080
  (+60 % de pixels) fait perdre environ 18 % de FPS : le coût dépend du remplissage des pixels autant que de la géométrie.
- Le volume de géométrie est élevé : 2 à 3,4 milliers de draw calls et 2 à 7,4 millions de triangles par image.
  La vue rue affiche 2 à 2,5 fois plus de triangles que la vue aérienne.
- Sur M1 8 Go, la démo tient environ 31 à 39 FPS et la ville de charge (500 bâtiments, environ 1 300 à
  1 900 véhicules) environ 25 à 30 FPS. Le 1 % low ne descend pas sous 19,5 FPS.
- Heure de jeu pendant les mesures : soirée (vers 19 h) pour la démo, nuit (vers 23 h 45) pour le stress.
  L'éclairage n'est donc pas identique entre les deux scénarios.

## Captures (GPU Metal, réduites pour rester sous 1 Mo)

- `captures-mac/demo-aerien-1440x900.png` (880 × 550)
- `captures-mac/demo-rue-1440x900.png` (960 × 600)
- `captures-mac/stress-aerien-1920x1080.png` (960 × 540)
- `captures-mac/stress-rue-1920x1080.png` (960 × 540)

> Rapport produit sur le Mac du propriétaire (session distante) ; le Mac n'ayant pas d'identifiants GitHub, ce fichier a été recopié tel quel dans le dépôt depuis le compte rendu. Les captures GPU (`docs/captures-mac/`) sont restées sur le Mac.

