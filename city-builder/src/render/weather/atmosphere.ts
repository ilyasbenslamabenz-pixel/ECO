/**
 * Atmosphère côté rendu (phase 2C) : applique la météo simulée et la saison du calendrier de jeu.
 *  - ciel (SkySystem, src/render/sky) : nuages, voile du soleil, brouillard, éclairs, course saisonnière du soleil ;
 *  - surfaces (./surfaces) : neige au sol et sur les toits, sol mouillé, herbe et feuillage saisonniers ;
 *  - précipitations (./precipitation) : pluie et neige instanciées (≤ 2 appels de rendu) ;
 *  - halos des lampadaires (./glows) : 1 appel de rendu la nuit.
 * Qualité réglable (`off` | `bas` | `haut`) : paramètre d'URL `?atmo=`, sinon localStorage `meknes.atmo.qualite`,
 * sinon `haut` ; `off` rend la scène de base (aucun patch, aucune particule, ciel clair).
 * Le rendu ne modifie jamais l'état du jeu.
 */
import * as THREE from 'three';
import type { AssetCatalog } from '../../shared/catalog';
import { astronomicalDay, seasonVisuals } from '../../shared/weather/season';
import { isLiteDevice } from '../device-profile';
import type { WeatherPayload } from '../../shared/weather/types';
import { roleOf } from '../nature/vegetation';
import { getActiveSky, type SkySystem } from '../sky/sky-system';
import { LampGlows } from './glows';
import { PrecipitationSystem } from './precipitation';
import { SurfacePatcher, type SurfaceRole } from './surfaces';

export type AtmosphereQuality = 'off' | 'bas' | 'haut';
const QUALITY_KEY = 'meknes.atmo.qualite';

export function readQualitySetting(): AtmosphereQuality {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('atmo');
    if (q === 'off' || q === 'bas' || q === 'haut') return q;
    const s = globalThis.localStorage?.getItem(QUALITY_KEY);
    if (s === 'off' || s === 'bas' || s === 'haut') return s;
  } catch { /* stockage indisponible */ }
  // Téléphone / faible mémoire : particules réduites par défaut.
  return isLiteDevice() ? 'bas' : 'haut';
}

const PARTICLES: Record<AtmosphereQuality, { rain: number; snow: number }> = {
  off: { rain: 0, snow: 0 }, bas: { rain: 2500, snow: 1600 }, haut: { rain: 9000, snow: 5000 },
};

/** Valeurs lissées affichées (convergent vers la dernière charge utile). */
interface Shown { cloud: number; rain: number; snow: number; fog: number; storm: number; wind: number; windDir: number; wetness: number; snowCover: number; doy: number }

export interface AtmosphereDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  catalog: AssetCatalog;
  nightFactor(): number;
  /** Ciel (par défaut : système de ciel actif de la page). */
  sky?: SkySystem | null;
}

export interface AtmosphereStats {
  quality: AtmosphereQuality;
  patchedMaterials: number;
  /** Appels de rendu ajoutés (particules + halos) à l'image courante. */
  extraCalls: number;
  /** Triangles ajoutés (2 par particule / halo dessiné). */
  extraTriangles: number;
  particles: number;
  glows: number;
}

export class AtmosphereSystem {
  private quality: AtmosphereQuality;
  private readonly patcher = new SurfacePatcher();
  private precip: PrecipitationSystem | null = null;
  private glows: LampGlows | null = null;
  private target: WeatherPayload | null = null;
  private readonly shown: Shown = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 2, windDir: 4.7, wetness: 0, snowCover: 0, doy: 172 };
  private scanTimer = 0;
  private skyTimer = 0;
  private lastSkyKey = '';
  private readonly roles = new Map<string, SurfaceRole>();

  constructor(private readonly d: AtmosphereDeps, quality: AtmosphereQuality = readQualitySetting()) {
    this.quality = quality;
    for (const a of d.catalog.assets) {
      const r = roleOf(a);
      if (!r) continue;
      this.roles.set(a.id, r === 'feuillu' || r === 'ornement' ? 'leaf' : r === 'conifere' || r === 'arbuste' ? 'conifer' : 'generic');
    }
    this.applyQuality();
  }

  private get sky(): SkySystem | null { return this.d.sky ?? getActiveSky(); }
  get currentQuality(): AtmosphereQuality { return this.quality; }
  get payload(): WeatherPayload | null { return this.target; }

  setQuality(q: AtmosphereQuality, persist = true): void {
    if (q === this.quality) return;
    this.quality = q;
    if (persist) { try { globalThis.localStorage?.setItem(QUALITY_KEY, q); } catch { /* ignoré */ } }
    this.applyQuality();
  }

  private applyQuality(): void {
    this.precip?.dispose();
    this.precip = null;
    if (this.quality === 'off') {
      this.patcher.restore();
      this.glows?.dispose();
      this.glows = null;
      this.sky?.setWeather(null);
      this.lastSkyKey = '';
      return;
    }
    const p = PARTICLES[this.quality];
    this.precip = new PrecipitationSystem(this.d.scene, { maxRain: p.rain, maxSnow: p.snow });
    if (!this.glows) this.glows = new LampGlows(this.d.scene);
    this.scanTimer = 0;
    this.lastSkyKey = '';
  }

  /** Nouvelle charge utile (instantané : appliquée immédiatement ; delta : transition douce sauf forçage). */
  apply(p: WeatherPayload | undefined, immediate: boolean): void {
    this.target = p ?? null;
    if (!p) {
      Object.assign(this.shown, { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wetness: 0, snowCover: 0 });
      this.lastSkyKey = '';
      return;
    }
    if (immediate || p.forced) this.snap();
  }

  private snap(): void {
    const t = this.target;
    if (!t) return;
    const s = this.shown;
    s.cloud = t.cloud; s.rain = t.rain; s.snow = t.snow; s.fog = t.fog; s.storm = t.storm; s.wind = t.wind; s.windDir = t.windDir;
    s.wetness = t.wetness; s.snowCover = t.snowCover; s.doy = t.dayOfYear;
    this.lastSkyKey = '';
  }

  /** Rôle de surface d'un maillage (null = ne pas patcher). */
  private classify(o: THREE.Mesh, group: string): SurfaceRole | null {
    const mat = o.material as THREE.Material;
    if (Array.isArray(mat)) return null;
    if (group === 'vehicules') return null;
    if (mat.name === 'eau') return null;
    if (mat.name === 'terrain_pbr') return 'grass';
    if (group === 'vegetation') {
      const m = /^veg_(.+)_(lod\d+|imposteur)$/.exec(o.name);
      if (!m) return 'generic';
      const role = this.roles.get(m[1]!) ?? 'generic';
      if (m[2] === 'imposteur') return role === 'leaf' ? 'impostorLeaf' : 'conifer';
      return role;
    }
    if (group === 'roads' && /^roads_(?!decor_|lamp_)/.test(o.name)) return 'road';
    return 'generic';
  }

  /** Patche les matériaux apparus depuis le dernier passage (chargements progressifs des modèles). */
  private scanMaterials(): void {
    for (const top of this.d.scene.children) {
      const group = top.name;
      if (group === 'vehicules' || group === 'ciel') continue;
      top.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
        if (this.patcher.isPatched(m.material)) return;
        const role = this.classify(m, group);
        if (role) this.patcher.patch(m.material, role);
      });
    }
  }

  frame(dt: number): void {
    if (this.quality === 'off') return;
    const sky = this.sky;
    const t = this.target;
    const s = this.shown;
    // Transition douce (≈ 3 s) vers la météo simulée.
    if (t) {
      const k = 1 - Math.exp(-dt * 0.8);
      s.cloud += (t.cloud - s.cloud) * k; s.rain += (t.rain - s.rain) * k; s.snow += (t.snow - s.snow) * k;
      s.fog += (t.fog - s.fog) * k; s.storm += (t.storm - s.storm) * k; s.wind += (t.wind - s.wind) * k;
      s.windDir = t.windDir;
      s.wetness += (t.wetness - s.wetness) * k; s.snowCover += (t.snowCover - s.snowCover) * k;
      s.doy = t.dayOfYear;
    }
    // Saison : uniformes partagés des surfaces, course du soleil.
    const sv = seasonVisuals(s.doy);
    const u = this.patcher.uniforms;
    u.uAtmoAutumn.value = sv.autumn; u.uAtmoBare.value = sv.bare; u.uAtmoSpring.value = sv.spring;
    u.uAtmoDry.value = sv.dryGrass; u.uAtmoDormant.value = sv.dormant;
    u.uAtmoSnow.value = s.snowCover; u.uAtmoWet.value = s.wetness;
    // Ciel : mis à jour quand la météo affichée a changé de façon perceptible (au plus 4 fois par seconde).
    this.skyTimer -= dt;
    if (sky && this.skyTimer <= 0) {
      const key = [s.cloud, s.rain, s.snow, s.fog, s.storm].map((v) => Math.round(v * 100)).join('|') + `|${astronomicalDay(s.doy)}`;
      if (key !== this.lastSkyKey) {
        this.lastSkyKey = key;
        this.skyTimer = 0.25;
        sky.setDayOfYear(astronomicalDay(s.doy));
        sky.setWeather({ cloud: s.cloud, rain: s.rain, snow: s.snow, fog: s.fog, storm: s.storm, wind: s.wind, windDir: s.windDir });
        this.syncImpostorLights(sky);
      }
    }
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) { this.scanTimer = 1.5; this.scanMaterials(); }
    const light = sky?.ambientSky ?? new THREE.Color(0.5, 0.5, 0.5);
    this.precip?.update(dt, this.d.camera, s.rain, s.snow, s.wind, s.windDir, light);
    this.glows?.update(dt, this.d.nightFactor(), s.fog, Math.min(1, s.rain + s.snow));
  }

  /**
   * Recopie soleil / hémisphère dans les uniformes partagés des imposteurs d'arbres (même formule que
   * VegetationSystem.syncLights, appelée seulement au changement d'heure par src/render/index.ts).
   */
  private syncImpostorLights(sky: SkySystem): void {
    let lights: Record<string, THREE.IUniform> | null = null;
    let hemi: THREE.HemisphereLight | null = null;
    let sun: THREE.DirectionalLight | null = null;
    this.d.scene.traverse((o) => {
      if (!hemi && (o as THREE.HemisphereLight).isHemisphereLight) hemi = o as THREE.HemisphereLight;
      if (!sun && (o as THREE.DirectionalLight).isDirectionalLight && (o as THREE.DirectionalLight).castShadow) sun = o as THREE.DirectionalLight;
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!lights && m && !Array.isArray(m) && m.name === 'imposteur_arbre') lights = m.uniforms;
    });
    const L = lights as Record<string, THREE.IUniform> | null, H = hemi as THREE.HemisphereLight | null, S = sun as THREE.DirectionalLight | null;
    if (!L || !H || !S || !L['uSunColor'] || !L['uSky'] || !L['uGround']) return;
    (L['uSunColor'].value as THREE.Color).copy(S.color).multiplyScalar(S.intensity / Math.PI);
    (L['uSky'].value as THREE.Color).copy(H.color).multiplyScalar(H.intensity / Math.PI).add(sky.ambientSky);
    (L['uGround'].value as THREE.Color).copy(H.groundColor).multiplyScalar(H.intensity / Math.PI).add(sky.ambientGround);
  }

  /** Éclair immédiat (démonstration, captures). */
  strike(): void { this.sky?.strike(1); }

  stats(): AtmosphereStats {
    const ps = this.precip?.stats() ?? { calls: 0, instances: 0 };
    const g = this.glows && this.glows.mesh.visible ? this.glows.count : 0;
    return {
      quality: this.quality, patchedMaterials: this.patcher.count,
      extraCalls: ps.calls + (g > 0 ? 1 : 0), extraTriangles: (ps.instances + g) * 2, particles: ps.instances, glows: g,
    };
  }

  dispose(): void {
    this.precip?.dispose();
    this.glows?.dispose();
    this.patcher.restore();
    this.sky?.setWeather(null);
  }
}
