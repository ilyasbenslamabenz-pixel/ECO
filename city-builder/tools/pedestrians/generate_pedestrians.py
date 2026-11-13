#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_pedestrians.py — Générateur procédural des PIÉTONS animés du city-builder (Three.js).

Outils : Blender en module Python (bpy 5.x : maillage, arêtes vives par angle, normales de coins,
BVH pour l'occlusion ambiante cuite) + numpy. Entièrement déterministe (aucun tirage hors graine fixe).

Principe :
  1. Chaque personnage est décrit par une fiche (taille, proportions, tenue, coiffure, accessoires, allure).
  2. Le corps est modelé par « sections lissées » : chaque volume (torse, tête, bras, mains, jambes,
     chaussures, cheveux, jupe, sacs...) est une peau tendue sur des sections super-elliptiques clés,
     interpolées par splines de Catmull-Rom. Les vêtements sont la surface elle-même (surépaisseur, ourlets
     en marche d'escalier, bandes frontales pour chemise/cravate), les couleurs sont des index de palette.
  3. Les 3 niveaux de détail sont reconstruits paramétriquement (moins de sections, moins de segments) :
     silhouette et skin restent propres, sans décimation aveugle.
  4. Squelette commun de 17 os (repos : rotations identité, axes monde), poids analytiques (<= 4 influences).
  5. Animations procédurales cuites à 30 i/s : « marche » (cinématique inverse des jambes, pied planté qui
     recule à la vitesse nominale, déroulé talon/pointe, rebond des hanches, bras opposés) et « attente ».
  6. Écriture GLB maison (glTF 2.0) pour garantir le contrat (un maillage, une primitive, un matériau
     `pieton_palette`, ordre des joints) + manifest.json (palettes, métadonnées, LOD).

Usage :
  bpyenv/bin/python tools/pedestrians/generate_pedestrians.py [--only id1,id2] [--out DIR] [--anims-all-lods]
"""
import argparse
import json
import math
import os
import struct
import sys
import time
from types import SimpleNamespace

import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.normpath(os.path.join(ICI, '..', '..'))
SOURCE = 'tools/pedestrians/generate_pedestrians.py'
GRAINE = 20261113
IPS = 30

BONES = ['hanches', 'colonne', 'poitrine', 'cou', 'tete', 'bras_g', 'avant_bras_g', 'main_g', 'bras_d',
         'avant_bras_d', 'main_d', 'cuisse_g', 'tibia_g', 'pied_g', 'cuisse_d', 'tibia_d', 'pied_d']
PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15]
BI = {n: i for i, n in enumerate(BONES)}
PARTS = ['peau', 'cheveux', 'haut', 'bas', 'chaussures', 'accessoire', 'haut2', 'detail']
PEAU, CHEVEUX, HAUT, BAS, CHAUSS, ACC, HAUT2, DETAIL = range(8)
LOD_DIST = [35, 110, 320]
BORNES_TRI = [(3000, 6000), (800, 1500), (150, 350)]

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])


# =====================================================================================================
# 1. OUTILS
# =====================================================================================================
def sm(a, b, x):
    """smoothstep généralisé (a peut être > b)."""
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def nrm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def V3(x, y, z):
    return np.array([x, y, z], float)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def euler(rx=0.0, ry=0.0, rz=0.0):
    """Lacet (Y) puis tangage (X) puis roulis (Z), angles en radians."""
    return rot_y(ry) @ rot_x(rx) @ rot_z(rz)


def mat2quat(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def K(c, ru, rw=None, rwm=None, e=2.2, em=None, imp=0, brk=False):
    """Section clé : centre c, demi-largeur ru (axe u), demi-profondeurs rw (côté +w) / rwm (côté -w),
    exposants de super-ellipse e (+w) / em (-w). imp : 0 = tous LOD, 1 = LOD0-1, 2 = LOD0 seul.
    brk : pas de lissage ni de subdivision entre cette clé et la suivante (ourlets, arêtes)."""
    rw = ru if rw is None else rw
    return dict(c=np.array(c, float), ru=float(ru), rw=float(rw), rwm=float(rw if rwm is None else rwm),
                e=float(e), em=float(e if em is None else em), imp=imp, brk=brk)


def pole(c, imp=0):
    return K(c, 0.0, 0.0, imp=imp)


def catmull(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def anneaux(keys, lod, spacing):
    """Sélectionne les clés du LOD puis (LOD0) insère des sections lissées (Catmull-Rom)."""
    ks = [k for k in keys if k['imp'] <= 2 - lod]
    A = np.array([np.concatenate([k['c'], [k['ru'], k['rw'], k['rwm'], k['e'], k['em']]]) for k in ks])
    if lod > 0 or spacing is None:
        return A
    out = [A[0]]
    for i in range(len(ks) - 1):
        if not ks[i]['brk']:
            p1, p2 = A[i], A[i + 1]
            p0 = A[i - 1] if i > 0 and not ks[i - 1]['brk'] else p1
            p3 = A[i + 2] if i + 2 < len(ks) and not ks[i + 1]['brk'] else p2
            n = int(np.clip(round(np.linalg.norm(p2[:3] - p1[:3]) / spacing), 1, 8))
            lo, hi = np.minimum(p1, p2), np.maximum(p1, p2)
            m = 0.12 * (hi - lo)
            for j in range(1, n):
                q = catmull(p0, p1, p2, p3, j / n)
                q[3:] = np.clip(q[3:], np.maximum(lo[3:] - m[3:], 1e-4), hi[3:] + m[3:])
                out.append(q)
        out.append(A[i + 1])
    return np.array(out)


def section(a, ru, rw, rwm, e, em):
    """Point(s) de super-ellipse pour l'angle a (0 = +w, sens vers +u)."""
    sa, ca = np.sin(a), np.cos(a)
    ex = np.where(ca >= 0, e, em)
    x = np.sign(sa) * np.abs(sa) ** (2.0 / ex) * ru
    w = np.sign(ca) * np.abs(ca) ** (2.0 / ex) * np.where(ca >= 0, rw, rwm)
    return x, w


class Corps:
    """Accumulateur de géométrie (positions, poids, faces, parties)."""

    def __init__(self, lod):
        self.lod = lod
        self.P, self.W, self.F, self.FP = [], [], [], []
        self.n = 0

    def add(self, P, W, faces, parts):
        o = self.n
        self.P.append(P)
        self.W.append(W)
        for f, p in zip(faces, parts):
            f = [o + i for i in f]
            if len(f) == 4:
                self.F.append((f[0], f[1], f[2]))
                self.F.append((f[0], f[2], f[3]))
                self.FP += [p, p]
            else:
                self.F.append(tuple(f))
                self.FP.append(p)
        self.n += len(P)

    def tableaux(self):
        return np.concatenate(self.P), np.concatenate(self.W), np.array(self.F, np.int64), np.array(self.FP, np.int64)


def peau(corps, keys, nseg, part, wfn, axes=None, spacing=0.03, ang_fn=None, disp_fn=None, ref=Z, rot=False):
    """Tend une peau sur les sections clés. part : entier ou f(centre_face, bande, angle) -> partie.
    wfn(P) -> poids (n,17). axes=(u,w) fixes, sinon repère suivant le chemin (référence `ref`).
    rot : décale les angles d'un demi-pas (volumes « boîte »)."""
    R = anneaux(keys, corps.lod, spacing)
    m = len(R)
    C = R[:, :3]
    if axes is not None:
        U = np.tile(np.asarray(axes[0], float), (m, 1))
        Wv = np.tile(np.asarray(axes[1], float), (m, 1))
    else:
        D = np.diff(C, axis=0)
        ok = np.linalg.norm(D, axis=1) > 1e-9
        for i in range(len(D)):  # propage les directions valides sur les segments dégénérés
            if not ok[i]:
                js = [j for j in range(len(D)) if ok[j]]
                D[i] = D[min(js, key=lambda j: abs(j - i))]
        D = nrm(D)
        T = np.zeros((m, 3))
        T[0], T[-1] = D[0], D[-1]
        for i in range(1, m - 1):
            T[i] = D[i - 1] + D[i]
        T = nrm(T)
        tu = T[0] @ np.array([0.3, 1.0, 0.2])
        T = T if tu >= 0 else -T
        U = nrm(np.cross(T, ref))
        Wv = np.cross(U, T)
    base = np.arange(nseg) * (2 * math.pi / nseg) + (math.pi / nseg if rot else 0.0)
    P, ANG, CC, start, cnt, angs = [], [], [], [], [], []
    for i in range(m):
        r = R[i]
        start.append(len(P))
        if r[3] < 1e-6 and r[4] < 1e-6:
            P.append(C[i].copy())
            ANG.append(0.0)
            CC.append(C[i])
            cnt.append(1)
            angs.append(base)
            continue
        a = ang_fn(r, nseg) if ang_fn else base
        x, w = section(a, r[3], r[4], r[5], r[6], r[7])
        for k in range(nseg):
            P.append(C[i] + x[k] * U[i] + w[k] * Wv[i])
            ANG.append(a[k])
            CC.append(C[i])
        cnt.append(nseg)
        angs.append(a)
    P = np.array(P)
    if disp_fn:
        P = disp_fn(P, np.array(ANG), np.array(CC))
    faces, parts = [], []
    acc = 0.0
    for i in range(m - 1):
        if cnt[i] == 1 and cnt[i + 1] == 1:
            continue
        cm = 0.5 * (C[i] + C[i + 1])
        a0 = angs[i] if cnt[i] > 1 else angs[i + 1]
        a1 = angs[i + 1] if cnt[i + 1] > 1 else angs[i]
        for k in range(nseg):
            k2 = (k + 1) % nseg
            if cnt[i] == 1:
                f = (start[i], start[i + 1] + k2, start[i + 1] + k)
            elif cnt[i + 1] == 1:
                f = (start[i] + k, start[i] + k2, start[i + 1])
            else:
                f = (start[i] + k, start[i] + k2, start[i + 1] + k2, start[i + 1] + k)
            am = 0.25 * (a0[k] + a1[k] + (a0[k2] if k2 else 2 * math.pi) + (a1[k2] if k2 else 2 * math.pi))
            am = (am + math.pi) % (2 * math.pi) - math.pi
            pts = P[list(f)]
            cen = pts.mean(axis=0)
            nf = np.cross(pts[1] - pts[0], pts[-1] - pts[0])
            acc += nf @ (cen - cm)
            faces.append(f)
            parts.append(part if isinstance(part, int) else part(np.array([cen[0], cm[1] if axes is not None else cen[1], cen[2]]), min(k, nseg - 1 - k), am))
    if acc < 0:
        faces = [tuple(reversed(f)) for f in faces]
    Wt = wfn(P)
    corps.add(P, Wt, faces, parts)
    return P


class Profil:
    """Évalue une pile de sections horizontales (lissées) à une hauteur y quelconque."""

    def __init__(self, keys):
        R = anneaux([k for k in keys if k['ru'] > 1e-6], 0, 0.008)
        o = np.argsort(R[:, 1], kind='stable')
        self.R = R[o]

    def at(self, y):
        return np.array([np.interp(y, self.R[:, 1], self.R[:, j]) for j in range(8)])

    def pt(self, y, a, off=0.0):
        r = self.at(y)
        x, w = section(np.array([a]), r[3], r[4], r[5], r[6], r[7])
        p = np.array([r[0] + x[0], y, r[2] + w[0]])
        if off:
            d = np.array([x[0] / max(r[3], 1e-6) ** 2, 0.0, w[0] / max(r[4] if w[0] >= 0 else r[5], 1e-6) ** 2])
            p = p + off * nrm(d)
        return p


def un_os(nom):
    j = BI[nom]

    def f(P):
        W = np.zeros((len(P), 17))
        W[:, j] = 1.0
        return W
    return f


def boule(corps, c, rx, ry, rz, nseg, part, wfn, e=2.0):
    """Ellipsoïde modelé (5 sections)."""
    c = np.asarray(c, float)
    ks = [pole(c - Y * ry)]
    for t, imp in ((-0.72, 1), (-0.3, 2), (0.0, 0), (0.45, 2), (0.78, 1)):
        s = math.sqrt(1 - t * t)
        ks.append(K(c + Y * ry * t, rx * s, rz * s, e=e, imp=imp))
    ks.append(pole(c + Y * ry))
    peau(corps, ks, nseg, part, wfn, axes=(X, Z), spacing=None)


def ruban(corps, pts, ep, larg, nseg, part, wfn, ref=X, spacing=0.035):
    """Sangle : chemin lissé à section plate (épaisseur ep, largeur larg)."""
    ks = [K(p, ep, larg, e=3.0, imp=(0 if i in (0, len(pts) - 1, len(pts) // 2) else 1)) for i, p in enumerate(pts)]
    peau(corps, ks, nseg, part, wfn, ref=ref, spacing=spacing, rot=True)


# =====================================================================================================
# 2. REPÈRES ANATOMIQUES ET SQUELETTE
# =====================================================================================================
def reperes(c):
    H = c['H']
    L = SimpleNamespace()
    L.H = H
    L.sc = H / 1.78
    L.mb = c.get('membre', 1.0) * L.sc
    L.hh = c.get('tete', 0.128) * H
    L.y_chin = H - L.hh
    L.y_cou = L.y_chin - 0.022 * H
    L.y_tete = L.y_chin + 0.12 * L.hh
    L.y_ep = L.y_cou - 0.032 * H
    L.y_hip = c.get('hipf', 0.52) * H
    L.y_crotch = L.y_hip - 0.05 * H
    L.y_knee = 0.545 * L.y_hip
    L.y_ank = 0.045 * H
    L.y_w = lerp(L.y_hip, L.y_ep, 0.36)
    L.y_ch = lerp(L.y_hip, L.y_ep, 0.72)
    L.y_han = L.y_hip + 0.02 * H
    L.y_col = lerp(L.y_hip, L.y_ep, 0.24)
    L.y_poi = lerp(L.y_hip, L.y_ep, 0.55)
    L.ep_x = c.get('ep', 0.105) * H
    L.tx = c.get('tx', 0.092) * H
    L.tz = c.get('tz', 0.062) * H
    L.wx = c.get('wx', 0.080) * H
    L.wz = c.get('wz', 0.055) * H
    L.hx = c.get('hx', 0.093) * H
    L.hz = c.get('hz', 0.062) * H
    L.ventre = c.get('ventre', 0.0)
    L.buste = c.get('buste', 0.0)
    L.rn = c.get('cou', 0.031) * H
    L.x_leg = 0.53 * L.hx
    L.z_tete = 0.02 * L.hh
    L.Lu = 0.172 * H
    L.Lf = 0.145 * H
    L.hs = c.get('main', 1.0) * H * 0.105 / 0.187
    abd = math.radians(c.get('abd', 7.0))
    L.dir_u = {1: V3(math.sin(abd), -math.cos(abd), 0.0), -1: V3(-math.sin(abd), -math.cos(abd), 0.0)}
    L.dir_f = {s: nrm(V3(s * math.sin(abd) * 0.6, -math.cos(abd), 0.17)) for s in (1, -1)}
    L.S = {s: V3(s * L.ep_x, L.y_ep, -0.005) for s in (1, -1)}
    L.E = {s: L.S[s] + L.dir_u[s] * L.Lu for s in (1, -1)}
    L.Wr = {s: L.E[s] + L.dir_f[s] * L.Lf for s in (1, -1)}
    L.G = {s: L.Wr[s] + L.dir_f[s] * 0.085 * L.hs for s in (1, -1)}  # centre de la paume
    L.pl = c.get('pied', 0.148) * H  # longueur du pied
    L.heel = 0.26 * L.pl
    L.toe = 0.74 * L.pl
    J = np.zeros((17, 3))
    J[0] = (0, L.y_han, 0)
    J[1] = (0, L.y_col, 0)
    J[2] = (0, L.y_poi, 0)
    J[3] = (0, L.y_cou, -0.004)
    J[4] = (0, L.y_tete, 0)
    for s, o in ((1, 5), (-1, 8)):
        J[o], J[o + 1], J[o + 2] = L.S[s], L.E[s], L.Wr[s]
    for s, o in ((1, 11), (-1, 14)):
        J[o] = (s * L.x_leg, L.y_hip, 0)
        J[o + 1] = (s * L.x_leg, L.y_knee, 0)
        J[o + 2] = (s * L.x_leg, L.y_ank, 0)
    L.J = J
    # table du torse nu : y, rx, rz avant, rz arrière, importance
    v, bu, Hh = L.ventre, L.buste, H
    L.tb = np.array([
        (L.y_crotch + 0.012 * Hh, 0.60 * L.hx, 0.72 * L.hz, 0.80 * L.hz, 2),
        (L.y_crotch + 0.040 * Hh, 0.93 * L.hx, 0.92 * L.hz + 0.2 * v, 1.02 * L.hz, 1),
        (L.y_hip + 0.012 * Hh, L.hx, 0.97 * L.hz + 0.5 * v, 1.09 * L.hz, 0),
        (lerp(L.y_hip, L.y_w, 0.55), lerp(L.hx, L.wx, 0.6), lerp(L.hz, L.wz, 0.6) + 0.9 * v, lerp(L.hz, L.wz, 0.7), 2),
        (L.y_w, L.wx, L.wz + v, L.wz, 0),
        (lerp(L.y_w, L.y_ch, 0.5), lerp(L.wx, L.tx, 0.6), lerp(L.wz, L.tz, 0.5) + 0.6 * v + 0.55 * bu, lerp(L.wz, L.tz, 0.6), 2),
        (L.y_ch, L.tx, L.tz + bu, L.tz * 1.03, 0),
        (L.y_ep - 0.030 * Hh, L.tx * 1.01, L.tz * 0.98 + 0.45 * bu, L.tz * 1.02, 1),
        (L.y_ep + 0.010 * Hh, L.ep_x * 0.93, L.tz * 0.76, L.tz * 0.86, 0),
        (L.y_ep + 0.028 * Hh, L.ep_x * 0.52, L.tz * 0.60, L.tz * 0.72, 1),
        (L.y_cou + 0.004 * Hh, L.rn * 1.45, L.rn * 1.3, L.rn * 1.4, 1),
    ])
    return L


def torse_r(L, y):
    t = L.tb
    return np.array([np.interp(y, t[:, 0], t[:, j]) for j in (1, 2, 3)])


def torse_z(L, y, x, avant=True, e=2.4):
    """Profondeur de la surface du torse nu à (x, y)."""
    rx, rzf, rzb = torse_r(L, y)
    q = max(0.0, 1.0 - min(1.0, abs(x) / rx) ** e) ** (1.0 / e)
    return rzf * q if avant else -rzb * q


def w_colonne(L, P):
    y, ax = P[:, 1], np.abs(P[:, 0])
    d = 0.035 * L.H
    a1 = sm(L.y_col - d, L.y_col + d, y)
    a2 = sm(L.y_poi - d, L.y_poi + d, y)
    a3 = sm(L.y_cou - 0.5 * d, L.y_cou + 0.5 * d, y) * (1 - sm(L.rn * 1.6, L.rn * 3.0, ax))
    a4 = sm(L.y_tete - 0.4 * d, L.y_tete + 0.4 * d, y)
    W = np.zeros((len(P), 17))
    W[:, 0] = 1 - a1
    W[:, 1] = a1 * (1 - a2)
    W[:, 2] = a2 * (1 - a3)
    W[:, 3] = a3 * (1 - a4)
    W[:, 4] = a3 * a4
    return W


def w_torse(L, P, wt=0.45):
    """Colonne + légère influence des cuisses sous les hanches."""
    W = w_colonne(L, P)
    f = wt * sm(L.y_hip + 0.01 * L.H, L.y_crotch, P[:, 1])
    g = np.clip(P[:, 0] / L.x_leg, -1, 1)
    wl, wr = f * np.maximum(g, 0), f * np.maximum(-g, 0)
    W *= (1 - wl - wr)[:, None]
    W[:, BI['cuisse_g']] += wl
    W[:, BI['cuisse_d']] += wr
    return W


def w_pan(L, P, wmax=0.75):
    """Jupes, robes, pans de manteau : hanches + cuisses (réparties gauche/droite)."""
    W = w_colonne(L, P)
    f = wmax * sm(L.y_hip + 0.01 * L.H, L.y_hip - 0.22 * L.sc, P[:, 1])
    gl = sm(-0.7 * L.x_leg, 0.7 * L.x_leg, P[:, 0])
    W *= (1 - f)[:, None]
    W[:, BI['cuisse_g']] += f * gl
    W[:, BI['cuisse_d']] += f * (1 - gl)
    return W


def w_bras(L, s):
    o = 5 if s == 1 else 8
    S, E, Wr, du, df = L.S[s], L.E[s], L.Wr[s], L.dir_u[s], L.dir_f[s]
    bis = nrm(du + df)

    def f(P):
        a_sh = sm(-0.035 * L.sc, 0.05 * L.sc, (P - S) @ du)
        a_el = sm(-0.035 * L.sc, 0.035 * L.sc, (P - E) @ bis)
        a_wr = sm(-0.018 * L.sc, 0.018 * L.sc, (P - Wr) @ df)
        W = np.zeros((len(P), 17))
        W[:, 2] = 1 - a_sh
        W[:, o] = a_sh * (1 - a_el)
        W[:, o + 1] = a_sh * a_el * (1 - a_wr)
        W[:, o + 2] = a_sh * a_el * a_wr
        return W
    return f


def w_jambe(L, s):
    o = 11 if s == 1 else 14

    def f(P):
        y = P[:, 1]
        a_h = sm(L.y_hip + 0.055 * L.H, L.y_hip - 0.02 * L.H, y)
        a_k = sm(L.y_knee + 0.05 * L.sc, L.y_knee - 0.05 * L.sc, y)
        a_a = sm(L.y_ank + 0.03 * L.sc, L.y_ank - 0.012 * L.sc, y)
        W = np.zeros((len(P), 17))
        W[:, 0] = 1 - a_h
        W[:, o] = a_h * (1 - a_k)
        W[:, o + 1] = a_h * a_k * (1 - a_a)
        W[:, o + 2] = a_h * a_k * a_a
        return W
    return f


# =====================================================================================================
# 3. MODELAGE DU CORPS ET DES TENUES
# =====================================================================================================
NSEG = dict(torse=(16, 10, 6), tete=(20, 10, 6), cou=(10, 6, 4), bras=(10, 6, 4), main=(8, 5, 3), pouce=(5, 4, 0),
            jambe=(12, 7, 4), chauss=(10, 6, 4), pan=(18, 10, 6), extra=(10, 6, 4), fin=(6, 4, 0), sac=(12, 8, 4))


def faire_torse(b, c, L):
    lod = b.lod
    n = NSEG['torse'][lod]
    h = c['haut']
    et, eb = h.get('ease', 0.012), c['bas'].get('ease', 0.008)
    y_hem = None if h.get('hem') is None else L.y_hip + h['hem'] * L.H
    bandes = h.get('bandes', []) if n >= 8 else []
    yb0 = lerp(L.y_hip, L.y_ep, h.get('bande_y0', 0.3)) if bandes else None
    yb1 = L.y_ep + 0.027 * L.H
    ys = [(r[0], int(r[4])) for r in L.tb]
    if bandes and y_hem is not None:
        yb0 = max(yb0, y_hem)
    if bandes and not any(abs(y - yb0) < 0.012 for y, _ in ys):
        ys.append((yb0, 1))
    elif bandes:
        yb0 = min(ys, key=lambda t: abs(t[0] - yb0))[0]
    if y_hem is not None:
        ys = [(y, i) for y, i in ys if abs(y - y_hem) > 0.012] + [(y_hem, -1)]
    ys.sort()
    y_top = L.tb[-1][0]

    def rad(y, top):
        rx, rzf, rzb = torse_r(L, y)
        e = (et if top else eb) * (0.35 + 0.65 * float(sm(y_top, L.y_ep, y)))
        return rx + e, rzf + e, rzb + e

    keys = [pole((0, L.y_crotch - 0.008 * L.H, 0))]
    for y, imp in ys:
        if imp == -1 and lod == 2:
            r = rad(y, True)
            keys.append(K((0, y, 0), r[0], r[1], r[2], e=2.4, imp=0))
        elif imp == -1:
            r = rad(y, False)
            keys.append(K((0, y, 0), r[0], r[1], r[2], e=2.4, imp=1, brk=True))
            r = rad(y, True)
            lip = h.get('lip', 0.008)
            keys.append(K((0, y, 0), r[0] + lip, r[1] + lip, r[2] + lip, e=2.4, imp=1))
        else:
            r = rad(y, y_hem is None or y > y_hem)
            keys.append(K((0, y, 0), r[0], r[1], r[2], e=2.4, imp=imp))
    keys.append(pole((0, L.y_cou + 0.012 * L.H, 0)))
    y_enc = L.y_ep + (0.016 if h.get('encolure') == 'large' else 0.029) * L.H if h.get('encolure') else None
    sous = h.get('sous', BAS)

    def larg(bd, y):
        t = float(np.clip((y - yb0) / (yb1 - yb0), 0, 1))
        return lerp(bd[1], bd[2], t) * L.sc

    def ang_fn(r, nn):
        base = np.arange(nn) * (2 * math.pi / nn)
        y = r[1]
        if not bandes or y < yb0 - 1e-6 or y > yb1 + 1e-6:
            return base
        a = base.copy()
        prev = 0.0
        for i, bd in enumerate(bandes):
            ai = math.asin(min(0.97, (larg(bd, y) / r[3])) ** (r[6] / 2))
            ai = max(ai, prev + 0.04)
            a[i + 1], a[nn - 1 - i] = ai, 2 * math.pi - ai
            prev = ai
        k = len(bandes)
        rest = nn - 2 * k - 1  # sommets restants répartis sur le reste du tour
        for j in range(rest):
            a[k + 1 + j] = prev + (2 * math.pi - 2 * prev) * (j + 1) / (rest + 1)
        return a

    def part(cen, band, am):
        y = cen[1]
        if y_hem is not None and y < y_hem - 1e-6:
            return sous
        if y_enc is not None and y > y_enc:
            return PEAU
        if bandes and yb0 < y < yb1 and band < len(bandes):
            return bandes[band][0]
        return HAUT

    peau(b, keys, n, part, lambda P: w_torse(L, P), axes=(X, Z), spacing=0.034 * L.sc, ang_fn=ang_fn)
    # col (chemise, polo, manteau)
    if h.get('col') is not None and lod < 2:
        rn, y0 = L.rn, L.y_cou
        ks = [K((0, y0 - 0.006 * L.H, 0.0), rn * 1.6, rn * 1.5, rn * 1.5, imp=1),
              K((0, y0 + 0.006 * L.H, -0.002), rn * 1.36, rn * 1.34, rn * 1.34, imp=2),
              K((0, y0 + 0.017 * L.H, -0.006), rn * 1.2, rn * 1.12, rn * 1.26, imp=1, brk=True),
              K((0, y0 + 0.015 * L.H, -0.006), rn * 1.06, rn * 1.03, rn * 1.08, imp=1)]
        peau(b, ks, NSEG['cou'][lod] + 2, h['col'], lambda P: w_colonne(L, P), axes=(X, Z), spacing=None)
    if h.get('capuche') and lod < 2 or h.get('capuche') and lod == 2:
        cz = -(L.tz * 0.75 + et + 0.03 * L.sc)
        cy = L.y_cou + 0.004 * L.H
        ks = [pole((0, cy - 0.075 * L.sc, cz + 0.02)),
              K((0, cy - 0.05 * L.sc, cz + 0.01), 0.085 * L.sc, 0.04 * L.sc, imp=1),
              K((0, cy, cz), 0.125 * L.sc, 0.06 * L.sc, 0.065 * L.sc, imp=0),
              K((0, cy + 0.04 * L.sc, cz + 0.012), 0.105 * L.sc, 0.05 * L.sc, imp=1),
              pole((0, cy + 0.062 * L.sc, cz + 0.02))]
        peau(b, ks, NSEG['extra'][lod], HAUT, un_os('poitrine'), axes=(X, Z), spacing=0.03)
    # cou
    rn = L.rn
    ks = [pole((0, L.y_cou - 0.03 * L.H, -0.006), imp=1),
          K((0, L.y_cou - 0.012 * L.H, -0.006), rn * 1.2, imp=0),
          K((0, L.y_cou + 0.012 * L.H, -0.003), rn * 1.03, imp=1),
          K((0, L.y_chin + 0.02 * L.hh, 0.004), rn * 0.98, imp=1),
          K((0, L.y_chin + 0.22 * L.hh, 0.006), rn * 0.95, imp=0),
          pole((0, L.y_chin + 0.3 * L.hh, 0.006), imp=1)]
    peau(b, ks, NSEG['cou'][lod], PEAU, lambda P: w_colonne(L, P), axes=(X, Z), spacing=0.03)
    return SimpleNamespace(et=et, eb=eb, y_hem=y_hem)


def faire_pan(b, c, L, T):
    """Jupe, bas de robe, pan de manteau/parka."""
    p = c.get('pan')
    if not p:
        return
    lod = b.lod
    part = p.get('part', HAUT)
    e = T.et if part == HAUT else T.eb
    y_hem = p['hem'] * L.H
    if part == HAUT and T.y_hem is None:
        y0 = L.y_hip + 0.06 * L.H
        r0 = torse_r(L, y0) + e - 0.004
    else:
        y0 = (T.y_hem if T.y_hem is not None else L.y_w) + 0.012
        r0 = torse_r(L, y0) + min(T.eb, T.et - 0.012) - 0.002
    fl = p.get('evase', 1.2)
    y1 = L.y_hip + 0.012 * L.H
    if part != HAUT and T.y_hem is not None:
        y1 = min(y1, T.y_hem - 0.03 * L.sc)
    r1 = torse_r(L, L.y_hip + 0.012 * L.H) + e + 0.006
    rc = r1 * lerp(1.0, fl, min(1.0, (L.y_hip - L.y_crotch) / max(L.y_hip - y_hem, 1e-3)) ** 0.8)
    rh = r1 * fl
    ks = [K((0, y0, 0), r0[0], r0[1], r0[2], e=2.4, imp=0),
          K((0, y1, 0), r1[0], r1[1], r1[2], e=2.4, imp=1),
          K((0, L.y_crotch - 0.01, 0), rc[0], rc[1], rc[2] * 1.03, e=2.3, imp=1),
          K((0, y_hem, 0), rh[0], rh[1] * 1.04, rh[2] * 1.04, e=2.2, imp=0, brk=True),
          K((0, y_hem + 0.004, 0), rh[0] - 0.012, rh[1] - 0.012, rh[2] - 0.012, e=2.2, imp=1),
          K((0, y_hem + 0.07 * L.sc, 0), rh[0] * 0.6, rh[1] * 0.6, rh[2] * 0.6, e=2.2, imp=2),
          pole((0, y_hem + 0.10 * L.sc, 0))]
    peau(b, ks, NSEG['pan'][lod], part, lambda P: w_pan(L, P, p.get('wt', 0.75)), axes=(X, Z), spacing=0.05 * L.sc)


def faire_bras(b, c, L, T, s):
    lod = b.lod
    h = c['haut']
    mb, sc = L.mb, L.sc
    S, du, df, E, Wr = L.S[s], L.dir_u[s], L.dir_f[s], L.E[s], L.Wr[s]
    manches = h.get('manches', 'longues')
    mpart = h.get('manche_part', HAUT)
    em = h.get('ease_m', min(T.et, 0.016)) if manches != 'sans' else 0.0
    Lu, Lf = L.Lu, L.Lf
    d_fin = {'longues': Lu + Lf - 0.022 * sc, 'courtes': 0.52 * Lu, 'trois_quarts': Lu + 0.4 * Lf, 'sans': -1.0}[manches]
    tab = [(-0.017, 0.027, 2), (0.000, 0.043, 1), (0.045, 0.052, 0), (0.42 * Lu / sc, 0.049, 2), (Lu / sc - 0.07, 0.043, 2),
           (Lu / sc, 0.040, 0), (Lu / sc + 0.055, 0.043, 1), (Lu / sc + 0.14, 0.037, 2), ((Lu + Lf) / sc - 0.012, 0.028, 0)]

    def pos(d):
        return S + du * d if d <= Lu else E + df * (d - Lu)

    def r_nu(d):
        return float(np.interp(d / sc, [t[0] for t in tab], [t[1] for t in tab])) * mb

    ds = [(t[0] * sc, t[2]) for t in tab]
    if 0 < d_fin < Lu + Lf - 0.03 * sc:
        ds = [(d, i) for d, i in ds if abs(d - d_fin) > 0.03 * sc] + [(d_fin, -1)]
    elif d_fin > 0:
        ds = ds[:-1] + [(d_fin, -1)]
    ds.sort()
    keys = [pole(pos(-0.026 * sc))]
    for d, imp in ds:
        r = r_nu(d)
        aplat = float(sm(Lu, Lu + Lf, d))
        if imp == -1:
            rr = r + em + (0.004 if manches == 'courtes' else 0.002)
            keys.append(K(pos(d), rr * 0.97, rr * 1.06, imp=0, brk=True))
            keys.append(K(pos(d), r * lerp(0.95, 0.85, aplat), r * lerp(1.05, 1.12, aplat), imp=(0 if d < Lu + Lf - 0.03 * sc else 1)))
        else:
            rr = r + (em * (0.35 + 0.65 * float(sm(-0.02 * sc, 0.06 * sc, d))) if d < d_fin else 0.0)
            keys.append(K(pos(d), rr * lerp(0.96, 0.85, aplat), rr * lerp(1.06, 1.12, aplat), imp=imp))
    keys.append(pole(pos(Lu + Lf + 0.004 * sc)))

    def part(cen, band, am):
        d = (cen - S) @ du if (cen - E) @ nrm(du + df) < 0 else Lu + (cen - E) @ df
        return mpart if d < d_fin - 1e-4 else PEAU

    peau(b, keys, NSEG['bras'][lod], part, w_bras(L, s), spacing=0.034 * sc)
    # main : paume + doigts joints légèrement repliés, pouce séparé
    hs = L.hs
    med = V3(-s, 0, 0)
    gant = c.get('gants')
    pm = ACC if gant else PEAU
    ks = [pole(Wr - df * 0.014 * hs),
          K(Wr, 0.021 * hs, 0.027 * hs, imp=1),
          K(Wr + df * 0.035 * hs, 0.017 * hs, 0.037 * hs, 0.031 * hs, imp=1),
          K(Wr + df * 0.085 * hs + med * 0.002, 0.016 * hs, 0.041 * hs, 0.037 * hs, imp=0),
          K(Wr + df * 0.130 * hs + med * 0.012 * hs, 0.013 * hs, 0.037 * hs, 0.034 * hs, imp=2),
          K(Wr + df * 0.168 * hs + med * 0.030 * hs, 0.010 * hs, 0.028 * hs, 0.027 * hs, imp=1),
          pole(Wr + df * 0.187 * hs + med * 0.042 * hs)]
    wm = un_os('main_g' if s == 1 else 'main_d')
    peau(b, ks, NSEG['main'][lod], pm, wm, spacing=0.03 * hs)
    if NSEG['pouce'][lod]:
        p0 = Wr + df * 0.030 * hs + Z * 0.030 * hs
        dp = nrm(df * 0.85 + Z * 0.5 + med * 0.15)
        ks = [pole(p0 - dp * 0.006 * hs), K(p0 + dp * 0.012 * hs, 0.011 * hs, imp=1),
              K(p0 + dp * 0.042 * hs, 0.0095 * hs, imp=1), pole(p0 + dp * 0.066 * hs)]
        peau(b, ks, NSEG['pouce'][lod], pm, wm, spacing=0.03)


def faire_jambe(b, c, L, T, s):
    lod = b.lod
    bas = c['bas']
    mb, sc = L.mb, L.sc
    x = s * L.x_leg
    typ = bas.get('type', 'pantalon')
    eb = T.eb
    yk, ya, yc = L.y_knee, L.y_ank, L.y_crotch
    tab = [(L.y_hip + 0.03 * L.H, 0.070, 0.070, 0.070, 2), (yc, 0.082, 0.088, 0.090, 0), (lerp(yc, yk, 0.45), 0.073, 0.078, 0.080, 2),
           (yk + 0.075 * sc, 0.058, 0.060, 0.060, 1), (yk, 0.052, 0.057, 0.050, 0), (yk - 0.06 * sc, 0.047, 0.047, 0.053, 2),
           (yk - 0.13 * sc, 0.050, 0.045, 0.063, 1), (ya + 0.15 * sc, 0.040, 0.039, 0.046, 2), (ya + 0.035 * sc, 0.033, 0.034, 0.036, 0)]
    ty = np.array([t[0] for t in tab])[::-1]

    def r_nu(y):
        return np.array([np.interp(y, ty, np.array([t[j] for t in tab])[::-1]) for j in (1, 2, 3)]) * mb

    y_fin = {'pantalon': ya + bas.get('fin', 0.02) * sc, 'short': yk + bas.get('fin', 0.10) * sc, 'aucun': 9.0}[typ]
    gk, gh = bas.get('genou', 0.068) * sc, bas.get('ourlet', 0.066) * sc

    def r_vet(y):
        r = r_nu(y) + eb
        if typ == 'pantalon':
            mn = lerp(gh, gk, float(sm(ya, yk, y))) if y < yk else gk
            r = np.maximum(r, mn)
        elif typ == 'short':
            r = np.maximum(r, r_nu(y)[0] + bas.get('ampleur', 0.012))
        return r

    ys = [(t[0], t[4]) for t in tab]
    if typ != 'aucun':
        ys = [(y, i) for y, i in ys if y > y_fin + 0.03 * sc] + [(y_fin, -1)] + [(y, i) for y, i in ys if y < y_fin - 0.03 * sc]
        if typ == 'pantalon':
            ys = [(y, i) for y, i in ys if y >= y_fin]
    y_ch, y_bt = ya + bas.get('chaussette', 0.0) * sc, ya + bas.get('botte', 0.0) * sc
    for yy in (y_ch, y_bt):
        if yy > ya + 0.04 * sc and yy < y_fin - 0.03 * sc:
            ys = [(y, i) for y, i in ys if abs(y - yy) > 0.03 * sc] + [(yy, 1)]
    ys.sort(reverse=True)
    keys = [pole((x, L.y_hip + 0.065 * L.H, 0))]
    for y, imp in ys:
        if imp == -1:
            r = r_vet(y) + 0.003
            keys.append(K((x, y, 0), r[0], r[1], r[2], imp=0, brk=True))
            r = r_nu(y)
            keys.append(K((x, y, 0), r[0], r[1], r[2], imp=(0 if typ == 'short' else 1)))
        else:
            r = r_vet(y) if y > y_fin else r_nu(y)
            if y > L.y_crotch + 0.004:  # la tête de cuisse reste à l'intérieur du bassin
                lim = max(0.02, torse_r(L, min(y, L.y_hip + 0.03 * L.H))[0] + min(T.et, T.eb) - 0.007 - L.x_leg)
                r = np.minimum(r, [lim, 9, 9]) * float(lerp(1.0, 0.8, sm(L.y_crotch, L.y_hip + 0.03 * L.H, y)))
            if y <= y_bt + 1e-6 and y < y_fin:
                r = r + 0.006
            elif y <= y_ch + 1e-6 and y < y_fin:
                r = r + 0.003
            keys.append(K((x, y, 0), r[0], r[1], r[2], imp=imp))
    r = r_nu(ya)
    if typ != 'pantalon':
        keys.append(K((x, ya - 0.01 * sc, 0), r[0], r[1], r[2], imp=1))
    keys.append(pole((x, ya - 0.03 * sc, 0), imp=(1 if typ == 'pantalon' else 0)))
    jp = bas.get('jambe', PEAU)

    def part(cen, band, am):
        y = cen[1]
        if y > y_fin + 1e-6:
            return BAS
        if y < y_bt:
            return CHAUSS
        if y < y_ch:
            return HAUT2
        return jp

    peau(b, keys, NSEG['jambe'][lod], part, w_jambe(L, s), axes=(X, Z), spacing=0.036 * sc)


def faire_chaussure(b, c, L, s):
    lod = b.lod
    ch = c.get('chauss', {})
    pl = L.pl
    k = pl / 0.263
    larg = ch.get('larg', 1.0) * k
    sem = ch.get('semelle', 1.0)
    haut = ch.get('tige', 1.0)
    x = s * L.x_leg
    out = math.radians(ch.get('ouverture', 7.0)) * s
    R = rot_y(out)
    n = NSEG['chauss'][lod]
    # sections le long du pied : z relatif à la cheville, demi-largeur, hauteur du dessus
    tab = [(-0.25, 0.031, 0.062, 1), (-0.13, 0.041, 0.092, 0), (0.04, 0.045, 0.096, 2), (0.20, 0.048, 0.076, 1),
           (0.42, 0.052, 0.054, 0), (0.60, 0.049, 0.044, 2), (0.70, 0.036, 0.038, 1)]
    orig = V3(x, 0, 0)

    def P3(z, y):
        return orig + R @ V3(0, y, z * pl)

    keys = [pole(P3(-0.265, 0.03 * k))]
    for z, hw, top, imp in tab:
        top = top * k * (haut if z < 0.1 else 1.0)
        keys.append(K(P3(z, top / 2), hw * larg, top / 2, top / 2, e=2.2, em=5.0, imp=imp))
    keys.append(pole(P3(0.742, 0.016 * k)))
    if n >= 6:
        m = (n - 4) // 2  # sommets du dessus de chaque côté
        haut_a = [math.radians(t) for t in np.linspace(0, 96, m + 2)[:-1]]
        side = [math.radians(104 - 6 * sem), math.radians(140)]
        a = haut_a + side
        a = np.array(a + [math.pi] + [2 * math.pi - t for t in reversed(a[1:])])[:n]
        lim = math.radians(100 - 3 * sem)
    else:
        a = np.radians([45.0, 125.0, 235.0, 315.0])
        lim = math.radians(100)

    def part(cen, band, am):
        return DETAIL if abs(am) > lim and n >= 6 else CHAUSS

    peau(b, keys, n, part, un_os('pied_g' if s == 1 else 'pied_d'), axes=(R @ X, Y), spacing=0.034 * k, ang_fn=lambda r, nn: a,
         disp_fn=(None if n >= 6 else lambda P, ANG, CC: np.column_stack([P[:, 0], np.where(P[:, 1] < CC[:, 1] - 1e-6, 0.0, P[:, 1]), P[:, 2]])))


def cles_tete(c, L):
    hh = L.hh
    j = c.get('machoire', 1.0)
    cr = c.get('crane', 1.0)
    z0 = L.z_tete
    tab = [(0.025, 0.15 * j, 0.33, 0.02, 2), (0.10, 0.235 * j, 0.385, 0.15, 0), (0.20, 0.285 * j, 0.40, 0.29, 1),
           (0.33, 0.315 * lerp(j, 1, 0.5), 0.405, 0.375, 2), (0.47, 0.325 * cr, 0.39, 0.42, 0), (0.58, 0.33 * cr, 0.41, 0.44, 1),
           (0.74, 0.325 * cr, 0.40, 0.445, 0), (0.88, 0.275 * cr, 0.325, 0.38, 1), (0.965, 0.175 * cr, 0.205, 0.25, 2)]
    ks = [pole((0, L.y_chin - 0.012 * hh, z0 + 0.14 * hh))]
    for fy, rx, rzf, rzb, imp in tab:
        ks.append(K((0, L.y_chin + fy * hh, z0), rx * hh, rzf * hh, rzb * hh, e=2.15, imp=imp))
    ks.append(pole((0, L.y_chin + hh, z0 - 0.02 * hh)))
    return ks


def ligne(pts):
    xs = np.radians([p[0] for p in pts])
    ys = [p[1] for p in pts]
    return lambda a: np.interp(np.abs(a), xs, ys)


def faire_tete(b, c, L):
    lod = b.lod
    hh = L.hh
    ch = c.get('cheveux', {})
    style = ch.get('style', 'court')
    ep = ch.get('ep', 0.014) * L.sc
    chap = c.get('chapeau')
    front = ch.get('front', 0.80)
    nuque = ch.get('nuque', 0.20)
    hl = ligne([(0, front), (48, front), (72, 0.62), (84, 0.50), (100, 0.44), (128, nuque), (180, nuque)])
    if style == 'degarni':
        hl2 = ligne([(0, 2), (60, 2), (80, 0.52), (100, 0.44), (128, nuque), (180, nuque)])

        def est_chev(fy, a):
            return (fy > hl2(a)) & ((fy < 0.80) | (np.abs(a) > math.radians(150)) & (fy < 0.9))
    elif style == 'chauve':
        def est_chev(fy, a):
            return fy > 9
    else:
        def est_chev(fy, a):
            return fy > hl(a)
    cap = None
    if chap == 'bonnet':
        cap = ligne([(0, 0.70), (90, 0.60), (180, 0.46)])
    elif chap == 'casquette':
        cap = ligne([(0, 0.74), (90, 0.66), (180, 0.56)])
    barbe = ligne([(0, 0.15), (28, 0.17), (55, 0.30), (95, 0.44), (108, 0.44), (116, -1), (180, -1)]) if c.get('barbe') else None
    cen = V3(0, L.y_chin + 0.52 * hh, L.z_tete)

    def fy_a(P):
        return (P[:, 1] - L.y_chin) / hh, np.arctan2(P[:, 0], P[:, 2] - L.z_tete)

    def disp(P, ANG, CC):
        fy, a = fy_a(P)
        d = nrm(P - cen)
        if style == 'degarni':
            m = sm(0.0, 0.08, fy - hl2(a)) * sm(0.86, 0.74, fy)
        elif style == 'chauve':
            m = np.zeros(len(P))
        else:
            m = sm(0.0, 0.09, fy - hl(a))
        off = m * ep * (0.55 + 0.45 * sm(0.45, 0.9, fy))
        if cap is not None:
            mc = sm(-0.01, 0.03, fy - cap(a))
            off = np.maximum(off * (1 - mc), mc * (0.012 if chap == 'bonnet' else 0.008) * L.sc + (ep * 0.5 * mc if chap == 'bonnet' else 0))
        if barbe is not None:
            off = off + sm(0.0, 0.05, barbe(a) - fy) * 0.006 * L.sc
        return P + d * off[:, None]

    def part(cn, band, am):
        fy = (cn[1] - L.y_chin) / hh
        a = math.atan2(cn[0], cn[2] - L.z_tete)
        if cap is not None and fy > cap(a) + 0.005:
            return ACC
        if est_chev(np.array(fy), np.array(a)):
            return CHEVEUX
        if barbe is not None and fy < barbe(a):
            return CHEVEUX
        return PEAU

    keys = cles_tete(c, L)
    wt = un_os('tete')
    peau(b, keys, NSEG['tete'][lod], part, wt, axes=(X, Z), spacing=0.017 * hh / 0.23, disp_fn=disp)
    pf = Profil(keys)
    yc = L.y_chin

    def zf(fy):
        r = pf.at(yc + fy * hh)
        return r[2] + r[4]

    enfant = c['age'] == 'enfant'
    fy_o = 0.445 if enfant else 0.47
    # nez
    if NSEG['fin'][lod]:
        ks = [pole((0, yc + (fy_o + 0.06) * hh, zf(fy_o + 0.06) - 0.004 * hh)),
              K((0, yc + (fy_o + 0.0) * hh, zf(fy_o) - 0.014 * hh), 0.022 * hh, 0.034 * hh, 0.01 * hh, imp=1),
              K((0, yc + (fy_o - 0.105) * hh, zf(fy_o - 0.105) - 0.024 * hh), 0.046 * hh, (0.078 if enfant else 0.092) * hh, 0.01 * hh, imp=1),
              K((0, yc + (fy_o - 0.14) * hh, zf(fy_o - 0.14) - 0.02 * hh), 0.040 * hh, 0.058 * hh, 0.01 * hh, imp=2),
              pole((0, yc + (fy_o - 0.165) * hh, zf(fy_o - 0.165) - 0.004 * hh))]
        peau(b, ks, NSEG['fin'][lod], PEAU, wt, axes=(X, Z), spacing=None)
        # yeux, sourcils, bouche : petites pastilles épousant le visage
        P, F, FPp = [], [], []

        def pastille(ac, fyc, da, dy, n, part_, off, incl=0.0):
            o = len(P)
            for i in range(n):
                t = 2 * math.pi * (i + 0.5) / n
                a = ac + da * math.cos(t)
                P.append(pf.pt(yc + (fyc + dy * math.sin(t) + incl * math.cos(t) * (1 if ac > 0 else -1)) * hh, a, off))
            for i in range(1, n - 1):
                F.append((o, o + i, o + i + 1))
                FPp.append(part_)

        a_o = math.radians(21.5)
        for sg in (1, -1):
            pastille(sg * a_o, fy_o, math.radians(7.2), 0.024 if not enfant else 0.03, 6 if lod == 0 else 4, DETAIL, 0.0016)
            if lod == 0:
                pastille(sg * a_o * 1.02, fy_o + 0.085, math.radians(10.5), 0.011, 4, DETAIL if not ch.get('sourcils_clairs') else CHEVEUX, 0.0022, incl=0.004)
        if lod == 0:
            pastille(0.0, fy_o - 0.265, math.radians(11.5), 0.008, 4, DETAIL, 0.0012)
        P = np.array(P)
        # oriente les pastilles vers l'extérieur
        F2 = []
        for f in F:
            nf = np.cross(P[f[1]] - P[f[0]], P[f[2]] - P[f[0]])
            F2.append(f if nf @ (P[f[0]] - cen) > 0 else (f[0], f[2], f[1]))
        b.add(P, wt(P), F2, FPp)
    # oreilles
    couvre = style in ('long', 'mi_long', 'carre') or chap == 'bonnet'
    if lod == 0 and not couvre:
        for sg in (1, -1):
            r = pf.at(yc + 0.46 * hh)
            x0 = sg * (r[3] - 0.012 * hh)
            c0 = V3(x0, yc + 0.455 * hh, L.z_tete - 0.03 * hh)
            ks = [K(c0, 0.050 * hh, 0.085 * hh, imp=2),
                  K(c0 + V3(sg * 0.035 * hh, 0, -0.02 * hh), 0.046 * hh, 0.08 * hh, imp=2),
                  pole(c0 + V3(sg * 0.045 * hh, 0, -0.025 * hh), imp=2)]
            peau(b, ks, 6, PEAU, wt, axes=(Z, Y), spacing=None)
    # compléments de coiffure
    ne = NSEG['extra'][lod]
    z0 = L.z_tete
    if style in ('long', 'mi_long', 'carre'):
        zb = -(L.tz * 0.86 + 0.012)  # dos, à hauteur d'épaules
        ks = [pole((0, yc + 0.95 * hh, z0 - 0.20 * hh)),
              K((0, yc + 0.80 * hh, z0 - 0.20 * hh), 0.30 * hh, 0.10 * hh, 0.29 * hh, imp=1),
              K((0, yc + 0.45 * hh, z0 - 0.20 * hh), 0.375 * hh, 0.235 * hh, 0.335 * hh, imp=0),
              K((0, yc + 0.10 * hh, z0 - 0.22 * hh), 0.385 * hh, 0.20 * hh, 0.33 * hh, imp=1)]
        if style == 'long':
            y_b = L.y_ep - ch.get('long', 0.10) * L.sc
            ks += [K((0, L.y_ep + 0.02 * L.H, zb + 0.01), 0.36 * hh, 0.07 * hh + 0.03, 0.05 * L.sc, imp=0),
                   K((0, lerp(L.y_ep, y_b, 0.6), zb - 0.004), 0.33 * hh, 0.03, 0.04 * L.sc, imp=1),
                   pole((0, y_b, zb - 0.01))]
        else:
            y_b = yc - (0.10 if style == 'mi_long' else 0.0) * hh
            ks += [K((0, y_b + 0.06 * hh, z0 - 0.22 * hh), 0.36 * hh, 0.17 * hh, 0.30 * hh, imp=0),
                   pole((0, y_b - 0.02 * hh, z0 - 0.24 * hh))]

        def wch(P):
            W = np.zeros((len(P), 17))
            f = 0.85 * sm(L.y_chin + 0.05 * hh, L.y_ep - 0.02, P[:, 1])
            W[:, 4] = 1 - f
            W[:, 2] = f
            return W
        peau(b, ks, NSEG['pan'][lod] - (4 if lod == 0 else 2 if lod == 1 else 1), CHEVEUX, wch, axes=(X, Z), spacing=0.035 * L.sc)
    if style == 'chignon':
        boule(b, (0, yc + 0.80 * hh, z0 - 0.50 * hh), 0.17 * hh, 0.15 * hh, 0.15 * hh, ne, CHEVEUX, wt)
    if style == 'queue':
        ks = [pole((0, yc + 0.80 * hh, z0 - 0.40 * hh)), K((0, yc + 0.74 * hh, z0 - 0.50 * hh), 0.085 * hh, imp=1),
              K((0, yc + 0.62 * hh, z0 - 0.64 * hh), 0.11 * hh, imp=0), K((0, yc + 0.36 * hh, z0 - 0.70 * hh), 0.10 * hh, 0.085 * hh, imp=1),
              K((0, yc + 0.08 * hh, z0 - 0.66 * hh), 0.075 * hh, 0.06 * hh, imp=0), pole((0, yc - 0.18 * hh, z0 - 0.60 * hh))]
        peau(b, ks, ne, CHEVEUX, wt, ref=X, spacing=0.03 * L.sc)
    if style == 'couettes':
        for sg in (1, -1):
            ks = [pole((sg * 0.28 * hh, yc + 0.66 * hh, z0 - 0.10 * hh)), K((sg * 0.37 * hh, yc + 0.60 * hh, z0 - 0.12 * hh), 0.075 * hh, imp=1),
                  K((sg * 0.50 * hh, yc + 0.42 * hh, z0 - 0.14 * hh), 0.105 * hh, imp=0), K((sg * 0.53 * hh, yc + 0.14 * hh, z0 - 0.13 * hh), 0.085 * hh, imp=1),
                  pole((sg * 0.50 * hh, yc - 0.10 * hh, z0 - 0.11 * hh))]
            peau(b, ks, ne - (2 if lod == 0 else 1), CHEVEUX, wt, ref=Z, spacing=0.03 * L.sc)
    # couvre-chefs
    if chap == 'bonnet':
        r = pf.at(yc + 0.64 * hh)
        o = 0.02 * L.sc
        ks = [K((0, yc + 0.54 * hh, z0 - 0.03 * hh), r[3] + o * 0.6, r[4] * 0.97 + o * 0.5, r[5] + o * 0.6, imp=1),
              K((0, yc + 0.58 * hh, z0 - 0.025 * hh), r[3] + o, r[4] + o, r[5] + o, imp=0),
              K((0, yc + 0.70 * hh, z0 - 0.01 * hh), r[3] + o, r[4] + o, r[5] + o, imp=0, brk=True),
              K((0, yc + 0.71 * hh, z0 - 0.01 * hh), r[3] * 0.95, r[4] * 0.95, r[5] * 0.95, imp=1)]
        # bord incliné (plus bas sur la nuque) : on cisaille les sections
        def cis(P, ANG, CC):
            Q = P.copy()
            Q[:, 1] += (P[:, 2] - z0) * 0.32 + 0.03 * hh
            return Q
        peau(b, ks, NSEG['tete'][lod], ACC, wt, axes=(X, Z), spacing=None, disp_fn=cis)
        if c.get('pompon'):
            boule(b, (0, yc + 1.06 * hh + ep * 0.3, z0 - 0.04 * hh), 0.14 * hh, 0.13 * hh, 0.14 * hh, NSEG['fin'][lod] or 4, ACC, wt)
    if chap == 'casquette':
        y_v = yc + 0.745 * hh
        zv = zf(0.745) + 0.004
        ks = [K((0, y_v, zv - 0.07 * hh), 0.30 * hh, 0.014 * hh, imp=0),
              K((0, y_v - 0.012 * hh, zv + 0.12 * hh), 0.27 * hh, 0.011 * hh, imp=1),
              K((0, y_v - 0.03 * hh, zv + 0.25 * hh), 0.18 * hh, 0.010 * hh, imp=1),
              pole((0, y_v - 0.036 * hh, zv + 0.30 * hh))]
        peau(b, ks, NSEG['extra'][lod], ACC, wt, axes=(X, Y), spacing=None, rot=True)
    if chap == 'plate':
        ks = [K((0, yc + 0.74 * hh, z0 + 0.0 * hh), 0.335 * hh, 0.40 * hh, 0.45 * hh, imp=1),
              K((0, yc + 0.80 * hh, z0 + 0.03 * hh), 0.385 * hh, 0.53 * hh, 0.47 * hh, e=2.6, imp=0),
              K((0, yc + 0.90 * hh, z0 + 0.02 * hh), 0.375 * hh, 0.50 * hh, 0.46 * hh, e=2.4, imp=1),
              K((0, yc + 1.00 * hh, z0 - 0.02 * hh), 0.26 * hh, 0.32 * hh, 0.33 * hh, imp=0),
              pole((0, yc + 1.045 * hh, z0 - 0.04 * hh))]

        def cis2(P, ANG, CC):
            Q = P.copy()
            Q[:, 1] -= np.maximum(P[:, 2] - z0, 0) * 0.20
            return Q
        peau(b, ks, NSEG['tete'][lod] - 2, ACC, wt, axes=(X, Z), spacing=0.03, disp_fn=cis2)
    return pf


def boite(b, c0, c1, ru, rw, axes, nseg, part, wfn, e=6.0, biseau=0.012):
    """Volume « boîte » à coins arrondis entre c0 et c1."""
    c0, c1 = np.asarray(c0, float), np.asarray(c1, float)
    d = nrm(c1 - c0)
    ks = [pole(c0), K(c0, ru - biseau, rw - biseau, e=e, imp=1), K(c0 + d * biseau, ru, rw, e=e, imp=0, brk=True),
          K(c1 - d * biseau, ru, rw, e=e, imp=0), K(c1, ru - biseau, rw - biseau, e=e, imp=1), pole(c1)]
    peau(b, ks, nseg, part, wfn, axes=axes, spacing=None, rot=True)


def faire_accessoires(b, c, L, T):
    lod = b.lod
    sc = L.sc
    acc = c.get('acc', [])
    ns = NSEG['sac'][lod]
    nf = NSEG['fin'][lod]
    et = T.et
    if 'echarpe' in acc:
        rn, y0 = L.rn, L.y_cou
        ks = [K((0, y0 - 0.018 * L.H, 0.004), rn * 1.75, rn * 1.75, rn * 1.6, imp=1),
              K((0, y0 + 0.004 * L.H, 0.006), rn * 2.0, rn * 2.05, rn * 1.85, imp=0),
              K((0, y0 + 0.028 * L.H, 0.004), rn * 1.8, rn * 1.85, rn * 1.75, imp=0),
              K((0, y0 + 0.040 * L.H, 0.002), rn * 1.25, rn * 1.25, rn * 1.3, imp=1),
              K((0, y0 + 0.034 * L.H, 0.002), rn * 1.02, imp=2)]
        peau(b, ks, NSEG['extra'][lod] + (2 if lod < 2 else 1), ACC, lambda P: w_colonne(L, P), axes=(X, Z), spacing=0.02)
        if lod < 2:
            xs = 0.045 * sc
            y1 = L.y_cou - 0.01 * L.H
            pts = [V3(xs, y1, torse_z(L, y1, xs) + et + 0.02), V3(xs + 0.012, L.y_ch + 0.02, torse_z(L, L.y_ch + 0.02, xs) + et + 0.008),
                   V3(xs + 0.018, lerp(L.y_w, L.y_ch, 0.35), torse_z(L, lerp(L.y_w, L.y_ch, 0.35), xs) + et + 0.007)]
            ruban(b, pts, 0.009 * sc, 0.042 * sc, 6 if lod == 0 else 4, ACC, un_os('poitrine'), ref=X)
    if 'mallette' in acc:
        s = -1
        g = L.G[s]
        cx = g[0] - 0.012 * s
        yt = g[1] - 0.05 * sc
        h2, l2, e2 = 0.145 * sc, 0.21 * sc, 0.045 * sc
        wm = un_os('main_d')
        boite(b, (cx - e2, yt - h2, g[2]), (cx + e2, yt - h2, g[2]), l2, h2, (Z, Y), ns, ACC, wm, e=8.0, biseau=0.008)
        if nf:
            pts = [V3(cx, yt - 0.006, g[2] - 0.055 * sc), V3(cx, yt + 0.04 * sc, g[2] - 0.045 * sc), V3(cx, yt + 0.05 * sc, g[2]),
                   V3(cx, yt + 0.04 * sc, g[2] + 0.045 * sc), V3(cx, yt - 0.006, g[2] + 0.055 * sc)]
            peau(b, [K(p, 0.007 * sc, imp=1) for p in pts], 5 if lod == 0 else 3, DETAIL, wm, ref=X, spacing=0.03)
    if 'cabas' in acc:
        s = c.get('cabas_cote', 1)
        g = L.G[s]
        cx = g[0] + 0.01 * s
        yt = g[1] - 0.17 * sc
        yb = yt - 0.29 * sc
        wm = un_os('main_g' if s == 1 else 'main_d')
        ks = [pole((cx, yb, g[2])), K((cx, yb, g[2]), 0.045 * sc, 0.12 * sc, e=5, imp=0, brk=True),
              K((cx, yb + 0.02, g[2]), 0.052 * sc, 0.135 * sc, e=5, imp=1),
              K((cx, yt, g[2]), 0.050 * sc, 0.165 * sc, e=5, imp=0, brk=True),
              K((cx, yt - 0.004, g[2]), 0.040 * sc, 0.155 * sc, e=5, imp=1), pole((cx, yt - 0.03, g[2]), imp=0)]
        peau(b, ks, ns, ACC, wm, axes=(X, Z), spacing=0.08, rot=True)
        if nf:
            for dx in (-0.03, 0.03):
                pts = [V3(cx + dx * sc, yt - 0.01, g[2] - 0.085 * sc), V3(cx + dx * 0.5 * sc, lerp(yt, g[1], 0.7), g[2] - 0.04 * sc),
                       V3(g[0], g[1] + 0.012 * sc, g[2]), V3(cx + dx * 0.5 * sc, lerp(yt, g[1], 0.7), g[2] + 0.04 * sc),
                       V3(cx + dx * sc, yt - 0.01, g[2] + 0.085 * sc)]
                peau(b, [K(p, 0.006 * sc, imp=1) for p in pts], 4 if lod == 0 else 3, ACC, wm, ref=X, spacing=0.05)
    if 'sac_epaule' in acc:
        s = 1
        xb = s * (L.hx + et + 0.058 * sc)
        yb = L.y_hip + 0.075 * L.H
        zb = -0.035 * sc
        wp = un_os('poitrine')
        boite(b, (xb - 0.05 * sc * s, yb, zb), (xb + 0.05 * sc * s, yb, zb), 0.15 * sc, 0.105 * sc, (Z, Y), ns, ACC, wp, e=5.0, biseau=0.014)
        xs = s * L.ep_x * 0.66
        yt = L.y_ep + 0.019 * L.H + et + 0.004
        yy = yb + 0.10 * sc
        pts = [V3(xb - 0.01 * s, yy, zb + 0.11 * sc), V3(xs + 0.035 * s, L.y_ch, torse_z(L, L.y_ch, xs + 0.03) + et + 0.012),
               V3(xs + 0.01 * s, L.y_ep - 0.01, torse_z(L, L.y_ep - 0.01, xs) + et + 0.012), V3(xs, yt + 0.004, -0.004),
               V3(xs + 0.01 * s, L.y_ep - 0.01, torse_z(L, L.y_ep - 0.01, xs, False) - et - 0.012),
               V3(xs + 0.035 * s, L.y_ch, torse_z(L, L.y_ch, xs + 0.03, False) - et - 0.012), V3(xb - 0.01 * s, yy, zb - 0.11 * sc)]
        if lod == 2:
            pts = [pts[0], pts[3], pts[6]]
        ruban(b, pts, 0.005 * sc, 0.017 * sc, 4 if lod < 2 else 3, ACC, wp, ref=X, spacing=0.05)
    for nom in ('sac_dos', 'cartable'):
        if nom not in acc:
            continue
        cart = nom == 'cartable'
        wp = un_os('poitrine')
        ep_s = (0.075 if cart else 0.085) * sc
        zc = -(L.tz * 1.02 + et + ep_s - 0.01)
        y0, y1 = L.y_w - (0.0 if cart else 0.04) * sc, L.y_ep + (0.0 if cart else 0.03) * sc
        ex = 6.0 if cart else 3.6
        la = (0.135 if cart else 0.15) * sc
        ks = [pole((0, y0, zc)), K((0, y0 + 0.004, zc), la * 0.86, ep_s * 0.8, e=ex, imp=0),
              K((0, y0 + 0.07 * sc, zc), la, ep_s, e=ex, imp=1),
              K((0, lerp(y0, y1, 0.6), zc), la * 0.97, ep_s * 0.95, e=ex, imp=2),
              K((0, y1 - 0.045 * sc, zc + 0.006), la * 0.9, ep_s * 0.86, e=ex, imp=0),
              K((0, y1 - 0.008 * sc, zc + 0.016), la * 0.68, ep_s * 0.55, e=ex, imp=1), pole((0, y1, zc + 0.02))]
        peau(b, ks, ns, ACC, wp, axes=(X, Z), spacing=0.05 * sc, rot=True)
        if lod < 2:
            for s in (1, -1):
                xs = s * L.ep_x * 0.60
                yt = L.y_ep + 0.020 * L.H + et + 0.004
                ya_ = L.y_ch - 0.02 * sc
                yb_ = L.y_w + 0.07 * sc
                xa = s * (L.tx + et - 0.012)
                pts = [V3(xs * 0.8, y1 - 0.03 * sc, zc + ep_s * 0.6), V3(xs, yt + 0.010, -0.005),
                       V3(xs + 0.012 * s, L.y_ep - 0.035 * sc, torse_z(L, L.y_ep - 0.035 * sc, xs) + et + 0.018),
                       V3(xs + 0.03 * s, ya_, torse_z(L, ya_, xs + 0.03 * s) + et + 0.018),
                       V3(xa, lerp(ya_, yb_, 0.6), 0.02 * sc), V3(s * la * 0.8, yb_, zc + ep_s * 0.8)]
                ruban(b, pts, 0.007 * sc, 0.016 * sc, 4, ACC, wp, ref=X, spacing=0.05)
    if 'canne' in acc:
        s = -1
        g = L.G[s]
        xc, zc = g[0] - 0.004 * s, g[2] + 0.004
        r = 0.011 * sc
        yg = g[1]
        ks = [pole((xc, 0.0, zc)), K((xc, 0.002, zc), r * 1.25, imp=0, brk=True), K((xc, 0.03, zc), r * 1.2, imp=1, brk=True),
              K((xc, 0.035, zc), r, imp=1, brk=True), K((xc, yg - 0.03 * sc, zc), r, imp=0),
              K((xc, yg + 0.022 * sc, zc - 0.004 * sc), r, imp=1), K((xc, yg + 0.040 * sc, zc - 0.03 * sc), r * 1.05, imp=0),
              K((xc, yg + 0.036 * sc, zc - 0.075 * sc), r * 1.0, imp=1), pole((xc, yg + 0.022 * sc, zc - 0.10 * sc))]
        peau(b, ks, 6 if lod == 0 else 4 if lod == 1 else 3, ACC, un_os('main_d'), ref=X, spacing=0.02)


def construire(c, lod):
    L = reperes(c)
    b = Corps(lod)
    T = faire_torse(b, c, L)
    faire_pan(b, c, L, T)
    for s in (1, -1):
        faire_bras(b, c, L, T, s)
        faire_jambe(b, c, L, T, s)
        faire_chaussure(b, c, L, s)
    faire_tete(b, c, L)
    faire_accessoires(b, c, L, T)
    return b, L


# =====================================================================================================
# 4. FINITION DANS BLENDER : normales, découpe par partie, occlusion ambiante
# =====================================================================================================
def hemisphere(n):
    i = np.arange(n) + 0.5
    ct = np.sqrt(1 - i / n)  # répartition pondérée par le cosinus
    st = np.sqrt(1 - ct * ct)
    ph = i * math.pi * (3 - math.sqrt(5))
    return np.stack([st * np.cos(ph), st * np.sin(ph), ct], axis=1)


HEMI = hemisphere(28)


def finaliser(b, angle_vif=58.0):
    P, W, F, FP = b.tableaux()
    # supprime les triangles dégénérés
    a = np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
    ok = a > 1e-10
    F, FP = F[ok], FP[ok]
    me = bpy.data.meshes.new('pieton')
    me.from_pydata(P.tolist(), [], F.tolist())
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle_vif))
    nl = len(me.loops)
    assert nl == 3 * len(F) and len(me.polygons) == len(F), 'Blender a modifié la topologie'
    cn = np.empty(nl * 3, np.float32)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(-1, 3).astype(np.float64)
    vi = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', vi)
    assert np.array_equal(vi.reshape(-1, 3), F), 'ordre des coins inattendu'
    part = np.repeat(FP, 3)
    cle = np.column_stack([vi, part, np.round(cn * 24).astype(np.int64)])
    _, first, inv = np.unique(cle, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    nv = len(first)
    N = np.zeros((nv, 3))
    np.add.at(N, inv, cn)
    N = nrm(N)
    src = vi[first]
    Pv, Wv, partv = P[src], W[src], part[first]
    idx = inv.reshape(-1, 3)
    # occlusion ambiante par lancer de rayons (BVH de Blender), sol compris
    g = 6.0
    verts = [Vector(p) for p in P] + [Vector((-g, 0, -g)), Vector((g, 0, -g)), Vector((g, 0, g)), Vector((-g, 0, g))]
    n0 = len(P)
    polys = F.tolist() + [(n0, n0 + 2, n0 + 1), (n0, n0 + 3, n0 + 2)]
    bvh = BVHTree.FromPolygons(verts, polys)
    dmax = 0.45
    ao = np.zeros(nv)
    up = np.where(np.abs(N[:, 1:2]) < 0.9, Y, X)
    Tn = nrm(np.cross(up, N))
    Bn = np.cross(N, Tn)
    for i in range(nv):
        o = Vector(Pv[i] + N[i] * 0.004)
        D = HEMI[:, 0:1] * Tn[i] + HEMI[:, 1:2] * Bn[i] + HEMI[:, 2:3] * N[i]
        occ = 0.0
        for d in D:
            hit = bvh.ray_cast(o, Vector(d), dmax)
            if hit[0] is not None:
                occ += (1 - hit[3] / dmax) ** 1.5
        ao[i] = 1 - occ / len(HEMI)
    bpy.data.meshes.remove(me)
    col = 0.55 + 0.45 * np.clip(ao, 0, 1) ** 1.6
    # poids : 4 influences max, normalisés
    order = np.argsort(-Wv, axis=1)[:, :4]
    w4 = np.take_along_axis(Wv, order, axis=1)
    w4[w4 < 0.02] = 0
    w4 = w4 / w4.sum(axis=1, keepdims=True)
    j4 = np.where(w4 > 0, order, 0)
    return dict(P=Pv.astype(np.float32), N=N.astype(np.float32), part=partv, col=col, J=j4.astype(np.uint8),
                W=w4.astype(np.float32), idx=idx.astype(np.uint32), tris=len(idx))


# =====================================================================================================
# 5. ANIMATIONS
# =====================================================================================================
def ik_jambe(hip, cible, L1, L2):
    d = cible - hip
    dist = min(np.linalg.norm(d), (L1 + L2) * 0.9995)
    dn = nrm(d)
    A = math.acos(np.clip((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1))
    ax = nrm(np.cross(dn, Z))
    cuisse = dn * math.cos(A) + np.cross(ax, dn) * math.sin(A)
    genou = hip + cuisse * L1
    tibia = nrm(hip + dn * dist - genou)
    xa = -ax

    def M(d_):
        y = -d_
        return np.column_stack([xa, y, np.cross(xa, y)])
    return M(cuisse), M(tibia)


def fk(L, Rl, th):
    """Rotations locales + translation des hanches -> matrices monde et positions des joints."""
    Rw = [None] * 17
    pw = [None] * 17
    for j in range(17):
        p = PARENT[j]
        if p < 0:
            Rw[j], pw[j] = Rl[j], th
        else:
            Rw[j] = Rw[p] @ Rl[j]
            pw[j] = pw[p] + Rw[p] @ (L.J[j] - L.J[p])
    return Rw, pw


def pose(L, a, hanches_R, hanches_y, cibles, haut, t_info):
    """Assemble une pose : bassin, jambes par CI vers `cibles` {s: (pos cheville, rot pied)}, haut du corps `haut`."""
    Rl = [np.eye(3) for _ in range(17)]
    Rl[0] = hanches_R
    th = V3(0, hanches_y, 0)
    L1, L2 = L.y_hip - L.y_knee, L.y_knee - L.y_ank
    for s, o in ((1, 11), (-1, 14)):
        hip = th + hanches_R @ (L.J[o] - L.J[0])
        cib, Rp = cibles[s]
        Mc, Mt = ik_jambe(hip, cib, L1, L2)
        Rl[o] = hanches_R.T @ Mc
        Rl[o + 1] = Mc.T @ Mt
        Rl[o + 2] = Mt.T @ Rp
    for j, R in haut.items():
        Rl[j] = R
    return Rl, th


def bras_pose(mode, s, sw, a, r=math.radians):
    """Rotations locales (bras, avant-bras, main) ; sw dans [-1,1] : +1 = bras en avant."""
    amp = r(a.get('bras', 22.0))
    if mode == 'porte':  # objet tenu à bout de bras : faible balancement
        ang = -r(2) - 0.22 * amp * sw
        return euler(ang, 0, 0), euler(-r(6), 0, 0), np.eye(3)
    if mode == 'bandouliere':  # main sur la sangle du sac
        k = 0.06 * amp * sw
        return euler(r(14) + k, -s * r(24), s * r(3)), euler(-r(128), 0, 0), euler(r(10), 0, 0)
    if mode == 'canne':
        b1 = -r(9) - r(5) * sw
        b2 = -r(15)
        return euler(b1, 0, 0), euler(b2, 0, 0), euler(-(b1 + b2) - r(7) * sw, 0, 0)
    if mode == 'poche':
        return euler(r(4), 0, -s * r(2)), euler(-r(28), -s * r(18), 0), np.eye(3)
    ang = r(a.get('bras_biais', 3.0)) - amp * sw
    coude = -(r(a.get('coude0', 9.0)) + r(a.get('coude1', 13.0)) * (0.5 + 0.5 * sw))
    return euler(ang, 0, -s * r(a.get('bras_ecart', 0.0))), euler(coude, 0, 0), euler(0, 0, 0)


def anim_marche(L, a):
    r = math.radians
    T = a['T']
    N = int(round(T * IPS))
    foulee = a['v'] * T
    fs = a.get('appui', 0.62)
    ha, lh, lt = L.y_ank, L.heel, L.toe
    phi0, phi1 = r(a.get('talon', 16.0)), r(a.get('pointe', 36.0))
    ch = a.get('lever', 0.035) * L.sc
    fx = a.get('ecart', 0.85)
    h_l, t_l = V3(0, -ha, -lh), V3(0, -ha, lt)

    def smf(x):
        x = min(1.0, max(0.0, x))
        return x * x * (3 - 2 * x)

    def appui(u):
        zr = (0.5 - u) * fs * foulee - (fs - 0.5) * foulee * 0.5 + a.get('biais', 0.015) * L.sc
        u1, u2 = 0.17, 0.50
        if u < u1:
            p = phi0 * (1 - smf(u / u1))
            R = rot_x(-p)
            return V3(0, 0, zr - lh) - R @ h_l, p
        if u < u2:
            return V3(0, ha, zr), 0.0
        p = -phi1 * smf((u - u2) / (1 - u2)) ** 1.15
        R = rot_x(-p)
        return V3(0, 0, zr + lt) - R @ t_l, p

    pa, _ = appui(1.0)
    pb, _ = appui(0.0)

    def pied(ph):
        ph = ph % 1.0
        if ph < fs:
            return appui(ph / fs)
        v = (ph - fs) / (1 - fs)
        p = -phi1 + (phi0 + phi1) * smf(v / 0.88)
        R = rot_x(-p)
        m = -foulee * (1 - fs) * 0.6
        h00, h10, h01, h11 = 2 * v ** 3 - 3 * v ** 2 + 1, v ** 3 - 2 * v ** 2 + v, -2 * v ** 3 + 3 * v ** 2, v ** 3 - v ** 2
        z = h00 * pa[2] + h10 * m + h01 * pb[2] + h11 * m
        lift = max(-(R @ h_l)[1], -(R @ t_l)[1])
        return V3(0, ch * math.sin(math.pi * v) ** 2 + lift, z), p

    lacet, roulis = r(a.get('lacet', 5.0)), r(a.get('roulis', 3.0))
    Ab = a.get('rebond', 0.006) * L.sc
    pm = 0.5 * fs - 0.03
    L1, L2 = L.y_hip - L.y_knee, L.y_knee - L.y_ank

    def bassin_R(ph):
        return euler(r(a.get('bassin_tang', 0.0)), -lacet * math.cos(2 * math.pi * ph), roulis * math.sin(2 * math.pi * (ph - pm + 0.25)))

    def cibles(ph):
        out = {}
        for s, dph in ((1, 0.0), (-1, 0.5)):
            p, pit = pied(ph + dph)
            out[s] = (V3(s * L.x_leg * fx, p[1], p[2]), rot_x(-pit))
        return out

    # hauteur du bassin : la plus haute permise par l'extension des jambes (genoux jamais verrouillés),
    # plafonnée un peu sous la station debout, puis lissée (périodique) -> rebond naturel à 2 cycles par foulée
    plafond = L.y_han - a.get('flexion', 0.022) * L.sc
    lim = np.zeros(N)
    for k in range(N):
        ph = k / N
        Rh = bassin_R(ph)
        cb = cibles(ph)
        lo, hi = L.y_han - 0.3 * L.sc, plafond - Ab * (1 - math.cos(4 * math.pi * (ph - pm)))
        for _ in range(22):
            mid = 0.5 * (lo + hi)
            okk = all(np.linalg.norm(cb[s][0] - (V3(0, mid, 0) + Rh @ (L.J[o] - L.J[0]))) <= 0.99 * (L1 + L2) for s, o in ((1, 11), (-1, 14)))
            lo, hi = (mid, hi) if okk else (lo, mid)
        lim[k] = lo
    # on ne garde que la moyenne et l'harmonique à 2 cycles par foulée (+ un peu de la suivante) : rebond régulier
    ph_k = np.arange(N) / N
    yh_s = np.full(N, lim.mean())
    for h, g in ((2, 1.0), (4, 0.35)):
        cc, ss = np.cos(2 * math.pi * h * ph_k), np.sin(2 * math.pi * h * ph_k)
        yh_s += g * 2 * ((lim * cc).mean() * cc + (lim * ss).mean() * ss)
    yh_s -= max(0.0, float((yh_s - lim).max()))

    def bassin(ph, k):
        return bassin_R(ph), float(yh_s[k % N])
    modes = a.get('modes', {})
    dos, nuq = r(a.get('dos', 3.0)), r(a.get('nuque', 0.0))
    frames = []
    for k in range(N + 1):
        ph = (k % N) / N
        Rh, yh = bassin(ph, k)
        c2 = math.cos(2 * math.pi * ph)
        s2 = math.sin(2 * math.pi * (ph - pm + 0.25))
        yaw = -lacet * c2
        rol = roulis * s2
        ep = r(a.get('epaules', 5.0))
        haut = {
            1: euler(dos * 0.55, -0.55 * yaw + 0.4 * ep * c2, -0.6 * rol),
            2: euler(dos * 0.45, -0.45 * yaw + 0.6 * ep * c2, -0.5 * rol),
            3: euler(-dos * 0.35 + nuq * 0.5, -0.5 * ep * c2, 0.05 * rol),
            4: euler(-dos * 0.45 + nuq * 0.5 + r(0.8) * math.cos(4 * math.pi * ph), -0.5 * ep * c2, 0.05 * rol),
        }
        swl = -math.cos(2 * math.pi * (ph - 0.03))  # bras gauche en arrière quand le pied gauche attaque
        for s, o, sw in ((1, 5, swl), (-1, 8, -swl)):
            Rb, Ra, Rm = bras_pose(modes.get(s, 'libre'), s, sw, a)
            haut[o], haut[o + 1], haut[o + 2] = Rb, Ra, Rm
        frames.append(pose(L, a, Rh, yh, cibles(ph), haut, None))
    return dict(nom='marche', T=N / IPS, frames=frames, foulee=foulee)


def anim_attente(L, a):
    r = math.radians
    T = a.get('T_attente', 3.6)
    N = int(round(T * IPS))
    modes = a.get('modes', {})
    dos, nuq = r(a.get('dos', 3.0)) * 0.8, r(a.get('nuque', 0.0))
    ph0 = a.get('phase_attente', 0.0)
    frames = []
    for k in range(N + 1):
        t = 2 * math.pi * (k % N) / N
        resp = math.sin(2 * t)  # deux respirations par boucle
        poids = math.sin(t + ph0)
        Rh = euler(r(0.4) * math.sin(t + 1.0), r(1.3) * math.sin(t + 0.6 + ph0), r(2.0) * poids)
        yh = L.y_han - 0.008 * L.sc + 0.0015 * L.sc * resp
        cib = {s: (V3(s * L.x_leg, L.y_ank, 0.0), np.eye(3)) for s in (1, -1)}
        tete_y = r(a.get('regard', 9.0)) * (0.7 * math.sin(t + 2.2) + 0.3 * math.sin(2 * t + 0.5))
        haut = {
            1: euler(dos * 0.55 - r(0.5) * resp, -r(0.7) * math.sin(t + 0.6 + ph0), -r(1.3) * poids),
            2: euler(dos * 0.45 - r(1.0) * resp, -r(0.6) * math.sin(t + 0.6 + ph0), -r(1.0) * poids),
            3: euler(-dos * 0.35 + nuq * 0.5 + r(0.5) * resp, 0.4 * tete_y, r(0.3) * poids),
            4: euler(-dos * 0.45 + nuq * 0.5 + r(1.5) * math.sin(t + 0.9), 0.6 * tete_y, 0),
        }
        for s, o in ((1, 5), (-1, 8)):
            m = modes.get(s, 'libre')
            sw = 0.12 * math.sin(t + (0.0 if s == 1 else 1.3))
            if m == 'libre':
                Rb = euler(r(1.0) + r(1.2) * resp * 0.5 + r(1.5) * sw, 0, s * r(0.8) * resp)
                Ra = euler(-r(9) - r(2) * sw, 0, 0)
                Rm = np.eye(3)
            else:
                Rb, Ra, Rm = bras_pose(m, s, sw, a)
            haut[o], haut[o + 1], haut[o + 2] = Rb, Ra, Rm
        frames.append(pose(L, a, Rh, yh, cib, haut, None))
    return dict(nom='attente', T=N / IPS, frames=frames)


def cuire(L, an):
    """-> temps (n,), quaternions (n,17,4), translation hanches (n,3) ; boucle exacte."""
    fr = an['frames']
    n = len(fr)
    Q = np.zeros((n, 17, 4))
    Tr = np.zeros((n, 3))
    for k, (Rl, th) in enumerate(fr):
        for j in range(17):
            q = mat2quat(Rl[j])
            if k > 0 and q @ Q[k - 1, j] < 0:
                q = -q
            elif k == 0 and q[3] < 0:
                q = -q
            Q[k, j] = q
        Tr[k] = th
    Q[-1], Tr[-1] = Q[0], Tr[0]
    return np.arange(n) / IPS, Q, Tr


def sol_min(L, an):
    """Altitude minimale des points de semelle sur le clip (contrôle : pas de pied sous le sol)."""
    lo = 1e9
    for Rl, th in an['frames']:
        Rw, pw = fk(L, Rl, th)
        for s, o in ((1, 13), (-1, 16)):
            for z in (-L.heel, 0.0, L.toe):
                p = pw[o] + Rw[o] @ V3(0, -L.y_ank, z)
                lo = min(lo, p[1])
    return lo


# =====================================================================================================
# 6. ÉCRITURE GLB
# =====================================================================================================
def ecrire_glb(path, nom, m, L, anims):
    bufs = []
    views = []
    accs = []

    def view(data, target=None):
        off = sum(len(x) for x in bufs)
        pad = (-len(data)) % 4
        bufs.append(data + b'\x00' * pad)
        v = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def acc(arr, ctype, typ, target=None, normalized=False, minmax=False):
        arr = np.ascontiguousarray(arr)
        a = dict(bufferView=view(arr.tobytes(), target), componentType=ctype, count=len(arr), type=typ)
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in np.atleast_1d(arr.min(axis=0))]
            a['max'] = [float(x) for x in np.atleast_1d(arr.max(axis=0))]
        accs.append(a)
        return len(accs) - 1

    nv = len(m['P'])
    uv = np.stack([(m['part'] + 0.5) / 8.0, np.full(nv, 0.5)], axis=1).astype(np.float32)
    c8 = np.clip(np.round(m['col'] * 255), 0, 255).astype(np.uint8)
    col = np.stack([c8, c8, c8, np.full(nv, 255, np.uint8)], axis=1)
    attrs = dict(
        POSITION=acc(m['P'], 5126, 'VEC3', 34962, minmax=True),
        NORMAL=acc(m['N'], 5126, 'VEC3', 34962),
        TEXCOORD_0=acc(uv, 5126, 'VEC2', 34962),
        COLOR_0=acc(col, 5121, 'VEC4', 34962, normalized=True),
        JOINTS_0=acc(m['J'], 5121, 'VEC4', 34962),
        WEIGHTS_0=acc(m['W'], 5126, 'VEC4', 34962),
    )
    idx = m['idx'].reshape(-1)
    ia = acc(idx.astype(np.uint16) if nv < 65536 else idx, 5123 if nv < 65536 else 5125, 'SCALAR', 34963)
    ibm = np.tile(np.eye(4, dtype=np.float32), (17, 1, 1))
    for j in range(17):
        ibm[j, 3, :3] = -L.J[j]  # glTF : matrices en colonnes -> translation dans la 4e « ligne » numpy
    ibm_a = acc(ibm.reshape(17, 16), 5126, 'MAT4')
    nodes = []
    for j, nomj in enumerate(BONES):
        p = PARENT[j]
        t = L.J[j] - (L.J[p] if p >= 0 else 0)
        nd = dict(name=nomj, translation=[float(x) for x in t], rotation=[0.0, 0.0, 0.0, 1.0], scale=[1.0, 1.0, 1.0])
        ch = [k for k in range(17) if PARENT[k] == j]
        if ch:
            nd['children'] = ch
        nodes.append(nd)
    nodes.append(dict(name=nom, mesh=0, skin=0))
    g = dict(
        asset=dict(version='2.0', generator='Aube Urbaine — ' + SOURCE, copyright='CC0-1.0 — Aube Urbaine'),
        extras=dict(license='CC0-1.0', author='Aube Urbaine', source=SOURCE),
        scene=0, scenes=[dict(name=nom, nodes=[0, 17])], nodes=nodes,
        meshes=[dict(name=nom, primitives=[dict(attributes=attrs, indices=ia, material=0, mode=4)])],
        materials=[dict(name='pieton_palette', pbrMetallicRoughness=dict(baseColorFactor=[1, 1, 1, 1], metallicFactor=0.0, roughnessFactor=0.85))],
        skins=[dict(name='squelette', joints=list(range(17)), skeleton=0, inverseBindMatrices=ibm_a)],
    )
    if anims:
        g['animations'] = []
        for an in anims:
            t, Q, Tr = cuire(L, an)
            ta = acc(t.astype(np.float32), 5126, 'SCALAR', minmax=True)
            samplers, channels = [], []
            for j in range(17):
                samplers.append(dict(input=ta, output=acc(Q[:, j].astype(np.float32), 5126, 'VEC4'), interpolation='LINEAR'))
                channels.append(dict(sampler=len(samplers) - 1, target=dict(node=j, path='rotation')))
            samplers.append(dict(input=ta, output=acc(Tr.astype(np.float32), 5126, 'VEC3'), interpolation='LINEAR'))
            channels.append(dict(sampler=len(samplers) - 1, target=dict(node=0, path='translation')))
            g['animations'].append(dict(name=an['nom'], samplers=samplers, channels=channels))
    g['bufferViews'] = views
    g['accessors'] = accs
    blob = b''.join(bufs)
    g['buffers'] = [dict(byteLength=len(blob))]
    js = json.dumps(g, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<I4s', len(js), b'JSON') + js)
        f.write(struct.pack('<I4s', len(blob), b'BIN\x00') + blob)
    return os.path.getsize(path)


# =====================================================================================================
# 7. PALETTES
# =====================================================================================================
PEAUX = ['#f2d6c1', '#eac6aa', '#e0b594', '#d3a07c', '#b98660', '#96663f', '#75492c', '#5a3722']
CHEV = dict(blond='#c8a660', chatain_clair='#8e6a40', chatain='#5f4329', brun='#3d2c20', noir='#1d1815', roux='#a5552c',
            gris='#8d8b88', blanc='#d9d6cf', poivre='#5e5b58', auburn='#6e3322')
DETAILS = ['#1f1b19', '#2b231f', '#17171c', '#30271f']
# (haut, bas, chaussures, accessoire, haut2)
TENUES = dict(
    ville=[('#27364f', '#3f4a5c', '#3a2a20', '#6b4a2e', '#e9e6df'), ('#5a5f66', '#22252b', '#1f1f22', '#2a2a2e', '#d9dde3'),
           ('#7a5a3c', '#2c3a55', '#5a3d28', '#8a6a44', '#efe9dc'), ('#2f4a3a', '#4a4338', '#3b2c22', '#b08a52', '#e4e0d4'),
           ('#6d1f2b', '#2a2c33', '#241f1e', '#3a3230', '#e8e2da'), ('#c9b79a', '#3b4a66', '#6a4a30', '#7a2f2f', '#f3efe6'),
           ('#1f2126', '#5c6068', '#26221f', '#8c1f2a', '#cfd3d8'), ('#48566b', '#b9a98c', '#70523a', '#2f3c50', '#f1eee8'),
           ('#8a8f96', '#2e3e5c', '#e8e6e1', '#3d5a4a', '#ffffff'), ('#3c3f58', '#6f6a60', '#2a2422', '#a8743a', '#dfe5ec'),
           ('#a35a3a', '#33373f', '#3f2e24', '#28303c', '#efe8dc'), ('#445a4c', '#1f2229', '#2d2724', '#c2a35a', '#e6e2d6'),
           ('#b4a58c', '#4f4336', '#5c3f2a', '#394b3f', '#f4f1ea'), ('#2b4f72', '#262b36', '#d9d6d0', '#5a2a2a', '#f0f0ee'),
           ('#6a6f78', '#3a4c6e', '#33291f', '#b3552f', '#e3e7ea'), ('#3a2f3f', '#757b85', '#201c1c', '#6c5a3f', '#e9dfd6')],
    costume=[('#1c2333', '#1c2333', '#161313', '#3a2618', '#f4f4f1'), ('#33363c', '#33363c', '#1a1716', '#22201f', '#e8edf3'),
             ('#222226', '#222226', '#141212', '#4a2f1c', '#ffffff'), ('#2a3550', '#2a3550', '#3b281c', '#5a3a22', '#dfe8f2'),
             ('#4b4f57', '#4b4f57', '#221d1b', '#2b1f19', '#f6f2ea'), ('#3a2f2a', '#3a2f2a', '#2a1d16', '#6b1f26', '#f1ecdf'),
             ('#19202b', '#2b303a', '#1b1716', '#7a1c24', '#eef1f4')],
    vif=[('#d23c3c', '#2c3f66', '#f0eeea', '#f2b632', '#ffffff'), ('#2f7fc2', '#2a2d33', '#e9e7e2', '#e2543a', '#f5f3ee'),
         ('#f0b429', '#3c4f78', '#d44a3a', '#2f6f9f', '#fbfaf5'), ('#3fa46a', '#33363d', '#f2f0ec', '#e57a2e', '#ffffff'),
         ('#e9739a', '#4a5a86', '#f4e9e4', '#7a4fb0', '#fff6f2'), ('#7a4fb0', '#262a33', '#eeeeee', '#3fb0a4', '#f1ecf7'),
         ('#ef7d2d', '#3a3d45', '#2b2b2f', '#2f6fb0', '#fbf4ea'), ('#27a3a3', '#1f2733', '#f6f4ef', '#e84a5f', '#e8f6f4'),
         ('#e5484d', '#5d6b7e', '#2a2a2e', '#ffd04a', '#fdf0ee'), ('#4a7de0', '#c8b48e', '#f3f1ec', '#e2733a', '#ffffff'),
         ('#b7d04a', '#34415e', '#e84a3a', '#2f5fa0', '#fafcf0'), ('#f2f0ea', '#2f5f9f', '#d7402f', '#3a9f6a', '#f2c230')],
    senior=[('#7a6a55', '#4a4640', '#3a2c22', '#6b3d2a', '#e9e3d5'), ('#5c6470', '#3a3d44', '#2a2523', '#8c6a3a', '#dfe3e6'),
            ('#6b2d32', '#55504a', '#33261f', '#3f4a3a', '#efe9de'), ('#3f5446', '#5f574a', '#3d2e22', '#a47b45', '#e8e4d6'),
            ('#8a7d6a', '#2f3644', '#4a3526', '#5a2a2a', '#f2eee4'), ('#49546b', '#6e675b', '#2c2420', '#7a5a34', '#e6e9ee'),
            ('#9a8f84', '#40372f', '#35281f', '#32475a', '#f4f0e8'), ('#5a4a5f', '#4c4a48', '#272120', '#8a6f4a', '#ece4e6'),
            ('#a89a7c', '#5a5f58', '#4f3a2a', '#6b2f3a', '#f5f1e6')],
    hiver=[('#2f3d2f', '#2b2e36', '#2a211c', '#b06a2f', '#b9ad98'), ('#1f2a44', '#3a3d45', '#1f1b1a', '#a32c2c', '#d8d2c4'),
           ('#b9a27c', '#262a33', '#3d2c20', '#5a2630', '#e9e2d2'), ('#5b2a30', '#2e3138', '#241d1b', '#d1c7b0', '#cfc6b4'),
           ('#3a3d42', '#4a556b', '#2c2623', '#c9a23a', '#a9a59c'), ('#6a7260', '#3b352e', '#3a2b20', '#2f4f6a', '#ddd6c4'),
           ('#8b3a2a', '#33363c', '#1e1b1a', '#30506a', '#e4dccb'), ('#24272e', '#24272e', '#191716', '#7c7f86', '#b54a3a')],
)


def faire_palettes():
    rng = np.random.default_rng(GRAINE)
    pal, groupes = [], {}
    jeunes = ['blond', 'chatain_clair', 'chatain', 'chatain', 'brun', 'brun', 'noir', 'roux', 'auburn']
    vieux = ['gris', 'blanc', 'gris', 'blanc', 'poivre']
    for grp, rows in TENUES.items():
        for i, (haut, bas, ch, ac, h2) in enumerate(rows):
            ip = int(rng.integers(0, len(PEAUX)))
            if grp == 'senior':
                ip = min(ip, 5)
                chv = vieux[int(rng.integers(0, len(vieux)))]
            elif ip >= 5:
                chv = ['noir', 'brun', 'noir'][int(rng.integers(0, 3))]
            else:
                chv = jeunes[int(rng.integers(0, len(jeunes)))]
            pid = 'p%02d' % len(pal)
            pal.append(dict(id=pid, colors=[PEAUX[ip], CHEV[chv], haut, bas, ch, ac, h2, DETAILS[int(rng.integers(0, 4))]]))
            groupes.setdefault(grp, []).append(pid)
    return pal, groupes


# =====================================================================================================
# 8. FICHES DES PERSONNAGES
# =====================================================================================================
def fiches():
    F = []

    def P(**k):
        F.append(k)

    P(id='pieton_homme_veste', nameFr='Homme en veste', age='adulte', genre='homme', H=1.78, groupes=['ville'],
      haut=dict(ease=0.016, hem=-0.035, lip=0.010, bandes=[(HAUT2, 0.034, 0.058)], bande_y0=0.0, col=HAUT2),
      bas=dict(type='pantalon', ease=0.010, genou=0.072, ourlet=0.066),
      chauss=dict(), cheveux=dict(style='court', ep=0.016), acc=[],
      anim=dict(T=1.1, v=1.35, bras=22))

    P(id='pieton_homme_costume', nameFr="Homme d'affaires en costume", age='adulte', genre='homme', H=1.84, groupes=['costume'],
      ep=0.107, tx=0.094, wx=0.083,
      haut=dict(ease=0.016, hem=-0.04, lip=0.010, bandes=[(ACC, 0.014, 0.017), (HAUT2, 0.022, 0.062)], bande_y0=0.34, col=HAUT2),
      bas=dict(type='pantalon', ease=0.009, genou=0.070, ourlet=0.066),
      chauss=dict(larg=0.96), cheveux=dict(style='court', ep=0.010, front=0.86), acc=['mallette'],
      anim=dict(T=1.0, v=1.62, bras=27, dos=5, modes={-1: 'porte'}, rebond=0.02))

    P(id='pieton_femme_manteau', nameFr='Femme en manteau long', age='adulte', genre='femme', H=1.68, groupes=['hiver', 'ville'],
      ep=0.096, tx=0.086, tz=0.060, wx=0.072, wz=0.052, hx=0.096, buste=0.016, cou=0.027, membre=0.9, machoire=0.93,
      haut=dict(ease=0.022, hem=None, bandes=[(HAUT2, 0.012, 0.050)], bande_y0=0.62, col=HAUT, ease_m=0.016),
      pan=dict(part=HAUT, hem=0.30, evase=1.13, wt=0.72),
      bas=dict(type='pantalon', ease=0.004, genou=0.056, ourlet=0.050, botte=0.26),
      chauss=dict(larg=0.9, tige=1.05), cheveux=dict(style='carre', ep=0.02), acc=['sac_epaule'],
      anim=dict(T=1.1, v=1.3, bras=18, roulis=4.5, modes={1: 'bandouliere'}))

    P(id='pieton_femme_robe', nameFr='Femme en robe', age='adulte', genre='femme', H=1.65, groupes=['vif', 'ville'],
      ep=0.094, tx=0.084, tz=0.058, wx=0.068, wz=0.050, hx=0.095, buste=0.018, cou=0.026, membre=0.86, machoire=0.92,
      haut=dict(ease=0.005, hem=None, manches='courtes', ease_m=0.008, encolure='large'),
      pan=dict(part=HAUT, hem=0.29, evase=1.42, wt=0.7),
      bas=dict(type='aucun', jambe=PEAU),
      chauss=dict(larg=0.88, tige=0.6, semelle=0.6), cheveux=dict(style='long', ep=0.022, long=0.16), acc=[],
      anim=dict(T=1.1, v=1.25, bras=20, roulis=5, lacet=6))

    P(id='pieton_ado_sweat', nameFr='Adolescent en sweat à capuche', age='ado', genre='homme', H=1.62, groupes=['vif', 'ville'],
      tete=0.136, ep=0.100, tx=0.088, wx=0.078, hx=0.090, membre=0.9,
      haut=dict(ease=0.026, hem=-0.03, lip=0.012, capuche=True, ease_m=0.02),
      bas=dict(type='pantalon', ease=0.012, genou=0.070, ourlet=0.062),
      chauss=dict(larg=1.08, semelle=1.6, tige=1.1), cheveux=dict(style='court', ep=0.028, front=0.74, nuque=0.16), acc=['sac_dos'],
      anim=dict(T=1.1, v=1.3, bras=16, dos=6, nuque=6, rebond=0.008, modes={1: 'poche', -1: 'poche'}))

    P(id='pieton_enfant_garcon', nameFr='Garçon à casquette', age='enfant', genre='homme', H=1.28, groupes=['vif'],
      tete=0.168, ep=0.098, tx=0.090, tz=0.064, wx=0.084, wz=0.060, hx=0.090, hz=0.064, hipf=0.50, cou=0.030, membre=1.02,
      machoire=0.9, pied=0.155, main=1.05,
      haut=dict(ease=0.012, hem=-0.01, lip=0.008, manches='courtes', encolure=True, ease_m=0.012),
      bas=dict(type='short', ease=0.012, fin=0.03, ampleur=0.016, chaussette=0.10),
      chauss=dict(larg=1.08, semelle=1.5, tige=1.05), cheveux=dict(style='court', ep=0.016), chapeau='casquette', acc=['cartable'],
      anim=dict(T=1.0, v=1.05, bras=30, rebond=0.008, lever=0.05, coude1=28))

    P(id='pieton_fillette_robe', nameFr='Fillette en robe', age='enfant', genre='femme', H=1.20, groupes=['vif'],
      tete=0.174, ep=0.094, tx=0.086, tz=0.062, wx=0.080, wz=0.058, hx=0.088, hz=0.062, hipf=0.495, cou=0.029, membre=0.96,
      machoire=0.88, pied=0.152, main=1.05,
      haut=dict(ease=0.006, hem=None, manches='courtes', encolure=True, ease_m=0.012),
      pan=dict(part=HAUT, hem=0.305, evase=1.6, wt=0.65),
      bas=dict(type='aucun', jambe=PEAU, chaussette=0.085),
      chauss=dict(larg=1.0, tige=0.8), cheveux=dict(style='couettes', ep=0.016), acc=[],
      anim=dict(T=1.0, v=0.98, bras=32, rebond=0.008, lever=0.055, coude1=26, roulis=4))

    P(id='pieton_senior_homme', nameFr='Monsieur âgé à la canne', age='senior', genre='homme', H=1.70, groupes=['senior'],
      ventre=0.035, wx=0.088, tx=0.093, hx=0.094, cou=0.032,
      haut=dict(ease=0.014, hem=-0.02, lip=0.008, manche_part=HAUT2, bandes=[(HAUT2, 0.012, 0.052)], bande_y0=0.45, col=HAUT2, ease_m=0.010),
      bas=dict(type='pantalon', ease=0.012, genou=0.074, ourlet=0.072),
      chauss=dict(larg=1.04), cheveux=dict(style='degarni', ep=0.010), chapeau='plate', acc=['canne'],
      anim=dict(T=1.3, v=0.82, bras=11, dos=17, nuque=12, rebond=0.008, lever=0.02, talon=9, pointe=22, lacet=3, roulis=2,
                appui=0.66, modes={-1: 'canne'}, regard=6, T_attente=4.0))

    P(id='pieton_senior_femme', nameFr='Dame âgée au cabas', age='senior', genre='femme', H=1.58, groupes=['senior'],
      ep=0.096, tx=0.090, tz=0.064, wx=0.084, wz=0.060, hx=0.100, hz=0.066, buste=0.018, ventre=0.02, cou=0.028, membre=0.95, machoire=0.95,
      haut=dict(ease=0.018, hem=-0.015, lip=0.010, bandes=[(HAUT2, 0.010, 0.046)], bande_y0=0.3, ease_m=0.014),
      pan=dict(part=BAS, hem=0.17, evase=1.22, wt=0.7),
      bas=dict(type='aucun', jambe=BAS, ease=0.008),
      chauss=dict(larg=1.0, tige=0.8), cheveux=dict(style='chignon', ep=0.016), acc=['cabas'], cabas_cote=1,
      anim=dict(T=1.3, v=0.85, bras=12, dos=13, nuque=9, rebond=0.008, lever=0.02, talon=9, pointe=22, lacet=3, roulis=3,
                appui=0.66, modes={1: 'porte'}, regard=7, T_attente=4.0))

    P(id='pieton_sportive', nameFr='Sportive en short', age='adulte', genre='femme', H=1.70, groupes=['vif'],
      ep=0.097, tx=0.085, tz=0.058, wx=0.070, wz=0.050, hx=0.092, buste=0.014, cou=0.027, membre=0.92, machoire=0.93,
      haut=dict(ease=0.004, hem=0.012, lip=0.005, manches='sans', encolure=True),
      bas=dict(type='short', ease=0.006, fin=0.17, ampleur=0.008, chaussette=0.075),
      chauss=dict(larg=1.02, semelle=1.7, tige=1.0), cheveux=dict(style='queue', ep=0.014), acc=[],
      anim=dict(T=1.0, v=1.55, bras=26, coude0=18, coude1=22, dos=5, lever=0.05))

    P(id='pieton_femme_echarpe', nameFr='Femme à l’écharpe', age='adulte', genre='femme', H=1.73, groupes=['ville', 'hiver'],
      ep=0.097, tx=0.087, tz=0.060, wx=0.074, wz=0.053, hx=0.097, buste=0.016, cou=0.027, membre=0.92, machoire=0.93,
      haut=dict(ease=0.018, hem=-0.005, lip=0.012, ease_m=0.015),
      bas=dict(type='pantalon', ease=0.006, genou=0.060, ourlet=0.056),
      chauss=dict(larg=0.92, tige=1.3), cheveux=dict(style='mi_long', ep=0.02), acc=['echarpe'],
      anim=dict(T=1.1, v=1.38, bras=21, roulis=4.5))

    P(id='pieton_homme_parka', nameFr='Homme en parka et bonnet', age='adulte', genre='homme', H=1.88, groupes=['hiver', 'ville'],
      ep=0.108, tx=0.098, tz=0.068, wx=0.094, wz=0.066, hx=0.098, hz=0.066, ventre=0.028, cou=0.033, membre=1.1,
      haut=dict(ease=0.034, hem=None, col=HAUT2, ease_m=0.024),
      pan=dict(part=HAUT, hem=0.415, evase=1.03, wt=0.5),
      bas=dict(type='pantalon', ease=0.012, genou=0.076, ourlet=0.072),
      chauss=dict(larg=1.1, semelle=1.5, tige=1.3), cheveux=dict(style='court', ep=0.012), chapeau='bonnet', pompon=False, barbe=True, acc=[],
      anim=dict(T=1.2, v=1.3, bras=17, bras_ecart=4, rebond=0.008, lacet=4, modes={}))
    return F


# =====================================================================================================
# 9. PROGRAMME PRINCIPAL
# =====================================================================================================
def main():
    ap = argparse.ArgumentParser(description='Génère les piétons animés (GLB + manifest).')
    ap.add_argument('--only', default='', help='ids séparés par des virgules')
    ap.add_argument('--out', default=os.path.join(RACINE, 'assets', 'models', 'pedestrians'))
    ap.add_argument('--anims-all-lods', action='store_true', help='embarque aussi les clips dans les LOD1/LOD2')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    only = [s for s in args.only.split(',') if s]
    palettes, groupes = faire_palettes()
    man_path = os.path.join(args.out, 'manifest.json')
    anciens = {}
    if only and os.path.exists(man_path):
        with open(man_path, encoding='utf-8') as f:
            anciens = {m['id']: m for m in json.load(f).get('models', [])}
    models = []
    t0 = time.time()
    for c in fiches():
        if only and c['id'] not in only:
            if c['id'] in anciens:
                models.append(anciens[c['id']])
            continue
        lods = []
        L = None
        for lod in range(3):
            b, L = construire(c, lod)
            m = finaliser(b)
            if lod == 0:
                am, at = anim_marche(L, c['anim']), anim_attente(L, c['anim'])
                h = float(m['P'][:, 1].max())
                ymin = float(m['P'][:, 1].min())
                rayon = float(np.percentile(np.hypot(m['P'][:, 0], m['P'][:, 2]), 99.5))
            nom = '%s_lod%d' % (c['id'], lod)
            sz = ecrire_glb(os.path.join(args.out, nom + '.glb'), nom, m, L, [am, at] if (lod == 0 or args.anims_all_lods) else None)
            lo, hi = BORNES_TRI[lod]
            flag = '' if lo <= m['tris'] <= hi else '  <-- HORS BORNES'
            lods.append(dict(file=nom + '.glb', triangles=int(m['tris']), maxDistance=LOD_DIST[lod]))
            print('  %-28s LOD%d %5d tri %5d som %7.1f Ko%s' % (c['id'], lod, m['tris'], len(m['P']), sz / 1024, flag), flush=True)
        a = c['anim']
        models.append(dict(
            id=c['id'], nameFr=c['nameFr'], age=c['age'], genre=c['genre'], height=round(h, 3), radius=round(max(0.2, rayon + 0.02), 2),
            walkSpeed=a['v'], strideM=round(a['v'] * am['T'], 4),
            palettes=[p for g in c['groupes'] for p in groupes[g]],
            lods=lods, animations=dict(marche=dict(duration=round(am['T'], 4)), attente=dict(duration=round(at['T'], 4)))))
        print('    hauteur %.3f m, y min %.4f, semelle min marche %.4f / attente %.4f (%.0f s)' % (h, ymin, sol_min(L, am), sol_min(L, at), time.time() - t0), flush=True)
    manifest = dict(schemaVersion=1, generator=SOURCE, license=dict(spdx='CC0-1.0', source=SOURCE, author='Aube Urbaine'),
                    bones=BONES, parts=PARTS, palettes=palettes, models=models)
    with open(man_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('manifest : %s (%d modèles, %d palettes)' % (man_path, len(models), len(palettes)))


if __name__ == '__main__':
    main()
