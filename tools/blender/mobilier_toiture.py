"""Mobilier urbain (lampadaire, feu tricolore, abribus) et équipements de toiture générés
(local technique, château d'eau). Le climatiseur vient de Poly Haven : voir polyhaven.py.

Lancement : <python avec bpy> tools/blender/mobilier_toiture.py
Le feu tricolore et l'abribus « regardent » vers -Y Blender (+Z Babylon) : les automobilistes arrivant
depuis +Z voient les feux.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_common import (BLANC, EMIT, FEU_ROUGE, GRIS, GRIS_CLAIR, GRIS_FONCE, VITRE,  # noqa: E402
                        Maillage, exporter, reinitialiser)

E = EMIT
GRIS_MOBILIER = (0.22, 0.24, 0.25)


def lampadaire():
    m = Maillage("lampadaire")
    h = 8.0
    m.cylindre((0, 0, 0.4), 0.16, 0.8, GRIS_MOBILIER, segments=8)
    m.cylindre((0, 0, 0.8 + (h - 0.8) / 2), 0.09, h - 0.8, GRIS_MOBILIER, segments=6, rayon2=0.06, bouchons=False)
    # Crosse : deux segments vers l'avant (-Y), au-dessus de la chaussée
    m.poutre((0, 0, h - 0.05), (0, -0.7, h + 0.25), 0.08, GRIS_MOBILIER)
    m.poutre((0, -0.7, h + 0.25), (0, -1.6, h + 0.3), 0.07, GRIS_MOBILIER)
    m.boite((0, -1.95, h + 0.28), (0.36, 0.8, 0.14), GRIS_MOBILIER, biseau=0.03)
    m.boite((0, -1.95, h + 0.2), (0.3, 0.68, 0.03), (1.0, 0.95, 0.85), E["eclairage"])
    return [m.objet()], []


def feu_tricolore():
    m = Maillage("feu_tricolore")
    m.cylindre((0, 0, 1.6), 0.06, 3.2, GRIS_MOBILIER, segments=6)
    m.boite((0, -0.08, 2.75), (0.3, 0.22, 0.9), GRIS_FONCE, biseau=0.03)
    m.boite((0, 0.04, 2.75), (0.44, 0.02, 1.04), (0.08, 0.08, 0.08))  # plaque de fond
    for dz, coul, code in ((0.28, FEU_ROUGE, E["feu_arriere"]), (0.0, (0.95, 0.6, 0.08), E["orange"]),
                           (-0.28, (0.1, 0.75, 0.3), E["vert"])):
        m.cylindre((0, -0.2, 2.75 + dz), 0.1, 0.03, coul, code, axe="Y", segments=8, lisse=False)
        m.boite((0, -0.25, 2.75 + dz + 0.11), (0.24, 0.1, 0.02), GRIS_FONCE)  # visière
    m.boite((0, -0.08, 1.2), (0.2, 0.14, 0.32), GRIS_FONCE)  # boîtier piéton
    return [m.objet()], [{"nom": "lampes", "type": "emissif",
                          "description": "Rouge = code 2, orange = code 5, vert = code 6 : alterner l'émission."}]


def abribus():
    m = Maillage("abribus")
    L, P, H = 4.6, 1.6, 2.5
    vitre = (0.55, 0.65, 0.7)
    m.boite((0, 0, H), (L + 0.2, P + 0.25, 0.12), GRIS_MOBILIER, biseau=0.02)
    for x in (-L / 2, L / 2):
        for y in (-P / 2 + 0.1, P / 2 - 0.05):
            m.boite((x, y, H / 2), (0.07, 0.07, H), GRIS_MOBILIER)
    m.boite((0, P / 2 - 0.05, H / 2 + 0.1), (L, 0.02, H - 0.35), vitre, E["vitrage_sombre"])  # paroi arrière
    m.boite((-L / 2, 0.05, H / 2 + 0.1), (0.02, P - 0.25, H - 0.35), vitre, E["vitrage_sombre"])
    # Panneau publicitaire rétroéclairé (côté droit)
    m.boite((L / 2, 0.05, H / 2 + 0.05), (0.14, P - 0.3, 1.75), GRIS_MOBILIER)
    m.boite((L / 2 - 0.08, 0.05, H / 2 + 0.05), (0.01, P - 0.45, 1.6), (0.95, 0.9, 0.8), E["vitrage"])
    m.boite((L / 2 + 0.08, 0.05, H / 2 + 0.05), (0.01, P - 0.45, 1.6), (0.95, 0.9, 0.8), E["vitrage"])
    m.boite((-0.3, P / 2 - 0.3, 0.48), (2.6, 0.4, 0.06), (0.55, 0.4, 0.28))  # banc
    m.boite((-0.3, P / 2 - 0.3, 0.24), (2.4, 0.08, 0.48), GRIS_MOBILIER)
    m.boite((0, -P / 2 - 0.05, H + 0.15), (1.2, 0.04, 0.25), (0.1, 0.4, 0.3))  # bandeau de ligne
    return [m.objet()], []


def local_technique():
    m = Maillage("local_technique")
    beton = (0.66, 0.64, 0.6)
    m.boite((0, 0, 1.4), (4.0, 3.0, 2.8), beton, biseau=0.04)
    m.boite((0, 0, 2.85), (4.2, 3.2, 0.12), GRIS)
    m.boite((-0.8, -1.51, 1.05), (0.95, 0.04, 2.1), GRIS_FONCE)                  # porte
    for k in range(3):
        m.boite((0.9, -1.51, 1.2 + k * 0.35), (1.2, 0.05, 0.12), GRIS)            # ventelles
    m.boite((2.01, 0.3, 2.0), (0.04, 0.8, 0.5), GRIS)
    m.cylindre((1.3, 0.8, 3.3), 0.25, 0.9, GRIS_CLAIR, segments=8)                # extracteur
    m.cylindre((1.3, 0.8, 3.8), 0.4, 0.12, GRIS_CLAIR, segments=8)
    m.boite((-1.0, -1.6, 2.4), (0.25, 0.12, 0.12), (1.0, 0.95, 0.85), E["eclairage"])  # applique
    return [m.objet()], []


def chateau_eau():
    """Réservoir de toiture en bois cerclé, sur charpente métallique (type new-yorkais)."""
    m = Maillage("chateau_eau")
    bois = (0.46, 0.33, 0.22)
    h_pieds = 3.5
    r = 2.4
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = 1.9 * math.cos(a), 1.9 * math.sin(a)
        m.poutre((x * 1.1, y * 1.1, 0), (x, y, h_pieds), 0.22, GRIS_FONCE)
    for z in (1.2, h_pieds - 0.15):
        m.boite((0, 0, z), (3.0, 3.0, 0.16), GRIS_FONCE)
    m.cylindre((0, 0, h_pieds + 2.1), r, 4.2, bois, segments=14)
    for z in (h_pieds + 0.6, h_pieds + 1.6, h_pieds + 2.6, h_pieds + 3.6):
        m.cylindre((0, 0, z), r + 0.03, 0.08, GRIS_FONCE, segments=14, bouchons=False)
    m.cylindre((0, 0, h_pieds + 4.2 + 0.65), r + 0.12, 1.3, (0.32, 0.25, 0.2), segments=14, rayon2=0.12)
    m.poutre((r * 0.7, -r * 0.7, 0.0), (r * 0.7, -r * 0.7, h_pieds + 4.4), 0.08, GRIS)  # échelle stylisée
    return [m.objet()], []


MODELES = {
    "lampadaire": (lampadaire, "mobilier_urbain", "Lampadaire routier 8 m à crosse, lanterne LED (code 8)."),
    "feu_tricolore": (feu_tricolore, "mobilier_urbain", "Feu tricolore sur mât de 3,2 m, lampes à codes distincts."),
    "abribus": (abribus, "mobilier_urbain", "Abribus 4,6 m, parois vitrées, panneau publicitaire rétroéclairé."),
    "local_technique": (local_technique, "toiture", "Local technique de toiture (édicule d'ascenseur, ventilation)."),
    "chateau_eau": (chateau_eau, "toiture", "Château d'eau de toiture en bois cerclé, 9 m de haut."),
}


def construire(ids=None):
    for id_m, (fn, cat, notes) in MODELES.items():
        if ids and id_m not in ids:
            continue
        reinitialiser()
        objets, parties = fn()
        objets[0].name = id_m
        exporter(id_m, objets, categorie=cat, notes=notes, parties=parties,
                 source="Généré procéduralement (eco-nation/tools/blender/mobilier_toiture.py)")


if __name__ == "__main__":
    construire(sys.argv[1:] or None)
