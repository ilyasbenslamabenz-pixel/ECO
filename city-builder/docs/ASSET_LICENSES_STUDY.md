# Étude des licences — bibliothèques d'assets externes (phase 2C)

Date : 2026-11-13. Objet : choisir des sources d'assets 3D/textures utilisables dans un **jeu commercial**
(Meknes City), sans obligation contraignante, et documenter la vérification **asset par asset**.

## 1. Règle retenue
- **Licence exigée : CC0 1.0** (domaine public). Aucune attribution obligatoire, usage commercial libre, modification libre.
  C'est aussi ce qu'impose le validateur du projet (`tools/assets/validate.ts` : `spdx === 'CC0-1.0'`).
- CC-BY 4.0 est **compatible** avec un usage commercial mais impose une attribution par asset (nom de l'auteur, lien, licence,
  mention des modifications). Ce n'est pas retenu pour l'instant : chaque asset CC-BY demanderait un écran de crédits
  et un suivi des modifications. À ouvrir seulement sur décision explicite, et en élargissant le validateur.
- Exclus : CC-BY-NC (non commercial), CC-BY-ND (pas de modification, donc pas de LOD ni de recompression), licences
  « éditoriales » ou propriétaires, et tout asset qui représente une **marque**, un logo ou un design déposé.
- La licence est vérifiée **sur chaque asset**, pas seulement sur le site : sur une plateforme mixte (Sketchfab, OpenGameArt),
  deux modèles voisins peuvent avoir des licences différentes.

## 2. Sources étudiées

Légende de la colonne « vérifié » :
- **en ligne** : texte de licence lu pendant cette session ;
- **API** : asset téléchargé et contrôlé via l'API officielle pendant cette session ;
- **non vérifié** : site inaccessible depuis le conteneur (politique réseau) ; l'information vient de sources secondaires et
  doit être relue sur le site officiel avant tout import.

| Source | Licence | Attribution | Usage commercial | Qualité / style | Formats | Vérifié | Retenu |
|---|---|---|---|---|---|---|---|
| **Poly Haven** (polyhaven.com) | CC0 1.0, pour tout le catalogue | non exigée | oui | photogrammétrie et modélisation réalistes, PBR complet ; très bien adapté au style du jeu ; parfois très dense (jusqu'à plusieurs millions de triangles), à réduire | glTF/FBX/blend, textures JPG/PNG/EXR, de 1k à 8k | API : métadonnées et fichiers (`api.polyhaven.com`, `dl.polyhaven.org`, contrôle md5). La page `polyhaven.com/license` est hors de la liste réseau de cette session : le CC0 du catalogue est l'hypothèse déjà retenue par le pipeline d'origine (`docs/ASSET_PIPELINE.md`) | **oui** (seule source branchée sur le pipeline) |
| **Kenney** (kenney.nl) | CC0 1.0 | non exigée (crédit facultatif ; ne pas utiliser seul le logo Kenney) | oui | low-poly stylisé à couleurs unies, souvent sans normal map : **ne suit pas** la règle de qualité « PBR albedo + normal » ni le style réaliste du jeu | glTF/GLB, FBX, OBJ | **en ligne** (page d'assistance de kenney.nl : « all game assets … public domain licensed (CC0) », « Attribution is not required », « free to use … even in commercial projects ») ; le téléchargement direct a été refusé par le proxy (403) | non (style incompatible) |
| **Quaternius** (quaternius.com) | annoncée CC0 | non exigée (d'après des sources secondaires) | oui (d'après des sources secondaires) | low-poly stylisé, peu ou pas de textures PBR : même incompatibilité de style que Kenney | glTF, FBX, OBJ, blend | **non vérifié** (hôte hors de la liste réseau). Une source secondaire évoque une interdiction de revendre les assets bruts : à vérifier dans le texte officiel | non |
| **ambientCG** (ambientcg.com) | CC0 1.0 (fichiers et images d'aperçu) | non exigée | oui | textures/matériaux PBR photo-scannés de très bonne qualité, HDRI ; peu de modèles | textures JPG/PNG 1k–16k, quelques modèles | **non vérifié** en ligne (hôte hors de la liste réseau) ; d'après la recherche web, docs.ambientcg.com/license dit que tous les assets sont en CC0 1.0 | candidat pour les **textures** (non utilisé dans ce lot) |
| **Sketchfab** (sketchfab.com) | **par modèle** : CC0, CC-BY, CC-BY-SA, CC-BY-NC, CC-BY-ND… (+ licences de la boutique) | selon la licence du modèle (CC-BY : obligatoire) | seulement CC0, CC-BY et CC-BY-SA ; jamais NC | très hétérogène : de l'excellent au très mauvais ; topologie et échelle à contrôler une par une | glTF/GLB (conversion automatique), source originale | **non vérifié** (hôte hors de la liste réseau) | non : licence à contrôler asset par asset, risque de marques (abribus, mobilier de fabricants identifiables) |
| **OpenGameArt** (opengameart.org) | par asset : CC0, CC-BY, CC-BY-SA, GPL, OGA-BY… | selon l'asset | selon l'asset ; la GPL/SA contamine la distribution | inégale, peu de 3D réaliste | variés | non vérifié (hôte hors de la liste réseau) | non |
| **Smithsonian 3D / musées (Open Access)** | CC0 pour les objets marqués « CC0 » | non | oui | scans de patrimoine, rarement du mobilier urbain | glTF, OBJ | non vérifié | non (hors sujet) |
| **Générateurs du projet** (`tools/props`, `tools/generators`…) | CC0 1.0 (œuvre originale du projet) | non | oui | contrôlée (dimensions réelles, LOD, atlas PBR) ; style « propre » moins riche qu'un scan | GLB | code source dans le dépôt | **oui** pour tout ce que Poly Haven ne propose pas |

### Ce qui bloque l'usage d'autres sources
1. **Réseau** : depuis ce conteneur, seuls `api.polyhaven.com`, `dl.polyhaven.org` et `cdn.polyhaven.com` répondent
   (kenney.nl : 403 du proxy ; quaternius.com, ambientcg.com, sketchfab.com, opengameart.org, polyhaven.com : non résolus).
2. **Pipeline** : `tools/assets/polyhaven.ts` refuse volontairement tout autre hôte, et le validateur n'accepte que deux
   sources (page Poly Haven, générateurs internes). Pour brancher ambientCG ou Kenney, il faudrait : un client dédié
   (hôte autorisé, cache avec contrôle d'intégrité), une source exacte par asset (URL de la page) et l'élargissement
   du validateur, puis ouvrir les hôtes dans l'environnement.

## 3. Vérification asset par asset (lot phase 2C)

### Poly Haven (CC0 1.0) — 5 modèles importés
Les métadonnées viennent de `api.polyhaven.com/info/<id>` (cache `.cache/polyhaven/api/`) et les fichiers de
`dl.polyhaven.org` (md5 contrôlé). Source catalogue = page exacte de l'asset.

| Id catalogue | Asset Poly Haven | Auteur(s) (API) | Publié | Licence | Retenu |
|---|---|---|---|---|---|
| `banc_modulaire` | https://polyhaven.com/a/modular_street_seating (un banc à dossier extrait du kit) | Stuart Attenborrow | 2023-09-08 | CC0 1.0 | oui |
| `jardiniere_bac_bois` | https://polyhaven.com/a/planter_box_02 | James Ray Cock | 2023-05-10 | CC0 1.0 | oui |
| `jardiniere_haute_bois` | https://polyhaven.com/a/planter_box_03 | James Ray Cock | 2023-05-12 | CC0 1.0 | oui |
| `plaque_egout` | https://polyhaven.com/a/water_manhole_cover | Raunox | 2023-11-08 | CC0 1.0 | oui |
| `separateur_beton_bas` | https://polyhaven.com/a/concrete_road_barrier_02 | Amal Kumar | 2023-11-17 | CC0 1.0 | oui |
| — | https://polyhaven.com/a/modular_chainlink_fence | James Ray Cock, Amal Kumar | 2023-11-11 | CC0 1.0 | **écarté** : l'opacité du grillage est une carte séparée que le pipeline ne fusionne pas (rendu opaque, vu sur la planche) |
| — | https://polyhaven.com/a/korean_public_payphone_01 | UM JOORIN | — | CC0 1.0 | écarté : mobilier non européen |

### Générés par le projet (CC0 1.0) — 19 modèles
Source = `tools/props/models.ts#<id>` ; géométrie paramétrique et atlas dessiné par programme (`tools/props/atlas.ts`) ;
aucun fichier tiers. La signalisation reprend les **pictogrammes génériques** de la convention de Vienne
(danger, sens interdit, STOP, passage pour piétons) et un pictogramme d'arrêt neutre, sans marque, logo, police
ni charte d'exploitant (« STOP » est tracé à la main). Les affiches sont abstraites, sans texte.
Ids : `abribus`, `abri_tram`, `totem_arret`, `panneau_danger`, `panneau_sens_interdit`, `panneau_stop`,
`panneau_passage_pieton`, `arceaux_velo`, `velo`, `banc_beton`, `poubelles_tri`, `potelet`, `barriere_vauban`,
`jardiniere_beton`, `fontaine_eau`, `colonne_morris`, `kiosque_journaux`, `borne_recharge`, `horodateur`.

Point d'attention : « Vauban » et « colonne Morris » sont des noms d'usage génériques. Les modèles ne reproduisent
le design déposé d'aucun fabricant (la fontaine n'est pas une fontaine Wallace : c'est une colonne simple).

## 4. Recommandations
1. Rester en CC0 strict (Poly Haven + générateurs) tant qu'il n'y a pas d'écran de crédits.
2. Prochaine source à brancher : **ambientCG** pour les textures (CC0, PBR de qualité). Il faut d'abord relire sa licence
   en ligne, ouvrir `ambientcg.com` dans l'environnement et adapter le client et le validateur (voir §2).
3. Ne pas utiliser Kenney ni Quaternius pour le rendu principal (style low-poly) ; envisageable pour des icônes d'interface.
4. Sketchfab : uniquement au cas par cas, avec la licence de la page du modèle archivée dans le catalogue, et jamais
   pour du mobilier de marque.

Sources consultées pendant cette session : kenney.nl (page d'assistance, en ligne) ; recherche web pour ambientCG/Quaternius
(dont docs.ambientcg.com/license cité dans les résultats) ; API Poly Haven.
