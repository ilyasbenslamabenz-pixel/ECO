"""Modèles dérivés de Poly Haven (CC0) et arbres d'ECO NATION.

Lancement : <python avec bpy> tools/blender/polyhaven.py [ids...]
Les sources glTF 1k sont téléchargées une fois par tools/blender/telecharger_polyhaven.py dans
$ECO_POLYHAVEN (par défaut le dossier de travail temporaire) ; elles ne sont pas versionnées.

- climatiseur : `exterior_aircon_unit` décimé (modificateur Decimate), texture « cuite » en couleurs de sommets.
- lampadaire_classique : `street_lamp_01` (lanterne de style parisien) décimé, verre émissif (code 8).
- arbres : deux niveaux de détail par espèce, nœuds « lod0 » (proche, ≤ 400 triangles) et « lod1 » (lointain).
    * platane d'alignement : généré (tronc, charpentières, houppier en masses lobées) ;
    * arbre_parc_large : houppier « rétréci » sur le nuage de feuilles de `jacaranda_tree`
      (enveloppe par lancer de rayons) + tronc Poly Haven décimé ;
    * arbre_parc_rond : idem d'après `tree_small_02`, mis à l'échelle d'un arbre de 9 m ;
    * peuplier : généré (silhouette fusiforme des peupliers d'Italie des berges).
"""
from __future__ import annotations

import math
import os
import random
import sys

import bpy  # doit précéder bmesh/mathutils (module bpy)
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_common import (DOSSIER_SOURCES, EMIT, Maillage, exporter, lin, materiau_unique,  # noqa: E402
                        reinitialiser, triangles)

E = EMIT


# ---------------------------------------------------------------------------
# Outils Poly Haven
# ---------------------------------------------------------------------------
def importer(asset: str) -> list:
    chemin = os.path.join(DOSSIER_SOURCES, asset, f"{asset}_1k.gltf")
    if not os.path.exists(chemin):
        raise FileNotFoundError(f"{chemin} absent : lancer telecharger_polyhaven.py")
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=chemin)
    objs = [o for o in bpy.data.objects if o not in avant and o.type == "MESH"]
    for o in objs:  # appliquer les transformations (glTF importé avec rotations/échelles de nœuds)
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    return objs


def pixels_image(mat: bpy.types.Material):
    """Image de couleur de base d'un matériau (tableau h × w × 4, valeurs telles que stockées : sRGB)."""
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            lien = n.inputs["Base Color"].links
            if lien and lien[0].from_node.type == "TEX_IMAGE":
                img = lien[0].from_node.image
                w, h = img.size
                px = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(px)
                return px.reshape(h, w, 4)
    return None


def echantillonner(px, u: float, v: float):
    h, w, _ = px.shape
    x = int((u % 1.0) * (w - 1))
    y = int((v % 1.0) * (h - 1))
    return px[y, x]


def couleur_moyenne(mat, seuil_alpha=0.5) -> tuple:
    px = pixels_image(mat)
    if px is None:
        return (0.3, 0.45, 0.2)
    p = px.reshape(-1, 4)
    p = p[p[:, 3] > seuil_alpha] if (p[:, 3] > seuil_alpha).any() else p
    return tuple(float(x) for x in p[:, :3].mean(axis=0))


def normaliser(c, maxi: float) -> tuple:
    """Ramène la composante la plus forte d'une couleur à `maxi` (textures souvent sombres)."""
    m = max(c[:3]) or 1.0
    return tuple(x * maxi / m for x in c[:3])


def decimer(ob, cible_tris: int) -> None:
    t = triangles(ob)
    if t <= cible_tris:
        return
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.0005, cible_tris / t)
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def cuire_couleurs(ob, assombrir: float = 1.0) -> None:
    """Remplace texture et UV par des couleurs de sommets (moyenne par face de la texture), un seul matériau."""
    me = ob.data
    uv = me.uv_layers.active
    images = [pixels_image(ms) for ms in me.materials]
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for p in me.polygons:
        px = images[p.material_index] if p.material_index < len(images) else None
        if px is None:
            c = (0.5, 0.5, 0.5)
        else:
            ech = [echantillonner(px, *uv.data[li].uv) for li in p.loop_indices]
            cu = sum((Vector(uv.data[li].uv) for li in p.loop_indices), Vector((0.0, 0.0))) / len(p.loop_indices)
            ech.append(echantillonner(px, cu.x, cu.y))
            c = tuple(float(x) * assombrir for x in np.mean(ech, axis=0)[:3])
        lc = lin(c)
        for li in p.loop_indices:
            col.data[li].color = lc
    finaliser_maillage(ob)


def finaliser_maillage(ob, emit_par_face=None) -> None:
    me = ob.data
    # Supprimer les sommets et arêtes isolés laissés par la décimation (ils fausseraient l'origine).
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES_FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    e = me.uv_layers.new(name="EMIT")
    if emit_par_face:
        for p in me.polygons:
            code = emit_par_face(p)
            for li in p.loop_indices:
                e.data[li].uv = (float(code), 0.0)
    else:
        for d in e.data:
            d.uv = (0.0, 0.0)
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.materials.clear()
    me.materials.append(materiau_unique())
    for k in list(me.attributes.keys()):
        if k.startswith("_") or k in ("material_index",):
            continue


def joindre(objs: list, nom: str):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    with bpy.context.temp_override(selected_editable_objects=objs, active_object=objs[0], object=objs[0]):
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = nom
    ob.data.name = nom
    return ob


def supprimer_autres(garder: list) -> None:
    for o in list(bpy.data.objects):
        if o not in garder:
            bpy.data.objects.remove(o, do_unlink=True)


def recentrer_au_sol(objs: list, centre_boite: bool = False) -> None:
    """Origine au sol (z min = 0), centrée en X/Y sur la base (ou sur la boîte englobante)."""
    pts = [v.co for o in objs for v in o.data.vertices]
    zmin = min(p.z for p in pts)
    bas = pts if centre_boite else ([p for p in pts if p.z < zmin + 0.6] or pts)
    if centre_boite:
        xs, ys = [p.x for p in pts], [p.y for p in pts]
        for o in objs:
            o.data.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -zmin)))
        return
    cx = sum(p.x for p in bas) / len(bas)
    cy = sum(p.y for p in bas) / len(bas)
    for o in objs:
        o.data.transform(Matrix.Translation((-cx, -cy, -zmin)))


# ---------------------------------------------------------------------------
# Climatiseur et lampadaire classique
# ---------------------------------------------------------------------------
def climatiseur():
    objs = importer("exterior_aircon_unit")
    garder = [o for o in objs if "rusted" not in o.name.lower()]
    supprimer_autres(garder)
    ob = joindre(garder, "climatiseur")
    decimer(ob, 260)
    bm = bmesh.new()  # la décimation retourne quelques faces : normales recalculées
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    cuire_couleurs(ob)
    recentrer_au_sol([ob], centre_boite=True)
    return [ob], "Poly Haven « exterior_aircon_unit » (CC0), décimé, texture cuite en couleurs de sommets."


def lampadaire_classique():
    """Lanterne Poly Haven décimée sur un fût tourné généré (le fût fin ne survit pas à la décimation)."""
    objs = importer("street_lamp_01")
    ob = joindre(objs, "lanterne")
    me = ob.data
    noms = [m.name.lower() for m in me.materials]
    idx_verre = {i for i, n in enumerate(noms) if "glass" in n or "bulb" in n}
    z_coupe = 2.95
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < z_coupe], context="FACES")
    bm.to_mesh(me)
    bm.free()
    attr = me.attributes.new("verre", "INT", "FACE")
    for p in me.polygons:
        attr.data[p.index].value = 1 if p.material_index in idx_verre else 0
    decimer(ob, 78)
    verre = {p.index for p in me.polygons if me.attributes["verre"].data[p.index].value}
    cuire_couleurs(ob)
    col = me.color_attributes["Col"]
    for p in me.polygons:
        if p.index in verre:
            for li in p.loop_indices:
                col.data[li].color = lin((1.0, 0.88, 0.62))
    finaliser_maillage(ob, lambda p: E["eclairage"] if p.index in verre else 0)
    me.attributes.remove(me.attributes["verre"])
    # Fût de fonte tourné (profil : socle, bague, fût effilé, chapiteau)
    m = Maillage("fut")
    fonte = (0.12, 0.14, 0.13)
    profil = [(0.0, 0.2), (0.4, 0.17), (0.55, 0.1), (1.3, 0.075), (z_coupe - 0.1, 0.055), (z_coupe + 0.05, 0.1)]
    anneaux = [[(r * math.cos(2 * math.pi * k / 6), r * math.sin(2 * math.pi * k / 6), z) for k in range(6)]
               for z, r in profil]
    m.lissage_anneaux(anneaux, fonte, fermer_debut=True, fermer_fin=True)
    fut = m.objet()
    ob = joindre([ob, fut], "lampadaire_classique")
    recentrer_au_sol([ob])
    return [ob], ("Lanterne : Poly Haven « street_lamp_01 » (CC0) décimée, verre émissif (code 8) ; "
                  "fût tourné généré.")


# ---------------------------------------------------------------------------
# Arbres
# ---------------------------------------------------------------------------
def bruit3(p: Vector, graine: int) -> float:
    """Bruit pseudo-aléatoire lisse et déterministe (somme de sinus), dans [-1, 1]."""
    s = 0.0
    for k, (a, b, c, f) in enumerate(((1.7, 2.3, 1.1, 1.0), (3.1, 1.3, 2.9, 0.5), (5.3, 4.7, 3.7, 0.25))):
        s += f * math.sin(a * p.x + graine * 0.37 + k) * math.sin(b * p.y + graine * 0.11) * math.cos(c * p.z + k)
    return s / 1.75


def peindre_houppier(m: Maillage, faces, base: tuple, zmin: float, zmax: float, rng: random.Random) -> None:
    """Feuillage : plus clair et chaud en haut (lumière), plus sombre et froid en bas (ombre propre)."""
    for f in faces:
        for l in f.loops:
            p = l.vert.co
            t = (p.z - zmin) / max(zmax - zmin, 1e-3)
            k = 0.62 + 0.58 * t + rng.uniform(-0.08, 0.08)
            c = (base[0] * k * (0.9 + 0.2 * t), base[1] * k, base[2] * k * (1.05 - 0.25 * t))
            l[m.col] = lin(tuple(min(1.0, x) for x in c))
            l[m.uv].uv = (0.0, 0.0)


def masse(m: Maillage, centre, rayons, subdiv, graine, amp=0.22) -> list:
    """Masse de feuillage : icosphère déformée par un bruit lisse."""
    faces = m.sphere(centre, 1.0, (0.3, 0.4, 0.2), subdiv=subdiv)
    c = Vector(centre)
    for v in {v for f in faces for v in f.verts}:
        d = v.co - c
        n = d.normalized()
        k = 1.0 + amp * bruit3(n * 2.0, graine)
        v.co = c + Vector((n.x * rayons[0], n.y * rayons[1], n.z * rayons[2])) * k
    return faces


def tronc_genere(m: Maillage, h, r0, r1, couleur, branches, segments=7, rng=None, h_branche=None):
    m.cylindre((0, 0, h / 2), r0, h, couleur, segments=segments, rayon2=r1, bouchons=False)
    rng = rng or random.Random(1)
    hb = h_branche or h * 0.92
    for k in range(branches):
        a = 2 * math.pi * k / branches + rng.uniform(-0.3, 0.3)
        lg = h * rng.uniform(0.45, 0.6)
        fin = (math.cos(a) * lg * 0.55, math.sin(a) * lg * 0.55, hb + lg * 0.8)
        m.poutre((0, 0, hb - 0.3), fin, r1 * 1.3, couleur, segments=5)


def platane(lod: int):
    rng = random.Random(11)
    m = Maillage(f"lod{lod}")
    ecorce = (0.62, 0.6, 0.5)   # écorce desquamée gris-beige
    vert = (0.4, 0.54, 0.2)
    h_tronc = 3.6
    if lod == 0:
        tronc_genere(m, h_tronc, 0.32, 0.24, ecorce, 3, rng=rng)
        masses = [((0, 0, 11.0), (5.6, 5.6, 4.6), 2), ((2.6, 1.2, 8.6), (3.6, 3.6, 3.0), 2),
                  ((-2.4, -1.6, 8.4), (3.4, 3.5, 2.9), 2), ((0.8, -2.8, 13.6), (3.0, 3.0, 2.6), 2)]
    else:
        m.cylindre((0, 0, h_tronc / 2 + 1.0), 0.3, h_tronc + 2.0, ecorce, segments=5, bouchons=False)
        masses = [((0, 0, 10.6), (6.2, 6.2, 5.4), 2)]
    zmin, zmax = 5.0, 16.5
    for i, (c, r, sd) in enumerate(masses):
        f = masse(m, c, r, sd, graine=i + 3)
        m.lisses.update(f)
        peindre_houppier(m, f, vert, zmin, zmax, rng)
    return m.objet(angle_vif=80)


def peuplier(lod: int):
    rng = random.Random(5)
    m = Maillage(f"lod{lod}")
    ecorce = (0.4, 0.37, 0.32)
    vert = (0.3, 0.44, 0.18)
    if lod == 0:
        m.cylindre((0, 0, 2.0), 0.3, 4.0, ecorce, segments=6, rayon2=0.22, bouchons=False)
        masses = [((0, 0, 8.5), (2.4, 2.4, 6.5), 2), ((0.3, 0.2, 15.5), (1.7, 1.7, 5.0), 2),
                  ((0, 0, 20.0), (0.9, 0.9, 2.6), 1)]
    else:
        m.cylindre((0, 0, 2.0), 0.3, 4.0, ecorce, segments=4, bouchons=False)
        masses = [((0, 0, 11.5), (2.4, 2.4, 10.0), 2)]
    for i, (c, r, sd) in enumerate(masses):
        f = masse(m, c, r, sd, graine=i + 7, amp=0.15)
        m.lisses.update(f)
        peindre_houppier(m, f, vert, 2.0, 22.5, rng)
    return m.objet(angle_vif=80)


def enveloppe_houppier(points: np.ndarray, centre: np.ndarray, subdiv: int, lissage: int = 2,
                       percentile: float = 92.0) -> tuple[list, list]:
    """Enveloppe étoilée d'un nuage de points : pour chaque direction d'une icosphère, rayon = percentile
    des projections des points situés dans un cône autour de la direction. Renvoie (sommets, faces)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    dirs = np.array([v.co[:] for v in bm.verts])
    rel = points - centre
    dist = np.linalg.norm(rel, axis=1) + 1e-9
    unit = rel / dist[:, None]
    rayons = np.zeros(len(dirs))
    for i, d in enumerate(dirs):
        cos = unit @ d
        sel = dist[cos > 0.93]
        if len(sel) < 5:
            sel = dist[cos > 0.8]
        rayons[i] = np.percentile(sel, percentile) if len(sel) else 0.0
    # Lissage laplacien des rayons sur le graphe de l'icosphère
    voisins = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    med = np.median(rayons[rayons > 0])
    rayons[rayons <= 0] = med * 0.5
    for _ in range(lissage):
        rayons = 0.5 * rayons + 0.5 * np.array([rayons[n].mean() for n in voisins])
    verts = [tuple(centre + d * r) for d, r in zip(dirs, rayons)]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def arbre_poly_haven(asset: str, echelle: float, lod: int, subdiv: int, tris_tronc: int, vert_force=None):
    """Arbre simplifié d'après un modèle Poly Haven : houppier en enveloppe + tronc décimé."""
    deja = set(bpy.data.objects)
    objs = importer(asset)
    ob = objs[0] if len(objs) == 1 else joindre(objs, asset)
    me = ob.data
    noms = [ms.name.lower() for ms in me.materials]
    i_feuilles = [i for i, n in enumerate(noms) if "lea" in n]
    i_tronc = [i for i, n in enumerate(noms) if "trunk" in n or n == asset]
    mat_feuilles = me.materials[i_feuilles[0]] if i_feuilles else None
    mat_tronc = me.materials[i_tronc[0]] if i_tronc else None
    # Nuage des sommets de feuillage (feuilles + rameaux)
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    mi = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", mi)
    ivs = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", ivs)
    tot = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", tot)
    mi_par_loop = np.repeat(mi, tot)
    est_tronc = np.isin(mi_par_loop, i_tronc)
    v_feuilles = np.unique(ivs[~est_tronc])
    v_tronc = np.unique(ivs[est_tronc])
    rng = np.random.default_rng(3)
    pts = co[v_feuilles]
    if len(pts) > 60000:
        pts = pts[rng.choice(len(pts), 60000, replace=False)]
    # Base au sol, centrée sur le pied du tronc
    zmin = co[v_tronc, 2].min() if len(v_tronc) else co[:, 2].min()
    pied = co[v_tronc] if len(v_tronc) else co
    pied = pied[pied[:, 2] < zmin + 0.4]
    cx, cy = pied[:, 0].mean(), pied[:, 1].mean()
    decal = np.array([cx, cy, zmin])
    pts = (pts - decal) * echelle
    centre = np.array([np.median(pts[:, 0]), np.median(pts[:, 1]),
                       (pts[:, 2].min() * 0.45 + pts[:, 2].max() * 0.55)])
    # Base du houppier : on ignore les feuilles retombantes du bas pour dégager le tronc.
    z_bas, z_haut = pts[:, 2].min(), pts[:, 2].max()
    z_base = max(z_bas + 0.3 * (z_haut - z_bas), 0.3 * z_haut)
    pts = pts[pts[:, 2] > z_base]
    centre[2] = z_base * 0.4 + z_haut * 0.6
    verts, faces = enveloppe_houppier(pts, centre, subdiv)
    verts = [(x, y, max(z, z_base + (z - z_base) * 0.3)) for x, y, z in verts]
    base_feuilles = vert_force or normaliser(couleur_moyenne(mat_feuilles), 0.52)
    couleur_ecorce = normaliser(couleur_moyenne(mat_tronc, seuil_alpha=-1), 0.42)
    # Tronc : faces du matériau tronc, décimées
    bm_tronc = bmesh.new()
    bm_tronc.from_mesh(me)
    for f in [f for f in bm_tronc.faces if f.material_index not in i_tronc]:
        bm_tronc.faces.remove(f)
    for v in [v for v in bm_tronc.verts if not v.link_faces]:
        bm_tronc.verts.remove(v)
    me_t = bpy.data.meshes.new("tronc_tmp")
    bm_tronc.to_mesh(me_t)
    bm_tronc.free()
    me_t.transform(Matrix.Translation(Vector(-decal)))
    me_t.transform(Matrix.Diagonal((echelle, echelle, echelle, 1.0)))
    ob_t = bpy.data.objects.new("tronc_tmp", me_t)
    bpy.context.scene.collection.objects.link(ob_t)
    decimer(ob_t, tris_tronc)
    bpy.data.objects.remove(ob, do_unlink=True)
    m = Maillage(f"lod{lod}")
    bm_t = bmesh.new()
    bm_t.from_mesh(ob_t.data)
    m.importer_bm(bm_t, couleur_ecorce, lisse=True)
    bm_t.free()
    bpy.data.objects.remove(ob_t, do_unlink=True)
    # Houppier
    avant = set(m.bm.faces)
    vs = [m.bm.verts.new(v) for v in verts]
    for f in faces:
        m.bm.faces.new([vs[i] for i in f])
    fh = [f for f in m.bm.faces if f not in avant]
    bmesh.ops.recalc_face_normals(m.bm, faces=fh)
    m.lisses.update(fh)
    rr = random.Random(2)
    zs = [v[2] for v in verts]
    peindre_houppier(m, fh, base_feuilles, min(zs), max(zs), rr)
    ob = m.objet(angle_vif=80)
    for o in list(bpy.data.objects):
        if o is not ob and o not in deja:
            bpy.data.objects.remove(o, do_unlink=True)
    return ob


def construire_arbre(id_m, fabrique, notes, source):
    reinitialiser()
    lod0 = fabrique(0)
    lod1 = fabrique(1)
    lod1.name = "lod1"
    lod0.name = "lod0"
    lods = [{"noeud": "lod0", "triangles": triangles(lod0), "usage": "proche"},
            {"noeud": "lod1", "triangles": triangles(lod1), "usage": "lointain (au-delà d'environ 300 m)"}]
    # Aperçu : on rend le lod0 seul puis on exporte les deux nœuds superposés.
    exporter(id_m, [lod0, lod1], categorie="arbre", notes=notes, source=source, lods=lods, apercu=False)
    from eco_common import rendre_apercu
    rendre_apercu(id_m, [lod0])
    rendre_apercu(id_m + "_lod1", [lod1])


def arbre_parc_large(lod):
    # Feuillage vert (au lieu du violet de la floraison du jacaranda) pour un parc européen.
    return arbre_poly_haven("jacaranda_tree", 0.85, lod, subdiv=3 if lod == 0 else 2,
                            tris_tronc=70 if lod == 0 else 20, vert_force=(0.3, 0.42, 0.17))


def arbre_parc_rond(lod):
    return arbre_poly_haven("tree_small_02", 2.0, lod, subdiv=3 if lod == 0 else 2,
                            tris_tronc=70 if lod == 0 else 16)


ARBRES = {
    "arbre_platane": (platane, "Platane d'alignement (~16 m), houppier en masses lobées.",
                      "Généré procéduralement (polyhaven.py, fonction platane)"),
    "arbre_peuplier": (peuplier, "Peuplier d'Italie (~22 m), silhouette fusiforme des berges.",
                       "Généré procéduralement (polyhaven.py, fonction peuplier)"),
    "arbre_parc_large": (arbre_parc_large, "Grand feuillu de parc (~16 m, houppier étalé de 20 m).",
                         "Dérivé de Poly Haven « jacaranda_tree » (CC0) : enveloppe du feuillage + tronc décimé"),
    "arbre_parc_rond": (arbre_parc_rond, "Feuillu de parc au houppier rond (~9 m).",
                        "Dérivé de Poly Haven « tree_small_02 » (CC0, ×2) : enveloppe du feuillage + tronc décimé"),
}
AUTRES = {
    "climatiseur": (climatiseur, "toiture"),
    "lampadaire_classique": (lampadaire_classique, "mobilier_urbain"),
}


def construire(ids=None):
    for id_m, (fn, cat) in AUTRES.items():
        if ids and id_m not in ids:
            continue
        reinitialiser()
        objets, source = fn()
        exporter(id_m, objets, categorie=cat, source=source, notes=source)
    for id_m, (fn, notes, source) in ARBRES.items():
        if ids and id_m not in ids:
            continue
        construire_arbre(id_m, fn, notes, source)


if __name__ == "__main__":
    construire(sys.argv[1:] or None)
