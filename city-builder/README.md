# Aube Urbaine

City-builder 3D original (TypeScript strict + Three.js, simulation en Web Worker).

```
npm install
npm run build          # dist/index.html, dist/artifact.html, dist/game.js, dist/sim.worker.js, dist/assets/
npm run typecheck
npm test               # tests unitaires (node:test via tsx)
npm run e2e            # Chromium : chargement, worker, rendu, caméra
npm run e2e:gate       # auto-test de la porte de validation visuelle
npm run assets         # pipeline d'assets -> assets/catalog.json
npm run validate:assets
npm run validate:visual  # porte de validation visuelle (planche-contact + captures démo)
```

Ouvrir `dist/index.html` via un serveur HTTP statique (les modules ES et le worker ne se chargent pas en `file://`).
Paramètres d'URL : `?autostart` (partie immédiate), `?demo` (scène de démonstration — phase 1), `?validate` (mode inspection des assets).

Documentation : `docs/ARCHITECTURE.md`, `docs/ASSET_PIPELINE.md`, `AGENT_TASKS.md`, `FEATURES.md`, `PROJECT_STATUS.md`.
