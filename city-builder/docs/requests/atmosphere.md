# Demandes du module « Atmosphère » (phase 2C, branche `claude/p2c-atmosphere`)

Le module fonctionne sans aucune de ces modifications (branchements faits par le registre des plugins et par lecture
de la scène). Les points ci-dessous rendent l'intégration plus propre ou plus complète ; chacun indique le fichier
propriétaire, l'API déjà disponible et le diff proposé.

## 1. Registres communs (superviseur)

Fait sur la branche (une ligne chacun) : `src/sim/plugins/index.ts` (`weatherPlugin`), `src/render/plugins/index.ts`
(`weatherRenderPlugin`). Le test `tests/plugins/plugins.test.ts` a été ajusté **a minima** : les registres sim / rendu
valent `[...PHASE2_MODULES, ...ATMOSPHERE_MODULES]` (`src/shared/weather/types.ts`), le test « modules vides » exclut les
modules d'atmosphère (leur absence d'effet sur la simulation de base est testée dans `tests/weather`).

Proposé (non fait, fichiers communs) :

```diff
// src/sim/save-sections/index.ts
+import { weatherSaveSection } from './weather';
 export const SAVE_SECTIONS = [ ..., chantiersSaveSection,
+  weatherSaveSection,
 ];
// src/shared/protocol-ext/index.ts : types de ext.weather
+import type { WeatherCommands, WeatherPayload } from '../weather/types';
 export interface PluginDeltaMap { ...; weather: WeatherPayload }
 export interface PluginSnapshotMap { ...; weather: WeatherPayload }
 export interface PluginCommandMaps { ...; weather: WeatherCommands }
```
(Si `weather` entre dans `PHASE2_MODULES`, retirer `ATMOSPHERE_MODULES` du test des registres.)

## 2. Barre supérieure : icône + température (propriétaire `src/ui`)

Données : `delta.ext.weather` / `snapshot.ext.weather` (`WeatherPayload`) — `icon` (emoji, lune la nuit par beau
temps), `label` (« Pluie »…), `tempC` (°C, une décimale), `wind` (m/s), `season`. Envoyé toutes les 10 min de jeu et
à chaque forçage ; absent sinon (garder la dernière valeur). Diff proposé :

```diff
// src/ui/markup.html, à côté de #hud-date
+    <span id="hud-meteo" class="pill" data-tip="Météo et température"></span>
// src/ui/hud.ts
+  updateWeather(w: WeatherPayload): void { elMeteo.textContent = `${w.icon} ${Math.round(w.tempC)} °C`;
+    elMeteo.dataset['tip'] = `${w.label}, vent ${Math.round(w.wind * 3.6)} km/h`; }
// src/main.ts (onDelta / onSnapshot)
+  const w = (d.ext?.['weather']) as WeatherPayload | undefined; if (w) ui.updateWeather(w);
```

## 3. Options graphiques : qualité de l'atmosphère (propriétaire `src/ui/options.ts`)

API : `getAtmosphere()?.setQuality('off' | 'bas' | 'haut')` (`src/render/plugins/weather.ts`), mémorisée dans
`localStorage['meknes.atmo.qualite']` ; URL `?atmo=off|bas|haut`. `off` = rendu de base exact (patchs retirés,
programmes d'origine recompilés, aucune particule, ciel clair). Proposé : un sélecteur « Météo et saisons :
Désactivées / Simples / Complètes » dans le panneau d'options, et `bas` par défaut quand l'option « performance » est
choisie.

## 4. Végétation (propriétaire `src/render/nature/vegetation.ts`)

Aujourd'hui : l'atmosphère reconnaît les maillages `veg_<asset>_lod<n>` / `veg_<asset>_imposteur` dans le groupe
`vegetation` et chaîne un patch de shader à leurs matériaux (`src/render/weather/surfaces.ts`, rôle du catalogue via
`roleOf`) : couleurs d'automne par arbre (graine d'instance), défoliation hivernale (fragments verts écartés),
vert tendre du printemps, neige sur les conifères. Limites et API proposée :

- **Ombres des arbres nus** : le matériau de profondeur par défaut ne connaît pas la défoliation (l'ombre d'un
  feuillu reste pleine en hiver). Proposé : `customDepthMaterial` par maillage feuillu, fabriqué par
  `createSeasonDepthMaterial(baseMaterial, uniforms)` (à exposer par `src/render/weather/surfaces.ts`), ou
  `castShadow = false` pour le seul sous-maillage de feuillage quand `bare > 0.8`.
- **Branchement explicite** (au lieu de la reconnaissance par nom) :

```diff
// src/render/nature/vegetation.ts
+import type { SurfacePatcher } from '../weather/surfaces';
+  /** Saison : patch des matériaux de feuillage par l'atmosphère (rôle feuillu / conifère). */
+  applySeason(patcher: SurfacePatcher): void {
+    for (const r of this.renders) {
+      const role = r.sp.role === 'conifere' || r.sp.role === 'arbuste' ? 'conifer' : 'leaf';
+      for (const l of r.lods) for (const m of l.meshes) patcher.patch(m.material as THREE.Material, role);
+      if (r.imp) patcher.patch(r.imp.mesh.material as THREE.Material, role === 'leaf' ? 'impostorLeaf' : 'conifer');
+    }
+  }
```

## 5. Intégration du rendu (propriétaire `src/render/index.ts`)

- L'éclairage des imposteurs (`veg.syncLights`) n'est recopié qu'au changement d'heure ; l'atmosphère recopie elle-même
  soleil / hémisphère dans les uniformes des imposteurs après un changement de météo. Proposé : exposer
  `RenderPluginContext.sky` (SkySystem) et `RenderPluginContext.syncLights()` pour éviter `getActiveSky()` et la
  recopie.
- `SkySystem.setDayOfYear(doy)` et `SkySystem.setWeather(w)` existent : l'atmosphère les appelle depuis son `frame`.

## 6. Éclairage de nuit (propriétaires `src/render/roads`, `src/render/buildings`)

Halos de lanternes ajoutés par l'atmosphère (1 appel de rendu, positions lues dans `roads_decor_lampadaire_fonte_lod0`,
centre du vitrage). Pour harmoniser : vitrage des lanternes `emissiveIntensity = night * 3.2` (routes) et fenêtres
(`nightFactorForHour`, bâtiments) suivent déjà le même facteur de nuit ; proposé côté routes : flaques de lumière au sol
`roads_lamp_pools` plus larges (×1,3) quand `wetness > 0.5` (reflets sur sol mouillé), via une méthode
`setWetness(w)` que l'atmosphère appellerait.

## 7. Saison de départ : printemps (décision du superviseur) — diff à appliquer (propriétaire simulation)

Une nouvelle partie commence début mai (jour de l'année 120 = 1er mai, calendrier de 30 jours) ; paramètre de
nouvelle partie `startSeason`, défaut `printemps`. La démo en hérite sans forçage dans main.ts. Le module météo
n'a rien à changer : il lit le jour de l'année dans l'horloge (`dayOfYearAt(totalMinutes)`), et son premier épisode
reste ensoleillé ou nuageux.

```diff
// src/shared/contracts.ts — NewGameParams
   /** Heure de départ de l'horloge (0..23,99) ; défaut 0 h. */
   startHour?: number;
+  /** Saison de départ (printemps = 1er mai, été = 1er juin, automne = 1er septembre, hiver = 1er décembre) ; défaut 'printemps' (1er mai). */
+  startSeason?: 'printemps' | 'ete' | 'automne' | 'hiver';
 }
+/** Jour de l'année de départ par saison (calendrier de jeu, 30 jours par mois). */
+export const START_DAY_OF_YEAR = { printemps: 120, ete: 150, automne: 240, hiver: 330 } as const;

// src/sim/world.ts — newGame()
-    this.clock.totalMinutes = Math.round(Math.max(0, Math.min(23.99, p.startHour ?? 0)) * 60);
+    const startDay = START_DAY_OF_YEAR[p.startSeason ?? 'printemps'];
+    this.clock.totalMinutes = startDay * MINUTES_PER_DAY + Math.round(Math.max(0, Math.min(23.99, p.startHour ?? 0)) * 60);
+    // (import { START_DAY_OF_YEAR } from '../shared/contracts' ; MINUTES_PER_DAY depuis ./clock)
     // + replanifier DayStart / MonthStart / YearStart à partir de cette heure (le code de planification
     //   existant `next(period)` part déjà de `t = this.clock.totalMinutes` : vérifier qu'il est appelé APRÈS).

// src/shared/protocol.ts — validation de newGame
       if (a.startHour !== undefined && (!isNum(a.startHour) || a.startHour < 0 || a.startHour >= 24)) return bad('Heure de départ invalide');
+      if (a.startSeason !== undefined && !['printemps', 'ete', 'automne', 'hiver'].includes(a.startSeason as string)) return bad('Saison de départ invalide');
```

Effets à vérifier par le propriétaire : l'année affichée reste « an 1 » (mai an 1) ; les tests qui supposent
`totalMinutes = startHour * 60` (horloge, économie mensuelle, empreintes de tests/plugins) devront fixer
`startSeason: 'hiver'`… ou mieux, utiliser le nouveau défaut et recalculer leurs attendus. Les sauvegardes existantes
ne changent pas (l'horloge est sauvegardée).

## 8. Coût mesuré (SwiftShader, scène de démonstration, `tests/weather/captures.mjs`)

| Vue rue, pluie forte | appels | triangles | ajouts atmosphère |
|---|---|---|---|
| `?atmo=off` | 2113 | 4 886 990 | 0 |
| `bas` | 2114 | 4 890 624 | 1 appel, 3 634 triangles (1 817 gouttes) |
| `haut` | 2114 | 4 901 736 | 1 appel, 13 082 triangles (6 541 gouttes) |

Orage (`haut`) : 1 appel, 18 000 triangles. Nuit : + 1 appel (halos). Précipitations ≤ 2 appels (pluie + neige
mêlées). Surfaces : 568 matériaux patchés une fois (une recompilation chacun), aucun appel ajouté ; ciel : nuages
dans le shader du dôme existant (bruit fbm 5 octaves par pixel de ciel).
