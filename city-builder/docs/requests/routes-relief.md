# Routes et relief — état et reste à faire

Branche `claude/routes-relief`. Détails techniques : `src/sim/roads/README.md` (section « Relief »), captures :
`docs/captures-routes-relief/` (avant / après).

## Livré
- Talus maillés raccordés au terrain (herbe, sable au bord de l'eau, terre en déblai) et murs de soutènement (quai, remblai
  haut, déblai profond) ; nivellement du terrain sous le talus. Défaut « dalle surélevée sur la plage » corrigé.
- Hauteur imposée ▲ / ▼ (pas de 4 m, ±40 m) dans la barre de l'outil Routes, aperçu 3D, viaducs et passages dénivelés sans
  carrefour (6 m minimum), piles hors des routes croisées.
- Tunnels (route abaissée, couverture ≥ 6,5 m) avec portails et revêtement intérieur.
- Culées de pont (mur de front, sommier, murs en aile).
- Giratoires Ø 36 / 56 m posés d'un clic (carrefour ou route), îlot planté, anneau prioritaire.
- Sauvegardes : champs facultatifs, anciennes sauvegardes chargées (testé).

## Reste à faire
- Vérifier à l'œil, en jeu, l'aperçu 3D d'un tracé surélevé (test unitaire vert, capture prise avant le retour du dryRun).
- Raccourcis clavier ▲ / ▼ (PageUp / PageDown) ; « Annuler » ne défait pas un giratoire.
- Grille de terrain de 8 m : remblai grossier sous les abouts de pont, façades de tunnel parfois en saillie du relief.
- Hauteur imposée sur une polyligne (tracé continu de l'autre session) : non testée avec son code.
- Validation par le module circulation des deux lignes ajoutées (`traffic/adapters.ts`, `traffic/network.ts` :
  anneau de giratoire prioritaire, entrées en cédez-le-passage).
- Teinte du talus (`#9aae6c`) réglée sur une seule capture : à revoir selon la lumière et les saisons.
