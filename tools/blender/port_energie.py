"""Portiques portuaires (STS de quai, portique de parc RTG) et éolienne de 150 m.

Lancement : <python avec bpy> tools/blender/port_energie.py
- Portique STS : la flèche s'avance vers -Y Blender (+Z Babylon) = côté eau ; les rails sont parallèles à X.
  Le chariot (avec son spreader) est un nœud séparé « chariot » qui se déplace le long de la flèche.
- Portique RTG : franchit 6 rangées de conteneurs + 1 voie (portée 23,5 m) ; chariot séparé, mobile en X.
- Éolienne : nœuds séparés « mat », « nacelle » (lacet autour de Y) et « rotor » (rotation autour de l'axe
  avant-arrière, Z Babylon), pivots placés au sommet du mât et au centre du moyeu.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_common import (BLANC, EMIT, FEU_ROUGE, GRIS, GRIS_CLAIR, GRIS_FONCE, NOIR_PNEU,  # noqa: E402
                        VITRE_ECLAIREE, Maillage, exporter, reinitialiser)

E = EMIT
ROUGE_PORTIQUE = (0.78, 0.16, 0.1)
JAUNE_PORTIQUE = (0.92, 0.7, 0.08)


def portique_sts():
    m = Maillage("portique_sts")
    ecart_rails = 30.5     # le long de Y
    largeur = 26.0         # entre axes des pieds, le long de X
    h_portail = 46.0
    h_fleche = 49.0
    y_eau, y_terre = -ecart_rails / 2, ecart_rails / 2
    # Pieds, traverses, bogies
    for y in (y_eau, y_terre):
        for s in (-1, 1):
            x = s * largeur / 2
            m.boite((x, y, h_portail / 2 + 1.0), (1.8, 1.8, h_portail - 2.0), ROUGE_PORTIQUE)
            m.boite((x, y, 0.9), (2.4, 9.0, 1.8), GRIS_FONCE)
            for dy in (-3.2, -1.1, 1.1, 3.2):
                m.cylindre((x, y + dy, 0.5), 0.5, 0.6, NOIR_PNEU, axe="X", segments=8)
        m.boite((0, y, h_portail), (largeur + 1.8, 2.2, 2.4), ROUGE_PORTIQUE)   # poutre de portail
        m.boite((0, y, 14.0), (largeur, 1.4, 1.6), ROUGE_PORTIQUE)              # traverse basse
    for s in (-1, 1):
        m.boite((s * largeur / 2, 0, h_portail), (2.0, ecart_rails, 2.0), ROUGE_PORTIQUE)
        m.boite((s * largeur / 2, 0, 14.0), (1.4, ecart_rails, 1.4), ROUGE_PORTIQUE)
        m.poutre((s * largeur / 2, y_eau, 14.0), (s * largeur / 2, y_terre, h_portail), 0.9, ROUGE_PORTIQUE)
    # Flèche (deux poutres-caissons) : avant-bec de 65 m côté eau, arrière-bec de 22 m côté terre
    y_bec = y_eau - 65.0
    y_arr = y_terre + 22.0
    for s in (-1, 1):
        m.boite((s * 4.2, (y_bec + y_arr) / 2, h_fleche), (1.6, y_arr - y_bec, 3.2), BLANC)
        m.boite((s * 4.2, (y_bec + y_arr) / 2, h_fleche - 1.7), (2.0, y_arr - y_bec, 0.3), GRIS)  # rails du chariot
    for k in range(9):
        y = y_bec + 3 + k * (y_arr - y_bec - 6) / 8
        m.boite((0, y, h_fleche + 1.0), (8.4, 0.8, 0.8), BLANC)
    # Chevalement (A-frame) et haubans
    apex_z = 80.0
    apex_y = y_terre - 4.0
    for s in (-1, 1):
        m.poutre((s * 4.2, y_eau, h_fleche + 1.5), (s * 3.0, apex_y, apex_z), 1.4, ROUGE_PORTIQUE)
        m.poutre((s * 4.2, y_terre + 2, h_fleche + 1.5), (s * 3.0, apex_y, apex_z), 1.4, ROUGE_PORTIQUE)
        m.poutre((s * 3.0, apex_y, apex_z), (s * 4.2, y_bec + 4, h_fleche + 1.6), 0.45, GRIS_FONCE, segments=6)
        m.poutre((s * 3.0, apex_y, apex_z), (s * 4.2, y_eau - 30, h_fleche + 1.6), 0.45, GRIS_FONCE, segments=6)
        m.poutre((s * 3.0, apex_y, apex_z), (s * 4.2, y_arr - 2, h_fleche + 1.6), 0.5, GRIS_FONCE, segments=6)
    m.boite((0, apex_y, apex_z + 0.5), (8.0, 2.0, 1.6), ROUGE_PORTIQUE)
    m.boite((0, apex_y, apex_z + 1.6), (0.6, 0.6, 0.6), FEU_ROUGE, E["feu_arriere"])
    m.boite((0, y_bec + 1.0, h_fleche + 2.0), (0.6, 0.6, 0.6), FEU_ROUGE, E["feu_arriere"])
    # Salle des machines sur l'arrière-bec
    m.boite((0, y_arr - 8.0, h_fleche + 4.6), (11.0, 12.0, 6.0), BLANC, biseau=0.2)
    # Projecteurs sous la flèche
    for y in (y_bec + 10, y_eau - 20, y_eau, y_terre):
        m.boite((0, y, h_fleche - 2.0), (2.0, 0.6, 0.3), (1, 0.95, 0.85), E["eclairage"])
    tronc = m.objet()
    tronc.name = "portique_sts"
    # Chariot + cabine + spreader (nœud séparé)
    c = Maillage("chariot")
    yc = y_eau - 20.0
    c.boite((0, yc, h_fleche + 0.6), (10.0, 6.0, 1.6), GRIS_CLAIR)
    c.boite((0, yc - 1.0, h_fleche - 4.0), (2.6, 3.0, 2.8), BLANC)  # cabine du grutier
    c.boite((0, yc - 2.55, h_fleche - 4.0), (2.4, 0.06, 2.0), VITRE_ECLAIREE, E["vitrage"])
    for s in (-1, 1):
        c.poutre((s * 2.0, yc, h_fleche - 0.5), (s * 2.0, yc, 20.5), 0.12, GRIS_FONCE, segments=4)
    c.boite((0, yc, 20.0), (2.6, 12.4, 0.9), JAUNE_PORTIQUE)
    chariot = c.objet(origine=(0, yc, h_fleche))
    chariot.name = "chariot"
    return [tronc, chariot], [{
        "nom": "chariot", "type": "translation", "axe": "z", "pivot_m": [0.0, h_fleche, -yc],
        "course_m": [round(-y_arr + 6, 1), round(-y_bec - 4, 1)],
        "description": "Chariot et spreader : translation le long de la flèche (axe Z Babylon, +Z = côté eau).",
    }]


def portique_rtg():
    m = Maillage("portique_rtg")
    portee = 23.5   # le long de X
    empattement = 12.0  # le long de Y
    h = 25.5
    for s in (-1, 1):
        x = s * portee / 2
        # Deux pieds inclinés par côté, poutre inférieure, bogies à pneus
        for sy in (-1, 1):
            m.poutre((x, sy * (empattement / 2 - 1.0), 2.2), (x, sy * 2.2, h - 1.0), 1.3, JAUNE_PORTIQUE)
            for dx in (-0.6, 0.6):
                m.cylindre((x + dx, sy * (empattement / 2 - 0.5), 0.8), 0.8, 0.6, NOIR_PNEU, axe="X", segments=10)
        m.boite((x, 0, 1.9), (1.4, empattement, 1.2), JAUNE_PORTIQUE)
        m.boite((x, 0, h), (2.0, 6.0, 2.0), JAUNE_PORTIQUE)
    for sy in (-1, 1):
        m.boite((0, sy * 2.2, h + 0.4), (portee + 2.0, 1.4, 2.4), JAUNE_PORTIQUE)
    m.boite((portee / 2 + 2.0, 0, 4.0), (2.4, 4.0, 3.0), BLANC, biseau=0.1)  # groupe électrogène
    m.boite((-portee / 2, 3.0, h + 2.2), (0.5, 0.5, 0.5), (1, 0.62, 0.1), E["orange"])
    m.boite((portee / 2, -3.0, h + 2.2), (0.5, 0.5, 0.5), (1, 0.62, 0.1), E["orange"])
    tronc = m.objet()
    tronc.name = "portique_rtg"
    c = Maillage("chariot")
    c.boite((0, 0, h + 2.2), (4.0, 5.8, 1.6), GRIS_CLAIR)
    c.boite((-1.0, -3.4, h - 1.0), (2.0, 2.0, 2.2), BLANC)
    c.boite((-1.0, -4.42, h - 1.0), (1.8, 0.05, 1.5), VITRE_ECLAIREE, E["vitrage"])
    for s in (-1, 1):
        c.poutre((s * 1.0, 0, h + 1.4), (s * 1.0, 0, 9.0), 0.1, GRIS_FONCE, segments=4)
    c.boite((0, 0, 8.6), (2.6, 12.4, 0.8), GRIS_FONCE)
    chariot = c.objet(origine=(0, 0, h + 2.2))
    chariot.name = "chariot"
    return [tronc, chariot], [{
        "nom": "chariot", "type": "translation", "axe": "x", "pivot_m": [0.0, h + 2.2, 0.0],
        "course_m": [-portee / 2 + 2.5, portee / 2 - 2.5],
        "description": "Chariot et spreader : translation transversale (axe X Babylon).",
    }]


def eolienne():
    h_moyeu = 95.0
    l_pale = 55.0
    mat = Maillage("mat")
    mat.cylindre((0, 0, h_moyeu / 2 - 1.0), 2.2, h_moyeu - 2.0, BLANC, segments=16, rayon2=1.35, bouchons=False)
    mat.cylindre((0, 0, 0.6), 3.0, 1.2, GRIS_CLAIR, segments=16)   # embase
    ob_mat = mat.objet()
    ob_mat.name = "mat"
    # Nacelle : pivot au sommet du mât
    n = Maillage("nacelle")
    zt = h_moyeu - 2.0
    n.boite((0, 1.2, h_moyeu), (4.0, 11.0, 4.2), BLANC, biseau=0.6)
    n.boite((0, 6.6, h_moyeu + 0.6), (3.2, 0.4, 2.8), GRIS_CLAIR)
    n.boite((0, 5.5, h_moyeu + 2.3), (0.4, 0.4, 0.5), FEU_ROUGE, E["feu_arriere"])  # balisage aéronautique
    ob_nac = n.objet(origine=(0, 0, zt))
    ob_nac.name = "nacelle"
    # Rotor : moyeu + 3 pales, pivot au centre du moyeu, axe de rotation = Y Blender (Z Babylon)
    r = Maillage("rotor")
    y_moyeu = -5.6
    r.cylindre((0, y_moyeu + 0.6, h_moyeu), 1.9, 2.2, BLANC, axe="Y", segments=12, rayon2=1.7)
    r.cylindre((0, y_moyeu - 1.2, h_moyeu), 1.7, 1.6, BLANC, axe="Y", segments=12, rayon2=0.4)
    stations = [(1.2, 1.2, 1.0, 0), (5, 3.2, 0.9, 8), (12, 4.0, 0.6, 12), (22, 3.3, 0.42, 9), (34, 2.4, 0.3, 6),
                (46, 1.5, 0.2, 3), (54, 0.7, 0.1, 1)]
    for k in range(3):
        a = 2 * math.pi * k / 3
        ca, sa = math.cos(a), math.sin(a)
        anneaux = []
        for rr, corde, ep, vrille in stations:
            v = math.radians(vrille)
            pts2 = [(-corde * 0.3, 0.0), (0.0, ep * corde * 0.5), (corde * 0.7, 0.0), (0.0, -ep * corde * 0.3)]
            anneau = []
            for u, w in pts2:
                uu = u * math.cos(v) - w * math.sin(v)
                ww = u * math.sin(v) + w * math.cos(v)
                # Repère local : rayon le long de Z tourné de a dans le plan XZ, corde selon X local, épaisseur selon Y
                x_l, z_l = uu, rr
                anneau.append((x_l * ca + z_l * sa, y_moyeu + 0.2 + ww, h_moyeu - x_l * sa + z_l * ca))
            anneaux.append(anneau)
        r.lissage_anneaux(anneaux, BLANC, fermer_debut=True, pointe_fin=None)
    ob_rot = r.objet(origine=(0, y_moyeu, h_moyeu))
    ob_rot.name = "rotor"
    parties = [
        {"nom": "nacelle", "type": "rotation", "axe": "y", "pivot_m": [0.0, zt, 0.0],
         "description": "Lacet de la nacelle (et du rotor) autour de l'axe vertical."},
        {"nom": "rotor", "type": "rotation", "axe": "z", "pivot_m": [0.0, h_moyeu, -y_moyeu],
         "vitesse_tr_min": [6, 14], "description": "Rotation du rotor autour de l'axe avant-arrière (Z Babylon)."},
    ]
    return [ob_mat, ob_nac, ob_rot], parties


MODELES = {
    "portique_sts": (portique_sts, "port", "Portique de quai ship-to-shore : 30,5 m entre rails, avant-bec 65 m, "
                     "flèche à 49 m."),
    "portique_rtg": (portique_rtg, "port", "Portique de parc sur pneus (RTG) : portée 23,5 m, 1 sur 5."),
    "eolienne": (eolienne, "energie", "Éolienne terrestre de 150 m en bout de pale : moyeu à 95 m, rotor de 110 m."),
}


def construire(ids=None):
    for id_m, (fn, cat, notes) in MODELES.items():
        if ids and id_m not in ids:
            continue
        reinitialiser()
        objets, parties = fn()
        exporter(id_m, objets, categorie=cat, notes=notes, parties=parties,
                 source="Généré procéduralement (eco-nation/tools/blender/port_energie.py)")


if __name__ == "__main__":
    construire(sys.argv[1:] or None)
