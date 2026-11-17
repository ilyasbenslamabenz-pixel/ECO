# Prochaines étapes (brief pour une nouvelle session)

Jeu : `city-builder/` ; branche `claude/amazing-meitner-vtryts` ; artifact joueur https://claude.ai/artifact/YTQu5U1EvibeTY3fRQpexH (v34).
Publication : `npm run build`, `node scripts/pack-artifact.mjs dist <dossier>`, publier `artifact.html` + fichiers modifiés.
Règles : ne rien supprimer, ne pas changer l'architecture sans accord, aucun résultat inventé, tsc + tests avant commit.

## Demandé par le joueur, à faire
1. Fenêtres et boutons de l'interface mieux présentés (suite de la refonte : `src/ui/styles.css`, `styles-panels.css`,
   `styles-construction.css`, `buildbar.ts`).
2. Affichage des bâtiments plus détaillé par catégorie dans le menu de construction (cartes : vignette, chiffres clés,
   sous-catégories).

## Travail prêt mais non publié (worktrees `.claude/worktrees/`)
- Terrain à débloquer (carte 6 km, parcelles) : branche `worktree-agent-aaf084691e1b985a0` — à vérifier en jeu et en perf.
- Paysage, prise en main, gorge du fleuve, barrage 3D : agents arrêtés (travail partiel dans leurs worktrees).

## Connu
- Test `tests/jeu/equilibre.test.ts` « budget serré » : 454 habitants au lieu de 500 depuis le recul de façade par type.
