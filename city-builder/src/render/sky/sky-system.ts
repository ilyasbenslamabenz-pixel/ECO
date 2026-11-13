/**
 * Ciel et lumière : HDRI Poly Haven (PMREM) pour l'environnement, soleil directionnel dont l'angle,
 * la couleur et l'intensité suivent l'heure (setTimeOfDay), lune et nuit étoilée, brouillard
 * atmosphérique accordé au ciel, exposition adaptée, ombres de qualité cadrées sur la vue
 * (boîte d'ombre qui suit la caméra, alignée sur les texels pour éviter le scintillement).
 *
 * N'impose rien à scene.ts : on lui passe les objets existants (renderer, scène, soleil, hémisphère).
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { AssetCatalog } from '../../shared/catalog';
import { createSkyDome, prepareHdri, type HdriSource } from './sky-dome';

export interface SkyOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  catalog: AssetCatalog;
  assetsBase: URL;
  /** Latitude (degrés) : hauteur maximale du soleil à midi. Défaut 46 (France). */
  latitude?: number;
  /** Jour de l'année 0..364 (saison). Défaut 172 (été). */
  dayOfYear?: number;
  /** Taille de la carte d'ombre (px). Défaut 2048 ; 4096 sur grand écran. */
  shadowMapSize?: number;
}

export interface SunState {
  /** Élévation (rad) ; < 0 sous l'horizon. */
  elevation: number;
  /** Azimut (rad), 0 = nord (-Z), sens horaire vu du dessus (est = +X). */
  azimuth: number;
  direction: THREE.Vector3;
}

const tmpColor = new THREE.Color();
const V_X = new THREE.Vector3(1, 0, 0);
const V_Y = new THREE.Vector3(0, 1, 0);

/** Couleur approchée de la lumière solaire selon l'élévation (rad). */
export function sunColorForElevation(el: number, out: THREE.Color): THREE.Color {
  const t = THREE.MathUtils.clamp(el / THREE.MathUtils.degToRad(35), 0, 1);
  const low = tmpColor.setRGB(1.0, 0.48, 0.22);
  out.setRGB(1.0, 0.95, 0.88).lerp(low, Math.pow(1 - t, 2.2));
  return out;
}

/**
 * Position du soleil (modèle astronomique simplifié) pour une heure locale, une latitude et un jour de l'année.
 * Renvoie élévation/azimut et la direction monde (vers le soleil). Pur et déterministe.
 */
export function sunPosition(hour: number, latitudeDeg: number, dayOfYear: number, out: SunState): SunState {
  const lat = THREE.MathUtils.degToRad(latitudeDeg);
  const decl = THREE.MathUtils.degToRad(23.44) * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const ha = THREE.MathUtils.degToRad(15 * (hour - 12));
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1));
  const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / Math.max(1e-6, Math.cos(el) * Math.cos(lat));
  let az = Math.acos(THREE.MathUtils.clamp(cosAz, -1, 1));
  if (ha > 0) az = 2 * Math.PI - az;
  out.elevation = el;
  out.azimuth = az;
  // Nord = -Z, est = +X.
  out.direction.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
  return out;
}

/** Météo vue par le ciel (valeurs 0..1 sauf vent en m/s et direction en rad). */
export interface SkyWeather {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  storm: number;
  wind: number;
  windDir: number;
}

const CLEAR: SkyWeather = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 2, windDir: 1.5 * Math.PI };

let activeSky: SkySystem | null = null;
/** Système de ciel courant (un seul rendu par page) : point d'accès des modules d'atmosphère. */
export function getActiveSky(): SkySystem | null { return activeSky; }

/** PRNG visuel minimal (éclairs) : reproductible d'une capture à l'autre, sans effet sur la simulation. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SkySystem {
  readonly dome: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private readonly sunState: SunState = { elevation: 0, azimuth: 0, direction: new THREE.Vector3() };
  private readonly moonDir = new THREE.Vector3();
  private hour = 14;
  private envHour = -100;
  private readonly fog: THREE.FogExp2;
  private readonly fogColor = new THREE.Color();
  /** Éclairement ambiant approché du ciel et du sol (linéaire). */
  readonly ambientSky = new THREE.Color();
  readonly ambientGround = new THREE.Color();
  private readonly lat: number;
  private doy: number;
  private readonly weather: SkyWeather = { ...CLEAR };
  private envWeatherKey = '';
  private flash = 0;
  private nextStrike = 4;
  private strikeRnd = mulberry(0xa7305);
  private hemiBase = 0.45;
  private sunBase = 0;
  private readonly cloudOffset = new THREE.Vector2();
  /** Facteur de lumière directe restante sous les nuages 0..1 (lu par les modules : ombres, reflets). */
  sunVisibility = 1;
  private day: HdriSource;
  private dusk: HdriSource;
  private elapsed = 0;
  /** Exposition de base (multipliée selon l'heure). */
  baseExposure = 0.85;
  /** Densité de brouillard de jour (exp²). */
  fogDensity = 0.00022;
  private shadowHalf = 220;

  private constructor(private readonly o: SkyOptions, day: HdriSource, dusk: HdriSource) {
    this.day = day;
    this.dusk = dusk;
    this.lat = o.latitude ?? 46;
    this.doy = o.dayOfYear ?? 172;
    const { mesh, uniforms } = createSkyDome(day, dusk);
    this.dome = mesh;
    this.uniforms = uniforms;
    o.scene.add(mesh);
    o.scene.background = null;
    // Copie du dôme pour la carte d'environnement (sans disque solaire).
    const envDome = new THREE.Mesh(mesh.geometry, (mesh.material as THREE.ShaderMaterial).clone());
    (envDome.material as THREE.ShaderMaterial).uniforms = { ...uniforms, uSunDisc: { value: 0 }, uHorizonFog: { value: 0.3 } };
    envDome.scale.setScalar(100);
    this.envScene.add(envDome);
    this.pmrem = new THREE.PMREMGenerator(o.renderer);
    this.fog = new THREE.FogExp2(0xb0c0d0, this.fogDensity);
    o.scene.fog = this.fog;
    const sun = o.sun;
    sun.castShadow = true;
    const ms = o.shadowMapSize ?? 2048;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.35;
    sun.shadow.radius = 2;
    if (!sun.target.parent) o.scene.add(sun.target);
    this.setTimeOfDay(this.hour);
    activeSky = this;
  }

  /** Jour de l'année astronomique 0..364 (course du soleil selon la saison). */
  setDayOfYear(doy: number): void {
    const d = Math.round(((doy % 365) + 365) % 365);
    if (d === this.doy) return;
    this.doy = d;
    this.setTimeOfDay(this.hour);
  }
  get dayOfYear(): number { return this.doy; }

  /** Météo courante (nuages, pluie, neige, brouillard, orage, vent) ; `null` = ciel clair de base. */
  setWeather(w: Partial<SkyWeather> | null): void {
    Object.assign(this.weather, w ?? CLEAR);
    if (!w) Object.assign(this.weather, CLEAR);
    this.setTimeOfDay(this.hour);
  }
  get currentWeather(): Readonly<SkyWeather> { return this.weather; }

  /** Charge les HDRI du catalogue (ciel_jour, ciel_crepuscule) et crée le système. */
  static async create(o: SkyOptions): Promise<SkySystem> {
    const find = (id: string): string => {
      const h = o.catalog.hdris.find((x) => x.id === id);
      if (!h) throw new Error(`HDRI absent du catalogue : ${id}`);
      return new URL(h.file, o.assetsBase).href;
    };
    const loader = new HDRLoader().setDataType(THREE.FloatType);
    const [d, k] = await Promise.all([loader.loadAsync(find('ciel_jour')), loader.loadAsync(find('ciel_crepuscule'))]);
    const prep = (t: THREE.DataTexture): HdriSource => {
      const img = t.image as { width: number; height: number; data: Float32Array };
      const r = prepareHdri(img, false);
      t.dispose();
      return r;
    };
    return new SkySystem(o, prep(d), prep(k));
  }

  get timeOfDay(): number { return this.hour; }
  get sun(): Readonly<SunState> { return this.sunState; }
  /** Facteur de nuit 0..1 (1 = pleine nuit). */
  get nightFactor(): number { return this.uniforms['uNight']!.value as number; }
  get environmentTexture(): THREE.Texture | null { return this.envRT?.texture ?? null; }

  /** Règle l'heure (0..24) : soleil, lune, lumières, ciel, brouillard, exposition, environnement. */
  setTimeOfDay(hour: number): void {
    const h = ((hour % 24) + 24) % 24;
    this.hour = h;
    const s = sunPosition(h, this.lat, this.doy, this.sunState);
    const elDeg = THREE.MathUtils.radToDeg(s.elevation);
    const u = this.uniforms;
    // Poids jour / crépuscule / nuit.
    const dayW = THREE.MathUtils.smoothstep(elDeg, 4, 22);
    const duskW = THREE.MathUtils.smoothstep(elDeg, -9, 2) * (1 - dayW);
    const night = 1 - THREE.MathUtils.smoothstep(elDeg, -12, -2);
    u['uDayW']!.value = dayW;
    u['uDuskW']!.value = duskW * (1 - night * 0.85);
    u['uNight']!.value = night;
    (u['uSunDir']!.value as THREE.Vector3).copy(s.direction);
    // Rotation des HDRI : leur soleil (effacé) est aligné sur l'azimut simulé.
    const simAz = Math.atan2(s.direction.z, s.direction.x);
    u['uRotDay']!.value = simAz - this.day.sunAzimuth;
    u['uRotDusk']!.value = simAz - this.dusk.sunAzimuth;
    const sunCol = sunColorForElevation(s.elevation, u['uSunColor']!.value as THREE.Color);
    u['uSunDisc']!.value = THREE.MathUtils.smoothstep(elDeg, -1.5, 1.0);
    // Lune : opposée au soleil, inclinée, phase fixe (gibbeuse).
    this.moonDir.copy(s.direction).multiplyScalar(-1);
    this.moonDir.y = Math.abs(this.moonDir.y) * 0.8 + 0.25;
    this.moonDir.normalize();
    (u['uMoonDir']!.value as THREE.Vector3).copy(this.moonDir);
    u['uMoonPhase']!.value = 0.38;

    // Lumière directionnelle : soleil le jour, lune la nuit.
    const sun = this.o.sun;
    const sunUp = THREE.MathUtils.smoothstep(elDeg, -1, 8);
    if (elDeg > -2) {
      sun.color.copy(sunCol);
      sun.intensity = 3.1 * sunUp + 0.02;
      this.lightDir.copy(s.direction);
    } else {
      sun.color.setRGB(0.55, 0.65, 0.95);
      sun.intensity = 0.28 * night;
      this.lightDir.copy(this.moonDir);
    }
    // Météo : les nuages voilent le soleil (lumière directe et ombres), la lumière diffuse augmente un peu.
    const w = this.weather;
    const overcast = THREE.MathUtils.smoothstep(w.cloud, 0.35, 0.98);
    const precip = Math.min(1, w.rain + w.snow);
    this.sunVisibility = (1 - 0.9 * overcast) * (1 - 0.35 * w.fog);
    sun.intensity *= this.sunVisibility;
    this.sunBase = sun.intensity;
    // Hémisphère : ciel / sol selon l'heure.
    const hemi = this.o.hemi;
    hemi.color.setRGB(0.62 * dayW + 0.75 * duskW + 0.12 * night, 0.72 * dayW + 0.55 * duskW + 0.16 * night, 0.9 * dayW + 0.5 * duskW + 0.3 * night);
    if (overcast > 0) {
      const l = (hemi.color.r + hemi.color.g + hemi.color.b) / 3;
      hemi.color.lerp(tmpColor.setRGB(l * 0.95, l * 1.0, l * 1.08), overcast * 0.8);
    }
    hemi.groundColor.setRGB(0.32, 0.28, 0.22).multiplyScalar(0.2 + 0.8 * dayW + 0.3 * duskW);
    hemi.intensity = (0.25 + 0.2 * dayW) * (1 + 0.9 * overcast * (dayW + duskW * 0.5)) * (1 - 0.15 * precip);
    this.hemiBase = hemi.intensity;
    // Brouillard : couleur de l'horizon du ciel affiché.
    const fc = this.fogColor.set(0, 0, 0)
      .add(tmpColor.copy(this.day.horizon).multiplyScalar(dayW))
      .add(tmpColor.copy(this.dusk.horizon).multiplyScalar(duskW * (1 - night * 0.85)))
      .add(tmpColor.setRGB(0.02, 0.03, 0.06).multiplyScalar(night));
    // Luminance bornée : un brouillard trop clair délave le paysage.
    let lum = fc.r * 0.2126 + fc.g * 0.7152 + fc.b * 0.0722;
    // Temps gris : brouillard désaturé, plus sombre sous la pluie, laiteux dans le brouillard.
    const grey = Math.max(overcast * 0.85, w.fog);
    if (grey > 0) {
      const g = lum * (1 - 0.3 * precip * overcast) * (1 + 0.25 * w.fog * (dayW + duskW));
      fc.lerp(tmpColor.setRGB(g * 0.97, g * 1.0, g * 1.04), grey);
      lum = fc.r * 0.2126 + fc.g * 0.7152 + fc.b * 0.0722;
    }
    if (lum > 0.9) fc.multiplyScalar(0.9 / lum);
    this.fog.color.copy(fc);
    (u['uFogColor']!.value as THREE.Color).copy(fc);
    // Éclairement ambiant approché (ciel / sol) pour les shaders sans IBL (imposteurs d'arbres).
    this.ambientSky.set(0, 0, 0).add(tmpColor.copy(this.day.zenith).lerp(this.day.horizon, 0.5).multiplyScalar(dayW))
      .add(tmpColor.copy(this.dusk.zenith).lerp(this.dusk.horizon, 0.5).multiplyScalar(duskW * (1 - night * 0.85)))
      .add(tmpColor.setRGB(0.01, 0.015, 0.03).multiplyScalar(night));
    this.ambientGround.copy(this.ambientSky).multiplyScalar(0.35);
    // Densité : brouillard météo (visibilité réduite mais ville lisible), pluie et neige épaississent l'air.
    this.fog.density = this.fogDensity * (1 + duskW * 0.6 + night * 0.3) * (1 + overcast * 0.5)
      + 0.0042 * Math.pow(w.fog, 1.4) + 0.0009 * w.rain + 0.0016 * w.snow;
    // Nuages : couverture, assombrissement, éclairage (ambiance du ciel + soleil, grisé par la pluie).
    u['uCloud']!.value = w.cloud;
    u['uCloudDark']!.value = Math.min(1, precip * 1.1 + w.storm * 0.4);
    const cl = u['uCloudLight']!.value as THREE.Color;
    const amb = this.ambientSky;
    const al = (amb.r + amb.g + amb.b) / 3;
    cl.setRGB(al, al, al * 1.04).multiplyScalar(1.5).add(tmpColor.copy(sunCol).multiplyScalar(0.55 * sunUp * (1 - 0.7 * overcast) + 0.25 * duskW));
    u['uGlow']!.value = duskW * (1 - 0.8 * overcast) * (1 - night);
    // Exposition : plus forte la nuit pour garder une lecture de la ville.
    this.o.renderer.toneMappingExposure = this.baseExposure * (1 + night * 1.2 + duskW * 0.25);
    // Environnement (PMREM) recalculé si l'heure a sensiblement changé.
    const wk = `${Math.round(w.cloud * 12)}|${Math.round(precip * 6)}|${Math.round(w.fog * 6)}`;
    if (Math.abs(this.envHour - h) > 0.2 || this.envRT === null || wk !== this.envWeatherKey) {
      this.envWeatherKey = wk;
      this.refreshEnvironment();
    }
    this.placeSun();
  }

  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private readonly focus = new THREE.Vector3();
  private readonly sRight = new THREE.Vector3();
  private readonly sUp = new THREE.Vector3();
  private readonly sSnap = new THREE.Vector3();

  private refreshEnvironment(): void {
    this.envHour = this.hour;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    old?.dispose();
    this.o.scene.environment = this.envRT.texture;
    this.o.scene.environmentIntensity = 1.0;
  }

  /**
   * Cadre la boîte d'ombre sur la zone regardée : centre = cible de la caméra, demi-taille selon la
   * distance caméra-cible, déplacement aligné sur la taille d'un texel (pas de scintillement).
   */
  followView(targetX: number, targetY: number, targetZ: number, viewDistance: number): void {
    this.focus.set(targetX, targetY, targetZ);
    this.shadowHalf = THREE.MathUtils.clamp(viewDistance * 0.85, 45, 700);
    this.placeSun();
  }

  private placeSun(): void {
    const sun = this.o.sun;
    const half = this.shadowHalf;
    const cam = sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1;
    cam.far = 3000;
    cam.updateProjectionMatrix();
    // Alignement texel : on arrondit la cible dans le repère de la lumière.
    const texel = (2 * half) / sun.shadow.mapSize.x;
    const d = this.lightDir;
    const up = Math.abs(d.y) > 0.99 ? V_X : V_Y;
    const right = this.sRight.crossVectors(up, d).normalize();
    const upL = this.sUp.crossVectors(d, right).normalize();
    const f = this.focus;
    const a = Math.round(f.dot(right) / texel) * texel;
    const b = Math.round(f.dot(upL) / texel) * texel;
    const c = f.dot(d);
    const snapped = this.sSnap.set(0, 0, 0).addScaledVector(right, a).addScaledVector(upL, b).addScaledVector(d, c);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(d, 1500);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.bias = -0.00015 - 0.0000006 * half;
    sun.shadow.normalBias = 0.25 + half / 900;
  }

  /** À appeler chaque image : dôme centré sur la caméra, scintillement des étoiles. */
  update(dt: number, camera: THREE.Camera): void {
    this.elapsed += dt;
    this.uniforms['uTime']!.value = this.elapsed;
    // Dérive des nuages avec le vent (vers où il souffle), éclairs d'orage.
    const w = this.weather;
    const drift = (0.004 + w.wind * 0.0016) * dt;
    this.cloudOffset.x -= Math.sin(w.windDir) * drift;
    this.cloudOffset.y += Math.cos(w.windDir) * drift;
    (this.uniforms['uCloudOffset']!.value as THREE.Vector2).copy(this.cloudOffset);
    this.updateLightning(dt);
    this.dome.position.copy(camera.position);
    this.dome.updateMatrixWorld();
  }

  /** Éclairs : intervalles aléatoires selon l'activité orageuse, double flash bref, lumière d'ambiance accrue. */
  private updateLightning(dt: number): void {
    const storm = this.weather.storm;
    if (storm > 0.15) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.flash = 0.7 + 0.3 * this.strikeRnd();
        this.nextStrike = (2 + this.strikeRnd() * 9) / (0.4 + storm);
      }
    }
    if (this.flash <= 0.001 && this.uniforms['uFlash']!.value === 0) return;
    // Décroissance rapide avec un rebond (scintillement typique d'un éclair).
    this.flash = Math.max(0, this.flash - dt * 4.5);
    const f = this.flash > 0.3 && this.flash < 0.45 ? this.flash * 0.3 : this.flash;
    this.uniforms['uFlash']!.value = f;
    this.o.hemi.intensity = this.hemiBase + f * 2.2;
    this.o.sun.intensity = this.sunBase;
  }

  /** Déclenche un éclair immédiat (captures, démonstration). */
  strike(power = 1): void { this.flash = power; }

  dispose(): void {
    if (activeSky === this) activeSky = null;
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.day.texture.dispose();
    this.dusk.texture.dispose();
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.dome.removeFromParent();
  }
}
