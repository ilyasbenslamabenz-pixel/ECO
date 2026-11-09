# Bibliothèque de modèles 3D (Blender headless)

Les modèles 3D d'ECO NATION (véhicules, rames, avions, navires, portiques, éolienne, mobilier urbain,
arbres, équipements de toiture) sont produits par des scripts Python reproductibles exécutés avec
Blender en module (`bpy`), sans interface. Ils sont exportés en glTF binaire dans
`client/public/assets/models/`, décrits par `manifest.json`, et chargés côté client par
`client/src/game/modelLibrary.ts`.

## Installation

```sh
python3 -m venv /chemin/bpyenv
/chemin/bpyenv/bin/pip install bpy==5.2.3        # Python 3.13
# Aperçus Workbench : EGL logiciel (Mesa)
apt-get install -y libegl1 libegl-mesa0 libgl1-mesa-dri libgbm1
# Sources Poly Haven (CC0) pour polyhaven.py, non versionnées
python3 tools/blender/telecharger_polyhaven.py
```

Variables : `ECO_POLYHAVEN` (dossier des sources Poly Haven), `ECO_APERCUS` (dossier des rendus PNG).

## Construction

```sh
/chemin/bpyenv/bin/python tools/blender/construire_tout.py            # tout (≈ 4 min)
/chemin/bpyenv/bin/python tools/blender/vehicules.py berline taxi      # quelques modèles
node tools/verifier_modeles.cjs [dossier_captures]                     # contrôle dans Babylon.js
```

| Script | Modèles |
|---|---|
| `vehicules.py` | berline, citadine, suv, utilitaire, camion_porteur, semi_remorque, bus_articule, taxi, police, ambulance, rame_tete, rame_intermediaire |
| `avions.py` | avion_moyen_courrier (type A320), avion_gros_porteur (type A330-300) |
| `navires.py` | porte_conteneurs (300 m), petrolier, remorqueur, peniche (Freycinet), bateau_mouche |
| `port_energie.py` | portique_sts, portique_rtg, eolienne (150 m) |
| `mobilier_toiture.py` | lampadaire, feu_tricolore, abribus, local_technique, chateau_eau |
| `polyhaven.py` | climatiseur, lampadaire_classique (dérivés Poly Haven), arbre_platane, arbre_peuplier, arbre_parc_large, arbre_parc_rond |
| `eco_common.py` | constructeur de maillage, palette, export glTF, manifeste, aperçus |

Chaque export écrit `<id>.png` (et `<id>_nuit.png` s'il a des faces émissives) dans le dossier des
aperçus, puis `_planche.png` / `_planche_nuit.png` en fin de construction.

## Conventions

- **Unités** : mètres. **Origine** au sol, centrée (navires : à la ligne de flottaison, carène sous 0).
- **Axes** : dans Blender, Z en haut et l'avant vers -Y ; après export glTF (+Y en haut) et chargement
  dans Babylon, l'avant est vers **+Z**, la droite vers +X. `verifier_modeles.cjs` le contrôle
  (phares devant les feux arrière).
- **Un seul matériau** par modèle : couleurs de sommets (`COLOR_0`, linéaires) ; aucune texture.
- **Faces émissives** : code entier dans la composante u de `TEXCOORD_0` :

  | Code | Usage | Code | Usage |
  |---|---|---|---|
  | 1 | phares avant | 6 | feu vert, navigation tribord |
  | 2 | feux arrière, feu rouge, balises | 7 | feux à éclats blancs |
  | 3 | vitrage éclairé (bus, tram, navires, abribus) | 8 | lanterne d'éclairage public |
  | 4 | gyrophare bleu | 9 | vitrage sombre (voitures, cockpits), non allumé par défaut |
  | 5 | orange (clignotant, feu orange, enseigne taxi) | | |

- **Sous-parties animées** : nœuds glTF séparés dont l'origine est le pivot (éolienne : `nacelle`,
  `rotor` ; portiques : `chariot`). Le manifeste donne type, axe, pivot (m, repère Babylon) et course.
- **Niveaux de détail** (arbres) : nœuds `lod0` (proche, ≤ 400 triangles) et `lod1` (lointain).
- **Peignable** : carrosserie gris clair, à teinter par une couleur d'instance (multipliée).

## Budgets

Voitures ≤ 800 triangles, bus et camions ≤ 1 200, avions et navires ≤ 3 000, grues ≤ 1 500,
éolienne ≤ 800, arbres ≤ 400 (lod0), lampadaires ≤ 150. Vérifiés par `tests/models.test.ts`.
