"""Avions de ligne d'ECO NATION : moyen-courrier type A320 et gros-porteur bimoteur (~64 m).

Lancement : <python avec bpy> tools/blender/avions.py
Avant vers -Y Blender (+Z Babylon). Train d'atterrissage sorti, origine au sol sous le centre.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_common import (BLANC, EMIT, FEU_ROUGE, GRIS, GRIS_CLAIR, GRIS_FONCE, NOIR_PNEU, PHARE, VITRE,  # noqa: E402
                        VITRE_ECLAIREE, Maillage, exporter, reinitialiser)

E = EMIT
SEG = 14  # segments de la section du fuselage


def anneau(yc, zc, rx, rz, n=SEG):
    return [(rx * math.sin(2 * math.pi * i / n), yc, zc + rz * math.cos(2 * math.pi * i / n)) for i in range(n)]


def avion(nom, *, L, D, envergure, corde_emplanture, corde_saumon, fleche_deg, z_axe, y_aile, moteur_d, moteur_l,
          x_moteur, empattement, voie, h_derive, envergure_empennage, couleur_derive, bogies=False) -> Maillage:
    m = Maillage(nom)
    R = D / 2
    yn = -L / 2  # nez
    # (distance depuis le nez, facteur de rayon, décalage vertical en m)
    stations = [(0.012, 0.32, -0.32 * R), (0.03, 0.58, -0.2 * R), (0.06, 0.82, -0.08 * R), (0.1, 0.96, -0.02 * R),
                (0.15, 1.0, 0.0), (0.66, 1.0, 0.0), (0.76, 0.86, 0.14 * R), (0.86, 0.6, 0.42 * R),
                (0.95, 0.32, 0.68 * R)]
    anneaux = [anneau(yn + t * L, z_axe + dz, R * k, R * k * 1.04) for t, k, dz in stations]

    def livree(face):
        c = face.calc_center_median()
        if face.normal.z < -0.45:
            return GRIS_CLAIR, 0
        # Pare-brise du poste de pilotage
        if yn + 0.025 * L < c.y < yn + 0.075 * L and z_axe + 0.2 * R < c.z < z_axe + 0.8 * R and face.normal.y < 0.2 and abs(face.normal.x) < 0.95:
            return VITRE, E["vitrage_sombre"]
        return BLANC, 0
    m.lissage_anneaux(anneaux, livree, pointe_debut=(0, yn, z_axe - 0.4 * R), pointe_fin=(0, L / 2, z_axe + 0.78 * R))
    # Hublots : bandeau sombre (éclairé la nuit) de chaque côté
    for s in (-1, 1):
        m.boite((s * (R * 1.0 + 0.005), yn + 0.42 * L, z_axe + 0.18 * R), (0.02, 0.62 * L, 0.24), VITRE_ECLAIREE,
                E["vitrage"])
        m.boite((s * (R * 1.0 + 0.006), yn + 0.42 * L, z_axe - 0.32 * R), (0.02, 0.66 * L, 0.18), couleur_derive)
    # Ailes (dièdre 5°), plaques à flèche
    tanf = math.tan(math.radians(fleche_deg))
    die = math.tan(math.radians(5.5))
    z_aile = z_axe - 0.55 * R
    demi = envergure / 2
    for s in (-1, 1):
        x0, x1 = R * 0.6, demi - 0.3
        ple0 = y_aile
        ple1 = y_aile + (x1 - x0) * tanf
        pts = [(s * x0, ple0, z_aile), (s * x1, ple1, z_aile + (x1 - x0) * die),
               (s * x1, ple1 + corde_saumon, z_aile + (x1 - x0) * die), (s * x0, ple0 + corde_emplanture, z_aile)]
        m.plaque(pts, max(0.25, corde_emplanture * 0.07), BLANC)
        # Ailettes (sharklets)
        zt = z_aile + (x1 - x0) * die
        m.plaque([(s * x1, ple1 + 0.1 * corde_saumon, zt), (s * (x1 + 0.1), ple1 + 0.95 * corde_saumon, zt + 2.2 * D / 4),
                  (s * (x1 + 0.1), ple1 + 1.25 * corde_saumon, zt + 2.2 * D / 4), (s * x1, ple1 + corde_saumon, zt)],
                 0.12, couleur_derive, axe="X")
        # Feux de navigation : rouge à gauche (bâbord = +X ici), vert à droite
        m.boite((s * (x1 + 0.05), ple1 + 0.2, zt), (0.15, 0.3, 0.15), FEU_ROUGE if s > 0 else (0.1, 0.8, 0.3),
                E["feu_arriere"] if s > 0 else E["vert"])
        # Moteur et mât
        xm = s * x_moteur
        ym = y_aile + (x_moteur - x0) * tanf - moteur_l * 0.45
        zm = z_aile + (x_moteur - x0) * die - moteur_d * 0.55
        m.cylindre((xm, ym + moteur_l / 2, zm), moteur_d / 2, moteur_l, GRIS_CLAIR, axe="Y", segments=12,
                   rayon2=moteur_d * 0.38)
        m.cylindre((xm, ym - 0.02, zm), moteur_d * 0.44, 0.06, GRIS_FONCE, axe="Y", segments=12, lisse=False)
        m.boite((xm, ym + moteur_l * 0.75, zm + moteur_d * 0.45), (0.35, moteur_l * 0.9, moteur_d * 0.45), GRIS_CLAIR)
    # Empennage horizontal
    y_emp = L / 2 - 0.15 * L
    z_emp = z_axe + 0.45 * R
    for s in (-1, 1):
        demi_e = envergure_empennage / 2
        c0 = 0.085 * L
        m.plaque([(s * 0.3, y_emp, z_emp), (s * demi_e, y_emp + demi_e * tanf * 1.1, z_emp + demi_e * 0.08),
                  (s * demi_e, y_emp + demi_e * tanf * 1.1 + c0 * 0.4, z_emp + demi_e * 0.08), (s * 0.3, y_emp + c0, z_emp)],
                 0.22, BLANC)
    # Dérive
    y_der = L / 2 - 0.2 * L
    z_der = z_axe + 0.7 * R
    c_der = 0.17 * L
    m.plaque([(0, y_der, z_der), (0, y_der + h_derive * 0.82, z_der + h_derive),
              (0, y_der + h_derive * 0.82 + c_der * 0.36, z_der + h_derive), (0, L / 2 - 0.02 * L, z_der)],
             0.32, couleur_derive, axe="X")
    m.boite((0, y_der + h_derive * 0.82 + c_der * 0.2, z_der + h_derive + 0.06), (0.2, 0.3, 0.12), (1, 1, 1), E["flash"])
    m.boite((0, L / 2 - 0.02, z_axe + 0.78 * R), (0.2, 0.2, 0.2), (1, 1, 1), E["flash"])
    # Feu anticollision rouge (dos et ventre)
    m.boite((0, yn + 0.45 * L, z_axe + R * 1.04 + 0.05), (0.25, 0.4, 0.12), FEU_ROUGE, E["feu_arriere"])
    # Train avant
    y_av = yn + 0.135 * L
    m.poutre((0, y_av, z_axe - R * 0.9), (0, y_av, 0.45), 0.2, GRIS)
    for s in (-1, 1):
        m.cylindre((s * 0.22, y_av, 0.4), 0.4, 0.28, NOIR_PNEU, axe="X", segments=10)
    m.boite((0, y_av - 0.3, z_axe - R * 0.85), (0.25, 0.2, 0.15), PHARE, E["phare"])
    # Train principal
    y_pr = y_av + empattement
    r_roue = 0.62 if bogies else 0.57
    for s in (-1, 1):
        x = s * voie / 2
        m.poutre((x, y_pr, z_aile - 0.1), (x, y_pr, r_roue + 0.1), 0.3, GRIS)
        dys = (-0.8, 0.8) if bogies else (0.0,)
        if bogies:
            m.boite((x, y_pr, r_roue), (0.25, 2.2, 0.25), GRIS)
        for dy in dys:
            for dx in (-0.35, 0.35):
                m.cylindre((x + dx, y_pr + dy, r_roue), r_roue, 0.36, NOIR_PNEU, axe="X", segments=10)
    # Carénage ventral aile-fuselage
    m.boite((0, y_aile + corde_emplanture * 0.45, z_axe - R * 0.72), (D * 0.7, corde_emplanture * 1.5, R * 0.6),
            GRIS_CLAIR, biseau=0.25)
    return m


def a320():
    return avion("avion_moyen_courrier", L=37.57, D=3.95, envergure=35.8, corde_emplanture=6.1, corde_saumon=1.6,
                 fleche_deg=25, z_axe=3.4, y_aile=-3.9, moteur_d=2.0, moteur_l=4.4, x_moteur=5.75, empattement=12.64,
                 voie=7.59, h_derive=6.6, envergure_empennage=12.45, couleur_derive=(0.1, 0.25, 0.55))


def gros_porteur():
    return avion("avion_gros_porteur", L=63.7, D=5.64, envergure=60.3, corde_emplanture=10.5, corde_saumon=2.4,
                 fleche_deg=30, z_axe=4.9, y_aile=-8.0, moteur_d=3.0, moteur_l=6.5, x_moteur=9.6, empattement=25.4,
                 voie=10.7, h_derive=9.6, envergure_empennage=19.4, couleur_derive=(0.05, 0.45, 0.4), bogies=True)


MODELES = {
    "avion_moyen_courrier": (a320, "Moyen-courrier type A320 : 37,6 m de long, 35,8 m d'envergure."),
    "avion_gros_porteur": (gros_porteur, "Gros-porteur bimoteur type A330-300 : 63,7 m, 60,3 m d'envergure."),
}


def construire(ids=None):
    for id_m, (fn, notes) in MODELES.items():
        if ids and id_m not in ids:
            continue
        reinitialiser()
        ob = fn().objet()
        ob.name = id_m
        exporter(id_m, [ob], categorie="avion", notes=notes,
                 source="Généré procéduralement (eco-nation/tools/blender/avions.py)")


if __name__ == "__main__":
    construire(sys.argv[1:] or None)
