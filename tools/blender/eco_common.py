"""Outils communs pour la bibliothèque de modèles 3D d'ECO NATION (Blender headless, module `bpy`).

Conventions (voir aussi README.md dans ce dossier) :
- Unités : mètres. Origine au sol (ou à la ligne de flottaison pour les navires), centrée.
- Repère Blender : Z vers le haut, l'AVANT du modèle vers -Y. À l'export glTF (+Y en haut),
  -Y Blender devient +Z glTF, puis +Z dans Babylon.js (le chargeur glTF de Babylon convertit
  le repère droit en repère gauche sans inverser l'avant).
- Un seul matériau par modèle : couleurs de sommets (COLOR_0, linéaires) via « Color Attribute ».
- Code émissif par face dans la carte UV « EMIT » (TEXCOORD_0, composante u = code entier),
  voir EMIT ci-dessous. Permet de rendre phares, feux et vitrages émissifs la nuit.
"""
from __future__ import annotations

import json
import math
import os
import random
from typing import Callable, Iterable, Sequence

import bpy  # doit précéder bmesh/mathutils (module bpy)
import bmesh
from mathutils import Matrix, Vector

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(os.path.dirname(ICI))  # eco-nation/
DOSSIER_MODELES = os.path.join(RACINE, "client", "public", "assets", "models")
DOSSIER_APERCUS = os.environ.get(
    "ECO_APERCUS",
    "/tmp/claude-0/-home-user-gefais/3c7dae7d-d178-58ac-880a-6f49712952bd/scratchpad/blender",
)
DOSSIER_SOURCES = os.environ.get(
    "ECO_POLYHAVEN",
    "/tmp/claude-0/-home-user-gefais/3c7dae7d-d178-58ac-880a-6f49712952bd/scratchpad/phassets",
)
MANIFESTE = os.path.join(DOSSIER_MODELES, "manifest.json")

# Codes émissifs (u de la carte UV « EMIT »). 0 = surface ordinaire.
EMIT = {
    "aucun": 0,
    "phare": 1,          # phares avant, blanc chaud
    "feu_arriere": 2,    # feux arrière / feu rouge / balise rouge
    "vitrage": 3,        # vitrage éclairé de l'intérieur la nuit (bus, tram, navires, abribus)
    "gyrophare": 4,      # gyrophare bleu
    "orange": 5,         # clignotant, feu orange, enseigne taxi
    "vert": 6,           # feu vert, feu de navigation tribord
    "flash": 7,          # feux à éclats blancs (avions, mâts)
    "eclairage": 8,      # lanterne d'éclairage public (blanc chaud)
    "vitrage_sombre": 9, # vitrage non éclairé (voitures, cockpits) : identifiable, pas émissif par défaut
}
# Couleur émissive suggérée (sRGB) pour chaque code, reprise dans le manifeste.
COULEURS_EMISSIVES = {
    1: (1.0, 0.95, 0.82), 2: (1.0, 0.08, 0.05), 3: (1.0, 0.82, 0.52), 4: (0.15, 0.35, 1.0),
    5: (1.0, 0.62, 0.1), 6: (0.1, 1.0, 0.35), 7: (1.0, 1.0, 1.0), 8: (1.0, 0.86, 0.62),
    9: (0.25, 0.32, 0.4),
}

# Palette (sRGB).
NOIR_PNEU = (0.045, 0.045, 0.05)
GRIS_JANTE = (0.62, 0.63, 0.65)
GRIS_FONCE = (0.16, 0.17, 0.18)
GRIS = (0.42, 0.43, 0.45)
GRIS_CLAIR = (0.72, 0.73, 0.74)
BLANC = (0.92, 0.92, 0.9)
VITRE = (0.13, 0.17, 0.21)
VITRE_ECLAIREE = (0.22, 0.27, 0.32)
PHARE = (0.95, 0.95, 0.9)
FEU_ROUGE = (0.75, 0.05, 0.04)
ORANGE = (1.0, 0.55, 0.08)
BLEU_GYRO = (0.1, 0.25, 0.95)


def lin(c: Sequence[float]) -> tuple[float, float, float, float]:
    """sRGB -> linéaire (les couleurs de sommets glTF sont linéaires)."""
    def f(x: float) -> float:
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (f(c[0]), f(c[1]), f(c[2]), 1.0)


def varier(c: Sequence[float], amp: float, rng: random.Random) -> tuple[float, float, float]:
    k = 1.0 + rng.uniform(-amp, amp)
    return tuple(max(0.0, min(1.0, x * k)) for x in c[:3])  # type: ignore[return-value]


def reinitialiser() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------
# Constructeur de maillage
# ---------------------------------------------------------------------------
Peinture = "tuple | Callable[[bmesh.types.BMFace], tuple]"


class Maillage:
    """Accumule des primitives dans un bmesh, avec couleur et code émissif par face."""

    def __init__(self, nom: str):
        self.nom = nom
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.uv = self.bm.loops.layers.uv.new("EMIT")
        self.lisses: set = set()

    # -- utilitaires internes ------------------------------------------------
    def _avant(self) -> set:
        return set(self.bm.faces)

    def _nouvelles(self, avant: set) -> list:
        return [f for f in self.bm.faces if f not in avant]

    def peindre(self, faces: Iterable, couleur, emit: int = 0) -> None:
        """couleur : tuple sRGB, ou fonction(face) -> (couleur, emit)."""
        for f in faces:
            if callable(couleur):
                c, e = couleur(f)
            else:
                c, e = couleur, emit
            lc = lin(c)
            for l in f.loops:
                l[self.col] = lc
                l[self.uv].uv = (float(e), 0.0)

    def _orienter(self, faces: list) -> None:
        """Normales sortantes pour un volume fermé : recalc_face_normals peut se tromper sur des coques
        effilées ; on vérifie le signe du volume et on retourne les faces si besoin."""
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        vol = 0.0
        for f in faces:
            vs = [v.co for v in f.verts]
            for i in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[i].cross(vs[i + 1]))
        if vol < 0:
            bmesh.ops.reverse_faces(self.bm, faces=faces)

    def _biseau(self, faces: list, largeur: float, segments: int = 1) -> list:
        if largeur <= 0:
            return faces
        aretes = list({e for f in faces for e in f.edges})
        avant = self._avant()
        bmesh.ops.bevel(self.bm, geom=aretes, offset=largeur, offset_type="OFFSET", segments=segments,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
        return [f for f in faces if f.is_valid] + self._nouvelles(avant)

    def _finir_prim(self, faces: list, couleur, emit: int, biseau: float, lisse: bool) -> list:
        faces = self._biseau(faces, biseau)
        self.peindre(faces, couleur, emit)
        if lisse:
            self.lisses.update(faces)
        return faces

    # -- primitives ------------------------------------------------------------
    def boite(self, centre, taille, couleur, emit: int = 0, biseau: float = 0.0, rot=None,
              sans_dessous: bool = False) -> list:
        """Pavé de centre et dimensions (x, y, z) données. rot : Matrix 3x3/4x4 ou Euler (radians)."""
        avant = self._avant()
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ _mat_rot(rot)
        m = m @ Matrix.Diagonal((*taille, 1.0))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        faces = self._nouvelles(avant)
        if sans_dessous:
            dessous = [f for f in faces if (m.to_3x3() @ f.normal).normalized().z < -0.99]
            bmesh.ops.delete(self.bm, geom=dessous, context="FACES")
            faces = [f for f in faces if f.is_valid]
        return self._finir_prim(faces, couleur, emit, biseau, False)

    def cylindre(self, centre, rayon, longueur, couleur, emit: int = 0, axe: str = "Z", segments: int = 12,
                 rayon2: float | None = None, biseau: float = 0.0, lisse: bool = True, bouchons: bool = True,
                 rot=None) -> list:
        """Cylindre (ou tronc de cône si rayon2) centré, d'axe X, Y ou Z."""
        avant = self._avant()
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ _mat_rot(rot)
        if axe == "X":
            m = m @ Matrix.Rotation(math.pi / 2, 4, "Y")
        elif axe == "Y":
            m = m @ Matrix.Rotation(-math.pi / 2, 4, "X")
        bmesh.ops.create_cone(self.bm, cap_ends=bouchons, cap_tris=False, segments=segments, radius1=rayon,
                              radius2=rayon if rayon2 is None else rayon2, depth=longueur, matrix=m)
        faces = self._nouvelles(avant)
        if lisse:
            faces_lisses = [f for f in faces if len(f.verts) == 4]
        faces = self._biseau(faces, biseau)
        self.peindre(faces, couleur, emit)
        if lisse:
            self.lisses.update(f for f in faces_lisses if f.is_valid)
        return faces

    def sphere(self, centre, rayon, couleur, emit: int = 0, subdiv: int = 1, echelle=(1, 1, 1),
               lisse: bool = True) -> list:
        avant = self._avant()
        m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*echelle, 1.0))
        bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=rayon, matrix=m)
        faces = self._nouvelles(avant)
        return self._finir_prim(faces, couleur, emit, 0.0, lisse)

    def profil_x(self, points_yz, largeur, couleur, emit: int = 0, x0: float = 0.0, biseau: float = 0.0,
                 retrait_haut: float = 0.0, z_retrait: float | None = None) -> list:
        """Extrude un profil latéral (y, z) sur la largeur X (centré en x0).

        retrait_haut : rétrécissement (m, par côté) appliqué aux sommets au-dessus de z_retrait,
        proportionnellement à la hauteur (galbe du pavillon)."""
        pts = list(points_yz)
        if _aire(pts) < 0:
            pts.reverse()
        zmin = min(p[1] for p in pts)
        zmax = max(p[1] for p in pts)
        zr = zmin if z_retrait is None else z_retrait

        def dx(z: float) -> float:
            if retrait_haut <= 0 or z <= zr or zmax <= zr:
                return 0.0
            return retrait_haut * (z - zr) / (zmax - zr)

        avant = self._avant()
        g = [self.bm.verts.new((x0 - largeur / 2 + dx(z), y, z)) for y, z in pts]
        d = [self.bm.verts.new((x0 + largeur / 2 - dx(z), y, z)) for y, z in pts]
        n = len(pts)
        self.bm.faces.new(g)              # côté -X
        self.bm.faces.new(list(reversed(d)))
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((g[j], g[i], d[i], d[j]))
        faces = self._nouvelles(avant)
        self._orienter(faces)
        return self._finir_prim(faces, couleur, emit, biseau, False)

    def lissage_anneaux(self, anneaux: list[list], couleur, emit: int = 0, fermer_debut: bool = True,
                        fermer_fin: bool = True, lisse: bool = True, pointe_debut=None, pointe_fin=None) -> list:
        """Loft entre anneaux fermés de même nombre de points (listes de (x, y, z)).

        pointe_debut / pointe_fin : point (x, y, z) pour fermer en cône au lieu d'un n-gone."""
        avant = self._avant()
        vs = [[self.bm.verts.new(p) for p in a] for a in anneaux]
        n = len(anneaux[0])
        for a, b in zip(vs, vs[1:]):
            for i in range(n):
                j = (i + 1) % n
                self.bm.faces.new((a[i], a[j], b[j], b[i]))
        for anneau, pointe, ferme in ((vs[0], pointe_debut, fermer_debut), (vs[-1], pointe_fin, fermer_fin)):
            if pointe is not None:
                p = self.bm.verts.new(pointe)
                for i in range(n):
                    self.bm.faces.new((anneau[i], anneau[(i + 1) % n], p))
            elif ferme:
                self.bm.faces.new(anneau)
        faces = self._nouvelles(avant)
        ferme = (fermer_debut or pointe_debut is not None) and (fermer_fin or pointe_fin is not None)
        if ferme:
            self._orienter(faces)
        else:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return self._finir_prim(faces, couleur, emit, 0.0, lisse)

    def plaque(self, points, epaisseur, couleur, emit: int = 0, axe: str = "Z", biseau: float = 0.0) -> list:
        """Polygone 2D (dans le plan normal à axe) extrudé en épaisseur, centré sur le plan des points."""
        avant = self._avant()
        e = epaisseur / 2
        def p3(p, o):
            if axe == "Z":
                return (p[0], p[1], p[2] + o) if len(p) == 3 else (p[0], p[1], o)
            if axe == "X":
                return (p[0] + o, p[1], p[2])
            return (p[0], p[1] + o, p[2])
        bas = [self.bm.verts.new(p3(p, -e)) for p in points]
        haut = [self.bm.verts.new(p3(p, e)) for p in points]
        n = len(points)
        self.bm.faces.new(bas)
        self.bm.faces.new(list(reversed(haut)))
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((bas[i], bas[j], haut[j], haut[i]))
        faces = self._nouvelles(avant)
        self._orienter(faces)
        return self._finir_prim(faces, couleur, emit, biseau, False)

    def poutre(self, a, b, section, couleur, emit: int = 0, segments: int = 4) -> list:
        """Barre de section carrée (segments=4) ou ronde entre deux points."""
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        if L < 1e-6:
            return []
        rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        avant = self._avant()
        m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Rotation(math.pi / 4 if segments == 4 else 0, 4, "Z")
        r = section / 2 * (math.sqrt(2) if segments == 4 else 1)
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r, radius2=r,
                              depth=L, matrix=m)
        faces = self._nouvelles(avant)
        return self._finir_prim(faces, couleur, emit, 0.0, segments > 4)

    def importer_bm(self, autre: bmesh.types.BMesh, couleur, emit: int = 0, lisse: bool = True,
                    matrice: Matrix | None = None) -> list:
        """Copie un bmesh externe (ex. tronc Poly Haven décimé)."""
        me = bpy.data.meshes.new("tmp_import")
        autre.to_mesh(me)
        if matrice is not None:
            me.transform(matrice)
        avant = self._avant()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        faces = self._nouvelles(avant)
        return self._finir_prim(faces, couleur, emit, 0.0, lisse)

    # -- finalisation ----------------------------------------------------------
    def objet(self, origine=(0.0, 0.0, 0.0), angle_vif: float = 35.0) -> bpy.types.Object:
        """Triangule, crée l'objet Blender (pivot = origine) avec le matériau unique."""
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        for f in bm.faces:
            f.smooth = f in self.lisses
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="EAR_CLIP")
        o = Vector(origine)
        for v in bm.verts:
            v.co -= o
        me = bpy.data.meshes.new(self.nom)
        bm.to_mesh(me)
        bm.free()
        me.color_attributes.active_color_name = "Col"
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        # Arêtes vives au-delà de angle_vif (normales séparées à l'export) ; le reste suit f.smooth.
        try:
            me.set_sharp_from_angle(angle=math.radians(angle_vif))
        except Exception:
            pass
        me.materials.append(materiau_unique())
        ob = bpy.data.objects.new(self.nom, me)
        ob.location = o
        bpy.context.scene.collection.objects.link(ob)
        return ob


def _aire(pts) -> float:
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts))) / 2


def _mat_rot(rot) -> Matrix:
    if isinstance(rot, Matrix):
        return rot.to_4x4()
    from mathutils import Euler
    return Euler(rot, "XYZ").to_matrix().to_4x4()


def materiau_unique() -> bpy.types.Material:
    mat = bpy.data.materials.get("eco_couleurs_sommets")
    if mat:
        return mat
    mat = bpy.data.materials.new("eco_couleurs_sommets")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.65
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


# ---------------------------------------------------------------------------
# Statistiques, export, aperçu, manifeste
# ---------------------------------------------------------------------------
def triangles(ob: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def boite_englobante(objets: list) -> tuple[Vector, Vector]:
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for ob in objets:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return mn, mx


def exporter(id_modele: str, objets: list, *, categorie: str, source: str, licence: str = "CC0",
             parties: list | None = None, peignable: bool = False, notes: str = "", lods: list | None = None,
             apercu: bool = True, origine: str = "sol") -> dict:
    """Exporte les objets donnés en GLB et met à jour le manifeste. Renvoie l'entrée du manifeste."""
    os.makedirs(DOSSIER_MODELES, exist_ok=True)
    chemin = os.path.join(DOSSIER_MODELES, f"{id_modele}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objets:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=chemin, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_tangents=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
        export_lights=False, export_extras=False,
    )
    bpy.context.view_layer.update()  # boîtes englobantes à jour après les modifications de maillage
    # Dimensions : niveau de détail le plus fin seulement (les LOD lointains sont superposés).
    mesures = [o for o in objets if not lods or o.name == lods[0]["noeud"]]
    mn, mx = boite_englobante(mesures)
    tri_parties = {ob.name: triangles(ob) for ob in objets}
    codes = sorted({int(round(uv.uv.x)) for ob in objets for uv in ob.data.uv_layers["EMIT"].data} - {0})
    entree = {
        "id": id_modele,
        "fichier": f"{id_modele}.glb",
        "categorie": categorie,
        # largeur = X, hauteur = Y (haut), longueur = Z (avant vers +Z) dans Babylon.
        "dimensions_m": {"largeur": round(mx.x - mn.x, 2), "hauteur": round(mx.z - mn.z, 2),
                         "longueur": round(mx.y - mn.y, 2)},
        # Pour les modèles à niveaux de détail, « triangles » est celui du niveau le plus détaillé.
        "triangles": lods[0]["triangles"] if lods else sum(tri_parties.values()),
        "triangles_par_noeud": tri_parties,
        "origine": origine,
        "parties_animees": parties or [],
        "lods": lods or [],
        "codes_emissifs": codes,
        "peignable": peignable,
        "taille_octets": os.path.getsize(chemin),
        "source": source,
        "licence": licence,
    }
    if notes:
        entree["notes"] = notes
    maj_manifeste(entree)
    if apercu:
        rendre_apercu(id_modele, objets)
        if codes:
            rendre_apercu_nuit(id_modele, objets)
    print(f"[export] {id_modele}: {entree['triangles']} tris, {entree['dimensions_m']}, "
          f"{entree['taille_octets'] / 1024:.0f} Ko")
    return entree


def maj_manifeste(entree: dict) -> None:
    if os.path.exists(MANIFESTE):
        with open(MANIFESTE, encoding="utf-8") as f:
            man = json.load(f)
    else:
        man = {}
    man.setdefault("version", 1)
    man["description"] = ("Bibliothèque de modèles 3D d'ECO NATION, générée par eco-nation/tools/blender/ "
                          "(Blender headless). Unités : mètres ; Y en haut ; avant vers +Z (Babylon).")
    man["convention_emissive"] = {
        "attribut": "TEXCOORD_0 (uv), composante u = code entier",
        "codes": {str(v): k for k, v in EMIT.items() if v},
        "couleurs_srgb": {str(k): list(v) for k, v in COULEURS_EMISSIVES.items()},
    }
    modeles = {m["id"]: m for m in man.get("modeles", [])}
    modeles[entree["id"]] = entree
    man["modeles"] = [modeles[k] for k in sorted(modeles)]
    with open(MANIFESTE, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write("\n")


def rendre_apercu(id_modele: str, objets: list, nuit: bool = True) -> None:
    """Rendu Workbench (couleurs de sommets) de 3/4 avant gauche, plus une vue « nuit » des émissifs."""
    os.makedirs(DOSSIER_APERCUS, exist_ok=True)
    sc = bpy.context.scene
    autres = [o for o in sc.objects if o not in objets and o.type == "MESH"]
    for o in autres:
        o.hide_render = True
    mn, mx = boite_englobante(objets)
    centre = (mn + mx) / 2
    taille = max((mx - mn).length, 0.5)
    # Sol
    sol = bpy.data.objects.get("_sol_apercu")
    if sol is None:
        me = bpy.data.meshes.new("_sol_apercu")
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
        bm.to_mesh(me)
        bm.free()
        sol = bpy.data.objects.new("_sol_apercu", me)
        sc.collection.objects.link(sol)
    sol.hide_render = False
    sol.scale = (taille * 3, taille * 3, 1)
    sol.location = (centre.x, centre.y, mn.z - 0.001 if mn.z > -0.01 else 0.0)
    # Caméra : 3/4 avant gauche (l'avant est vers -Y).
    cam = bpy.data.objects.get("_cam_apercu")
    if cam is None:
        cam = bpy.data.objects.new("_cam_apercu", bpy.data.cameras.new("_cam_apercu"))
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 50
    direction = Vector((-0.75, -1.0, 0.55)).normalized()
    dim = mx - mn
    elance = dim.z / max(dim.x, dim.y, 1e-3)  # objets hauts et fins : reculer davantage
    cam.location = centre + direction * taille * (1.55 if elance < 1.0 else 1.9 if elance < 3.0 else 2.6)
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = taille * 20
    cam.data.clip_start = taille * 0.01
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = 800
    sc.render.resolution_y = 560
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "VERTEX"
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    sh.show_object_outline = False
    sc.display_settings.display_device = "sRGB"
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = os.path.join(DOSSIER_APERCUS, f"{id_modele}.png")
    _couleur_sol(sol, (0.05, 0.05, 0.06) if id_modele.endswith("_nuit") else (0.55, 0.57, 0.52))
    bpy.ops.render.render(write_still=True)
    for o in autres:
        o.hide_render = False
    sol.hide_render = True


def rendre_apercu_nuit(id_modele: str, objets: list) -> None:
    """Vue « nuit » : surfaces ordinaires assombries, faces à code émissif (1 à 8) en couleur émissive pleine.
    Sert à vérifier que phares, feux et vitrages sont bien identifiés."""
    sauvegardes = []
    for ob in objets:
        me = ob.data
        col = me.color_attributes["Col"]
        uv = me.uv_layers["EMIT"]
        sauvegardes.append([tuple(d.color) for d in col.data])
        for i, d in enumerate(col.data):
            code = int(round(uv.data[i].uv.x))
            if 1 <= code <= 8:
                d.color = lin(COULEURS_EMISSIVES[code])
            else:
                c = d.color
                d.color = (c[0] * 0.08, c[1] * 0.09, c[2] * 0.14, 1.0)
    sc = bpy.context.scene
    sh = sc.display.shading
    ancien = (sh.light, sh.show_shadows, sh.show_cavity)
    sh.light, sh.show_shadows, sh.show_cavity = "FLAT", False, False
    rendre_apercu(id_modele + "_nuit", objets)
    sh.light, sh.show_shadows, sh.show_cavity = ancien
    for ob, sauv in zip(objets, sauvegardes):
        for d, c in zip(ob.data.color_attributes["Col"].data, sauv):
            d.color = c


def _couleur_sol(sol, c) -> None:
    me = sol.data
    if "Col" not in me.color_attributes:
        me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for d in me.color_attributes["Col"].data:
        d.color = lin(c)
    me.color_attributes.active_color = me.color_attributes["Col"]


def planche_contact() -> None:
    """Assemble les aperçus en deux planches, jour et nuit (ImageMagick si disponible)."""
    import shutil
    import subprocess
    if not shutil.which("montage"):
        return
    tous = sorted(p for p in os.listdir(DOSSIER_APERCUS) if p.endswith(".png") and not p.startswith("_"))
    for nom, imgs in (("_planche.png", [p for p in tous if not p.endswith("_nuit.png")]),
                      ("_planche_nuit.png", [p for p in tous if p.endswith("_nuit.png")])):
        if imgs:
            subprocess.run(["montage", "-label", "%t", "-pointsize", "16",
                            *[os.path.join(DOSSIER_APERCUS, p) for p in imgs], "-tile", "6x",
                            "-geometry", "360x252+4+4", os.path.join(DOSSIER_APERCUS, nom)], check=False)
