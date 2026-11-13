# Recette QA n° 5 — intégration phase 2 (PARTIELLE, en pause)

Version recettée : `origin/claude/amazing-meitner-vtryts` @ `773418f` (fusions circulation, piétons, refonte de
l'interface, mobilier, modèles transport, atmosphère, contrat municipal). Date : 2026-11-13.
Environnement : conteneur Linux 4 cœurs, Chromium + SwiftShader (rendu logiciel : FPS non représentatifs).

**Statut : recette INTERROMPUE à mi-parcours (pause pour économiser le quota, demandée par le propriétaire).**
Aucune note ni verdict final : ils seront donnés à la reprise, sur la version complète.

## Commandes exécutées (chiffres réels)

| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm test` | OK, 277/277 (22 s) |
| `npm run build` | OK, 505 fichiers, 47,93 Mo (budget 60 Mo) ; `game.js` 1,0 Mo |
| `npm run e2e` | SUCCÈS (279 s) |
| `npm run e2e:gate` | SUCCÈS (4 s) |
| `npm run validate:visual` | SUCCÈS (185 s) : 113 assets, 40 bâtiments ; démo 119 bâtiments, 141 véhicules, 42 tronçons, décor 29 ; aérien **2 975 appels**, 2,24 M triangles ; rue 2 194 appels, 5,02 M triangles |
| `node tests/e2e/qa5-iphone.mjs` (nouveau) | SUCCÈS 50/50 (portrait 390×844 et paysage 844×390) |
| `node tests/e2e/qa5-hud.mjs` (nouveau) | **ÉCHEC** (voir M1, M2) |
| `e2e:game` | interrompu en cours (contrôles passés jusque-là : sauvegarde IndexedDB) |
| `captures` | interrompu (01–04 + carrefour à feux OK) |
| Non lancés | `e2e:play`, `e2e:signals`, `ui-refonte.mjs`, `iphone-layout.mjs`, `qa5-jeu.mjs`, `qa5-ville.mjs` |

## Problèmes constatés à ce stade

### Bloquants
Aucun constaté à ce stade (recette incomplète).

### Majeurs
- **M1 — Barre supérieure qui déborde dans la démo à 1280 et 1440 px.** Réglages (menu) et Sauvegarder sont
  hors de l'écran ; le badge de notifications est coupé. Mesures : à 1440 px, `#hud` scrollWidth = 1 537 ;
  `#btn-menu` en 1495→1537 px ; à 1280 px, scrollWidth = 1 359. Le menu n'est plus accessible qu'à la touche Échap.
  Cause probable : sous-titre long « Aube-sur-Mer (démonstration) » + montants « +97 046 CHF / mois ». Une partie
  dont les chiffres grandissent risque le même débordement (non mesuré).
  Reproduction : `dist/index.html?demo` en 1440×900 → regarder l'extrémité droite de la barre ;
  `node tests/e2e/qa5-hud.mjs` (captures `tests/e2e/out/qa5/hud-demo-1440.png`).
- **M2 — Météo non branchée sur la barre supérieure.** Le module météo (phase 2C) est fusionné et simule
  (« Ensoleillé 11,6 °C, printemps » dans la démo, 8,6 °C en partie), mais `#hud-weather` reste grisé
  « — 2C » avec l'info-bulle « aucune valeur affichée tant qu'elle n'est pas simulée ». La référence d'interface
  demande icône + température. Reproduction : n'importe quelle partie ; comparer
  `pluginCommand { plugin: 'weather', name: 'state' }` au contenu de `#hud-weather` (`qa5-hud.mjs`).

### Mineurs
- **m1 — Variation de population = population totale** : la démo affiche « 4 323 +4 323 » (variation mesurée
  depuis 0 au chargement ?). Reproduction : `?demo`, barre supérieure.
- **m2 — Anciens noms visibles** : nom de ville par défaut « Nouvelle-Aube », ville de démo « Aube-sur-Mer ».
  Ce ne sont pas le nom du jeu (« Meknes City » est bien affiché), mais ils rappellent l'ancien nom.
- **m3 — Documentation non mise à jour** : `PROJECT_STATUS.md` et `FEATURES.md` décrivent encore la phase 1
  (titre « Aube Urbaine », piétons et mobilier « à faire ») alors que 2A/2B(1)/2C(3, 4) sont fusionnés.
- **m4 — Appels de rendu inchangés** : 2 975 en vue aérienne (phase 1 : 2 987). La réduction prévue en 2C (atlas,
  culling) n'est pas faite ; à noter, pas une régression.
- **m5 — Arbres d'alignement plantés au milieu du trottoir** de l'avenue (`demo-rue.png`) : le tronc barre le
  passage des piétons (à confirmer sur les captures de piétons).

## Constaté conforme
- Titre et logo « Meknes City » ; montants en CHF (« 11,6 M CHF », « +97 046 CHF / mois ») ; aucun « ¢ » vu.
- Fonctions non faites grisées avec leur phase : Zones/Énergie/Eau/Déchets/Terrain « 2B », Politiques/Recherche
  « 2C », Arrêt de bus/Tramway/Port/Aéroport « Phase 2C » ; Objectifs « 2C ».
- iPhone portrait et paysage : rien hors écran, aucun chevauchement, cibles ≥ 40 px, 6 tableaux de bord actifs
  ouverts en feuille, 10 sous-barres d'outils dans l'écran, vitesses au doigt, mini-carte, 0 erreur console.
- Bureau, partie neuve : barre supérieure entière de 1280 à 1920 px.

## Scripts de la recette (tests/e2e/)
- `qa5-hud.mjs` — barre supérieure de 1280 à 1920 px (partie et démo), météo affichée vs simulée.
- `qa5-iphone.mjs` — iPhone portrait et paysage au doigt : débordements, chevauchements, cibles, chaque tableau et outil.
- `qa5-jeu.mjs` — (non exécuté) partie par le menu : routes droites/courbes, rangée de maisons alignées,
  bulldozer, vitesses ×1→×16 mesurées, sauvegarde/rechargement/chargement, démo depuis le menu.
- `qa5-ville.mjs` — (non exécuté) démo : piétons sur trottoirs / passages et respect des feux piétons,
  circulation multi-voies, météo forcée (pluie, neige, brouillard, orage), appels de rendu.

## À faire à la reprise
Lancer `e2e:game`, `e2e:play`, `e2e:signals`, `ui-refonte.mjs`, `iphone-layout.mjs`, `captures`, `qa5-jeu.mjs`,
`qa5-ville.mjs` ; regarder toutes les captures ; comparer à `docs/ui/reference-interface.png` ; note /10 et verdict.
