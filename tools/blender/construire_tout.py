"""Reconstruit toute la bibliothèque de modèles (un sous-processus par famille, pour repartir d'une scène vide).

Usage : <python avec bpy> tools/blender/construire_tout.py [famille ...]
Familles : vehicules, avions, navires, port_energie, mobilier_toiture, polyhaven.
Les aperçus PNG sont écrits dans $ECO_APERCUS (planche de synthèse : _planche.png).
"""
from __future__ import annotations

import os
import subprocess
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
FAMILLES = ["vehicules", "avions", "navires", "port_energie", "mobilier_toiture", "polyhaven"]


def main() -> int:
    choix = [f for f in sys.argv[1:] if f in FAMILLES] or FAMILLES
    echecs = []
    for f in choix:
        print(f"=== {f} ===", flush=True)
        r = subprocess.run([sys.executable, os.path.join(ICI, f"{f}.py")], capture_output=True, text=True)
        for ligne in (r.stdout + r.stderr).splitlines():
            if ligne.startswith("[export]") or "Error" in ligne and "EGL" not in ligne or "Traceback" in ligne \
                    or ligne.startswith("  File") or (r.returncode and ligne.strip()):
                print(ligne)
        if r.returncode:
            echecs.append(f)
    sys.path.insert(0, ICI)
    import bpy  # noqa: F401  (requis avant eco_common)
    from eco_common import planche_contact
    planche_contact()
    if echecs:
        print("ÉCHECS :", ", ".join(echecs))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
