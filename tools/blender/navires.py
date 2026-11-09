"""Navires d'ECO NATION : porte-conteneurs (~300 m), pétrolier, remorqueur, péniche, bateau-mouche.

Lancement : <python avec bpy> tools/blender/navires.py
Origine : ligne de flottaison (y = 0 dans Babylon), centrée ; la carène immergée descend sous 0.
Avant (étrave) vers -Y Blender (+Z Babylon).
"""
from __future__ import annotations

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_common import (BLANC, EMIT, FEU_ROUGE, GRIS, GRIS_CLAIR, GRIS_FONCE, NOIR_PNEU, VITRE,  # noqa: E402
                        VITRE_ECLAIREE, Maillage, exporter, reinitialiser, varier)

E = EMIT
ANTIFOULING = (0.55, 0.12, 0.1)
VERT_PONT = (0.24, 0.33, 0.27)

# Stations de carène : (t le long de la coque depuis l'étrave, largeur au pont, à la flottaison, au bouchain,
# au fond — en fraction de la demi-largeur —, profondeur de quille en fraction du tirant d'eau, relevé du pont en m)
CARENE_CARGO = [
    (0.0, 0.06, 0.03, 0.015, 0.01, 0.15, 2.0), (0.025, 0.42, 0.26, 0.14, 0.05, 0.75, 1.6),
    (0.07, 0.8, 0.66, 0.45, 0.18, 1.0, 1.0), (0.15, 0.98, 0.93, 0.8, 0.5, 1.0, 0.3),
    (0.26, 1.0, 1.0, 0.96, 0.78, 1.0, 0.0), (0.74, 1.0, 1.0, 0.96, 0.78, 1.0, 0.0),
    (0.86, 1.0, 0.97, 0.85, 0.5, 1.0, 0.0), (0.94, 0.98, 0.9, 0.62, 0.25, 0.8, 0.2),
    (1.0, 0.93, 0.82, 0.5, 0.15, 0.25, 0.4),
]
CARENE_PENICHE = [
    (0.0, 0.7, 0.62, 0.5, 0.35, 0.5, 0.2), (0.04, 0.94, 0.9, 0.82, 0.7, 0.9, 0.05),
    (0.1, 1.0, 1.0, 0.98, 0.92, 1.0, 0.0), (0.92, 1.0, 1.0, 0.98, 0.92, 1.0, 0.0),
    (0.97, 0.95, 0.9, 0.8, 0.6, 0.85, 0.05), (1.0, 0.82, 0.75, 0.6, 0.4, 0.5, 0.15),
]
CARENE_REMORQUEUR = [
    (0.0, 0.25, 0.12, 0.05, 0.02, 0.3, 1.2), (0.08, 0.7, 0.5, 0.3, 0.1, 0.85, 0.8),
    (0.25, 0.97, 0.9, 0.7, 0.35, 1.0, 0.3), (0.6, 1.0, 0.98, 0.85, 0.45, 1.0, 0.0),
    (0.85, 0.98, 0.93, 0.75, 0.4, 0.9, 0.0), (1.0, 0.9, 0.85, 0.6, 0.3, 0.4, 0.1),
]


def coque(m: Maillage, L, B, T, F, stations, couleur_coque, couleur_pont=VERT_PONT, ligne_flottaison=0.3):
    """Coque par sections en U. L longueur, B largeur, T tirant d'eau, F franc-bord (pont au-dessus de l'eau)."""
    anneaux = []
    for t, wd, wl, wb, wk, kq, releve in stations:
        y = -L / 2 + t * L
        zd = F + releve
        zk = -T * kq
        b = B / 2
        bab = [(b * wd, zd), (b * wl, 0.0), (b * wb, zk * 0.65), (b * wk, zk)]
        cote = [(x, y, z) for x, z in bab]
        autre = [(-x, y, z) for x, z in reversed(bab)]
        anneaux.append(cote + autre)

    def peinture(face):
        c = face.calc_center_median()
        if face.normal.z > 0.8:
            return couleur_pont, 0
        if c.z < -ligne_flottaison * 0.2:
            return ANTIFOULING, 0
        return couleur_coque, 0
    m.lissage_anneaux(anneaux, peinture, lisse=True)
    # Liseré de flottaison (boot-top) : on le suggère par une bande fine juste au-dessus de l'eau.
    return anneaux


def feux_navigation(m: Maillage, x, y, z):
    m.boite((x, y, z), (0.6, 0.6, 0.6), FEU_ROUGE, E["feu_arriere"])
    m.boite((-x, y, z), (0.6, 0.6, 0.6), (0.1, 0.8, 0.3), E["vert"])


def chateau(m: Maillage, y, z0, larg, prof, h, ponts, couleur=BLANC, aileron=0.0):
    """Superstructure à bandes vitrées (une par pont) éclairées la nuit."""
    m.boite((0, y, z0 + h / 2), (larg, prof, h), couleur, biseau=0.15)
    hp = h / ponts
    for k in range(ponts):
        zf = z0 + hp * (k + 0.62)
        m.boite((0, y - prof / 2 - 0.03, zf), (larg * 0.92, 0.06, hp * 0.38), VITRE_ECLAIREE, E["vitrage"])
        for s in (-1, 1):
            m.boite((s * (larg / 2 + 0.03), y, zf), (0.06, prof * 0.85, hp * 0.38), VITRE_ECLAIREE, E["vitrage"])
    if aileron > 0:
        m.boite((0, y - prof / 2 + 1.5, z0 + h + 0.4), (aileron, 4.0, 1.2), couleur)
        m.boite((0, y - prof / 2 - 0.5 + 1.5, z0 + h + 0.5), (aileron * 0.95, 0.06, 0.7), VITRE, E["vitrage_sombre"])
        feux_navigation(m, aileron / 2 - 0.3, y - prof / 2 + 1.5, z0 + h + 1.3)


# ---------------------------------------------------------------------------
COULEURS_CONTENEURS = [(0.1, 0.32, 0.6), (0.8, 0.62, 0.12), (0.62, 0.12, 0.1), (0.15, 0.45, 0.25),
                       (0.85, 0.42, 0.1), (0.55, 0.56, 0.56), (0.85, 0.85, 0.82), (0.45, 0.28, 0.18),
                       (0.2, 0.55, 0.62), (0.12, 0.12, 0.14)]


def porte_conteneurs():
    rng = random.Random(4)
    m = Maillage("porte_conteneurs")
    L, B, T, F = 300.0, 48.2, 13.5, 11.0
    coque(m, L, B, T, F, CARENE_CARGO, (0.08, 0.13, 0.22))
    # Gaillard d'avant et brise-lames
    m.boite((0, -L / 2 + 26, F + 0.3 + 1.2), (B * 0.6, 8, 2.4), (0.08, 0.13, 0.22))
    m.boite((0, -L / 2 + 30.5, F + 2.4), (B * 0.86, 0.8, 4.8), (0.08, 0.13, 0.22))
    # Château arrière (habitations + passerelle), cheminée
    y_ch = L / 2 - 52
    chateau(m, y_ch, F, 32, 14, 30, 9, aileron=B - 1.0)
    m.boite((0, y_ch + 24, F + 9.0), (14, 10, 18), BLANC, biseau=0.3)
    m.boite((0, y_ch + 24, F + 19.5), (14.2, 10.2, 3.0), (0.62, 0.1, 0.08))
    m.boite((0, y_ch - 2, F + 36), (0.6, 0.6, 9), GRIS, )  # mât radar
    m.boite((0, y_ch - 2, F + 40.6), (0.5, 0.5, 0.5), (1, 1, 1), E["flash"])
    m.boite((0, L / 2 - 1, F + 3.5), (B * 0.86, 2.0, 3.0), BLANC)  # pont arrière
    # Conteneurs : baies de 40 pieds (12,2 m), 5 blocs par baie, 2 couleurs superposées.
    largeur_bloc = (B - 2.0) / 5
    y = -L / 2 + 31.5
    while y + 12.2 < y_ch - 8:
        for i in range(5):
            x = -B / 2 + 1.0 + largeur_bloc * (i + 0.5)
            etages = rng.choice((5, 6, 6, 7, 7, 7)) - (1 if i in (0, 4) else 0)
            bas = rng.randint(2, etages - 2)
            h_t = 2.59
            c1 = varier(rng.choice(COULEURS_CONTENEURS), 0.12, rng)
            c2 = varier(rng.choice(COULEURS_CONTENEURS), 0.12, rng)
            m.boite((x, y + 6.1, F + bas * h_t / 2), (largeur_bloc - 0.25, 12.1, bas * h_t), c1, sans_dessous=True)
            m.boite((x, y + 6.1, F + bas * h_t + (etages - bas) * h_t / 2), (largeur_bloc - 0.25, 12.1, (etages - bas) * h_t),
                    c2, sans_dessous=True)
        y += 13.1
    # Une rangée basse derrière le château
    for i in range(5):
        x = -B / 2 + 1.0 + largeur_bloc * (i + 0.5)
        m.boite((x, y_ch + 34, F + 2.6), (largeur_bloc - 0.25, 12.1, 5.2),
                varier(rng.choice(COULEURS_CONTENEURS), 0.1, rng), sans_dessous=True)
    m.boite((0, -L / 2 + 6, F + 5.0), (0.5, 0.5, 6), GRIS)
    m.boite((0, -L / 2 + 6, F + 8.3), (0.6, 0.6, 0.6), (1, 1, 1), E["flash"])
    return m


def petrolier():
    m = Maillage("petrolier")
    L, B, T, F = 250.0, 44.0, 14.5, 7.5
    coque(m, L, B, T, F, CARENE_CARGO, (0.12, 0.12, 0.13), couleur_pont=(0.55, 0.18, 0.12))
    y_ch = L / 2 - 20
    chateau(m, y_ch, F, 26, 16, 18, 6, aileron=B - 2.0)
    m.boite((0, y_ch + 12, F + 12), (9, 7, 24), BLANC, biseau=0.3)
    m.boite((0, y_ch + 12, F + 22.5), (9.2, 7.2, 2.4), (0.15, 0.35, 0.6))
    # Tuyauteries longitudinales, passerelle, collecteur central et grue
    for x in (-3.0, -1.5, 0.0, 1.5, 3.0):
        m.cylindre((x, -10, F + 1.0), 0.45, 190, GRIS_CLAIR, axe="Y", segments=6)
    m.boite((6.0, -10, F + 2.4), (1.2, 190, 0.3), GRIS)
    m.boite((0, -5, F + 1.6), (34, 6, 3.2), GRIS_CLAIR)
    m.cylindre((8, -5, F + 6), 0.6, 9, GRIS_CLAIR, segments=8)
    m.poutre((8, -5, F + 10), (2, 8, F + 16), 0.7, (0.85, 0.65, 0.1))
    for k in range(6):
        y = -L / 2 + 40 + k * 28
        m.boite((-12, y, F + 0.8), (3, 3, 1.6), GRIS)
        m.boite((12, y, F + 0.8), (3, 3, 1.6), GRIS)
    m.boite((0, -L / 2 + 24, F + 1.5), (B * 0.6, 10, 3.0), (0.12, 0.12, 0.13))
    m.boite((0, -L / 2 + 6, F + 8.0), (0.5, 0.5, 8), GRIS)
    m.boite((0, -L / 2 + 6, F + 12.3), (0.6, 0.6, 0.6), (1, 1, 1), E["flash"])
    return m


def remorqueur():
    m = Maillage("remorqueur")
    L, B, T, F = 32.0, 12.0, 4.5, 2.2
    rouge = (0.7, 0.12, 0.08)
    coque(m, L, B, T, F, CARENE_REMORQUEUR, rouge, couleur_pont=(0.3, 0.3, 0.32))
    # Défenses (boudins noirs) : pourtour du pont et étrave
    m.boite((0, -L / 2 + 1.3, F - 0.2), (3.5, 1.4, 1.6), NOIR_PNEU, biseau=0.3)
    for s in (-1, 1):
        m.boite((s * (B / 2 - 0.1), 1.5, F - 0.3), (0.8, L * 0.78, 0.9), NOIR_PNEU, biseau=0.2)
    m.boite((0, L / 2 - 0.4, F - 0.3), (B * 0.85, 0.8, 0.9), NOIR_PNEU, biseau=0.2)
    # Rouf et timonerie vitrée tout autour
    m.boite((0, -2.5, F + 1.4), (7.5, 11, 2.8), BLANC, biseau=0.12)
    m.boite((0, -4.0, F + 4.0), (6.2, 5.5, 2.4), BLANC, biseau=0.12)
    m.boite((0, -4.0, F + 4.2), (6.35, 5.65, 1.2), VITRE_ECLAIREE, E["vitrage"])
    m.boite((0, -4.0, F + 5.35), (6.6, 6.0, 0.3), BLANC)
    m.boite((0, -3.0, F + 7.5), (0.4, 0.4, 4.2), GRIS)
    m.boite((0, -3.0, F + 9.7), (0.4, 0.4, 0.4), (1, 1, 1), E["flash"])
    feux_navigation(m, 3.3, -4.5, F + 5.7)
    for s in (-1, 1):
        m.cylindre((s * 1.6, 1.5, F + 4.0), 0.55, 3.5, (0.1, 0.1, 0.1), segments=8)  # cheminées
    m.cylindre((0, 7.5, F + 0.8), 0.9, 1.6, GRIS_FONCE, segments=10)  # treuil de remorquage
    m.boite((0, 10.5, F + 1.2), (6, 0.4, 0.4), GRIS_FONCE)
    return m


def peniche():
    m = Maillage("peniche")
    L, B, T, F = 38.5, 5.05, 1.6, 1.0
    coque(m, L, B, T, F, CARENE_PENICHE, (0.08, 0.08, 0.09), couleur_pont=(0.2, 0.22, 0.2), ligne_flottaison=0.1)
    # Cale avec panneaux d'écoutille arrondis
    m.boite((0, -2.5, F + 0.35), (B - 0.6, 27, 0.7), (0.25, 0.32, 0.25))
    for k in range(9):
        m.cylindre((0, -15.4 + k * 2.9, F + 0.7), (B - 0.7) / 2, 2.8, (0.32, 0.4, 0.3), axe="Y", segments=10,
                   lisse=True)
    # Logement et timonerie à l'arrière
    m.boite((0, 15.2, F + 1.0), (B - 0.5, 5.5, 2.0), (0.85, 0.82, 0.74), biseau=0.08)
    m.boite((0, 13.6, F + 2.8), (2.6, 2.0, 1.6), (0.85, 0.82, 0.74), biseau=0.06)
    m.boite((0, 13.6, F + 2.9), (2.7, 2.1, 0.7), VITRE_ECLAIREE, E["vitrage"])
    for s in (-1, 1):
        m.boite((s * (B / 2 - 0.22), 15.2, F + 1.1), (0.03, 4.6, 0.55), VITRE_ECLAIREE, E["vitrage"])
    m.boite((0, 17.6, F + 2.3), (0.15, 0.15, 1.0), GRIS)
    m.boite((0, 17.6, F + 2.85), (0.2, 0.2, 0.2), (1, 1, 1), E["flash"])
    m.boite((1.0, 16.5, F + 2.2), (1.2, 1.2, 0.3), BLANC)  # voiture sur le toit ? petite annexe
    feux_navigation(m, 1.25, 12.8, F + 3.2)
    return m


def bateau_mouche():
    m = Maillage("bateau_mouche")
    L, B, T, F = 46.0, 8.2, 1.4, 0.9
    coque(m, L, B, T, F, CARENE_PENICHE, (0.9, 0.9, 0.88), couleur_pont=(0.45, 0.32, 0.22), ligne_flottaison=0.1)
    # Pont principal vitré (verrière), éclairé la nuit
    m.boite((0, 1.0, F + 0.35), (B - 0.5, 38, 0.7), (0.88, 0.88, 0.86))
    m.boite((0, 1.0, F + 1.6), (B - 0.7, 37, 1.8), VITRE_ECLAIREE, E["vitrage"], biseau=0.1)
    m.boite((0, 1.0, F + 2.6), (B - 0.4, 38, 0.2), (0.88, 0.88, 0.86))
    # Pont supérieur ouvert : bancs et garde-corps
    for k in range(10):
        m.boite((0, -12 + k * 3.0, F + 3.0), (B - 2.0, 0.5, 0.6), (0.5, 0.35, 0.22))
    for s in (-1, 1):
        m.boite((s * (B / 2 - 0.25), 1.0, F + 3.2), (0.06, 37, 0.8), GRIS_CLAIR)
    m.boite((0, -L / 2 + 6.5, F + 3.5), (3.5, 2.6, 1.6), BLANC, biseau=0.08)  # timonerie
    m.boite((0, -L / 2 + 6.5, F + 3.7), (3.6, 2.7, 0.8), VITRE_ECLAIREE, E["vitrage"])
    feux_navigation(m, 1.6, -L / 2 + 6.5, F + 4.5)
    # Projecteurs latéraux (célèbres sur la Seine)
    for s in (-1, 1):
        for k in range(4):
            m.boite((s * (B / 2 - 0.1), -14 + k * 9, F + 2.85), (0.3, 0.4, 0.3), (1, 0.95, 0.85), E["eclairage"])
    return m


MODELES = {
    "porte_conteneurs": (porte_conteneurs, "navire", "Porte-conteneurs post-panamax 300 × 48 m, conteneurs intégrés."),
    "petrolier": (petrolier, "navire", "Pétrolier type Suezmax 250 × 44 m."),
    "remorqueur": (remorqueur, "navire", "Remorqueur portuaire 32 m, défenses et timonerie vitrée."),
    "peniche": (peniche, "navire", "Péniche au gabarit Freycinet 38,5 × 5,05 m."),
    "bateau_mouche": (bateau_mouche, "navire", "Bateau-promenade de rivière 46 × 8,2 m, verrière éclairée."),
}


def construire(ids=None):
    for id_m, (fn, cat, notes) in MODELES.items():
        if ids and id_m not in ids:
            continue
        reinitialiser()
        ob = fn().objet()
        ob.name = id_m
        exporter(id_m, [ob], categorie=cat, notes=notes, origine="ligne_de_flottaison",
                 source="Généré procéduralement (eco-nation/tools/blender/navires.py)")


if __name__ == "__main__":
    construire(sys.argv[1:] or None)
