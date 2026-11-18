# Prochaines étapes (brief pour une nouvelle session)

Jeu : `city-builder/` ; branche `claude/amazing-meitner-vtryts` ; artifact joueur https://claude.ai/artifact/YTQu5U1EvibeTY3fRQpexH (v36).
Publication : `npm run build`, `node scripts/pack-artifact.mjs dist <dossier>`, publier `artifact.html` + fichiers modifiés.
Règles : ne rien supprimer, ne pas changer l'architecture sans accord, aucun résultat inventé, tsc + tests avant commit.

## Demandé par le joueur
1. FAIT (publié en v35) — menu de construction : surface mate, onglets homogènes, raccourcis en pointillés ; sur téléphone
   les boutons Calques/Carte ne recouvrent plus le tiroir et les onglets Services tiennent sur une rangée.
2. FAIT (publié en v35) — cartes détaillées : badges empreinte/variantes, coût + entretien, chiffres clés en pastilles
   (`card-info.ts` › `stats`), dépendance en note neutre ; sous-catégories titrées (`src/ui/build-groups.ts`).
   Captures : `node tests/e2e/cap-tiroirs.mjs <préfixe> [dossier]`.
   Reste possible : le reste des fenêtres (panneaux) avec le même langage.

## Travail prêt mais non publié (worktrees `.claude/worktrees/`)
- Terrain à débloquer (carte 6 km, parcelles) : branche `worktree-agent-aaf084691e1b985a0` — à vérifier en jeu et en perf.
- Paysage, prise en main, gorge du fleuve, barrage 3D : agents arrêtés (travail partiel dans leurs worktrees).

## Connu
- Corrigé : « budget serré » (seuil 430 habitants, lots calés sur la trame) ; iPhone « fiche sur 390 px » (animation
  verticale des panneaux sur téléphone) ; e2e:game / e2e:play (nom d'emplacement et « Façade » en majuscule).
- Gameplay mesuré (`tests/perf/equilibre-economie.ts --debug --sauver=…`) : passé ~1 500 habitants, l'industrie
  consomme l'essentiel du courant (12,9 MW sur 19,9 MW à 7 000 hab.) ; sans centrale à gaz, tout l'industriel est
  délesté → chômage 30–47 %, satisfaction 11–18, départs. L'indice de croissance affiche maintenant « need-power ».

## Priorité joueur (17/11) : ORDINATEUR seulement, fluidité au maximum
- Le joueur a abandonné le mobile. Machine : PC Windows, GPU Intel intégré, Edge, 1280×755 densité 1,5.
- Fait (v36) : résolution dynamique + paliers aussi en qualité Moyenne sur GPU intégré, ombres 1 image sur 2,
  baisse de régime électrique, fiche bâtiment sans chevauchement. À faire : nouvelle mesure ?bench du joueur.

## Audit complet (18/11)
- `npm run e2e:audit` (tests/e2e/audit-jeu.mjs) : 31 contrôles à la souris, tout le jeu sur ordinateur — 31/31.
- Toutes les suites e2e PC passent (smoke, interface-pc, terraform, gate, game, play, problemes, signals, routes,
  electricite, zonage, dechets, actions). Restent en échec : parties iPhone de tests/construction/demo.mjs (mobile
  abandonné par le joueur).
- Non reproduit : source d'eau « lac prévu 0 m² » dans un cratère de la partie du joueur → demander l'export .meknes.

## Identité visuelle (refonte du design)

- Feuille `src/ui/styles-identite.css`, chargée en dernier par `scripts/build.mjs` : aucune règle existante retirée ; elle redéfinit les jetons (thèmes nuit/sombre et clair) et l'habillage.
- v41 : palette chaude « Meknès » (brun, laiton) — refusée par le joueur (« j'aime pas le marron »).
- v42 : palette froide inspirée de l'esprit des city-builders récents : ardoise bleutée, texte blanc, accent cyan (sélection et action principale), vert / corail pour bon / problème, couleurs de catégorie franches sur les outils. Angles 4–6 px, en-têtes de fenêtre en bandeau, surfaces quasi opaques sans flou (fluidité iGPU), anneau cyan pour le guidage du tutoriel.
- Typographie : Barlow (interface), Barlow Condensed (chiffres, intitulés de section). Polices SIL OFL intégrées en data: URI (`src/ui/fonts/`), aucun serveur tiers.
- Vérifié : tsc, 753 tests unitaires, e2e interface PC, audit 31/31.
