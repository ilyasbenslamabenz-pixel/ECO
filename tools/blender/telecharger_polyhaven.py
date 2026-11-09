"""Télécharge les sources Poly Haven (CC0, glTF 1k) utilisées par polyhaven.py.

Usage : python3 tools/blender/telecharger_polyhaven.py [dossier] [asset ...]
- dossier : défaut $ECO_POLYHAVEN ou le dossier par défaut d'eco_common.DOSSIER_SOURCES ;
- assets  : défaut, la liste ci-dessous. Variables : RES=2k pour une autre résolution, LIST=1 pour lister.
Les sources (≈ 400 Mo, surtout les arbres) ne sont pas versionnées ; seuls les GLB dérivés le sont.
"""
import json
import os
import sys
import urllib.request

ASSETS = ["exterior_aircon_unit", "street_lamp_01", "jacaranda_tree", "tree_small_02"]
DEFAUT = os.environ.get(
    "ECO_POLYHAVEN", "/tmp/claude-0/-home-user-gefais/3c7dae7d-d178-58ac-880a-6f49712952bd/scratchpad/phassets")
RES = os.environ.get("RES", "1k")
LISTER = os.environ.get("LIST") == "1"


def lire(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "eco-nation-tools/1.0"})
    with urllib.request.urlopen(req) as r:
        return r.read()


def main() -> None:
    sortie = sys.argv[1] if len(sys.argv) > 1 else DEFAUT
    for aid in sys.argv[2:] or ASSETS:
        g = json.loads(lire(f"https://api.polyhaven.com/files/{aid}")).get("gltf", {})
        if RES not in g:
            print(aid, "pas de résolution", RES, list(g))
            continue
        e = g[RES]["gltf"]
        inclus = e.get("include", {})
        print(aid, RES, e["url"], f"{(e['size'] + sum(v['size'] for v in inclus.values())) / 1e6:.1f} Mo")
        if LISTER:
            continue
        d = os.path.join(sortie, aid)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, os.path.basename(e["url"])), "wb") as f:
            f.write(lire(e["url"]))
        for rel, v in inclus.items():
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f:
                f.write(lire(v["url"]))


if __name__ == "__main__":
    main()
