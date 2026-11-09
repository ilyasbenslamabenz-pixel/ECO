"""Véhicules routiers et rames ferroviaires d'ECO NATION (Blender headless).

Lancement : <python avec bpy> tools/blender/vehicules.py
Chaque modèle : un seul objet, couleurs de sommets, avant vers -Y Blender (= +Z Babylon).
Les carrosseries « peignables » sont gris très clair pour être teintées par une couleur d'instance.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_common import (BLANC, BLEU_GYRO, EMIT, FEU_ROUGE, GRIS, GRIS_CLAIR, GRIS_FONCE, GRIS_JANTE,  # noqa: E402
                        NOIR_PNEU, ORANGE, PHARE, VITRE, VITRE_ECLAIREE, Maillage, exporter, reinitialiser)

CARROSSERIE_PEIGNABLE = (0.86, 0.86, 0.86)
E = EMIT


def peinture_cabine(couleur_toit, code_vitre=E["vitrage_sombre"], vitre=VITRE):
    """Toit (normale vers le haut) de la couleur de carrosserie, le reste en vitrage."""
    def f(face):
        if face.normal.z > 0.96:
            return couleur_toit, 0
        return vitre, code_vitre
    return f


def peinture_parebrise(couleur, zmin, code=E["vitrage_sombre"], vitre=VITRE, ny=-0.25):
    """Faces du profil tournées vers l'avant (-Y) au-dessus de zmin : pare-brise ; le reste : carrosserie."""
    def f(face):
        if face.normal.y < ny and face.normal.z < 0.97 and face.calc_center_median().z > zmin:
            return vitre, code
        return couleur, 0
    return f


def roue(m: Maillage, x, y, r, largeur, jumelee=False):
    m.cylindre((x, y, r), r, largeur, NOIR_PNEU, axe="X", segments=12)
    cote = 1 if x > 0 else -1
    m.cylindre((x + cote * (largeur / 2 + 0.004), y, r), r * 0.62, 0.01, GRIS_JANTE, axe="X", segments=8, lisse=False)
    if jumelee:
        m.cylindre((x - cote * (largeur + 0.02), y, r), r, largeur, NOIR_PNEU, axe="X", segments=10)


def essieux(m: Maillage, ys, voie, r, largeur, jumelees=()):
    for i, y in enumerate(ys):
        for s in (-1, 1):
            roue(m, s * (voie / 2), y, r, largeur, jumelee=i in jumelees)


def phares_feux(m: Maillage, L, W, z_phare, z_feu, larg_phare=0.34, y_av=None, y_ar=None, h_phare=0.11):
    y_av = -L / 2 + 0.03 if y_av is None else y_av
    y_ar = L / 2 - 0.03 if y_ar is None else y_ar
    for s in (-1, 1):
        m.boite((s * (W / 2 - 0.08 - larg_phare / 2), y_av, z_phare), (larg_phare, 0.08, h_phare), PHARE, E["phare"])
        m.boite((s * (W / 2 - 0.2), y_ar, z_feu), (0.3, 0.07, 0.11), FEU_ROUGE, E["feu_arriere"])


# ---------------------------------------------------------------------------
# Voitures particulières
# ---------------------------------------------------------------------------
def voiture(nom, *, L, W, H, r, empattement, garde, z_capot, ceinture, long_capot, long_coffre,
            pare_brise, lunette, couleur, decalage_essieux=0.0, retrait_toit=0.13, pare_chocs=GRIS_FONCE,
            hayon=False) -> Maillage:
    m = Maillage(nom)
    yf, yr = -L / 2, L / 2
    z0 = garde
    bas = [(yf + 0.1, z0), (yf, z0 + 0.22), (yf + 0.04, z_capot), (yf + long_capot, ceinture),
           (yr - long_coffre, ceinture + (0.0 if hayon else 0.02)), (yr - 0.03, ceinture - (0.06 if hayon else 0.02)),
           (yr, z0 + 0.28), (yr - 0.12, z0)]
    m.profil_x(bas, W - 0.04, couleur, biseau=0.07)
    cab = [(yf + long_capot - 0.04, ceinture - 0.03), (yf + long_capot + pare_brise, H),
           (yr - long_coffre - lunette, H), (yr - long_coffre + (0.02 if hayon else 0.0), ceinture - 0.03)]
    m.profil_x(cab, W - 0.12, peinture_cabine(couleur), retrait_haut=retrait_toit, z_retrait=ceinture, biseau=0.04)
    # Pare-chocs, calandre, plaques
    m.boite((0, yf + 0.06, z0 + 0.12), (W - 0.02, 0.14, 0.2), pare_chocs, biseau=0.03)
    m.boite((0, yr - 0.06, z0 + 0.14), (W - 0.02, 0.14, 0.22), pare_chocs, biseau=0.03)
    m.boite((0, yf + 0.01, (z0 + 0.22 + z_capot) / 2 - 0.02), (W * 0.42, 0.04, 0.14), GRIS_FONCE)
    m.boite((0, yr + 0.005, z0 + 0.42), (0.52, 0.02, 0.12), BLANC)
    phares_feux(m, L, W, z_capot - 0.08, ceinture - 0.13)
    # Rétroviseurs
    for s in (-1, 1):
        m.boite((s * (W / 2 + 0.06), yf + long_capot + 0.18, ceinture + 0.07), (0.13, 0.07, 0.1), couleur)
    yc = decalage_essieux
    essieux(m, (yc - empattement / 2, yc + empattement / 2), W - 0.24, r, 0.22)
    return m


def berline(couleur=CARROSSERIE_PEIGNABLE, nom="berline"):
    return voiture(nom, L=4.8, W=1.85, H=1.45, r=0.33, empattement=2.85, garde=0.22, z_capot=0.78, ceinture=0.98,
                   long_capot=1.25, long_coffre=0.95, pare_brise=0.75, lunette=0.6, couleur=couleur,
                   decalage_essieux=0.05)


def citadine():
    return voiture("citadine", L=3.95, W=1.75, H=1.5, r=0.31, empattement=2.55, garde=0.2, z_capot=0.75,
                   ceinture=0.98, long_capot=0.85, long_coffre=0.12, pare_brise=0.7, lunette=0.3,
                   couleur=CARROSSERIE_PEIGNABLE, hayon=True)


def suv():
    m = voiture("suv", L=4.7, W=1.9, H=1.72, r=0.37, empattement=2.75, garde=0.3, z_capot=0.98, ceinture=1.15,
                long_capot=1.0, long_coffre=0.12, pare_brise=0.7, lunette=0.25, couleur=CARROSSERIE_PEIGNABLE,
                hayon=True, retrait_toit=0.1)
    for s in (-1, 1):  # barres de toit
        m.boite((s * 0.62, 0.15, 1.75), (0.05, 2.0, 0.05), GRIS_FONCE)
    m.boite((0, 2.36, 0.85), (0.5, 0.06, 0.5), GRIS_FONCE)  # roue de secours stylisée / hayon
    return m


def taxi():
    m = berline(couleur=(0.12, 0.12, 0.13), nom="taxi")
    m.boite((0, 0.25, 1.5), (0.55, 0.16, 0.14), BLANC, E["orange"], biseau=0.02)
    return m


def police():
    m = berline(couleur=(0.93, 0.93, 0.93), nom="police")
    for s in (-1, 1):  # bandeau bleu et liseré rouge
        m.boite((s * 0.928, 0.0, 0.66), (0.01, 3.9, 0.18), (0.06, 0.16, 0.48))
        m.boite((s * 0.928, 0.0, 0.55), (0.01, 3.9, 0.04), (0.8, 0.07, 0.07))
    m.boite((0, 0.1, 1.5), (1.1, 0.24, 0.12), GRIS_FONCE, biseau=0.02)
    for s in (-1, 1):
        m.boite((s * 0.3, 0.1, 1.58), (0.42, 0.2, 0.08), BLEU_GYRO, E["gyrophare"], biseau=0.015)
    return m


# ---------------------------------------------------------------------------
# Utilitaires, camions, bus
# ---------------------------------------------------------------------------
def fourgon(nom, couleur, L=5.4, W=2.05, H=2.5) -> Maillage:
    m = Maillage(nom)
    yf, yr = -L / 2, L / 2
    z0 = 0.3
    profil = [(yf + 0.1, z0), (yf, z0 + 0.3), (yf + 0.05, 0.95), (yf + 0.75, 1.15), (yf + 1.5, H - 0.05),
              (yf + 1.7, H), (yr - 0.05, H), (yr, H - 0.1), (yr, z0 + 0.15), (yr - 0.15, z0)]
    m.profil_x(profil, W, peinture_parebrise(couleur, 1.2, ny=-0.5), biseau=0.06)
    # Vitres de portières (légèrement en saillie)
    for s in (-1, 1):
        m.boite((s * (W / 2 + 0.005), yf + 1.35, 1.65), (0.01, 0.6, 0.55), VITRE, E["vitrage_sombre"])
        m.boite((s * (W / 2 + 0.07), yf + 0.95, 1.4), (0.14, 0.08, 0.22), GRIS_FONCE)
    m.boite((0, yf + 0.07, z0 + 0.15), (W, 0.16, 0.28), GRIS_FONCE, biseau=0.03)
    m.boite((0, yr - 0.05, z0 + 0.12), (W, 0.12, 0.22), GRIS_FONCE, biseau=0.03)
    m.boite((0, yf + 0.02, 0.72), (0.9, 0.04, 0.18), GRIS_FONCE)
    for s in (-1, 1):
        m.boite((s * (W / 2 - 0.25), yf + 0.04, 0.85), (0.32, 0.08, 0.14), PHARE, E["phare"])
        m.boite((s * (W / 2 - 0.06), yr + 0.01, 0.95), (0.1, 0.04, 0.45), FEU_ROUGE, E["feu_arriere"])
    m.boite((0, yr + 0.006, H / 2 + 0.25), (0.02, 0.01, H - 0.9), GRIS_FONCE)  # jointure des portes arrière
    essieux(m, (yf + 0.95, yr - 1.1), W - 0.26, 0.36, 0.23)
    return m


def utilitaire():
    return fourgon("utilitaire", CARROSSERIE_PEIGNABLE)


def ambulance():
    m = fourgon("ambulance", (0.95, 0.95, 0.93))
    for s in (-1, 1):
        m.boite((s * 1.032, 0.4, 1.05), (0.01, 4.0, 0.22), (1.0, 0.72, 0.05))   # bande jaune
        m.boite((s * 1.032, 0.4, 0.9), (0.01, 4.0, 0.08), (0.1, 0.3, 0.75))    # liseré bleu
        m.boite((s * 0.6, -0.95, 2.56), (0.42, 0.22, 0.12), BLEU_GYRO, E["gyrophare"], biseau=0.015)
        m.boite((s * 0.85, 2.65, 2.5), (0.16, 0.08, 0.12), BLEU_GYRO, E["gyrophare"])
    m.boite((0, -0.95, 2.53), (0.5, 0.2, 0.08), (1.0, 0.72, 0.05), E["orange"])
    return m


def cabine_camion(m: Maillage, yf, W, H, couleur, z0=0.5, prof=2.3):
    """Cabine avancée européenne : face avant presque verticale, pare-brise incliné."""
    profil = [(yf, z0), (yf, 1.45), (yf + 0.12, H - 0.25), (yf + 0.3, H), (yf + prof, H), (yf + prof, z0)]
    m.profil_x(profil, W, peinture_parebrise(couleur, 1.5, ny=-0.9), biseau=0.07)
    for s in (-1, 1):
        m.boite((s * (W / 2 + 0.005), yf + 0.75, 2.05), (0.01, 0.9, 0.7), VITRE, E["vitrage_sombre"])
        m.boite((s * (W / 2 + 0.15), yf + 0.15, 2.0), (0.06, 0.08, 0.45), GRIS_FONCE)
        m.boite((s * (W / 2 - 0.3), yf - 0.02, 0.82), (0.38, 0.06, 0.16), PHARE, E["phare"])
    m.boite((0, yf - 0.03, 0.6), (W, 0.12, 0.35), GRIS_FONCE, biseau=0.03)
    m.boite((0, yf - 0.005, 1.15), (W * 0.6, 0.02, 0.4), GRIS_FONCE)
    m.boite((0, yf + prof * 0.55, H + 0.25), (W - 0.3, prof * 0.8, 0.5), couleur, biseau=0.08)  # déflecteur


def camion_porteur():
    m = Maillage("camion_porteur")
    L, W = 8.6, 2.5
    yf, yr = -L / 2, L / 2
    cabine_camion(m, yf, W, 3.0, (0.85, 0.12, 0.1))
    m.boite((0, 0.6, 0.75), (1.0, L - 1.4, 0.3), GRIS_FONCE)  # châssis
    m.boite((0, yf + 2.45 + 6.0 / 2, 0.98 + 2.6 / 2), (W, 6.0, 2.6), (0.9, 0.9, 0.88), biseau=0.05)  # caisse
    for s in (-1, 1):
        m.boite((s * (W / 2 - 0.15), yr - 0.02, 0.85), (0.2, 0.06, 0.25), FEU_ROUGE, E["feu_arriere"])
    essieux(m, (yf + 1.25, yr - 1.6), W - 0.3, 0.5, 0.32, jumelees=(1,))
    return m


def semi_remorque():
    m = Maillage("semi_remorque")
    L, W = 16.5, 2.55
    yf, yr = -L / 2, L / 2
    cabine_camion(m, yf, W, 3.0, (0.12, 0.25, 0.55))
    m.boite((0, yf + 2.6, 0.75), (1.0, 3.6, 0.3), GRIS_FONCE)  # châssis du tracteur
    m.cylindre((0, yf + 3.4, 1.0), 0.45, 0.12, GRIS_FONCE, segments=8)  # sellette
    long_rem = 13.6
    y0 = yr - long_rem
    m.boite((0, y0 + long_rem / 2, 1.2 + 2.8 / 2), (W, long_rem, 2.8), (0.93, 0.93, 0.92), biseau=0.05)  # remorque
    m.boite((0, y0 + long_rem / 2, 1.08), (W - 0.1, long_rem, 0.25), GRIS_FONCE)
    m.boite((0, y0 + 2.0, 0.6), (1.6, 0.15, 0.8), GRIS)  # béquilles
    for s in (-1, 1):
        m.boite((s * (W / 2 - 0.15), yr - 0.02, 0.85), (0.2, 0.06, 0.25), FEU_ROUGE, E["feu_arriere"])
        m.boite((s * (W / 2 + 0.003), y0 + long_rem / 2, 1.4), (0.01, long_rem - 0.4, 0.03), ORANGE)  # bande réfléchissante
    essieux(m, (yf + 1.25, yf + 4.85), W - 0.3, 0.5, 0.32, jumelees=(1,))
    essieux(m, (yr - 3.3, yr - 2.0, yr - 0.7), W - 0.3, 0.48, 0.38)
    return m


def caisse_bus(m: Maillage, y0, y1, W, H, couleur, nez=False, arriere=False, z0=0.35):
    yf, yr = y0, y1
    pts = [(yf + (0.05 if nez else 0), z0), (yf, z0 + 0.3)]
    pts += [(yf + 0.08, H - 0.35), (yf + 0.3, H)] if nez else [(yf, H)]
    pts += [(yr - (0.25 if arriere else 0), H)]
    pts += [(yr, H - 0.3), (yr, z0)] if arriere else [(yr, z0)]
    m.profil_x(pts, W, couleur, biseau=0.06)
    long = yr - yf
    # Bandeau vitré latéral éclairé
    debut = yf + (1.0 if nez else 0.3)
    fin = yr - (0.6 if arriere else 0.3)
    for s in (-1, 1):
        m.boite((s * (W / 2 + 0.006), (debut + fin) / 2, 1.85), (0.012, fin - debut, 1.15), VITRE_ECLAIREE, E["vitrage"])
        m.boite((s * (W / 2 + 0.009), (debut + fin) / 2, 0.8), (0.01, long - 0.2, 0.12), (0.1, 0.55, 0.45))  # liseré
    return long


def bus_articule():
    m = Maillage("bus_articule")
    W, H = 2.55, 3.0
    L = 18.0
    yf = -L / 2
    caisse_bus(m, yf, yf + 11.4, W, H, BLANC, nez=True)
    caisse_bus(m, yf + 12.0, L / 2, W, H, BLANC, arriere=True)
    m.cylindre((0, yf + 11.7, 1.7), 1.15, 0.8, GRIS_FONCE, axe="Y", segments=12)  # soufflet d'articulation
    m.boite((0, yf + 0.04, 1.95), (W - 0.15, 0.02, 1.45), VITRE_ECLAIREE, E["vitrage"], rot=(-0.06, 0, 0))
    m.boite((0, yf + 0.2, H - 0.15), (W - 0.3, 0.05, 0.22), (0.1, 0.1, 0.1), E["orange"])  # girouette
    for s in (-1, 1):
        m.boite((s * (W / 2 - 0.3), yf - 0.01, 0.65), (0.35, 0.05, 0.14), PHARE, E["phare"])
        m.boite((s * (W / 2 - 0.12), L / 2 + 0.005, 0.9), (0.12, 0.03, 0.4), FEU_ROUGE, E["feu_arriere"])
        # Portes (côté droit et gauche, vitrage sombre)
        for yp in (yf + 0.6, yf + 5.5, yf + 10.2, yf + 15.0):
            m.boite((s * (W / 2 + 0.012), yp, 1.4), (0.01, 1.2, 2.2), VITRE, E["vitrage_sombre"])
    m.boite((0, yf + 4.5, H + 0.18), (1.8, 2.6, 0.36), GRIS_CLAIR, biseau=0.06)  # climatisation
    m.boite((0, yf + 14.5, H + 0.15), (1.6, 2.0, 0.3), GRIS_CLAIR, biseau=0.06)
    m.boite((0, yf + 0.1, 0.48), (W, 0.2, 0.3), GRIS_FONCE)
    essieux(m, (yf + 2.7, yf + 8.6), W - 0.3, 0.5, 0.3, jumelees=(1,))
    essieux(m, (yf + 16.3,), W - 0.3, 0.5, 0.3, jumelees=(0,))
    return m


# ---------------------------------------------------------------------------
# Rames de tram / métro
# ---------------------------------------------------------------------------
def voiture_rame(nom, L, tete: bool) -> Maillage:
    m = Maillage(nom)
    W, H, z0 = 2.65, 3.35, 0.35
    yf, yr = -L / 2, L / 2
    if tete:
        pts = [(yf + 0.5, z0), (yf, 0.95), (yf + 0.15, 1.6), (yf + 0.9, H - 0.05), (yf + 1.2, H), (yr, H), (yr, z0)]
    else:
        pts = [(yf, z0), (yf, H), (yr, H), (yr, z0)]
    blanc = (0.94, 0.94, 0.93)
    m.profil_x(pts, W, peinture_parebrise(blanc, 1.5, E["vitrage"], VITRE_ECLAIREE, ny=-0.4) if tete else blanc,
               biseau=0.08)
    debut = yf + (1.6 if tete else 0.35)
    fin = yr - 0.35
    for s in (-1, 1):
        m.boite((s * (W / 2 + 0.006), (debut + fin) / 2, 2.05), (0.012, fin - debut, 1.25), VITRE_ECLAIREE, E["vitrage"])
        m.boite((s * (W / 2 + 0.01), 0, 0.62), (0.01, L - 0.8, 0.3), (0.55, 0.62, 0.66))  # jupe grise
        n_portes = 2
        for k in range(n_portes):
            yp = debut + (fin - debut) * (k + 0.5) / n_portes
            m.boite((s * (W / 2 + 0.013), yp, 1.55), (0.01, 1.3, 2.3), (0.75, 0.1, 0.25))  # portes colorées
            m.boite((s * (W / 2 + 0.016), yp, 1.75), (0.01, 1.1, 1.3), VITRE, E["vitrage_sombre"])
    if tete:
        for s in (-1, 1):
            m.boite((s * 0.95, yf + 0.06, 0.95), (0.35, 0.08, 0.12), PHARE, E["phare"], rot=(0.3, 0, 0))
            m.boite((s * 1.1, yf + 0.08, 1.2), (0.12, 0.05, 0.08), FEU_ROUGE, E["feu_arriere"])
        m.boite((0, yf + 0.7, H - 0.08), (1.6, 0.05, 0.18), (0.08, 0.08, 0.08), E["orange"])  # girouette
        m.boite((0, 1.5, H + 0.15), (1.4, 3.0, 0.3), GRIS_CLAIR, biseau=0.05)  # équipements de toiture
    else:
        # Pantographe (losange simplifié)
        m.boite((0, 0, H + 0.08), (1.2, 1.2, 0.16), GRIS)
        m.poutre((0, -0.5, H + 0.15), (0, 0.4, H + 0.9), 0.06, GRIS_FONCE)
        m.poutre((0, 0.4, H + 0.9), (0, -0.2, H + 1.45), 0.05, GRIS_FONCE)
        m.boite((0, -0.2, H + 1.47), (1.6, 0.08, 0.05), GRIS_FONCE)
    # Bogies
    for yb in ((yf + 2.4, yr - 2.0) if tete else (yf + 2.0, yr - 2.0)):
        m.boite((0, yb, 0.42), (2.2, 2.2, 0.45), GRIS_FONCE)
        for dy in (-0.8, 0.8):
            for s in (-1, 1):
                m.cylindre((s * 0.72, yb + dy, 0.36), 0.36, 0.12, NOIR_PNEU, axe="X", segments=10)
    return m


def tram_tete():
    return voiture_rame("rame_tete", 16.0, True)


def tram_intermediaire():
    return voiture_rame("rame_intermediaire", 12.0, False)


# ---------------------------------------------------------------------------
MODELES = {
    # id: (fonction, catégorie, peignable, notes)
    "berline": (berline, "vehicule", True, "Berline 4,8 m (carrosserie gris clair à teinter)."),
    "citadine": (citadine, "vehicule", True, "Citadine 3,95 m, hayon."),
    "suv": (suv, "vehicule", True, "SUV 4,7 m, barres de toit."),
    "utilitaire": (utilitaire, "vehicule", True, "Fourgon utilitaire 5,4 m."),
    "camion_porteur": (camion_porteur, "vehicule", False, "Porteur 19 t à caisse fermée, cabine avancée."),
    "semi_remorque": (semi_remorque, "vehicule", False, "Tracteur et remorque 13,6 m, 16,5 m au total."),
    "bus_articule": (bus_articule, "vehicule", False, "Bus urbain articulé 18 m, bandeaux vitrés éclairés."),
    "taxi": (taxi, "vehicule", False, "Berline sombre, lanternon TAXI (code orange)."),
    "police": (police, "vehicule", False, "Berline sérigraphiée, rampe de gyrophares bleus."),
    "ambulance": (ambulance, "vehicule", False, "Fourgon blanc à bandes jaunes, gyrophares bleus."),
    "rame_tete": (tram_tete, "rail", False, "Voiture de tête de tramway / métro léger (16 m)."),
    "rame_intermediaire": (tram_intermediaire, "rail", False, "Voiture intermédiaire avec pantographe (12 m)."),
}


def construire(ids=None):
    for id_m, (fn, cat, peignable, notes) in MODELES.items():
        if ids and id_m not in ids:
            continue
        reinitialiser()
        ob = fn().objet()
        ob.name = id_m
        exporter(id_m, [ob], categorie=cat, peignable=peignable, notes=notes,
                 source="Généré procéduralement (eco-nation/tools/blender/vehicules.py)", licence="CC0")


if __name__ == "__main__":
    construire(sys.argv[1:] or None)
