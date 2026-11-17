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
- Corrigé : « budget serré » (seuil 430 habitants, lots calés sur la trame) ; iPhone « fiche sur 390 px » (animation
  verticale des panneaux sur téléphone) ; e2e:game / e2e:play (nom d'emplacement et « Façade » en majuscule).
- Gameplay mesuré (`tests/perf/equilibre-economie.ts --debug --sauver=…`) : passé ~1 500 habitants, l'industrie
  consomme l'essentiel du courant (12,9 MW sur 19,9 MW à 7 000 hab.) ; sans centrale à gaz, tout l'industriel est
  délesté → chômage 30–47 %, satisfaction 11–18, départs. L'indice de croissance affiche maintenant « need-power ».
