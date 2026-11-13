#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_trees.py — Générateur procédural d'arbres feuillus DENSES pour le city-builder (Three.js).

Outils : Blender en module Python (bpy 5.3, rendu Cycles CPU) + numpy. Déterministe pour une graine donnée.

Principe (technique des « cartes de rameaux ») :
  1. Une feuille (contour denté/lobé propre à l'essence, nervures peintes dans une petite texture) est
     maillée en 3D (pliée, courbée), puis assemblée en RAMEAUX (tiges, pétioles, 20-80 feuilles).
  2. Quatre rameaux sont RENDUS par Cycles (vue orthographique, fond transparent) dans un atlas 1024 px :
     couleur (albédo x occlusion ambiante : ciel blanc uniforme) + alpha + carte de normales (passe
     d'émission des normales). Cases 0-2 : rameaux simples ; case 3 : bouquet dense (pour le LOD1).
  3. La ramure est obtenue par « colonisation de l'espace » (Runions et al. 2007) dans une enveloppe de
     couronne propre à l'essence (ronde, ovoïde, fusiforme...) ; rayons par le modèle des tuyaux
     (Léonard de Vinci) ; tronc évasé au pied ; branches maillées en tubes effilés, UV d'écorce en mètres.
  4. L'écorce est un bruit procédural (spectre anisotrope, périodique par FFT) cuit en textures
     albédo + normales.
  5. La couronne est habillée de cartes de rameaux (quads pliés au LOD0, quads simples au LOD1) orientées
     vers l'extérieur ; normales de sommets « sphériques » (mélange normale de carte / normale de
     l'enveloppe) pour un ombrage de volume ; couleur de sommet = variation de teinte par carte x
     occlusion (intérieur et bas de couronne plus sombres).
  6. LOD2 = imposteur : 3 plans verticaux à 60° + 1 plan horizontal (8 triangles), texture rendue par
     Cycles depuis le LOD0 (couleur + normales en espace caméra = espace tangent des plans).
  7. Écriture GLB maison (glTF 2.0, textures WebP intégrées via EXT_texture_webp, feuillage alphaMode MASK
     double face) ; origine au pied du tronc, Y vers le haut, mètres ; aucune transformation de nœud.

Usage :
  nice -n 15 bpyenv/bin/python generate_trees.py [--only id1,id2] [--seed N] [--fast] [--out DIR]
"""
import argparse
import json
import math
import os
import struct
import sys
import time

import numpy as np
import bpy
import mathutils

ICI = os.path.dirname(os.path.abspath(__file__))
SEED_DEFAUT = 20261113
CUTOFF = 0.42  # seuil alpha (MASK) commun au GLB et aux rendus Cycles de l'imposteur
SPECULAR_FEUILLAGE = 0.3  # KHR_materials_specular du feuillage (1 = défaut glTF)

# =====================================================================================================
# 1. ESSENCES
# =====================================================================================================
# crown : enveloppe de couronne. y0/y1 = bas/haut (m), R = rayon max, m = hauteur relative du rayon max,
#         p_bot/p_top = exposants du profil (0,5 = ellipse ; > 0,5 = plus pointu), lump = bosses.
# sc    : colonisation de l'espace. n_attr = attracteurs, D = pas de croissance, di = rayon d'influence,
#         dk = distance de destruction, tropism = attraction vers le haut, jitter = bruit de direction.
# leaf  : feuille (longueur en m, pétiole relatif, espacement sur la tige, angle d'insertion, dents...).
# twig  : rameau (S = taille physique d'une case d'atlas en m, Sc = taille du bouquet de la case 3).
# cards0/cards1 : nombre et taille (relative à S / Sc) des cartes aux LOD0 et LOD1.
# budget_br : budget de triangles des branches (LOD0, LOD1).
SPECIES = {
    'arbre_feuillu_rond': dict(
        nomFr='Tilleul (feuillu à couronne ronde)', essence='Tilia cordata',
        tags=['arbre', 'feuillu', 'rue', 'parc', 'tilleul'],
        trunk_clear=2.5, trunk_r=0.23, tip_r=0.006,
        crown=dict(y0=2.2, y1=10.8, R=4.2, m=0.42, p_bot=0.55, p_top=0.62, lump=0.10),
        sc=dict(n_attr=2600, D=0.30, di=1.9, dk=0.55, tropism=0.12, jitter=0.20),
        leaf=dict(shape='cordate', length=0.075, petiole=0.40, spacing=0.030, angle=62, teeth=17,
                  tooth=0.022, opposite=False, top=(0.33, 0.46, 0.17), under=(0.52, 0.60, 0.38),
                  veins='pinnate'),
        twig=dict(S=0.50, side=6, side2=3, side_len=(0.38, 0.60), main_len=0.90, Sc=0.85, cluster_n=4),
        bark=dict(kind='fissure', dark=(0.17, 0.155, 0.135), light=(0.44, 0.41, 0.36), stretch=5.0,
                  depth=0.35, lichen=0.30),
        cards0=dict(n=2650, size=(1.0, 1.35)),
        cards1=dict(n=1000, size=(1.0, 1.3)),
        budget_br=(3000, 420),
        twig_r=0.03,
    ),
    'arbre_feuillu_jeune': dict(
        nomFr="Jeune feuillu d'alignement (érable plane)", essence='Acer platanoides (jeune)',
        tags=['arbre', 'feuillu', 'rue', 'jardin', 'alignement', 'erable'],
        trunk_clear=2.1, trunk_r=0.085, tip_r=0.005,
        crown=dict(y0=1.9, y1=5.85, R=1.65, m=0.45, p_bot=0.55, p_top=0.60, lump=0.08),
        sc=dict(n_attr=1100, D=0.19, di=1.1, dk=0.34, tropism=0.22, jitter=0.20),
        leaf=dict(shape='palmate', lobes=[(0, 0.55), (55, 0.50), (-55, 0.50), (108, 0.32), (-108, 0.32)],
                  r0=0.20, lobe_e=9.0, length=0.085, petiole=0.75, spacing=0.05, angle=58, teeth=46,
                  tooth=0.035, opposite=True, top=(0.30, 0.43, 0.15), under=(0.46, 0.56, 0.32),
                  veins='palmate'),
        twig=dict(S=0.48, side=4, side2=2, side_len=(0.40, 0.62), main_len=0.90, Sc=0.85, cluster_n=4),
        bark=dict(kind='lisse', dark=(0.17, 0.155, 0.13), light=(0.38, 0.36, 0.32), stretch=3.0,
                  depth=0.18, lichen=0.12),
        cards0=dict(n=1300, size=(0.95, 1.30)),
        cards1=dict(n=640, size=(1.0, 1.25)),
        budget_br=(2000, 260),
        twig_r=0.02,
    ),
    'arbre_peuplier': dict(
        nomFr="Peuplier d'Italie (fusiforme, alignement)", essence="Populus nigra 'Italica'",
        tags=['arbre', 'feuillu', 'rue', 'avenue', 'alignement', 'riviere', 'peuplier'],
        trunk_clear=1.1, trunk_r=0.27, tip_r=0.006,
        crown=dict(y0=0.9, y1=15.6, R=1.85, m=0.30, p_bot=0.50, p_top=0.95, lump=0.06),
        sc=dict(n_attr=2400, D=0.30, di=1.7, dk=0.48, tropism=0.55, jitter=0.18),
        leaf=dict(shape='deltoid', length=0.062, petiole=0.60, spacing=0.028, angle=48, teeth=13,
                  tooth=0.020, opposite=False, top=(0.27, 0.40, 0.15), under=(0.46, 0.55, 0.36),
                  veins='pinnate'),
        twig=dict(S=0.46, side=6, side2=3, side_len=(0.38, 0.60), main_len=0.92, Sc=0.8, cluster_n=4),
        bark=dict(kind='crevasse', dark=(0.10, 0.095, 0.085), light=(0.36, 0.345, 0.32), stretch=6.0,
                  depth=0.7, lichen=0.20),
        cards0=dict(n=2100, size=(1.0, 1.35)),
        cards1=dict(n=900, size=(1.0, 1.3)),
        budget_br=(2800, 380),
        twig_r=0.03,
        upright=0.55,  # rameaux redressés (port fastigié)
    ),
    'arbre_platane': dict(
        nomFr='Platane (grand arbre d’avenue)', essence='Platanus x hispanica',
        tags=['arbre', 'feuillu', 'avenue', 'parc', 'rue', 'platane'],
        trunk_clear=3.0, trunk_r=0.34, tip_r=0.007,
        crown=dict(y0=2.8, y1=14.6, R=5.6, m=0.46, p_bot=0.50, p_top=0.55, lump=0.12),
        sc=dict(n_attr=3200, D=0.36, di=2.3, dk=0.65, tropism=0.10, jitter=0.22),
        leaf=dict(shape='palmate', lobes=[(0, 0.50), (58, 0.46), (-58, 0.46), (112, 0.24), (-112, 0.24)],
                  r0=0.30, lobe_e=5.0, length=0.13, petiole=0.45, spacing=0.085, angle=60, teeth=26,
                  tooth=0.025, opposite=False, top=(0.34, 0.46, 0.17), under=(0.50, 0.58, 0.38),
                  veins='palmate'),
        twig=dict(S=0.75, side=5, side2=2, side_len=(0.38, 0.60), main_len=0.90, Sc=1.25, cluster_n=4),
        bark=dict(kind='platane', dark=(0.33, 0.31, 0.24), light=(0.70, 0.67, 0.55), stretch=1.3,
                  depth=0.12, lichen=0.0),
        cards0=dict(n=2700, size=(1.0, 1.35)),
        cards1=dict(n=1150, size=(1.05, 1.35)),
        budget_br=(3400, 520),
        twig_r=0.035,
    ),
}

# =====================================================================================================
# 2. UTILITAIRES NUMÉRIQUES
# =====================================================================================================

def nrm(v):
    """Normalise des vecteurs (dernier axe)."""
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lin2srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))


def rot_axis(axis, ang):
    """Matrice de rotation 3x3 autour d'un axe unitaire (Rodrigues)."""
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    x, y, z = axis
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def noise_field(n, rng, slope=1.0, ax=1.0, ay=1.0, kmin=1.0, kmax=None):
    """Bruit périodique (tuilable) par filtrage spectral d'un bruit blanc : amplitude ~ k^-slope.
    ay > 1 : fréquences verticales atténuées -> motifs étirés verticalement (lignes de l'image)."""
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    ky = np.fft.fftfreq(n)[:, None] * n
    kx = np.fft.fftfreq(n)[None, :] * n
    k = np.sqrt((kx * ax) ** 2 + (ky * ay) ** 2)
    filt = 1.0 / np.power(np.maximum(k, kmin), slope)
    if kmax is not None:
        filt *= np.exp(-(k / kmax) ** 2)
    filt[0, 0] = 0
    f = np.real(np.fft.ifft2(F * filt))
    return (f - f.mean()) / (f.std() + 1e-9)


def down2(img):
    """Réduction x2 par moyenne de 4 pixels."""
    return 0.25 * (img[0::2, 0::2] + img[1::2, 0::2] + img[0::2, 1::2] + img[1::2, 1::2])


def fill_holes(rgb, valid):
    """Remplissage « pull-push » : les pixels non valides prennent la couleur moyenne des pixels valides
    les plus proches (pyramide). Évite les halos (blancs ou noirs) dus au filtrage / aux mipmaps."""
    levels = [(rgb * valid[..., None], valid.astype(np.float64))]
    while levels[-1][1].shape[0] > 1 and levels[-1][1].shape[1] > 1:
        c, w = levels[-1]
        h2, w2 = c.shape[0] // 2, c.shape[1] // 2
        c2 = c[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, c.shape[2]).sum((1, 3))
        ww = w[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum((1, 3))
        levels.append((c2, ww))
    c, w = levels[-1]
    col = c / np.maximum(w, 1e-9)[..., None]
    for c, w in reversed(levels[:-1]):
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)
        if up.shape[0] < c.shape[0] or up.shape[1] < c.shape[1]:
            up = np.pad(up, ((0, c.shape[0] - up.shape[0]), (0, c.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        up = up[:c.shape[0], :c.shape[1]]
        own = c / np.maximum(w, 1e-9)[..., None]
        col = np.where(w[..., None] > 0, own, up)
    return col


def finish_rgba(prem):
    """Rendu Cycles (RVBA linéaire prémultiplié) -> RVBA sRGB droit, transparents remplis par dilatation."""
    a = prem[..., 3]
    rgb = prem[..., :3] / np.maximum(a, 1e-6)[..., None]
    valid = a > 0.2
    rgb = np.where(valid[..., None], rgb, 0)
    rgb = fill_holes(rgb, valid)
    out = np.concatenate([lin2srgb(rgb), a[..., None]], axis=-1)
    return np.clip(out, 0, 1)


def finish_normal(prem):
    """Passe de normales (émission n*0,5+0,5, prémultipliée) -> carte de normales tangente (RVB 0..1)."""
    a = prem[..., 3]
    n = prem[..., :3] / np.maximum(a, 1e-6)[..., None] * 2 - 1
    n[..., 2] = np.where(n[..., 2] < 0, -n[..., 2], n[..., 2])  # toujours vers l'observateur
    n = nrm(n)
    valid = a > 0.2
    n = np.where(valid[..., None], n, np.array([0, 0, 1.0]))
    n = nrm(fill_holes(n, valid))
    return np.clip(n * 0.5 + 0.5, 0, 1)


def orient_faces(V, F, Nref):
    """Inverse les triangles dont la normale géométrique s'oppose à la normale de référence (par face)."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    fn = np.cross(b - a, c - a)
    flip = (fn * Nref).sum(1) < 0
    F = F.copy()
    F[flip] = F[flip][:, [0, 2, 1]]
    return F


# =====================================================================================================
# 3. TEXTURES PROCÉDURALES : ÉCORCE ET FEUILLE
# =====================================================================================================

def bark_textures(b, rng, n=512):
    """Écorce : relief (fissures étirées verticalement) -> albédo sRGB (n,n,3) + normales (n,n,3).
    Lignes de l'image = axe de la branche (v), colonnes = tour de la branche (u). Tuilable."""
    n1 = noise_field(n, rng, 1.25, 1.0, b['stretch'], kmin=3.0)
    n2 = noise_field(n, rng, 0.9, 1.0, 1.6, kmin=8.0)
    n3 = noise_field(n, rng, 1.6, 1.0, 1.0, kmin=1.5)
    n4 = noise_field(n, rng, 1.3, 1.0, 1.0, kmin=4.0)
    kind = b['kind']
    if kind == 'platane':
        # plaques qui se détachent : taches de couleur à bords nets, relief faible
        plates = smoothstep(-0.15, 0.15, n3) * 0.6 + smoothstep(0.2, 0.5, n4) * 0.4
        h = 0.5 + 0.25 * plates + 0.06 * n2
        cols = [np.array(b['dark']), np.array([0.55, 0.53, 0.40]), np.array(b['light'])]
        t = np.clip(plates, 0, 1)[..., None]
        alb = np.where(t < 0.5, cols[0] + (cols[1] - cols[0]) * (t / 0.5), cols[1] + (cols[2] - cols[1]) * ((t - 0.5) / 0.5))
        alb = alb * (1 + 0.08 * n2[..., None])
        strength = 2.0
    else:
        width = {'fissure': 0.45, 'crevasse': 0.75, 'lisse': 0.25}[kind]
        ridge = smoothstep(0.0, width, np.abs(n1))          # 0 au fond des fissures, 1 sur les crêtes
        h = ridge * b['depth'] + 0.05 * n2 + 0.03 * n4
        t = np.clip(ridge * 0.85 + 0.15 * smoothstep(-1, 1, n2), 0, 1)[..., None]
        alb = np.array(b['dark']) + (np.array(b['light']) - np.array(b['dark'])) * t
        alb = alb * (1 + 0.10 * n3[..., None])
        if b['lichen'] > 0:
            lic = smoothstep(1.0, 1.8, n4) * b['lichen'] * ridge
            alb = alb + (np.array([0.42, 0.46, 0.32]) - alb) * lic[..., None]
        strength = 6.0 * b['depth'] + 1.0
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength * n / 64
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength * n / 64
    nm = nrm(np.stack([-gx, -gy, np.ones_like(h)], -1))
    return np.clip(alb, 0, 1), nm * 0.5 + 0.5


def catmull(ctrl, per_seg=24):
    P = np.asarray(ctrl, float)
    Pp = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = Pp[i:i + 4]
        t = np.linspace(0, 1, per_seg, endpoint=False)[:, None]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1:])
    return np.vstack(out)


def resample(P, n):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    s = np.linspace(0, d[-1], n)
    return np.stack([np.interp(s, d, P[:, 0]), np.interp(s, d, P[:, 1])], 1)


HALF_OUTLINES = {
    # demi-contour droit, du sinus du pétiole (0,0) à la pointe (0,1)
    'cordate': [(0, 0), (0.10, -0.075), (0.28, -0.065), (0.42, 0.07), (0.47, 0.29), (0.43, 0.50),
                (0.32, 0.70), (0.17, 0.86), (0.05, 0.965), (0, 1.0)],
    'deltoid': [(0, 0), (0.17, 0.0), (0.35, 0.05), (0.46, 0.17), (0.41, 0.35), (0.29, 0.57),
                (0.15, 0.79), (0.04, 0.95), (0, 1.0)],
}


def leaf_outline(lf, n=150):
    """Contour fermé (sens trigonométrique) d'une feuille de longueur 1 (pétiole en (0,0), pointe ~(0,1)),
    centre d'étoilement c, et extrémités des nervures principales."""
    if lf['shape'] in HALF_OUTLINES:
        half = resample(catmull(HALF_OUTLINES[lf['shape']]), n // 2)
        # dents orientées vers la pointe, atténuées au pied et à la pointe
        d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(half, axis=0), axis=1))]
        s = d / d[-1]
        tang = np.gradient(half, axis=0)
        out_n = nrm(np.stack([tang[:, 1], -tang[:, 0]], 1))
        saw = np.power(np.mod(s * lf['teeth'], 1.0), 1.6)
        amp = lf['tooth'] * smoothstep(0.04, 0.2, s) * smoothstep(1.0, 0.85, s)
        right = half + out_n * (saw * amp)[:, None]
        left = right[::-1].copy()
        left[:, 0] *= -0.93  # légère asymétrie (base oblique du tilleul)
        P = np.vstack([right, left[1:-1]])
        c = np.array([0.0, 0.36])
        veins = [np.array([0, 1.0])]
        if lf['shape'] == 'cordate':
            veins += [np.array([0.36, 0.30]), np.array([-0.33, 0.30])]
        else:
            veins += [np.array([0.36, 0.22]), np.array([-0.34, 0.22])]
        return P, c, veins
    # feuille palmée (érable, platane) : rayon polaire somme de lobes
    th = np.linspace(-np.pi / 2, 1.5 * np.pi, n, endpoint=False)
    r = np.full_like(th, lf['r0'])
    tips = []
    for a_deg, L in lf['lobes']:
        thk = np.pi / 2 - math.radians(a_deg)
        dd = np.angle(np.exp(1j * (th - thk)))
        cs = np.maximum(0, np.cos(dd))
        r += L * cs ** lf['lobe_e'] + 0.18 * L * cs ** (lf['lobe_e'] * 8)
        tips.append(thk)
    lobe_w = (r - lf['r0']) / (r.max() - lf['r0'])
    r += lf['tooth'] * np.power(np.abs(np.sin(th * lf['teeth'] / 2)), 3) * lobe_w
    r *= 1 - 0.88 * np.maximum(0, np.cos(th + np.pi / 2)) ** 8   # sinus du pétiole
    P = np.stack([r * np.cos(th), r * np.sin(th)], 1)
    base = P[0].copy()
    P -= base
    sc = 1.0 / P[:, 1].max()
    P *= sc
    c = (np.array([0, 0]) - base) * sc
    veins = []
    for thk in tips:
        i = int(np.argmin(np.abs(np.angle(np.exp(1j * (th - thk))))))
        veins.append(P[i] * 0.93)
    return P, c, veins


LEAF_DOM = (-0.85, 0.85, -0.45, 1.25)  # domaine (x0,x1,y0,y1) couvert par la texture de feuille


def leaf_uv(xy):
    x0, x1, y0, y1 = LEAF_DOM
    return np.stack([(xy[:, 0] - x0) / (x1 - x0), (xy[:, 1] - y0) / (y1 - y0)], 1)


def leaf_texture(lf, rng, P, c, veins, n=256):
    """Texture sRGB de la face supérieure : vert de l'essence, nervures plus claires, marbrure, bord."""
    x0, x1, y0, y1 = LEAF_DOM
    ys, xs = np.mgrid[0:n, 0:n]
    X = x0 + (xs + 0.5) / n * (x1 - x0)
    Y = y0 + (ys + 0.5) / n * (y1 - y0)            # ligne 0 = bas (convention Blender)
    top = np.array(lf['top'])
    col = np.ones((n, n, 3)) * top
    # rapport au contour (feuille étoilée autour de c) -> assombrissement/jaunissement du bord
    ang_p = np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0])
    rad_p = np.hypot(P[:, 0] - c[0], P[:, 1] - c[1])
    o = np.argsort(ang_p)
    ang_s, rad_s = ang_p[o], rad_p[o]
    angs = np.arctan2(Y - c[1], X - c[0])
    rr = np.hypot(X - c[0], Y - c[1]) / np.interp(angs, ang_s, rad_s, period=2 * np.pi)
    col = col * (1.0 + 0.10 * (1 - smoothstep(0.0, 0.8, rr)))[..., None]
    edge = smoothstep(0.80, 1.0, rr)[..., None]
    col = col * (1 - 0.18 * edge) + np.array([0.04, 0.04, -0.01]) * edge
    # nervures : principales (segments depuis la base) + secondaires pennées le long de chacune
    vein = np.zeros((n, n))
    base = np.array([0.0, 0.0]) if lf['veins'] == 'pinnate' else np.array([0.0, 0.0])
    for k, tip in enumerate(veins):
        d = tip - base
        L = np.linalg.norm(d)
        u = d / L
        s = (X - base[0]) * u[0] + (Y - base[1]) * u[1]
        t = -(X - base[0]) * u[1] + (Y - base[1]) * u[0]
        inside = (s > 0) & (s < L)
        wmain = 0.012 * (1.15 - s / L) if k == 0 else 0.008 * (1.1 - s / L)
        vein = np.maximum(vein, np.where(inside, np.exp(-(t / np.maximum(wmain, 1e-3)) ** 2), 0))
        sp = 0.085 if k == 0 else 0.07
        q = np.mod((s - 0.75 * np.abs(t)) / sp, 1.0)
        sec = np.exp(-((np.minimum(q, 1 - q) * sp) / 0.0045) ** 2)
        sec *= inside * (np.abs(t) < 0.42 * L) * smoothstep(0.42 * L, 0.05, np.abs(t))
        vein = np.maximum(vein, sec * 0.6)
    col = col + (np.array([0.70, 0.78, 0.45]) - col) * (vein * 0.38)[..., None]
    mott = noise_field(n, rng, 1.2, kmin=6.0)
    col = col * (1 + 0.06 * mott)[..., None]
    return np.clip(col, 0, 1)


def leaf_template(lf, rings=3):
    """Maillage 2D en éventail/anneaux d'une feuille étoilée : sommets (m,2), triangles."""
    P, c, veins = leaf_outline(lf)
    n = len(P)
    V = [c[None, :]]
    for k in range(1, rings + 1):
        V.append(c + (k / rings) * (P - c))
    V = np.vstack(V)
    F = []
    for i in range(n):
        j = (i + 1) % n
        F.append((0, 1 + i, 1 + j))
    for k in range(1, rings):
        a0, b0 = 1 + (k - 1) * n, 1 + k * n
        for i in range(n):
            j = (i + 1) % n
            F.append((a0 + i, b0 + i, b0 + j))
            F.append((a0 + i, b0 + j, a0 + j))
    return V, np.array(F, np.int32), P, c, veins


# =====================================================================================================
# 4. TUBES (tiges, branches, tronc)
# =====================================================================================================

def tube(P, R, segs, u_rep=1.0, v_scale=1.0, cap=True, lobes=None, v0=0.0):
    """Tube effilé le long d'une polyligne P (n,3) de rayons R (n). Repères par transport parallèle.
    Renvoie V, N, UV (convention Blender : v vers le haut), F (orientées vers l'extérieur)."""
    P = np.asarray(P, float)
    n = len(P)
    T = np.gradient(P, axis=0) if n > 2 else np.repeat((P[1:] - P[:1]), n, 0)
    T = nrm(T)
    a = np.array([0, 1.0, 0]) if abs(T[0][1]) < 0.9 else np.array([1.0, 0, 0])
    Nf = [nrm(np.cross(T[0], a))]
    for i in range(1, n):
        v = Nf[-1] - T[i] * np.dot(Nf[-1], T[i])
        if np.linalg.norm(v) < 1e-6:
            v = np.cross(T[i], a)
        Nf.append(nrm(v))
    Nf = np.array(Nf)
    Bf = np.cross(T, Nf)
    ang = np.linspace(0, 2 * np.pi, segs + 1)
    ca, sa = np.cos(ang), np.sin(ang)
    rr = np.asarray(R, float)[:, None] * np.ones((1, segs + 1))
    if lobes is not None:  # contreforts du pied du tronc
        amp, k, ph = lobes
        rr = rr * (1 + amp[:, None] * np.cos(k * ang[None, :] + ph))
    dirs = ca[None, :, None] * Nf[:, None, :] + sa[None, :, None] * Bf[:, None, :]
    V = P[:, None, :] + rr[..., None] * dirs
    N = dirs.copy()
    cum = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    U = np.stack(np.broadcast_arrays((ang / (2 * np.pi) * u_rep)[None, :], (v0 + cum * v_scale)[:, None]), -1)
    V = V.reshape(-1, 3)
    N = N.reshape(-1, 3)
    U = U.reshape(-1, 2)
    W = segs + 1
    ii = np.arange(n - 1)[:, None]
    kk = np.arange(segs)[None, :]
    p0 = ii * W + kk
    p1, p2, p3 = p0 + 1, p0 + W + 1, p0 + W
    F = np.stack([np.stack([p0, p1, p2], -1), np.stack([p0, p2, p3], -1)], 2).reshape(-1, 3).astype(np.int32)
    if cap:  # pointe conique
        tip = P[-1] + T[-1] * R[-1] * 2.0
        it = len(V)
        V = np.vstack([V, tip])
        N = np.vstack([N, T[-1]])
        U = np.vstack([U, [0.5 * u_rep, v0 + (cum[-1] + R[-1] * 2) * v_scale]])
        last = (n - 1) * W
        F = np.vstack([F, np.array([(last + k, last + k + 1, it) for k in range(segs)], np.int32)])
    fc = (V[F[:, 0]] + V[F[:, 1]] + V[F[:, 2]]) / 3
    Nref = N[F[:, 0]] + N[F[:, 1]] + N[F[:, 2]]
    F = orient_faces(V, F, Nref)
    del fc
    return V, N, U, F


def merge(parts):
    """Fusionne des listes (V, N, UV, F[, C])."""
    Vs, Ns, Us, Fs, Cs = [], [], [], [], []
    off = 0
    for p in parts:
        Vs.append(p[0]); Ns.append(p[1]); Us.append(p[2]); Fs.append(p[3] + off)
        if len(p) > 4:
            Cs.append(p[4])
        off += len(p[0])
    out = [np.vstack(Vs), np.vstack(Ns), np.vstack(Us), np.vstack(Fs)]
    if Cs:
        out.append(np.vstack(Cs))
    return out


# =====================================================================================================
# 5. RAMEAUX (géométrie rendue en atlas)
# =====================================================================================================

def build_twig(sp, rng, tmpl, cluster=False):
    """Rameau feuillu dans le plan de la case : x ∈ [-S/2, S/2], y ∈ [0, S] (m), z vers la caméra.
    Renvoie (feuilles : V, UV, C, F), (tiges : V, F) et la taille physique S de la case."""
    lf, tw = sp['leaf'], sp['twig']
    S = tw['Sc'] if cluster else tw['S']
    margin = 0.025 * S
    base = np.array([0.0, 0.035 * S])
    V2, F2 = tmpl[0], tmpl[1]
    UV2 = leaf_uv(V2)
    leaves_V, leaves_UV, leaves_C, leaves_F = [], [], [], []
    stems = []
    counter = [0]
    upright = sp.get('upright', 0.0)

    def inside(pt, rad):
        return (pt[0] - rad > -S / 2 + margin and pt[0] + rad < S / 2 - margin
                and pt[1] - rad > 0.3 * margin and pt[1] + rad < S - margin)

    def add_leaf(p, ang, L):
        pet = lf['petiole'] * L
        d = np.array([math.cos(ang), math.sin(ang)])
        for _ in range(3):  # réduit la feuille si elle sort de la case
            ctr = p + d * (pet + 0.5 * L)
            if inside(ctr, 0.62 * L):
                break
            L *= 0.75
            pet = lf['petiole'] * L
        else:
            return
        z = 0.004 + counter[0] * 0.0009 + rng.uniform(0, 0.006)
        counter[0] += 1
        bb = np.array([p[0] + d[0] * pet, p[1] + d[1] * pet])
        # pétiole
        pp = np.array([[p[0], p[1], 0.0], [(p[0] + bb[0]) / 2, (p[1] + bb[1]) / 2, z * 0.6], [bb[0], bb[1], z]])
        stems.append(tube(pp, [0.0011, 0.0009, 0.0008], 4, cap=False))
        # limbe : courbure, pliure au milieu, roulis, tangage, puis orientation dans le plan
        v = np.zeros((len(V2), 3))
        v[:, 0] = V2[:, 0]
        v[:, 1] = V2[:, 1]
        curv = rng.uniform(0.06, 0.25)
        fold = rng.uniform(0.04, 0.14)
        v[:, 2] = -curv * (v[:, 1] - 0.45) ** 2 + fold * np.abs(v[:, 0])
        v *= L
        Rm = rot_axis([0, 0, 1], ang - math.pi / 2) @ rot_axis([1, 0, 0], math.radians(rng.uniform(-18, 28))) \
            @ rot_axis([0, 1, 0], math.radians(rng.uniform(-38, 38)))
        v = v @ Rm.T + np.array([bb[0], bb[1], z])
        leaves_V.append(v)
        leaves_UV.append(UV2)
        # teinte par feuille : luminosité, jaunissement ou bleuissement léger, quelques feuilles claires
        b = rng.uniform(0.86, 1.10)
        warm = rng.uniform(-0.05, 0.10)
        tint = np.array([b * (1 + warm), b, b * (1 - 1.6 * warm)])
        if rng.random() < 0.05:
            tint *= np.array([1.25, 1.18, 0.75])
        leaves_C.append(np.tile(tint, (len(V2), 1)))
        leaves_F.append(F2)

    def shoot(origin, ang, length, r0, leafy=True):
        npt = max(5, int(length / 0.025))
        t = np.linspace(0, 1, npt)
        bend = rng.uniform(-0.5, 0.5)
        angs = ang + bend * t + rng.normal(0, 0.03, npt).cumsum() * 0.5
        step = length / (npt - 1)
        pts = np.zeros((npt, 2))
        pts[0] = origin
        for i in range(1, npt):
            pts[i] = pts[i - 1] + step * np.array([math.cos(angs[i - 1]), math.sin(angs[i - 1])])
        ok = np.array([inside(p, 0.004) for p in pts])
        if not ok.all():
            k = int(np.argmin(ok))
            if k < 3:
                return pts, angs
            pts, angs, t = pts[:k], angs[:k], t[:k]
        P3 = np.c_[pts, np.zeros(len(pts))]
        stems.append(tube(P3, r0 * (1 - 0.6 * t), 5, cap=True))
        if not leafy:
            return pts, angs
        nleaf = max(2, int(length / lf['spacing']))
        side = 1 if rng.random() < 0.5 else -1
        for i in range(nleaf):
            tt = (i + 0.55) / nleaf
            if tt > t[-1]:
                break
            j = min(len(pts) - 1, int(tt * (len(pts) - 1)))
            L = lf['length'] * rng.uniform(0.85, 1.15) * (1 - 0.35 * tt)
            for s_ in ([side, -side] if lf['opposite'] else [side]):
                la = angs[j] + s_ * math.radians(lf['angle'] + rng.uniform(-14, 14))
                la = la + (math.pi / 2 - la) * upright * 0.5   # port redressé (peuplier)
                add_leaf(pts[j], la, L)
            side = -side
        add_leaf(pts[-1], angs[-1] + rng.uniform(-0.2, 0.2), lf['length'] * 0.75)
        return pts, angs

    def spray(origin, ang, length, r0, depth):
        """Pousse feuillée + pousses latérales alternes (récursif) : rameau ramifié et dense."""
        pts, angs = shoot(origin, ang, length, r0)
        if depth >= 2 or len(pts) < 4:
            return
        nside = tw['side'] if depth == 0 else tw.get('side2', 2)
        ts = np.sort(rng.uniform(0.08, 0.78, nside))
        side = 1 if rng.random() < 0.5 else -1
        for tt in ts:
            j = min(len(pts) - 1, int(tt * (len(pts) - 1)))
            a = angs[j] + side * math.radians(rng.uniform(32, 58) * (1 - 0.45 * upright))
            ln = rng.uniform(*tw['side_len']) * length * (1 - 0.45 * tt)
            spray(pts[j], a, ln, r0 * 0.65, depth + 1)
            side = -side

    if cluster:  # bouquet : plusieurs rameaux ramifiés en éventail depuis le même point
        k = tw.get('cluster_n', 4)
        for a in np.linspace(-0.95, 0.95, k):
            spray(base, math.pi / 2 + a * (1 - 0.5 * upright) + rng.uniform(-0.1, 0.1),
                  tw['main_len'] * S * (rng.uniform(0.55, 0.7) if abs(a) > 0.4 else rng.uniform(0.8, 0.92)), 0.0026, 0)
    else:
        spray(base, math.pi / 2 + rng.uniform(-0.12, 0.12), tw['main_len'] * S, 0.0028, 0)

    lv = np.vstack(leaves_V)
    luv = np.vstack(leaves_UV)
    lc = np.vstack(leaves_C)
    lfc, off = [], 0
    for v, f in zip(leaves_V, leaves_F):
        lfc.append(f + off)
        off += len(v)
    st = merge(stems)
    return (lv, luv, lc, np.vstack(lfc)), (st[0], st[3]), S, len(leaves_V)


# =====================================================================================================
# 6. BLENDER : SCÈNE, MATÉRIAUX, RENDUS
# =====================================================================================================

def gl2bl(v):
    """Repère glTF (Y haut) -> Blender (Z haut)."""
    v = np.asarray(v, float)
    return np.stack([v[..., 0], -v[..., 2], v[..., 1]], -1)


def bl_reset(threads):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.seed = 7
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 96
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.render.film_transparent = True
    sc.render.filter_size = 1.2
    sc.render.resolution_percentage = 100
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('ciel_blanc')
    sc.world = w
    if w.node_tree is None:
        w.use_nodes = True
    bg = next(nd for nd in w.node_tree.nodes if nd.type == 'BACKGROUND')
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    return sc


def bl_image(name, arr, colorspace):
    """Image Blender depuis un tableau (h,w,3|4) 0..1, ligne 0 = bas."""
    h, w, c = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=(c == 4))
    # NB : régler l'espace colorimétrique AVANT d'écrire les pixels (sinon l'image générée est réinitialisée)
    img.colorspace_settings.name = colorspace
    img.alpha_mode = 'STRAIGHT'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :c] = arr
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    return img


def save_webp(arr, path, quality=90):
    """Enregistre un tableau sRGB (h,w,3|4) 0..1 (ligne 0 = bas) en WebP via Blender ; renvoie les octets."""
    img = bl_image(os.path.basename(path), arr, 'sRGB')
    img.filepath_raw = path
    img.file_format = 'WEBP'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)
    with open(path, 'rb') as f:
        return f.read()


def bl_mesh(name, V, F, uv=None, col=None, normals=None, mat=None, convert=True):
    me = bpy.data.meshes.new(name)
    Vb = gl2bl(V) if convert else np.asarray(V, float)
    me.vertices.add(len(Vb))
    me.vertices.foreach_set('co', Vb.astype(np.float32).ravel())
    F = np.asarray(F, np.int32)
    me.loops.add(F.size)
    me.loops.foreach_set('vertex_index', F.ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set('loop_start', np.arange(0, F.size, 3, dtype=np.int32))
    me.update(calc_edges=True)
    if uv is not None:
        L = me.uv_layers.new(name='UVMap')
        L.data.foreach_set('uv', np.asarray(uv, np.float32)[F.ravel()].ravel())
    if col is not None:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        c4 = np.ones((len(V), 4), np.float32)
        c4[:, :3] = col
        ca.data.foreach_set('color', c4.ravel())
    me.polygons.foreach_set('use_smooth', np.ones(len(F), bool))
    if normals is not None:
        nb = gl2bl(normals) if convert else np.asarray(normals)
        me.normals_split_custom_set_from_vertices([tuple(x) for x in nb.astype(float)])
    if mat is not None:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def sock(node, ident, out=False):
    for s in (node.outputs if out else node.inputs):
        if s.identifier == ident:
            return s
    for s in (node.outputs if out else node.inputs):
        if s.name == ident:
            return s
    raise KeyError(ident)


def mat_new(name):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out


def normal_emission(nt, normal_socket):
    """Émission = normale (espace caméra) * 0,5 + 0,5 : passe de normales."""
    vt = nt.nodes.new('ShaderNodeVectorTransform')
    vt.vector_type = 'NORMAL'
    vt.convert_from = 'WORLD'
    vt.convert_to = 'CAMERA'
    # NB : en Blender 5.x, l'entrée 0 du nœud est un socket caché « LightIndex » -> on vise « Vector »
    if normal_socket is not None:
        nt.links.new(normal_socket, sock(vt, 'Vector'))
    else:
        g = nt.nodes.new('ShaderNodeNewGeometry')
        nt.links.new(sock(g, 'Normal', True), sock(vt, 'Vector'))
    ma = nt.nodes.new('ShaderNodeVectorMath')
    ma.operation = 'MULTIPLY_ADD'
    nt.links.new(sock(vt, 'Vector', True), ma.inputs[0])
    ma.inputs[1].default_value = (0.5, 0.5, 0.5)
    ma.inputs[2].default_value = (0.5, 0.5, 0.5)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(ma.outputs[0], sock(em, 'Color'))
    sock(em, 'Strength').default_value = 1.0
    return em


def mat_leaf(img, under, normal_pass=False):
    """Limbe : texture x teinte de la feuille ; face inférieure plus pâle ; diffus pur (albédo x AO)."""
    m, nt, out = mat_new('limbe_n' if normal_pass else 'limbe')
    if normal_pass:
        em = normal_emission(nt, None)
        nt.links.new(em.outputs[0], out.inputs[0])
        return m
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = img
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'Col'
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(tx.outputs['Color'], mul.inputs[0])
    nt.links.new(sock(at, 'Color', True), mul.inputs[1])
    g = nt.nodes.new('ShaderNodeNewGeometry')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(sock(g, 'Backfacing', True), sock(mix, 'Factor_Float'))
    nt.links.new(mul.outputs[0], sock(mix, 'A_Color'))
    sock(mix, 'B_Color').default_value = (*srgb2lin(under), 1)
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    nt.links.new(sock(mix, 'Result_Color', True), sock(df, 'Color'))
    nt.links.new(df.outputs[0], out.inputs[0])
    return m


def mat_flat(name, rgb_srgb, normal_pass=False):
    m, nt, out = mat_new(name)
    if normal_pass:
        nt.links.new(normal_emission(nt, None).outputs[0], out.inputs[0])
        return m
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    sock(df, 'Color').default_value = (*srgb2lin(rgb_srgb), 1)
    nt.links.new(df.outputs[0], out.inputs[0])
    return m


def mat_textured(name, col_img, nor_img, alpha_clip=False, vcol=False, normal_pass=False, unlit=False):
    """Écorce ou cartes de rameaux (rendu de l'imposteur) : albédo (x couleur de sommet) + normal map,
    découpe alpha au même seuil que le GLB."""
    m, nt, out = mat_new(name)
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = col_img
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = nor_img
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    nt.links.new(tn.outputs['Color'], sock(nm, 'Color'))
    if normal_pass:
        shader = normal_emission(nt, sock(nm, 'Normal', True))
    elif unlit:
        # albédo pur (x couleur de sommet) : l'éclairage du jeu s'appliquera via les normales de l'imposteur
        shader = nt.nodes.new('ShaderNodeEmission')
        if vcol:
            at = nt.nodes.new('ShaderNodeAttribute')
            at.attribute_name = 'Col'
            mul = nt.nodes.new('ShaderNodeVectorMath')
            mul.operation = 'MULTIPLY'
            nt.links.new(tx.outputs['Color'], mul.inputs[0])
            nt.links.new(sock(at, 'Color', True), mul.inputs[1])
            nt.links.new(mul.outputs[0], sock(shader, 'Color'))
        else:
            nt.links.new(tx.outputs['Color'], sock(shader, 'Color'))
    else:
        df = nt.nodes.new('ShaderNodeBsdfDiffuse')
        if vcol:
            at = nt.nodes.new('ShaderNodeAttribute')
            at.attribute_name = 'Col'
            mul = nt.nodes.new('ShaderNodeVectorMath')
            mul.operation = 'MULTIPLY'
            nt.links.new(tx.outputs['Color'], mul.inputs[0])
            nt.links.new(sock(at, 'Color', True), mul.inputs[1])
            nt.links.new(mul.outputs[0], sock(df, 'Color'))
        else:
            nt.links.new(tx.outputs['Color'], sock(df, 'Color'))
        nt.links.new(sock(nm, 'Normal', True), sock(df, 'Normal'))
        shader = df
    if alpha_clip:
        gt = nt.nodes.new('ShaderNodeMath')
        gt.operation = 'GREATER_THAN'
        nt.links.new(tx.outputs['Alpha'], gt.inputs[0])
        gt.inputs[1].default_value = CUTOFF
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        ms = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(gt.outputs[0], ms.inputs[0])
        nt.links.new(tr.outputs[0], ms.inputs[1])
        nt.links.new(shader.outputs[0], ms.inputs[2])
        nt.links.new(ms.outputs[0], out.inputs[0])
    else:
        nt.links.new(shader.outputs[0], out.inputs[0])
    return m


def bl_camera(center_bl, x_bl, y_bl, z_bl, scale, dist=60.0):
    """Caméra orthographique : axes caméra X (droite), Y (haut), Z (vers l'arrière) en repère Blender."""
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = scale
    cam.clip_start = 0.05
    cam.clip_end = dist * 3
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2] = x_bl, y_bl, z_bl
    M[:3, 3] = np.asarray(center_bl) + np.asarray(z_bl) * dist
    ob.matrix_world = mathutils.Matrix(M.tolist())
    bpy.context.scene.camera = ob
    return ob


def bl_render(path, w, h, samples, denoise):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    os.remove(path)
    return a.reshape(h, w, 4).astype(np.float64)


# =====================================================================================================
# 7. ATLAS DE RAMEAUX
# =====================================================================================================

def render_twig_atlas(sp, rng, tmp, args, log):
    """Rend 4 rameaux (cases 2x2 d'un atlas 1024) : couleur prémultipliée + normales. Renvoie aussi la
    taille physique de chaque case."""
    lf = sp['leaf']
    sc = bl_reset(args.threads)
    tmpl = leaf_template(lf)
    ltex = leaf_texture(lf, rng, tmpl[2], tmpl[3], tmpl[4])
    limg = bl_image('feuille', ltex, 'sRGB')
    m_leaf = mat_leaf(limg, lf['under'])
    m_leaf_n = mat_leaf(None, None, normal_pass=True)
    m_stem = mat_flat('tige', (0.30, 0.22, 0.13))
    m_stem_n = mat_flat('tige_n', (0, 0, 0), normal_pass=True)
    sizes, nleaves, objs = [], [], []
    for t in range(4):
        (lv, luv, lc, lfc), (sv, sfc), S, nl = build_twig(sp, rng, tmpl, cluster=(t == 3))
        col, row_top = t % 2, t // 2
        off = np.array([col + 0.5, (1 - row_top), 0.0])
        # coordonnées de la case (1 x 1 unité) en repère Blender (caméra regardant -Z)
        lvb = lv / S + off
        svb = sv / S + off
        objs.append((bl_mesh(f'feuilles{t}', lvb, lfc, uv=luv, col=lc, mat=m_leaf, convert=False), m_leaf, m_leaf_n))
        objs.append((bl_mesh(f'tiges{t}', svb, sfc, mat=m_stem, convert=False), m_stem, m_stem_n))
        sizes.append(S)
        nleaves.append(nl)
    bl_camera([1.0, 1.0, 0.0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 2.0, dist=10.0)
    res = 1024
    t0 = time.time()
    colr = bl_render(os.path.join(tmp, 'atlas_c.exr'), res, res, args.samples, True)
    t1 = time.time()
    for ob, _, mn in objs:
        ob.data.materials[0] = mn
    norr = bl_render(os.path.join(tmp, 'atlas_n.exr'), res, res, max(8, args.samples // 4), False)
    log(f'  atlas rameaux : {sum(nleaves)} feuilles {nleaves}, rendu couleur {t1 - t0:.1f} s, normales {time.time() - t1:.1f} s')
    return colr, norr, sizes, ltex


# =====================================================================================================
# 8. RAMURE : COLONISATION DE L'ESPACE
# =====================================================================================================

class Crown:
    """Enveloppe de couronne : rayon r(y), distance normalisée (0 centre .. 1 bord), normale « sphérique »."""

    def __init__(self, cr, rng):
        self.c = cr
        self.yc = cr['y0'] + cr['m'] * (cr['y1'] - cr['y0'])
        self.hb = cr['m'] * (cr['y1'] - cr['y0'])
        self.ht = (1 - cr['m']) * (cr['y1'] - cr['y0'])
        self.ph = rng.uniform(0, 2 * np.pi, 3)

    def radius(self, y, th=None):
        c = self.c
        t = np.clip((y - c['y0']) / (c['y1'] - c['y0']), 0, 1)
        m = c['m']
        low = t < m
        u = np.where(low, (m - t) / m, (t - m) / (1 - m))
        p = np.where(low, c['p_bot'], c['p_top'])
        r = c['R'] * np.power(np.clip(1 - u * u, 0, 1), p)
        if th is not None:
            r = r * (1 + c['lump'] * (0.6 * np.sin(3 * th + self.ph[0]) + 0.4 * np.sin(5 * th + self.ph[1] + y * 0.6)))
        return r

    def outer(self, P):
        d = np.hypot(P[:, 0], P[:, 2])
        r = self.radius(P[:, 1])
        h = np.where(P[:, 1] < self.yc, self.hb, self.ht)
        re = np.sqrt((d / self.c['R']) ** 2 + ((P[:, 1] - self.yc) / h) ** 2)
        return np.clip(np.maximum(d / np.maximum(r, 0.3), re), 0, 1.3)

    def normal(self, P):
        h = np.where(P[:, 1] < self.yc, self.hb, self.ht)
        R = self.c['R']
        g = np.stack([P[:, 0] / R ** 2, (P[:, 1] - self.yc) / h ** 2, P[:, 2] / R ** 2], 1)
        return nrm(g + np.array([0, 1e-4, 0]))


def colonize(sp, rng, crown, log):
    cr, scp = sp['crown'], sp['sc']
    D, di, dk = scp['D'], scp['di'], scp['dk']
    # --- attracteurs (plus nombreux vers le bord : feuillage surtout en périphérie)
    A = []
    while sum(len(a) for a in A) < scp['n_attr']:
        m = 4000
        y = rng.uniform(cr['y0'], cr['y1'], m)
        x = rng.uniform(-1.2, 1.2, m) * cr['R']
        z = rng.uniform(-1.2, 1.2, m) * cr['R']
        th = np.arctan2(z, x)
        rl = crown.radius(y, th)
        d = np.hypot(x, z)
        ok = (d < rl) & (rng.random(m) < 0.30 + 0.70 * np.power(d / np.maximum(rl, 1e-3), 1.5))
        A.append(np.stack([x, y, z], 1)[ok])
    A = np.vstack(A)[:scp['n_attr']]
    # --- tronc (seul le sommet du fût peut ramifier)
    cap = 60000
    Np = np.zeros((cap, 3))
    par = np.full(cap, -1, np.int64)
    nch = np.zeros(cap, np.int64)
    lean = rng.normal(0, 0.03, 2)
    n = 1
    Np[0] = (0, -0.08, 0)
    while Np[n - 1, 1] < sp['trunk_clear']:
        Np[n] = Np[n - 1] + np.array([lean[0], 1.0, lean[1]]) * D + np.r_[rng.normal(0, 0.012, 1), 0, rng.normal(0, 0.012, 1)]
        par[n] = n - 1
        nch[n - 1] += 1
        n += 1
    trunk_n = n
    new_start = n - 1
    nd = np.full(len(A), np.inf)
    ni = np.full(len(A), -1, np.int64)
    up = np.array([0, 1.0, 0])
    it = 0
    for it in range(600):
        new = Np[new_start:n]
        if len(A) == 0 or len(new) == 0:
            break
        for c0 in range(0, len(new), 512):
            blk = new[c0:c0 + 512]
            d = np.sqrt(((A[:, None, :] - blk[None, :, :]) ** 2).sum(-1))
            j = d.argmin(1)
            dm = d[np.arange(len(A)), j]
            u = dm < nd
            nd[u] = dm[u]
            ni[u] = new_start + c0 + j[u]
        alive = nd > dk
        A, nd, ni = A[alive], nd[alive], ni[alive]
        infl = nd < di
        old_n = n
        if not infl.any():
            # le fût continue de monter tant qu'aucun attracteur n'est à portée
            top = n - 1
            if Np[top, 1] < cr['y1'] and len(A):
                Np[n] = Np[top] + up * D
                par[n] = top
                nch[top] += 1
                n += 1
                new_start = old_n
                continue
            break
        idx = ni[infl]
        dirs = nrm(A[infl] - Np[idx])
        uq, inv = np.unique(idx, return_inverse=True)
        acc = np.zeros((len(uq), 3))
        np.add.at(acc, inv, dirs)
        cnt = np.bincount(inv).astype(float)
        g = acc / cnt[:, None]
        weak = np.linalg.norm(g, axis=1) < 0.2
        g = nrm(g + up * scp['tropism'] + rng.normal(0, scp['jitter'], g.shape))
        g[weak] = nrm(up * 0.5 + rng.normal(0, 0.5, (weak.sum(), 3)))
        keep = nch[uq] < 4
        uq, g = uq[keep], g[keep]
        k = len(uq)
        if k == 0 or n + k >= cap:
            break
        Np[n:n + k] = Np[uq] + D * g
        par[n:n + k] = uq
        nch[uq] += 1
        n += k
        new_start = old_n
    Np, par, nch = Np[:n], par[:n], nch[:n]
    # --- lissage le long des branches (courbes plus naturelles)
    main_child = np.full(n, -1)
    for i in range(1, n):
        p = par[i]
        if main_child[p] < 0:
            main_child[p] = i
    for _ in range(3):
        Q = Np.copy()
        mask = (par >= 0) & (main_child >= 0)
        mask[:trunk_n] = False
        Q[mask] = 0.5 * Np[mask] + 0.25 * (Np[par[mask]] + Np[main_child[mask]])
        Np = Q
    # --- rayons : modèle des tuyaux, exposant choisi pour retrouver le rayon de tronc visé
    tips = int((nch == 0).sum())
    e = float(np.clip(math.log(max(tips, 2)) / math.log(sp['trunk_r'] / sp['tip_r']), 1.8, 3.2))
    rad = np.zeros(n)
    acc = np.zeros(n)
    for i in range(n - 1, -1, -1):
        rad[i] = max(sp['tip_r'], acc[i] ** (1 / e)) if acc[i] > 0 else sp['tip_r']
        if par[i] >= 0:
            acc[par[i]] += rad[i] ** e
    if rad[0] < 0.92 * sp['trunk_r']:
        k = sp['trunk_r'] / rad[0]
        rad = rad * (1 + (k - 1) * (rad / rad[0]) ** 0.7)
    # évasement du pied
    trunk_mask = np.arange(n) < trunk_n
    rad[trunk_mask] *= 1 + 0.55 * np.exp(-np.maximum(Np[trunk_mask, 1], 0) / 0.35)
    log(f'  ramure : {n} nœuds, {tips} extrémités, {it} itérations, exposant tuyaux {e:.2f}, '
        f'rayon tronc {rad[0]:.3f} m, attracteurs restants {len(A)}')
    return dict(pos=Np, par=par, nch=nch, rad=rad, trunk_n=trunk_n)


def chains_of(sk):
    """Découpe le graphe en chaînes (on suit l'enfant le plus épais)."""
    n = len(sk['pos'])
    children = [[] for _ in range(n)]
    for i in range(1, n):
        children[sk['par'][i]].append(i)
    rad = sk['rad']
    chains = []
    stack = [(0, -1)]
    while stack:
        start, attach = stack.pop()
        ch = [attach] if attach >= 0 else []
        cur = start
        while True:
            ch.append(cur)
            kids = children[cur]
            if not kids:
                break
            kids = sorted(kids, key=lambda k: -rad[k])
            for k in kids[1:]:
                stack.append((k, cur))
            cur = kids[0]
        chains.append(ch)
    return chains


def branch_mesh(sk, chains, r_min, lod, bark_tile=0.7, count_only=False):
    """Maille les chaînes de rayon >= r_min (tronquées sous 0,6 r_min). Renvoie (V,N,UV,F)."""
    P, R = sk['pos'], sk['rad']
    parts = []
    ntri = 0
    for ci, ch in enumerate(chains):
        own = ch[1:] if ci > 0 else ch
        if len(own) == 0 or R[own[0]] < r_min:
            continue
        idx = list(ch)
        rr = [R[own[0]] if (ci > 0 and k == 0) else R[i] for k, i in enumerate(idx)]
        # troncature
        cut = len(idx)
        for k in range(1 if ci > 0 else 0, len(idx)):
            if rr[k] < 0.6 * r_min:
                cut = k + 1
                break
        idx, rr = idx[:cut], rr[:cut]
        if len(idx) < 2:
            continue
        # sous-échantillonnage selon le rayon
        pts = P[idx]
        keep = [0]
        accl = 0.0
        for k in range(1, len(idx)):
            accl += np.linalg.norm(pts[k] - pts[k - 1])
            spc = np.clip((7 if lod == 0 else 12) * rr[k], 0.35 if lod == 0 else 0.7, 1.4 if lod == 0 else 2.5)
            if ci == 0 and pts[k][1] < 1.4 and lod == 0:
                spc = 0.25
            if accl >= spc or k == len(idx) - 1:
                keep.append(k)
                accl = 0.0
        pts = pts[keep]
        rk = np.array(rr)[keep]
        rb = rk[0] if ci == 0 else R[own[0]]
        segs = int(np.clip(round(3 + rb * (45 if lod == 0 else 22)), 3, 12 if lod == 0 else 7))
        if count_only:
            ntri += (len(pts) - 1) * segs * 2 + segs
            continue
        u_rep = max(1, round(2 * np.pi * rb / bark_tile))
        lobes = None
        if ci == 0:
            amp = 0.22 * np.exp(-np.maximum(pts[:, 1], 0) / 0.45)
            lobes = (amp, 5, 0.7)
        parts.append(tube(pts, rk, segs, u_rep=u_rep, v_scale=1.0 / bark_tile, cap=True, lobes=lobes))
    return ntri if count_only else merge(parts)


def fit_branches(sk, chains, budget, lod):
    """Cherche le seuil de rayon qui respecte le budget de triangles."""
    for r_min in np.geomspace(0.006, 0.25, 48):
        if branch_mesh(sk, chains, r_min, lod, count_only=True) <= budget:
            return r_min, branch_mesh(sk, chains, r_min, lod)
    return r_min, branch_mesh(sk, chains, r_min, lod)


# =====================================================================================================
# 9. CARTES DE RAMEAUX (habillage de la couronne)
# =====================================================================================================

def tile_uv(t, u, v):
    """UV (convention Blender, v vers le haut) dans la case t de l'atlas 2x2 ; u,v ∈ [0,1] dans la case."""
    col, row_top = t % 2, t // 2
    eps = 1.5 / 1024
    u = np.clip(u, eps, 1 - eps)
    v = np.clip(v, eps, 1 - eps)
    return np.stack([col * 0.5 + u * 0.5, (1 - row_top) * 0.5 + v * 0.5], -1)


def place_cards(sp, sk, crown, rng, n, size_rng, tile_S, lod):
    P, R, par = sk['pos'], sk['rad'], sk['par']
    cr = sp['crown']
    cand = np.where((R < sp['twig_r']) & (P[:, 1] > cr['y0'] - 0.2) & (par >= 0))[0]
    rho = crown.outer(P[cand])
    w = 0.12 + np.power(np.clip(rho, 0, 1.1), 2.2 if lod == 0 else 3.0)
    pick = rng.choice(cand, n, p=w / w.sum())
    p = P[pick] + rng.normal(0, 0.07, (n, 3))
    dbr = nrm(P[pick] - P[par[pick]])
    rad = crown.normal(p)
    upw = np.array([0, 1.0, 0])
    upright = sp.get('upright', 0.0)
    up = nrm(dbr * 0.8 + rad * 0.7 + upw * (0.35 + upright) + rng.normal(0, 0.35, (n, 3)))
    nd = nrm(rad * 1.0 + upw * 0.45 + rng.normal(0, 0.65, (n, 3)))
    nd = nd - up * (nd * up).sum(1, keepdims=True)
    bad = np.linalg.norm(nd, axis=1) < 0.1
    nd[bad] = np.cross(up[bad], rng.normal(0, 1, (bad.sum(), 3)))
    nd = nrm(nd)
    right = np.cross(up, nd)
    flip = (nd * rad).sum(1) < 0
    right[flip] *= -1
    nd[flip] *= -1
    tiles = np.full(n, 3) if lod == 1 else rng.integers(0, 3, n)
    S = np.array([tile_S[t] for t in tiles])
    size = S * rng.uniform(*size_rng, n)
    base = p - up * (size * 0.07)[:, None]
    # couleur par carte : luminosité, chaleur ; quelques cartes plus claires/jaunes
    b = rng.uniform(0.80, 1.06, n)
    warm = rng.uniform(-0.05, 0.08, n)
    tint = np.stack([b * (1 + warm), b, b * (1 - 1.5 * warm)], 1)
    light = rng.random(n) < 0.08
    tint[light] *= np.array([1.12, 1.10, 0.85])
    if lod == 0:
        rows = 3
        droop = np.radians(rng.uniform(8, 30, n))
        mid = base + up * (size * 0.5)[:, None]
        tipdir = nrm(up * np.cos(droop)[:, None] - nd * np.sin(droop)[:, None])
        top = mid + tipdir * (size * 0.5)[:, None]
        centers = [base, mid, top]
        vs = [0.0, 0.5, 1.0]
    else:
        rows = 2
        centers = [base, base + up * size[:, None]]
        vs = [0.0, 1.0]
    V, UV = [], []
    for r_ in range(rows):
        for sgn, u in ((-1, 0.0), (1, 1.0)):
            V.append(centers[r_] + right * (sgn * size * 0.5)[:, None])
            UV.append(np.stack([np.full(n, u), np.full(n, vs[r_])], 1))
    V = np.stack(V, 1)          # (n, 2*rows, 3)
    UVl = np.stack(UV, 1)       # (n, 2*rows, 2)
    UVa = np.stack([tile_uv(tiles[i], UVl[i, :, 0], UVl[i, :, 1]) for i in range(n)], 0)
    nv = 2 * rows
    Vf = V.reshape(-1, 3)
    # normales de sommets : mélange carte / enveloppe (ombrage de volume)
    radv = crown.normal(Vf)
    ndv = np.repeat(nd, nv, 0)
    Nv = nrm(0.35 * ndv + 0.65 * radv + np.array([0, 0.12, 0]))
    # occlusion : intérieur et bas de couronne plus sombres
    rho_v = crown.outer(Vf)
    ao = 0.52 + 0.48 * smoothstep(0.30, 1.0, rho_v)
    low = 0.80 + 0.20 * smoothstep(cr['y0'], cr['y0'] + 0.45 * (cr['y1'] - cr['y0']), Vf[:, 1])
    C = np.clip(np.repeat(tint, nv, 0) * (ao * low)[:, None], 0, 1)
    F = []
    for r_ in range(rows - 1):
        a, b_, c, d = 2 * r_, 2 * r_ + 1, 2 * r_ + 3, 2 * r_ + 2
        F += [(a, b_, c), (a, c, d)]
    F = np.array(F)
    Fall = (F[None, :, :] + (np.arange(n) * nv)[:, None, None]).reshape(-1, 3)
    Fall = orient_faces(Vf, Fall, np.repeat(nd, len(F), 0))
    return Vf, Nv, UVa.reshape(-1, 2), Fall, C


# =====================================================================================================
# 10. IMPOSTEUR (LOD2)
# =====================================================================================================

def render_impostor(sp, lod0, tex, tmp, args, log):
    """Imposteur (LOD2) : 2 plans verticaux croisés à 90° (faces avant ET arrière explicites, image miroir à
    l'arrière : matériau simple face, donc pas d'inversion de normale par three.js) + 1 plan horizontal
    visible du dessus : 10 triangles. Atlas 2x2 de 1024 px : case 0 = vue 0°, 1 = vue 90°, 2 = dessus.
    Couleur = albédo non éclairé (texture x couleur de sommet, comme le LOD0 dans le jeu) ; normales =
    espace caméra = espace tangent des plans."""
    sc = bl_reset(args.threads)
    (bV, bN, bU, bF), (cV, cN, cU, cF, cC) = lod0
    i_bc = bl_image('ecorce_c', tex['bark_c'], 'sRGB')
    i_bn = bl_image('ecorce_n', tex['bark_n'], 'Non-Color')
    i_lc = bl_image('feuilles_c', tex['leaf_c'], 'sRGB')
    i_ln = bl_image('feuilles_n', tex['leaf_n'], 'Non-Color')
    mb = mat_textured('ecorce', i_bc, i_bn, unlit=True)
    mbn = mat_textured('ecorce_n', i_bc, i_bn, normal_pass=True)
    ml = mat_textured('cartes', i_lc, i_ln, alpha_clip=True, vcol=True, unlit=True)
    mln = mat_textured('cartes_n', i_lc, i_ln, alpha_clip=True, normal_pass=True)
    ob_b = bl_mesh('branches', bV, bF, uv=bU, normals=bN, mat=mb)
    ob_c = bl_mesh('cartes', cV, cF, uv=cU, col=cC, normals=cN, mat=ml)
    allV = np.vstack([bV, cV])
    H = allV[:, 1].max()
    maxR = np.hypot(allV[:, 0], allV[:, 2]).max()
    s_side = max(H + 0.06, 2 * maxR * 1.04)
    s_top = 2 * maxR * 1.04
    tile = 512
    atl_c = np.zeros((1024, 1024, 4))
    atl_n = np.zeros((1024, 1024, 4))
    up = np.array([0, 1.0, 0])
    hw = maxR * 1.02
    V, N, U, F = [], [], [], []

    def quad(pts, uv, nvec, vertical=True):
        o = len(V) * 4
        pts = np.array(pts)
        if vertical:
            # normales « cylindriques » : plan + direction horizontale du sommet depuis l'axe + un peu de
            # haut : l'ombrage varie à travers le plan comme sur un volume et reste cohérent d'un plan à
            # l'autre (sinon un plan vu de profil, éclairé de face par le soleil, forme une bande claire).
            radial = nrm(pts * np.array([1.0, 0, 1.0]))
            nn = nrm(0.40 * nvec + 0.60 * radial + np.array([0, 0.25, 0]))
        else:
            nn = np.tile(nvec, (4, 1))
        V.append(pts); U.append(np.array(uv)); N.append(nn)
        F.append(np.array([[o, o + 1, o + 2], [o, o + 2, o + 3]]))

    t0 = time.time()
    for k in range(3):
        if k < 2:
            a = math.radians(90 * k)
            nvec = np.array([math.sin(a), 0, math.cos(a)])
            right = np.cross(up, nvec)
            imgup = up
            center = np.array([0, -0.03 + s_side / 2, 0])
            s = s_side
        else:
            nvec = up
            right = np.array([1.0, 0, 0])
            imgup = np.array([0, 0, -1.0])
            center = np.array([0, H, 0])
            s = s_top
        cam = bl_camera(gl2bl(center), gl2bl(right), gl2bl(imgup), gl2bl(nvec), s, dist=60.0)
        ob_b.data.materials[0] = mb
        ob_c.data.materials[0] = ml
        c = bl_render(os.path.join(tmp, f'imp_c{k}.exr'), tile, tile, max(16, args.samples // 2), False)
        ob_b.data.materials[0] = mbn
        ob_c.data.materials[0] = mln
        nn = bl_render(os.path.join(tmp, f'imp_n{k}.exr'), tile, tile, max(8, args.samples // 4), False)
        bpy.data.objects.remove(cam)
        col, row_top = k % 2, k // 2
        ys, xs = (1 - row_top) * tile, col * tile
        atl_c[ys:ys + tile, xs:xs + tile] = c
        atl_n[ys:ys + tile, xs:xs + tile] = nn
        u0, u1 = 0.5 - hw / s, 0.5 + hw / s
        if k < 2:
            v0, v1 = 0.03 / s, (H * 1.005 + 0.03) / s
            P = lambda u, v: center + right * ((u - 0.5) * s) + up * ((v - 0.5) * s)
            # face avant (image droite) puis face arrière (même image en miroir, normale opposée)
            quad([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)],
                 [tile_uv(k, u0, v0), tile_uv(k, u1, v0), tile_uv(k, u1, v1), tile_uv(k, u0, v1)], nvec)
            quad([P(u1, v0), P(u0, v0), P(u0, v1), P(u1, v1)],
                 [tile_uv(k, u0, v0), tile_uv(k, u1, v0), tile_uv(k, u1, v1), tile_uv(k, u0, v1)], -nvec)
        else:
            cr = sp['crown']
            yp = cr['y0'] + 0.72 * (cr['y1'] - cr['y0'])
            hs = 0.95   # plan horizontal haut et large : masque le haut des plans verticaux vus du dessus
            uu0, uu1 = 0.5 - hs * hw / s, 0.5 + hs * hw / s
            P = lambda u, v: np.array([0, yp, 0]) + right * ((u - 0.5) * s) + imgup * ((v - 0.5) * s)
            quad([P(uu0, uu0), P(uu1, uu0), P(uu1, uu1), P(uu0, uu1)],
                 [tile_uv(k, uu0, uu0), tile_uv(k, uu1, uu0), tile_uv(k, uu1, uu1), tile_uv(k, uu0, uu1)], up,
                 vertical=False)
    log(f'  imposteur : 6 rendus 512 px en {time.time() - t0:.1f} s (cadre latéral {s_side:.2f} m, dessus {s_top:.2f} m)')
    V, N, U = np.vstack(V), np.vstack(N), np.vstack(U)
    F = np.vstack(F)
    Fn = np.repeat(np.array([[0, 0, 1.0]]), len(F), 0)
    for i in range(len(F)):  # orientation selon la normale du plan (avant/arrière), pas la normale lissée
        q = i // 2
        Fn[i] = [math.sin(math.radians(90 * (q // 2 % 2))), 0, math.cos(math.radians(90 * (q // 2 % 2)))] if q < 4 else [0, 1, 0]
        if q < 4 and q % 2 == 1:
            Fn[i] = -Fn[i]
    F = orient_faces(V, F, Fn)
    return atl_c, atl_n, (V, N, U, F)


# =====================================================================================================
# 11. ÉCRITURE GLB (glTF 2.0 binaire)
# =====================================================================================================

def write_glb(path, name, prims, materials, images):
    """prims : dict(pos, nor, uv (v Blender), col (option, 0..1), idx, material).
    images : liste (octets WebP, wrap 'repeat'|'clamp'). Une texture par image."""
    binbuf = bytearray()
    views, accs = [], []

    def view(data, target=None):
        while len(binbuf) % 4:
            binbuf.append(0)
        off = len(binbuf)
        binbuf.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def acc(arr, ctype, typ, normalized=False, target=34962, minmax=False):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': ctype, 'count': int(len(arr)), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    gprims = []
    tri = 0
    for p in prims:
        uv = np.asarray(p['uv'], np.float32).copy()
        uv[:, 1] = 1.0 - uv[:, 1]   # glTF : v vers le bas
        attrs = {
            'POSITION': acc(np.asarray(p['pos'], '<f4'), 5126, 'VEC3', minmax=True),
            'NORMAL': acc(nrm(np.asarray(p['nor'], float)).astype('<f4'), 5126, 'VEC3'),
            'TEXCOORD_0': acc(uv.astype('<f4'), 5126, 'VEC2'),
        }
        if p.get('col') is not None:
            c = np.ones((len(p['col']), 4))
            c[:, :3] = p['col']
            attrs['COLOR_0'] = acc(np.round(np.clip(c, 0, 1) * 255).astype(np.uint8), 5121, 'VEC4', normalized=True)
        idx = np.asarray(p['idx']).ravel()
        if len(p['pos']) < 65536:
            ia = acc(idx.astype('<u2'), 5123, 'SCALAR', target=34963)
        else:
            ia = acc(idx.astype('<u4'), 5125, 'SCALAR', target=34963)
        tri += len(idx) // 3
        gprims.append({'attributes': attrs, 'indices': ia, 'material': p['material'], 'mode': 4})
    gimages, gtex = [], []
    samplers = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497},
                {'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
    for i, (data, wrap) in enumerate(images):
        gimages.append({'bufferView': view(data), 'mimeType': 'image/webp'})
        gtex.append({'sampler': 0 if wrap == 'repeat' else 1, 'extensions': {'EXT_texture_webp': {'source': i}}})
    while len(binbuf) % 4:
        binbuf.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'generate_trees.py (Blender bpy 5.3 + numpy)'},
        'extensionsUsed': ['EXT_texture_webp'] + (['KHR_materials_specular'] if any('extensions' in m for m in materials) else []),
        'extensionsRequired': ['EXT_texture_webp'],
        'scene': 0, 'scenes': [{'name': name, 'nodes': [0]}],
        'nodes': [{'name': name, 'mesh': 0}],
        'meshes': [{'name': name, 'primitives': gprims}],
        'materials': materials, 'textures': gtex, 'images': gimages, 'samplers': samplers,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(binbuf)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbuf)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(binbuf), 0x004E4942))
        f.write(binbuf)
    return tri


def mat_bark(tc, tn):
    return {'name': 'ecorce', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tc}, 'metallicFactor': 0.0,
            'roughnessFactor': 0.92}, 'normalTexture': {'index': tn, 'scale': 1.0}}


def mat_foliage(tc, tn, name='feuillage', double=True):
    return {'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': tc}, 'metallicFactor': 0.0,
            'roughnessFactor': 0.9}, 'normalTexture': {'index': tn, 'scale': 0.75},
            'alphaMode': 'MASK', 'alphaCutoff': CUTOFF, 'doubleSided': double,
            # Spéculaire réduit : sans cela, la réflexion de Fresnel du ciel blanchit les cartes vues de biais
            # (constaté dans la planche Three.js). GLTFLoader -> MeshPhysicalMaterial.specularIntensity.
            'extensions': {'KHR_materials_specular': {'specularFactor': SPECULAR_FEUILLAGE}}}


# =====================================================================================================
# 12. PIPELINE PAR ESSENCE
# =====================================================================================================

def build_species(sid, sp, idx, args, log):
    t_start = time.time()
    rng = np.random.default_rng([args.seed, idx])
    out = args.out
    tmp = os.path.join(out, '_tmp')
    os.makedirs(tmp, exist_ok=True)
    log(f'== {sid} ({sp["essence"]})')
    # --- textures d'écorce
    bc, bn = bark_textures(sp['bark'], rng, 512)
    # --- atlas de rameaux
    colr, norr, tile_S, ltex = render_twig_atlas(sp, rng, tmp, args, log)
    leaf_c = finish_rgba(colr)
    leaf_n = finish_normal(norr)
    leaf_c1 = finish_rgba(down2(colr))
    leaf_n1 = finish_normal(down2(norr))
    cov = [float((colr[(1 - t // 2) * 512:(2 - t // 2) * 512, (t % 2) * 512:(t % 2 + 1) * 512, 3] > CUTOFF).mean()) for t in range(4)]
    log(f'  couverture alpha des cases (>{CUTOFF}) : ' + ', '.join(f'{c:.2f}' for c in cov))
    # --- ramure
    crown = Crown(sp['crown'], rng)
    sk = colonize(sp, rng, crown, log)
    chains = chains_of(sk)
    r0, br0 = fit_branches(sk, chains, sp['budget_br'][0], 0)
    r1, br1 = fit_branches(sk, chains, sp['budget_br'][1], 1)
    log(f'  branches : LOD0 seuil r={r0 * 100:.1f} cm -> {len(br0[3])} tri ; LOD1 seuil r={r1 * 100:.1f} cm -> {len(br1[3])} tri')
    # --- cartes
    c0 = place_cards(sp, sk, crown, rng, sp['cards0']['n'], sp['cards0']['size'], tile_S, 0)
    c1 = place_cards(sp, sk, crown, rng, sp['cards1']['n'], sp['cards1']['size'], tile_S, 1)
    # --- images WebP
    w = lambda arr, nm, q=90: save_webp(arr, os.path.join(tmp, nm), q)
    b_c0, b_n0 = w(bc, 'bc0.webp'), w(bn, 'bn0.webp')
    b_c1, b_n1 = w(down2(bc), 'bc1.webp'), w(down2(bn), 'bn1.webp')
    l_c0, l_n0 = w(leaf_c, 'lc0.webp'), w(leaf_n, 'ln0.webp')
    l_c1, l_n1 = w(leaf_c1, 'lc1.webp'), w(leaf_n1, 'ln1.webp')
    if args.keep_png:
        save_webp(leaf_c, os.path.join(out, f'{sid}_atlas_rameaux.webp'), 95)
        save_webp(ltex, os.path.join(out, f'{sid}_texture_feuille.webp'), 95)
    res = {'id': sid, 'lods': []}

    def emit(lod, br, cards, imgs):
        prims = [dict(pos=br[0], nor=br[1], uv=br[2], idx=br[3], material=0),
                 dict(pos=cards[0], nor=cards[1], uv=cards[2], idx=cards[3], col=cards[4], material=1)]
        mats = [mat_bark(0, 1), mat_foliage(2, 3)]
        path = os.path.join(out, f'{sid}_lod{lod}.glb')
        tri = write_glb(path, f'{sid}_lod{lod}', prims, mats,
                        [(imgs[0], 'repeat'), (imgs[1], 'repeat'), (imgs[2], 'clamp'), (imgs[3], 'clamp')])
        allV = np.vstack([br[0], cards[0]])
        res['lods'].append(dict(file=os.path.basename(path), triangles=tri, bytes=os.path.getsize(path),
                                bbox_min=allV.min(0).tolist(), bbox_max=allV.max(0).tolist()))
        log(f'  LOD{lod} : {tri} triangles (branches {len(br[3])}, feuillage {len(cards[3])}), '
            f'{os.path.getsize(path) / 1024:.0f} Ko')

    emit(0, br0, c0, [b_c0, b_n0, l_c0, l_n0])
    emit(1, br1, c1, [b_c1, b_n1, l_c1, l_n1])
    # --- imposteur
    tex = dict(bark_c=bc, bark_n=bn, leaf_c=leaf_c, leaf_n=leaf_n)
    ic, inn, q = render_impostor(sp, (br0, c0), tex, tmp, args, log)
    imp_c = finish_rgba(ic)
    imp_n = finish_normal(inn)
    i_c, i_n = w(imp_c, 'ic.webp'), w(imp_n, 'in.webp')
    if args.keep_png:
        save_webp(imp_c, os.path.join(out, f'{sid}_imposteur.webp'), 95)
    path = os.path.join(out, f'{sid}_lod2.glb')
    tri = write_glb(path, f'{sid}_lod2', [dict(pos=q[0], nor=q[1], uv=q[2], idx=q[3], material=0)],
                    [mat_foliage(0, 1, 'imposteur', double=False)], [(i_c, 'clamp'), (i_n, 'clamp')])
    res['lods'].append(dict(file=os.path.basename(path), triangles=tri, bytes=os.path.getsize(path),
                            bbox_min=q[0].min(0).tolist(), bbox_max=q[0].max(0).tolist()))
    log(f'  LOD2 : {tri} triangles (imposteur), {os.path.getsize(path) / 1024:.0f} Ko')
    res['seconds'] = round(time.time() - t_start, 1)
    log(f'  durée {sid} : {res["seconds"]} s')
    return res


def catalog_entry(sid, sp, res, old):
    b0 = res['lods'][0]
    mn, mx = np.array(b0['bbox_min']), np.array(b0['bbox_max'])
    dims = {'width': round(float(mx[0] - mn[0]), 3), 'depth': round(float(mx[2] - mn[2]), 3),
            'height': round(float(mx[1]), 3)}
    maxd = [50, 120, 1000000000]
    e = dict(old) if old else {
        'id': sid, 'nameFr': sp['nomFr'], 'category': 'tree', 'footprint': {'tilesX': 0, 'tilesZ': 0},
        'cost': 700, 'upkeepPerMonth': 0, 'capacity': {'residents': 0, 'jobs': 0}, 'frontage': [],
        'variants': [{'id': 'standard', 'nameFr': 'Standard'}, {'id': 'h85', 'nameFr': 'Taille ×0,85', 'heightScale': 0.85},
                     {'id': 'h115', 'nameFr': 'Taille ×1,15', 'heightScale': 1.15}],
        'textureSets': [], 'tags': sp['tags'],
    }
    e['lods'] = [{'file': f'models/nature/tree/{l["file"]}', 'maxDistance': maxd[i], 'triangles': l['triangles']}
                 for i, l in enumerate(res['lods'])]
    e['dimensions'] = dims
    e['license'] = {'spdx': 'CC0-1.0', 'source': f'tools/generators/generate_trees.py#{sid}',
                    'author': 'Œuvre originale générée par le projet (generate_trees.py, Blender/Cycles + numpy)'}
    tags = [t for t in e.get('tags', []) if t != 'polyhaven']
    for t in ('procedural', 'arbre', 'feuillu'):
        if t not in tags:
            tags.append(t)
    e['tags'] = tags
    return e


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--seed', type=int, default=SEED_DEFAUT)
    ap.add_argument('--fast', action='store_true', help='rendus rapides (mise au point)')
    ap.add_argument('--out', default=ICI)
    ap.add_argument('--threads', type=int, default=3)
    ap.add_argument('--keep-png', action='store_true', help='écrit aussi les atlas pour inspection')
    ap.add_argument('--catalog', default='/home/user/ECO/city-builder/assets/catalog.json')
    args = ap.parse_args(argv)
    args.samples = 12 if args.fast else 48
    os.makedirs(args.out, exist_ok=True)
    logf = open(os.path.join(args.out, 'generation.log'), 'a', encoding='utf8')

    def log(s):
        print(s, flush=True)
        logf.write(s + '\n')
        logf.flush()

    ids = [s for s in args.only.split(',') if s] or list(SPECIES)
    log(f'### generate_trees.py — graine {args.seed}, échantillons {args.samples}, {time.strftime("%Y-%m-%d %H:%M:%S")}')
    T0 = time.time()
    old = {}
    if os.path.exists(args.catalog):
        with open(args.catalog, encoding='utf8') as f:
            old = {a['id']: a for a in json.load(f)['assets']}
    results = []
    for i, sid in enumerate(SPECIES):
        if sid not in ids:
            continue
        results.append((sid, build_species(sid, SPECIES[sid], i, args, log)))
    patch_path = os.path.join(args.out, 'catalog-patch.json')
    patch = {'assets': []}
    if os.path.exists(patch_path):
        with open(patch_path, encoding='utf8') as f:
            patch = json.load(f)
    by = {a['id']: a for a in patch.get('assets', [])}
    for sid, res in results:
        by[sid] = catalog_entry(sid, SPECIES[sid], res, old.get(sid))
    patch = {'comment': 'Entrées catalogue des arbres générés par generate_trees.py (remplacent les entrées de même id ; '
                        'copier les GLB dans assets/models/nature/tree/).',
             'seed': args.seed, 'assets': [by[k] for k in SPECIES if k in by]}
    with open(patch_path, 'w', encoding='utf8') as f:
        json.dump(patch, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out, 'stats.json'), 'w', encoding='utf8') as f:
        json.dump({sid: r for sid, r in results}, f, ensure_ascii=False, indent=2)
    log(f'### total {time.time() - T0:.1f} s')


if __name__ == '__main__':
    main()
