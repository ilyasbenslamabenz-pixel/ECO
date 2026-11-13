# Reprise — module hubs (port et aéroport), branche claude/p2c-port-aeroport

**Fait** : module complet (validation littoral / terrain plat / servitudes, activité, API `provide('port'|'aeroport')`, nuisances sur grilles municipales, navires et avions animés, panneau Transports, onglet Transports de l'outil de pose) ; 35 modèles transport au catalogue + 3 entrées de construction.
**Preuves** (avant la pause, commit 053e434) : typecheck ✓, npm test 215/215 (15 dans tests/hubs), build 47,87 Mo, e2e SUCCÈS, validate:visual SUCCÈS, captures regardées (tests/hubs/out).
**Reste** (docs/requests/hubs.md) : veto de pose dans le cœur, application du budget à la trésorerie, emplois offerts à la démographie,
camions dans la circulation, surface de l'eau / aplanissement du terrain, montage du panneau, sélection/démolition à la souris,
quelques arbres restants sur le terre-plein portuaire.
**Reprise (fin)** : test du port fluvial ajouté (16 tests hubs) ; typecheck ✓, npm test 216/216 ; aucun changement du build (0 Mo ajouté).
Docs : docs/HUBS.md.
