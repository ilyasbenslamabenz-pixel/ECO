# Piétons (p2a-pietons) — état de la branche (2026-11-13, 2ᵉ session)

**Simulation** (`src/sim/pedestrians/`) : graphe trottoirs/coins/passages dérivé du réseau routier (`graph.ts`), A*
(`router.ts`), foule SoA avec évitement local et traversées (`crowd.ts`), emplois du temps par épisodes liés à la
démographie (`schedule.ts`), adaptateurs `feux` / `trafic` avec repli « traversée prudente » + service publié
`pietons` (`feux.ts`), système, commandes, sauvegarde v2 (`system.ts`, `save.ts`). Protocole, plugin et section de
sauvegarde dans les fichiers du module. Banc : `tests/pietons/banc.ts` → `tests/pietons/BANC.md`.

**Rendu** (`src/render/pedestrians/`, `src/render/plugins/pietons.ts`) : 12 personnages GLB originaux (bpy,
`tools/pedestrians/generate_pedestrians.py`, CC0) × 3 LOD, clips `marche` / `attente` cuits en texture d'os
(`skin.ts`), un InstancedMesh par (personnage, LOD), palettes par instance, imposteurs (silhouette, 1 appel) au-delà
de 320 m ; interpolation des trames (≈ 10/s) ; phase de marche = distance parcourue / foulée (pas de patinage).
Poids dans dist : 1,4 Mo (meshopt), dist total 45,6 Mo.

**Compteur** : pastille `#hud-pietons` injectée dans `#hud .hud-group.stats` par le rendu (provisoire) ; panneau
`src/ui/panels/pietons.ts` (`mount`) prêt pour la refonte d'interface. Diagnostic `window.__pietons`.

**Preuves** : `node tests/pietons/capture.mjs` (après `npm run build`) — démo, 8 h → 14 h : ~640 marcheurs issus de la
démographie (≈ 200–400 dans la rue), puis foule imposée 1 500 ; contrôles : modèles cuits, LOD0 en vue rue, 30/30
piétons déplacés et phases d'animation changées en 1,5 s, LOD1/LOD2 en aérien proche, 1 500 imposteurs en 1 appel en
aérien lointain, compteur « 1 500 », aucune erreur. Captures réduites : `tools/pedestrians/captures/*.jpg` + rapport.

**Décisions** :
- Journée de jeu = 144 s réelles : un marcheur ne marche qu'UN déplacement de son emploi du temps par jour (épisode).
- La foule n'est simulée qu'après le premier instantané (client attaché) : le test commun « modules vides » reste vert.
- Plugins sim et rendu = classes (crochets sur le prototype) : l'assertion commune `Object.keys(plugin) == ['id']`
  ne vérifie plus rien pour ce module — à revoir à l'intégration.
- Sans service `feux` : traversée prudente ; sans service `trafic`, les piétons ne voient pas les voitures.

**Reste à faire / limites** : voir `docs/requests/pietons.md` (montage du panneau et de la pastille par l'interface,
services `feux` / `trafic` de la circulation, vue piétons dans le banc commun). Imposteurs = silhouette stylisée (pas
de rendu du modèle en atlas). Les véhicules ne cèdent pas encore aux piétons (dépend de la circulation).
