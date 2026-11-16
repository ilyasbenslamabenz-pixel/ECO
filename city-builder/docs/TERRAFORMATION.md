# Terraformation, eau et barrages

Outil **Terrain** de la barre de construction, inspiré des MÉCANIQUES de Cities: Skylines II (pinceaux Élever /
Abaisser, Niveler, Adoucir, Pente ; taille, force et forme du pinceau ; sources d'eau ; barrage posé en travers d'une
vallée dont la production dépend de la chute et du débit). Aucun contenu repris : seulement les principes de jeu.

| Fichier | Rôle |
|---|---|
| `src/sim/terrain/edits.ts` | éditions du joueur (pures) : planification, coût, application ; pinceaux, pente, barrage, source |
| `src/sim/hydro/fill.ts` | solveur d'eau « remplir puis déborder » sur la grille (pur, déterministe) |
| `src/sim/hydro/system.ts` | module d'eau du worker : sources, barrages, creux reliés à l'eau, remplissage dans le temps, service `hydro` |
| `src/sim/world.ts` | commande `terrainEdit`, annulation `terrainUndo`, état `hydroState`, re-nivellement local, sauvegarde |
| `src/shared/power/model.ts`, `src/sim/power/system.ts` | centrale au pied d'un barrage : `hydroDamKw`, `hydroDamSiteCheck` |
| `src/client/tools/terrain-tool.ts` | outil client (modes, réglages, gestes, annulation) |
| `src/input/tools.ts`, `src/input/terrain-preview.ts` | gestes souris / pavé tactile / doigt, aperçu 3D |
| `src/ui/terrain-drawer.ts` | tiroir Terrain et barre d'options |
| `tests/terrain/eau-dynamique.test.ts`, `tests/e2e/terraform.mjs`, `tests/perf/terraform-bench.ts` | tests et mesure |

## 1. Utilisation (souris, pavé tactile)

Tiroir **Terrain** : Relief (Élever, Abaisser, Niveler, Adoucir, Pente), Eau (Source d'eau, Barrage, Rivière, Creuser,
Quai / remblai), Défricher. La barre d'options n'affiche que les outils du groupe courant et leurs réglages.

- **Pinceaux** (Élever, Abaisser, Niveler, Adoucir) : appuyer et glisser ; le pinceau peint en continu (une passe dès
  que le curseur a parcouru un tiers du rayon, ou toutes les 0,25 s s'il reste appuyé). Réglages : diamètre 16 à 160 m,
  force Faible / Moyenne / Forte (Élever / Abaisser : 1, 2, 4 m par passe ; Niveler / Adoucir : 25, 50, 100 % de
  l'effet), forme douce (cloche) ou dure (plein effet jusqu'à 75 % du rayon). Niveler : à la hauteur du premier point
  touché, ou à une **hauteur cible** (boutons −5 / −1 / Cible / +1 / +5 m). Aperçu : anneau du pinceau et anneau du plein
  effet, vert / orange / rouge selon la validation de la simulation, coût sous le curseur, passes et coût cumulé pendant
  le geste.
- **Pente** : clic sur un bout, clic sur l'autre : rampe régulière entre les deux hauteurs, largeur = diamètre choisi.
- **Source d'eau** : un clic pose une source (10, 25, 50 ou 100 m³/s) ; aperçu : lac prévu (surface, niveau) et
  exutoire. **Retirer** : un clic sur une source (cercles bleus).
- **Barrage** : clic sur une rive haute, clic sur la rive d'en face, en travers de la vallée ou de la rivière ; hauteur
  maximale (rive la plus basse) ou 10 / 20 / 30 m au-dessus du fond. Aperçu vert : crête, retenue (surface, niveau),
  chute, débit, production possible avec une centrale ; rouge avec la raison (trop court, en mer, vallée trop peu
  profonde, bâtiment ou route sur l'axe). Si la vallée est plus large que l'ouvrage, l'aperçu le dit (« l'eau déborde
  par un col sous la crête ») : prolongez le barrage ou relevez les rives (Élever).
- **Annuler** : Ctrl+Z (ou bouton Annuler) annule le dernier geste entier (toutes les passes d'un coup), une pente, un
  barrage, une source : relief, eau, forêt et murs d'avant, coût remboursé. Refus clair si un bâtiment ou une route a
  été construit depuis sur la zone.
- Au doigt (code conservé) : un doigt peint, deux doigts déplacent la carte ; source et barrage se confirment.

## 2. Règles et cohérence

- Pas de déformation sous un bâtiment, une route ou son talus : refus (« Un bâtiment occupe la zone : démolissez-le
  d'abord »). Les éditions modifient les hauteurs NATURELLES ; le nivellement des routes est recalculé localement
  (routes proches de la zone seulement : même résultat que le nivellement complet).
- L'eau ne recouvre jamais un bâtiment ni une chaussée (barrières du solveur) ; les bâtiments sont interdits sur l'eau
  dynamique comme sur l'eau de la carte ; une route au sol ne traverse pas une retenue : l'outil Routes propose un
  ouvrage (Pont, Viaduc, Tunnel ou **Digue**, voir §2 bis). Les profils des routes ne voient que l'eau DE BASE
  (résultat identique au rechargement).
- Coûts : terre 1,5 CHF/m³, barrage 18 CHF/m³ de béton (hauteur de l'ouvrage le long de l'axe × 10 m), source
  2 000 CHF + 150 CHF par m³/s.

## 2 bis. Digue routière (ouvrage « Digue » de l'outil Routes)

Choix `waterCrossing: 'digue'` de `buildRoad` (bouton **Digue** à côté de Pont / Viaduc / Tunnel) : au lieu d'un
ouvrage d'art, la route est posée au sol sur un remblai qui coupe la retenue.

- Le remblai est une édition du terrain `levee` (`src/sim/terrain/edits.ts`, `planLevee`) : axe = polyligne du tracé,
  crête plate de la largeur de la route + 2 m de chaque côté, à la cote de l'eau dynamique la plus haute traversée +
  1,5 m (`LEVEE_FREEBOARD`), rampes à 75 % de la pente maximale du type depuis le terrain des extrémités, talus à 1/2.
  Ne fait que remblayer ; rien au-delà des extrémités. Remblai de 30 m au plus (sinon refus : Pont, Viaduc ou Tunnel).
- Validation (`World.planLeveeFor`) : bâtiment, route ou talus sur l'emprise du remblai = refus ; la route est
  re-planifiée sur le remblai appliqué provisoirement (à blanc, rien n'est modifié). À la construction, le remblai est
  appliqué (relief naturel, re-nivellement local, eau recalculée) AVANT la route ; il est enregistré dans
  `terrainEdits` (rejoué au chargement avant les routes : mêmes profils, même eau ; test).
- Eau : plus d'eau sous la route ; des **buses** (`lk`, fixées à la pose : d'un pied de talus à l'autre tous les ~24 m)
  relient les deux côtés pour le solveur (`HydroGrid.culvert`) : même niveau de part et d'autre, pas de lac perché
  derrière la route (sans elles, la chaussée, barrière du solveur, ferait monter l'amont jusqu'au col suivant).
- Coût : volume de remblai × 4 CHF/m³ (`EDIT_COSTS.leveePerM3`, remblai compacté et enroché) + défrichage éventuel,
  ajouté au coût de la route (`cost` du résultat, aperçu compris).
- Démolir la route laisse la digue (relief) ; elle s'annule ensuite comme une édition du terrain (Annuler du tiroir
  Terrain, si c'est la dernière). Une digue ne se pose pas par la commande `terrainEdit` (refus explicite).

## 3. Barrage et électricité

Le barrage est une édition `dam` : l'axe (bande continue d'échantillons) est relevé jusqu'à la crête, deux parements
de béton (murs de quai dos à dos, rendu existant `src/render/water/quays.ts`). Crête, côté amont (eau ou terrain le plus
haut), débit de la rivière barrée (largeur mouillée × 3 m³/s par m) et minute de pose sont fixés à la pose.

La retenue se remplit avec le débit entrant (rivière barrée + sources qui l'atteignent) jusqu'à la crête, ou jusqu'au
col le plus bas si la vallée n'est pas fermée ; elle déborde ensuite par-dessus la crête (ruisseau aval).

**Centrale** : le bâtiment `elec_barrage` (onglet Énergie, kind `hydro`) posé à moins de 60 m (+ sa demi-taille) de
l'axe d'un barrage produit `P = nominale × saison × (Q / 60 m³/s) × (H / 10 m)`, plafonnée à 4 × nominale (H : chute =
retenue − aval). Physique : ρ·g·η·Q·H avec un facteur de jeu choisi pour qu'à la référence elle égale une centrale au fil
de l'eau. Ailleurs, règle d'origine inchangée (au bord d'un cours d'eau : `hydroSiteCheck`, `hydroShare`) : les
parties en cours gardent leur production. Le site est réévalué quand une mesure de barrage change (service `hydro`,
`version()`). `checkSite` connaît aussi les barrages.

## 4. Sauvegarde

Les pinceaux, pentes, barrages, sources et digues sont des éditions (`terrainEdits`, rejouées au chargement) ; champs
facultatifs (`s`, `f`, `ah`, `bh`, `h`, `up`, `q`, `t`) absents des anciennes éditions : une ancienne partie se charge à
l'identique (test). Champ facultatif `hydro: { spreadFrom }` : index de la première édition dont les creux se
remplissent d'eau voisine (absent = toutes les éditions sont antérieures : aucun remplissage nouveau). L'eau
dynamique est recalculée à la minute de la sauvegarde (temps quantifié) : même retenue après rechargement (test).

## 5. Mesures (conteneur cloud, Node, ville de charge 500 bâtiments / 195 tronçons, `npx tsx tests/perf/terraform-bench.ts`)

- Passe de pinceau (Élever r 30 m) : **4 à 8 ms** en moyenne (41,5 ms avant le re-nivellement local).
- Eau : calcul moyen **2,9 ms** (max 13 ms) par pas de remplissage (6 minutes de jeu), 100 calculs sur 600 ticks avec 5
  sources dont une cuvette en remplissage ; 0 ms en régime établi et dans une partie sans eau dynamique.
- Aperçu d'un barrage (dryRun, régime établi) : 3 à 45 ms ; d'une source : 1 à 13 ms.
- Rendu : un remplissage n'envoie qu'un patch « eau seule » (`waterOnly`) : pas de remaillage du terrain ni des talus ;
  le rendu de l'eau existant (`WaterSystem`) affiche les retenues sans changement de matériau.
