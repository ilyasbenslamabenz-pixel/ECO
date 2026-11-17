# Prochaines étapes (brief pour une nouvelle session)

Jeu : `city-builder/` ; branche `claude/amazing-meitner-vtryts` ; artifact joueur https://claude.ai/artifact/YTQu5U1EvibeTY3fRQpexH (v35).
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
- `tests/e2e/interface-iphone.mjs` : « fiche sur 390 px sans débordement » échoue (1 élément hors écran), déjà avant la
  refonte du menu de construction.
- Test `tests/jeu/equilibre.test.ts` « budget serré » : 454 habitants au lieu de 500 depuis le recul de façade par type.
