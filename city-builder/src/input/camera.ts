/**
 * Contrôleur de caméra (implémente ICameraController).
 *
 * AÉRIEN (orbite autour d'un point au sol, de ~2 000 m à ~8 m) :
 *   souris   : glisser gauche = saisir et déplacer le sol (outil Sélection) ; glisser droit ou
 *              milieu (ou Maj + glisser gauche) = pivoter / incliner ; molette = zoom VERS LE CURSEUR ;
 *              Maj + molette = pivoter ; glissement au bord de l'écran (option, désactivé par défaut) ;
 *   pavé tactile (PC portable) : deux doigts = déplacer la carte dans les deux axes (proportionnel à l'altitude,
 *              amorti comme le reste) ; pincer = zoom vers le curseur (Ctrl + molette sous Chrome/Edge,
 *              `gesturechange` sous Safari, torsion = pivoter) ; Maj ou Alt + deux doigts = pivoter
 *              (horizontal) / incliner (vertical) ; clic-glissé à un doigt = comme le clic gauche de la souris.
 *              Détection pavé tactile / molette : `WheelClassifier` (deltas fractionnaires, deltaX, rythme, crans
 *              de ~100 px, deltaMode), décision « collante » le temps d'une session de défilement ; réglage
 *              Options › Navigation « Auto / Pavé tactile / Souris » (`inputPref`).
 *   clavier  : ZQSD (AZERTY) / WASD (QWERTY) = déplacer ; A/E (AZERTY, Q/E en QWERTY) ou ←/→ = pivoter ;
 *              R/F, Page↑/Page↓ ou ↑/↓ = incliner ; +/- = zoom ; T = vue de dessus ; N = nord en haut ;
 *              H = retour au point de départ ; C = mode cinématique (orbite lente) ;
 *   à l'écran : boutons pivoter ↺ ↻ et incliner ▲ ▼ près de la boussole (`rotateBy`, `tiltBy`), boussole = nord ;
 *   tactile  : 1 doigt = outil (ou déplacement avec l'outil Sélection) ; 2 doigts = déplacement
 *              du point milieu dans tous les sens + pincer (zoom vers le milieu) + torsion (rotation), quel que
 *              soit l'outil ; inclinaison = 2 doigts posés immobiles ~0,35 s puis glissés verticalement ensemble.
 *   L'inclinaison suit automatiquement le zoom (vue plongeante de loin, rasante de près) ;
 *   le joueur garde un décalage personnel. Toutes les commandes visent une pose « but » que la
 *   caméra rejoint avec un amortissement exponentiel. Bornes de carte, distance et altitude
 *   minimale au-dessus du relief respectées ; la cible suit le relief.
 *
 * RUE (piéton, yeux à 1,7 m) : ZQSD/WASD/flèches = marcher (Maj = courir), glisser = regarder,
 *   molette = avancer ; tactile : 1 doigt = regarder, 2 doigts = avancer / pas latéral / tourner.
 *   Collision avec les bâtiments via `isBlocked` (fourni par le câblage, miroir de la simulation).
 *
 * Les gestes « primaires » (clic gauche, un doigt) sont délégués aux outils via `PointerToolSink`
 * quand l'outil actif en a besoin (route, bâtiment, bulldozer) ; un clic sans glisser est
 * transmis comme « tap » (sélection).
 * Propriétaire : agent construction/caméra/UI.
 */
import * as THREE from 'three';
import type { CameraMode, CameraPose, ICameraController } from '../shared/contracts';
import { clamp } from '../shared/math';
import { angleDelta, rayTerrain, type Ray } from '../client/tools/geometry';

export interface CameraBounds { minX: number; minZ: number; maxX: number; maxZ: number }

/** Ce que la caméra transmet aux outils (coordonnées écran relatives au canvas, en px CSS). */
export interface PointerToolSink {
  /** Vrai si l'outil actif utilise le geste primaire (sinon : déplacement de caméra + tap). */
  capturesPrimary(pointerType: string): boolean;
  hover(sx: number, sy: number, pointerType: string): void;
  down(sx: number, sy: number, pointerType: string): void;
  move(sx: number, sy: number, pointerType: string): void;
  /** Fin du geste ; `tap` = relâché sans glisser notable. */
  up(sx: number, sy: number, pointerType: string, tap: boolean): void;
  /** Geste interrompu (deuxième doigt posé, perte du pointeur). */
  cancel(): void;
  /** Clic droit sans glisser. */
  secondary(): void;
  /**
   * Facultatif : vrai si l'outil veut CE geste (au doigt, l'outil Bâtiment ne prend un doigt que près du bâtiment
   * à poser ; ailleurs, le doigt déplace la carte et un simple tap y déplace le bâtiment).
   */
  capturesAt?(sx: number, sy: number, pointerType: string): boolean;
}

export const EYE_HEIGHT = 1.7;
export const MIN_DISTANCE = 8;
export const MAX_DISTANCE = 2000;
const MIN_PITCH = 0.06;
const MAX_PITCH = 1.54;
const TAP_SLOP_PX = 6;

/** Inclinaison automatique en fonction de la distance : rasante à 8 m, plongeante à 2 000 m. */
export function autoPitch(distance: number): number {
  const t = clamp((Math.log(distance) - Math.log(MIN_DISTANCE)) / (Math.log(MAX_DISTANCE) - Math.log(MIN_DISTANCE)), 0, 1);
  const s = t * t * (3 - 2 * t);
  return 0.2 + s * (1.12 - 0.2);
}

/** Durée (ms) pendant laquelle deux doigts doivent rester posés immobiles avant un glisser vertical = inclinaison. */
export const TILT_HOLD_MS = 350;

/**
 * Geste à deux doigts : « tilt » seulement si les doigts sont restés immobiles `TILT_HOLD_MS` puis glissent
 * verticalement ensemble (écart et angle quasi constants) ; sinon « free » (déplacement + pincer + torsion).
 */
export function classifyTwoFinger(acc: { mx: number; my: number; d: number; a: number }, heldMs: number): 'tilt' | 'free' {
  const vertical = Math.abs(acc.my) > 2 * Math.abs(acc.mx) && Math.abs(acc.d) < 0.3 * Math.abs(acc.my) && Math.abs(acc.a) < 0.06;
  return vertical && heldMs >= TILT_HOLD_MS ? 'tilt' : 'free';
}

/** Amortissement exponentiel indépendant de la fréquence d'images. */
export function damp(current: number, goal: number, lambda: number, dt: number): number {
  return goal + (current - goal) * Math.exp(-lambda * dt);
}

/* ------------------------- Pavé tactile ou molette ? ------------------------- */

/** Périphérique à l'origine des événements `wheel`. */
export type WheelDevice = 'touchpad' | 'mouse';
/** Réglage du joueur : détection automatique, ou périphérique imposé. */
export type InputPref = 'auto' | 'touchpad' | 'mouse';
/** Champs utiles d'un `WheelEvent` (`wheelDeltaY` : propriété historique de Chrome / Edge / Safari). */
export interface WheelSample {
  deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey?: boolean; timeStamp: number; wheelDeltaY?: number;
}

/** Au-delà de ce silence (ms) entre deux événements `wheel`, une nouvelle session de défilement commence. */
export const WHEEL_SESSION_GAP_MS = 350;
/** Deux événements à petits deltas plus rapprochés que ceci (ms) : rythme d'un pavé tactile (≈ 60 à 120 Hz). */
const TOUCHPAD_RHYTHM_MS = 30;
/** Un cran de molette fait ~100 px (×1,25 / ×1,5 selon la mise à l'échelle de Windows) : au-delà, « cran ». */
const NOTCH_MIN = 50;

const isFrac = (v: number): boolean => Math.abs(v - Math.round(v)) > 0.01;

/**
 * Indice porté par UN événement (sans contexte) : 'touchpad', 'mouse' ou null (ambigu : petit delta entier).
 *  - deltaMode 1 (lignes) / 2 (pages) : molette (Firefox) ;
 *  - Ctrl + petits deltas fractionnaires : pincement du pavé tactile (Chrome / Edge) ;
 *  - wheelDeltaY = −3 × deltaY : pavé tactile de Mac (Safari, Chrome) ;
 *  - wheelDeltaY multiple de 120 : cran de molette (Chrome / Edge / Safari) ;
 *  - deltaX non nul (sans Maj, qui transforme la molette en défilement horizontal) : deux doigts ;
 *  - petit delta fractionnaire : pavé tactile de précision (Windows, densité 1,25 / 1,5) ;
 *  - grand delta vertical seul (≥ 50 px) : cran de molette.
 */
export function wheelEvidence(e: WheelSample): WheelDevice | null {
  if (e.deltaMode !== 0) return 'mouse';
  const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
  const wy = e.wheelDeltaY ?? 0;
  if (e.ctrlKey) return ay < NOTCH_MIN && (isFrac(e.deltaY) || ay < 10) ? 'touchpad' : ay >= NOTCH_MIN ? 'mouse' : null;
  if (wy !== 0 && e.deltaY !== 0 && Math.abs(wy + 3 * e.deltaY) < 0.5) return 'touchpad';
  if (wy !== 0 && Math.abs(wy) >= 120 && wy % 120 === 0 && ax === 0) return 'mouse';
  if (ax > 0 && !e.shiftKey && (ax < NOTCH_MIN || isFrac(e.deltaX))) return 'touchpad';
  if (ay > 0 && ay < NOTCH_MIN && isFrac(e.deltaY)) return 'touchpad';
  if (ay >= NOTCH_MIN && ax === 0) return 'mouse';
  return null;
}

/**
 * Classement des événements `wheel` en pavé tactile ou molette, « collant » le temps d'une session de défilement
 * (événements séparés de moins de `WHEEL_SESSION_GAP_MS`) : une fois le pavé tactile reconnu, la fin d'un geste
 * (élan, delta isolé plus grand) reste un déplacement. Une session commencée comme « molette » passe au pavé tactile
 * sur un indice net (deltaX, fractions, rythme) ; jamais l'inverse. Un événement ambigu en début de session suit
 * la décision de la session précédente (sinon : molette, dont l'effet d'un petit delta est négligeable).
 */
export class WheelClassifier {
  /** Décision de la session en cours (null : pas encore d'indice). */
  session: WheelDevice | null = null;
  /** Dernière décision prise (toutes sessions confondues), null avant le premier indice. */
  last: WheelDevice | null = null;
  private lastT = -Infinity;
  private lastSmall = false;

  classify(e: WheelSample): WheelDevice {
    const gap = e.timeStamp - this.lastT;
    if (!(gap >= 0 && gap <= WHEEL_SESSION_GAP_MS)) { this.session = null; this.lastSmall = false; }
    this.lastT = e.timeStamp;
    const ay = Math.abs(e.deltaY);
    const small = ay < NOTCH_MIN && Math.abs(e.deltaX) < NOTCH_MIN;
    let ev = wheelEvidence(e);
    // Rythme : petits deltas entiers très rapprochés (pavé tactile à densité 1, Chrome sur Mac).
    if (ev === null && small && this.lastSmall && gap <= TOUCHPAD_RHYTHM_MS && !e.ctrlKey) ev = 'touchpad';
    this.lastSmall = small && !e.ctrlKey;
    if (ev === 'touchpad') this.session = 'touchpad';
    else if (ev === 'mouse' && this.session === null) this.session = 'mouse';
    if (this.session) this.last = this.session;
    return this.session ?? this.last ?? 'mouse';
  }

  /** Geste de Safari (gesturestart/gesturechange) : c'est forcément un pavé tactile. */
  markTouchpad(t: number): void { this.session = 'touchpad'; this.last = 'touchpad'; this.lastT = t; }
}

/** Marge (px CSS) du bord de la fenêtre qui fait glisser la carte quand l'option est activée. */
export const EDGE_SCROLL_PX = 14;

interface Pose { tx: number; ty: number; tz: number; dist: number; yaw: number; pitchOffset: number }
type Gesture = 'none' | 'tool' | 'pan' | 'pan-pending' | 'orbit' | 'orbit-pending' | 'look' | 'pinch';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();

export class CameraController implements ICameraController {
  mode: CameraMode = 'aerial';
  /** Pose visée (les commandes l'écrivent) et pose courante (amortie). */
  private goal: Pose = { tx: 0, ty: 0, tz: 0, dist: 520, yaw: 0.6, pitchOffset: 0 };
  private cur: Pose = { ...this.goal };
  private home: Pose = { ...this.goal };
  /** Mode rue : position et orientation propres (amorties elles aussi). */
  private street = { x: 0, z: 0, yaw: 0, pitch: -0.05, gx: 0, gz: 0, gyaw: 0, gpitch: -0.05, y: 0 };
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; button: number; type: string }>();
  private gesture: Gesture = 'none';
  private lastPinch = { dist: 0, angle: 0, midX: 0, midY: 0 };
  private disposers: (() => void)[] = [];
  bounds: CameraBounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
  /** Compatibilité fondation : le déplacement au glisser gauche est désormais décidé par `toolSink`. */
  leftDragPans = true;
  /** Outils (facultatif) : reçoivent survol, clics, taps. */
  toolSink: PointerToolSink | null = null;
  /** Mode rue : vrai si le point est dans un bâtiment (collision). */
  isBlocked: ((x: number, z: number) => boolean) | null = null;
  /** Mode cinématique : orbite lente, interrompue par toute action du joueur. */
  cinematic = false;
  /** Distance d'affichage (m) : plan lointain (option graphique). */
  viewDistance = 4500;
  /** Raideur de l'amortissement (1/s). */
  smoothing = 9;
  private streetPreset = false;
  private pinchDirty = false;
  private pinchMode: 'undecided' | 'tilt' | 'free' = 'undecided';
  private pinchAcc = { mx: 0, my: 0, d: 0, a: 0 };
  private onModeChange: ((m: CameraMode) => void) | null = null;
  private onCinematic: ((on: boolean) => void) | null = null;
  /** Réglage « Navigation » des options : détection automatique ou périphérique imposé. */
  inputPref: InputPref = 'auto';
  /** Glissement de la carte quand le curseur de la souris touche le bord de la fenêtre (option, désactivé par défaut). */
  edgeScroll = false;
  /** Classement des événements `wheel` (pavé tactile / molette). */
  readonly wheelKind = new WheelClassifier();
  /** Dernier périphérique utilisé pour naviguer (fiche des contrôles) ; null tant que rien n'a été détecté. */
  private lastDevice: WheelDevice | 'touch' | null = null;
  /** Dernière position du curseur de la souris (glissement au bord) ; `over` : au-dessus de la vue 3D. */
  private mouse = { x: 0, y: 0, over: false };
  /** Pincement / torsion Safari (gesturechange) : échelle et rotation précédentes. */
  private gestureLast: { scale: number; rotation: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private heightAt: (x: number, z: number) => number) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(dom, 'contextmenu', (e) => e.preventDefault());
    // Page intégrée (cadre) : le clavier n'arrive au jeu qu'une fois le cadre actif. On le rend actif au chargement,
    // au survol et au clic de la vue 3D (flèches / ZQSD utilisables sans clic préalable). Sans effet hors navigateur.
    const grabFocus = (): void => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return;
      try { window.focus(); } catch { /* cadre refusant le focus */ }
    };
    grabFocus();
    on(dom, 'pointerenter', grabFocus);
    on(dom, 'pointerdown', (e) => { grabFocus(); this.pointerDown(e); });
    on(window, 'pointermove', (e) => this.pointerMove(e));
    on(window, 'pointerup', (e) => this.pointerUp(e));
    on(window, 'pointercancel', (e) => this.pointerUp(e, true));
    on(dom, 'wheel', (e) => this.wheel(e), { passive: false });
    // Pincement du pavé tactile au-dessus de l'interface (Ctrl + molette synthétique de Chrome / Edge) : jamais de
    // zoom de la PAGE (l'interface se décalerait). Le défilement ordinaire des panneaux n'est pas touché, et ne
    // déplace jamais la caméra (écouteur `wheel` posé sur la vue 3D seule, les panneaux n'en sont pas les enfants).
    on(window, 'wheel', (e) => { if (e.ctrlKey && e.target !== dom) e.preventDefault(); }, { passive: false });
    // Safari (Mac) : le pincement du pavé tactile arrive en gesturestart / gesturechange (échelle, rotation).
    // Sur iPhone, ces événements accompagnent les doigts déjà suivis par les pointeurs : ignorés dans ce cas.
    const gStart = (e: Event): void => { e.preventDefault(); this.gestureLast = this.pointers.size ? null : { scale: 1, rotation: 0 }; };
    const gChange = (e: Event): void => { e.preventDefault(); this.gesture3(e as Event & { scale?: number; rotation?: number; clientX?: number; clientY?: number }); };
    const gEnd = (): void => { this.gestureLast = null; };
    dom.addEventListener('gesturestart', gStart);
    dom.addEventListener('gesturechange', gChange);
    dom.addEventListener('gestureend', gEnd);
    this.disposers.push(() => { dom.removeEventListener('gesturestart', gStart); dom.removeEventListener('gesturechange', gChange); dom.removeEventListener('gestureend', gEnd); });
    // Glissement au bord : le curseur quitte la fenêtre → plus de glissement.
    on(window, 'mouseout', (e) => { if (!e.relatedTarget) this.mouse.over = false; });
    on(window, 'keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      this.quickKey(e.code);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    // Perte du focus (changement d'appli en plein geste, appel entrant, onglet masqué) : le geste en cours est
    // abandonné ET l'outil prévenu (sinon le pinceau de terrain continuerait de peindre sans doigt posé).
    on(window, 'blur', () => this.abortGestures());
    const onVisibility = (): void => { if (document.hidden) this.abortGestures(); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
      this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }
    dom.style.touchAction = 'none';
  }

  /** Abandonne tout geste en cours (touches, pointeurs) ; un geste d'outil est annulé côté outil. */
  abortGestures(): void {
    const wasTool = this.gesture === 'tool';
    this.keys.clear();
    this.pointers.clear();
    this.gesture = 'none';
    this.pinchDirty = false;
    this.flingV = null;
    this.mouse.over = false;
    this.gestureLast = null;
    if (wasTool) this.toolSink?.cancel();
  }

  /** Périphérique de navigation détecté en dernier (fiche des contrôles) : pavé tactile, souris, écran tactile. */
  get detectedInput(): WheelDevice | 'touch' | null { return this.lastDevice; }

  /** Pivote la vue (rad, sens de la touche A / Q) : boutons à l'écran. */
  rotateBy(rad: number): void {
    this.stopCinematic();
    if (this.mode === 'street') this.street.gyaw += rad; else this.goal.yaw += rad;
  }

  /** Incline la vue (rad ; positif = plus plongeante, sens de la touche R) : boutons à l'écran. */
  tiltBy(rad: number): void {
    this.stopCinematic();
    if (this.mode === 'street') this.street.gpitch = clamp(this.street.gpitch - rad, -1.2, 1.2);
    else this.goal.pitchOffset = this.clampOffset(this.goal.pitchOffset + rad);
  }

  setModeListener(fn: (m: CameraMode) => void): void { this.onModeChange = fn; }
  setCinematicListener(fn: (on: boolean) => void): void { this.onCinematic = fn; }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.stopCinematic();
    if (mode === 'street') {
      const s = this.street;
      if (!this.streetPreset) {
        s.x = s.gx = this.cur.tx;
        s.z = s.gz = this.cur.tz;
        s.yaw = s.gyaw = this.cur.yaw;
      }
      this.streetPreset = false;
      s.pitch = s.gpitch = -0.05;
      s.y = 0;
      // Ne pas apparaître dans un bâtiment : on cherche un point libre en spirale.
      if (this.isBlocked?.(s.x, s.z)) {
        for (let r = 4; r < 80; r += 4) {
          let found = false;
          for (let a = 0; a < 8 && !found; a++) {
            const x = s.x + Math.cos((a * Math.PI) / 4) * r;
            const z = s.z + Math.sin((a * Math.PI) / 4) * r;
            if (!this.isBlocked(x, z)) { s.x = s.gx = x; s.z = s.gz = z; found = true; }
          }
          if (found) break;
        }
      }
    } else {
      this.goal.tx = this.cur.tx = this.street.x;
      this.goal.tz = this.cur.tz = this.street.z;
      this.goal.yaw = this.cur.yaw = this.street.yaw;
    }
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  /** Pose courante (contrat neutre). `pitch` = inclinaison effective. */
  /** Point du monde -> pixels dans l'élément (null s'il est derrière la caméra). */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * (this.dom.clientWidth || 1), y: (1 - v.y) / 2 * (this.dom.clientHeight || 1) };
  }

  /** Distance visée (diagnostic e2e : la pose courante n'avance qu'avec la boucle de rendu). */
  goalDistance(): number { return this.goal.dist; }

  getPose(): CameraPose {
    const c = this.cur;
    return { targetX: c.tx, targetY: c.ty, targetZ: c.tz, distance: c.dist, yaw: c.yaw, pitch: this.pitchOf(c) };
  }

  /** Téléportation (but et pose courante). */
  setPose(p: Partial<CameraPose>): void {
    this.applyPose(this.goal, p);
    this.applyPose(this.cur, p);
  }

  /** Déplacement amorti vers une pose. */
  flyTo(p: Partial<CameraPose>): void { this.applyPose(this.goal, p); }

  /** Mémorise la pose de départ (touche H). */
  setHome(p?: Partial<CameraPose>): void {
    if (p) this.applyPose(this.home, p); else this.home = { ...this.goal };
  }

  private applyPose(o: Pose, p: Partial<CameraPose>): void {
    if (p.targetX !== undefined) o.tx = p.targetX;
    if (p.targetY !== undefined) o.ty = p.targetY;
    if (p.targetZ !== undefined) o.tz = p.targetZ;
    if (p.distance !== undefined) o.dist = clamp(p.distance, MIN_DISTANCE, MAX_DISTANCE);
    if (p.yaw !== undefined) o.yaw = p.yaw;
    if (p.pitch !== undefined) o.pitchOffset = p.pitch - autoPitch(o.dist);
  }

  /** Position piéton imposée (utilisée au prochain passage en vue rue au lieu du centre de vue). */
  setStreetPosition(x: number, z: number, yaw: number): void {
    const s = this.street;
    this.streetPreset = this.mode !== 'street';
    s.x = s.gx = x; s.z = s.gz = z; s.yaw = s.gyaw = yaw;
  }

  private pitchOf(p: Pose): number { return clamp(autoPitch(p.dist) + p.pitchOffset, MIN_PITCH, MAX_PITCH); }

  /* ------------------------------ Vues rapides ------------------------------ */

  setView(v: 'top' | 'north' | 'home' | 'oblique'): void {
    this.stopCinematic();
    if (this.mode === 'street') this.setMode('aerial');
    const g = this.goal;
    if (v === 'top') g.pitchOffset = MAX_PITCH - 0.02 - autoPitch(g.dist);
    else if (v === 'north') g.yaw = Math.round(g.yaw / (2 * Math.PI)) * 2 * Math.PI;
    else if (v === 'oblique') g.pitchOffset = 0;
    else { g.tx = this.home.tx; g.tz = this.home.tz; g.dist = this.home.dist; g.yaw = this.cur.yaw + angleDelta(this.cur.yaw, this.home.yaw); g.pitchOffset = this.home.pitchOffset; }
  }

  toggleCinematic(): void { if (this.cinematic) this.stopCinematic(); else this.startCinematic(); }

  startCinematic(): void {
    if (this.mode === 'street') this.setMode('aerial');
    this.cinematic = true;
    this.onCinematic?.(true);
  }

  stopCinematic(): void {
    if (!this.cinematic) return;
    this.cinematic = false;
    this.onCinematic?.(false);
  }

  private quickKey(code: string): void {
    switch (code) {
      case 'KeyT': this.setView('top'); break;
      case 'KeyN': this.setView('north'); break;
      case 'KeyH': case 'Home': this.setView('home'); break;
      case 'KeyC': this.toggleCinematic(); break;
      default: break;
    }
  }

  /* ------------------------------ Pointeurs ------------------------------ */

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.dom.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Rayon caméra passant par un point écran (px CSS relatifs au canvas). */
  screenRay(sx: number, sy: number, out?: Ray): Ray {
    const w = this.dom.clientWidth || 1;
    const h = this.dom.clientHeight || 1;
    _ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    this.camera.updateMatrixWorld();
    _ray.setFromCamera(_ndc, this.camera);
    const o = out ?? { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    o.ox = _ray.ray.origin.x; o.oy = _ray.ray.origin.y; o.oz = _ray.ray.origin.z;
    o.dx = _ray.ray.direction.x; o.dy = _ray.ray.direction.y; o.dz = _ray.ray.direction.z;
    return o;
  }

  /** Point du terrain sous un point écran, ou null (ciel). */
  groundAt(sx: number, sy: number): { x: number; y: number; z: number } | null {
    return rayTerrain(this.screenRay(sx, sy), this.heightAt, 9000);
  }

  /** Intersection avec le plan horizontal y = h (pour un déplacement stable par saisie). */
  private planeAt(sx: number, sy: number, h: number): { x: number; z: number } | null {
    const r = this.screenRay(sx, sy);
    if (r.dy > -1e-3) return null;
    const t = (h - r.oy) / r.dy;
    if (t < 0 || t > this.cur.dist * 8 + 500) return null;
    return { x: r.ox + r.dx * t, z: r.oz + r.dz * t };
  }

  private pointerDown(e: PointerEvent): void {
    this.dom.setPointerCapture?.(e.pointerId);
    const [sx, sy] = this.local(e);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx, sy, button: e.button, type: e.pointerType });
    this.stopCinematic();
    if (e.pointerType === 'touch') this.lastDevice = 'touch';
    if (this.pointers.size === 1) {
      if (this.mode === 'street') { this.gesture = 'look'; return; }
      if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1)) { this.gesture = e.button === 2 ? 'orbit-pending' : 'orbit'; return; }
      if (e.pointerType === 'mouse' && e.shiftKey && !this.toolSink?.capturesPrimary('mouse')) { this.gesture = 'orbit'; return; }
      this.flingV = null;
      // Deuxième tap rapide au même endroit : réservé au double tap (zoom), même pendant un outil.
      const secondTap = e.pointerType === 'touch' && performance.now() - this.lastTap.t < 320 && Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 40;
      if (!secondTap && this.toolSink?.capturesPrimary(e.pointerType) && (this.toolSink.capturesAt?.(sx, sy, e.pointerType) ?? true)) { this.gesture = 'tool'; this.toolSink.down(sx, sy, e.pointerType); return; }
      this.gesture = 'pan-pending';
    } else if (this.pointers.size === 2) {
      if (this.gesture === 'tool') this.toolSink?.cancel();
      this.gesture = 'pinch';
      this.pinchStart = performance.now();
      this.pinchTravel = 0;
      this.resetPinch();
    }
  }

  /* -------- Gestes tactiles d'appoint : double tap (zoom), tap à deux doigts (dézoom), élan du glissé -------- */
  private lastTap = { t: 0, x: 0, y: 0 };
  private pinchStart = 0;
  /** Instant du premier mouvement notable des deux doigts (0 = encore immobiles). */
  private pinchFirstMove = 0;
  private pinchTravel = 0;
  /** Vitesse du glissé à un doigt (px/ms) mesurée sur les derniers mouvements ; élan appliqué au relâcher. */
  private panVel = { vx: 0, vy: 0, t: 0 };
  private flingV: { vx: number; vy: number; x: number; y: number } | null = null;

  private resetPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchMode = 'undecided';
    this.pinchFirstMove = 0;
    this.pinchAcc = { mx: 0, my: 0, d: 0, a: 0 };
    this.pinchDirty = false;
    this.lastPinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    const [sx, sy] = this.local(e);
    if (e.pointerType === 'mouse') { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.over = e.target === this.dom; }
    if (!p) {
      // Survol sans bouton (souris / stylet) : aperçu des outils.
      if (this.pointers.size === 0 && e.target === this.dom) this.toolSink?.hover(sx, sy, e.pointerType);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const psx = p.x; const psy = p.y;
    p.x = e.clientX; p.y = e.clientY;
    const moved = Math.hypot(sx - p.sx, sy - p.sy) > TAP_SLOP_PX;
    const h = this.dom.clientHeight || 800;
    switch (this.gesture) {
      case 'tool': this.toolSink?.move(sx, sy, e.pointerType); break;
      case 'look':
        if (this.pointers.size === 1) {
          this.street.gyaw -= dx * 0.0045;
          this.street.gpitch = clamp(this.street.gpitch - dy * 0.0045, -1.2, 1.2);
        }
        break;
      case 'orbit-pending':
      case 'orbit':
        if (this.gesture === 'orbit-pending') { if (!moved) break; this.gesture = 'orbit'; }
        this.goal.yaw -= dx * 0.006;
        this.goal.pitchOffset = this.clampOffset(this.goal.pitchOffset + dy * 0.005);
        break;
      case 'pan-pending':
      case 'pan': {
        if (this.gesture === 'pan-pending') { if (!moved) break; this.gesture = 'pan'; }
        const r = this.dom.getBoundingClientRect();
        this.panGrab(psx - r.left, psy - r.top, sx, sy, h);
        if (e.pointerType === 'touch') {
          const now = performance.now(), dtm = Math.max(1, now - this.panVel.t);
          const k = Math.min(1, dtm / 60); // moyenne glissante (~60 ms)
          this.panVel = { vx: this.panVel.vx * (1 - k) + (dx / dtm) * k, vy: this.panVel.vy * (1 - k) + (dy / dtm) * k, t: now };
        }
        break;
      }
      case 'pinch': this.pinchDirty = true; this.pinchTravel += Math.hypot(dx, dy); break; // traité une fois par image (les doigts bougent l'un après l'autre)
      default: break;
    }
  }

  private pinchMove(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dMidX = midX - this.lastPinch.midX;
    const dMidY = midY - this.lastPinch.midY;
    const dAngle = angleDelta(this.lastPinch.angle, angle);
    const dDist = dist - this.lastPinch.dist;
    const r = this.dom.getBoundingClientRect();
    if (this.mode === 'aerial') {
      // Classement du geste sur les premiers pixels, puis verrouillé jusqu'au lever des doigts :
      // déplacement (dans tous les sens) + pincer + torsion combinés ; l'inclinaison est un geste distinct
      // (deux doigts posés immobiles un instant, puis glissés verticalement ensemble), pour que le glisser vertical
      // ordinaire à deux doigts déplace la carte.
      const acc = this.pinchAcc;
      acc.mx += dMidX; acc.my += dMidY; acc.d += dDist; acc.a += dAngle;
      if (this.pinchMode === 'undecided') {
        const mag = Math.max(Math.hypot(acc.mx, acc.my), Math.abs(acc.d), Math.abs(acc.a) * 120);
        // Immobilité mesurée jusqu'au premier mouvement notable (un glisser lent reste un déplacement).
        if (!this.pinchFirstMove && mag > 3) this.pinchFirstMove = performance.now();
        if (mag > 10) this.pinchMode = classifyTwoFinger(acc, this.pinchFirstMove - this.pinchStart);
      }
      if (this.pinchMode === 'tilt') {
        this.goal.pitchOffset = this.clampOffset(this.goal.pitchOffset + dMidY * 0.004);
      } else {
        this.panGrab(this.lastPinch.midX - r.left, this.lastPinch.midY - r.top, midX - r.left, midY - r.top, this.dom.clientHeight || 800);
        if (this.lastPinch.dist > 0 && dist > 0) this.zoomAt(midX - r.left, midY - r.top, this.lastPinch.dist / dist);
        this.goal.yaw += dAngle;
      }
    } else {
      this.moveStreet(-dMidY * 0.06, dMidX * 0.06);
      this.street.gyaw += dAngle;
    }
    this.lastPinch = { dist, angle, midX, midY };
  }

  private pointerUp(e: PointerEvent, cancelled = false): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [sx, sy] = this.local(e);
    const tap = !cancelled && Math.hypot(sx - p.sx, sy - p.sy) <= TAP_SLOP_PX;
    // Pincement en attente (pas encore d'image depuis les derniers mouvements : appareil lent, onglet en
    // arrière-plan, rendu suspendu) : appliqué avant de lever le doigt, sinon le geste serait perdu.
    if (this.gesture === 'pinch' && this.pinchDirty && this.pointers.size === 2) { this.pinchDirty = false; this.pinchMove(); }
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      const touch = e.pointerType === 'touch' && this.mode === 'aerial';
      if (touch && this.gesture === 'pan' && !cancelled && performance.now() - this.panVel.t < 80 && Math.hypot(this.panVel.vx, this.panVel.vy) > 0.35) {
        // Élan : la carte continue un peu dans le sens du glissé, puis ralentit.
        this.flingV = { vx: this.panVel.vx, vy: this.panVel.vy, x: sx, y: sy };
      }
      this.panVel = { vx: 0, vy: 0, t: 0 };
      if (touch && this.gesture === 'pan-pending' && tap) {
        const now = performance.now();
        if (now - this.lastTap.t < 320 && Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 40) {
          // Double tap : zoom avant centré sur le point touché (comme dans Plans).
          this.zoomAt(sx, sy, 0.5);
          this.lastTap.t = 0;
          this.gesture = 'none';
          return;
        }
        this.lastTap = { t: now, x: sx, y: sy };
      }
      if (touch && this.gesture === 'tool' && tap) this.lastTap = { t: performance.now(), x: sx, y: sy };
      if (this.gesture === 'tool') { if (cancelled) this.toolSink?.cancel(); else this.toolSink?.up(sx, sy, e.pointerType, tap); }
      else if (this.gesture === 'pan-pending' && tap) this.toolSink?.up(sx, sy, e.pointerType, true);
      else if (this.gesture === 'orbit-pending' && tap) this.toolSink?.secondary();
      this.gesture = 'none';
    } else if (this.pointers.size === 1) {
      // Tap à deux doigts (rapide, presque sans mouvement) : zoom arrière.
      if (this.gesture === 'pinch' && e.pointerType === 'touch' && this.mode === 'aerial' && performance.now() - this.pinchStart < 260 && this.pinchTravel < 24) {
        const o = [...this.pointers.values()][0]!;
        const r = this.dom.getBoundingClientRect();
        this.zoomAt((o.x + p.x) / 2 - r.left, (o.y + p.y) / 2 - r.top, 2);
      }
      // Fin du pincement : on ne reprend pas de geste avec le doigt restant (évite les sauts).
      this.gesture = 'none';
    } else if (this.pointers.size === 2) this.resetPinch();
  }

  /** Périphérique retenu pour un événement `wheel` : réglage imposé, sinon détection (`WheelClassifier`). */
  wheelDevice(e: WheelSample): WheelDevice {
    const detected = this.wheelKind.classify(e);
    this.lastDevice = detected;
    return this.inputPref === 'auto' ? detected : this.inputPref;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.stopCinematic();
    const [sx, sy] = this.local(e);
    const device = this.wheelDevice(e as WheelEvent & { wheelDeltaY?: number });
    // deltaMode 1 = lignes (Firefox) : ~16 px par ligne ; 2 = pages.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (this.dom.clientHeight || 800) : 1;
    const d = e.deltaY * unit;
    const dx = e.deltaX * unit;
    if (this.mode !== 'aerial') {
      // Vue rue : deux doigts = avancer / pas latéral ; molette = avancer (inchangé).
      if (device === 'touchpad' && !e.ctrlKey) this.moveStreet(-d * 0.02, dx * 0.02);
      else this.moveStreet(-d * 0.02, 0);
      return;
    }
    if (e.ctrlKey) {
      // Pincement (Chrome / Edge : Ctrl + petits deltas) ou Ctrl + molette : zoom vers le curseur.
      if (device === 'touchpad' && Math.abs(d) < NOTCH_MIN) this.zoomAt(sx, sy, Math.exp(clamp(d, -40, 40) * 0.012));
      else this.zoomAt(sx, sy, Math.exp(clamp(d, -300, 300) * 0.0015));
      return;
    }
    if (device === 'touchpad') {
      if (e.shiftKey || e.altKey) {
        // Maj / Alt + deux doigts : horizontal = pivoter, vertical = incliner, dans le même sens qu'un glisser du clic
        // droit (doigts vers le bas = vue plus plongeante ; défilement « naturel » : deltaY < 0 quand les doigts
        // descendent). Chrome sous Windows peut convertir Maj + vertical en horizontal : on pivote alors ; Alt l'évite.
        this.goal.yaw += dx * 0.005;
        this.goal.pitchOffset = this.clampOffset(this.goal.pitchOffset - d * 0.004);
        return;
      }
      // Deux doigts : la carte suit les doigts (défilement « naturel »), proportionnellement à l'altitude.
      this.panScreen(-dx, -d);
      return;
    }
    // Molette : Maj + molette = pivoter (Chrome / Firefox transforment Maj + molette en défilement horizontal).
    if (e.shiftKey) { this.goal.yaw += clamp(d || dx, -300, 300) * 0.0025; return; }
    this.zoomAt(sx, sy, Math.exp(clamp(d, -300, 300) * 0.0015));
  }

  /** Pincement / torsion du pavé tactile sous Safari (gesturechange : échelle cumulée, rotation en degrés). */
  private gesture3(e: { scale?: number; rotation?: number; clientX?: number; clientY?: number; timeStamp: number }): void {
    const last = this.gestureLast;
    if (!last || this.pointers.size || typeof e.scale !== 'number' || !(e.scale > 0)) return;
    this.wheelKind.markTouchpad(e.timeStamp);
    this.lastDevice = 'touchpad';
    this.stopCinematic();
    const r = this.dom.getBoundingClientRect();
    const sx = (e.clientX ?? r.left + r.width / 2) - r.left, sy = (e.clientY ?? r.top + r.height / 2) - r.top;
    const rot = typeof e.rotation === 'number' ? e.rotation : 0;
    if (this.mode === 'aerial') {
      this.zoomAt(sx, sy, last.scale / e.scale);
      this.goal.yaw += ((rot - last.rotation) * Math.PI) / 180;
    } else this.moveStreet((e.scale - last.scale) * 30, 0);
    this.gestureLast = { scale: e.scale, rotation: rot };
  }

  /**
   * Déplacement de la carte d'un vecteur écran (px CSS), comme si le sol au centre de la vue était saisi :
   * proportionnel à l'altitude (plan du sol), amorti (seule la pose visée bouge).
   */
  private panScreen(dx: number, dy: number): void {
    const w = this.dom.clientWidth || 2, h = this.dom.clientHeight || 2;
    this.panGrab(w / 2, h / 2, w / 2 + dx, h / 2 + dy, h, false);
  }

  private clampOffset(o: number): number {
    const base = autoPitch(this.goal.dist);
    return clamp(o, MIN_PITCH - base, MAX_PITCH - base);
  }

  /**
   * Zoom vers un point écran : homothétie de centre P (point du sol sous le curseur), ce qui
   * garde P sous le curseur à orientation constante.
   */
  zoomAt(sx: number, sy: number, factor: number): void {
    const g = this.goal;
    const nd = clamp(g.dist * factor, MIN_DISTANCE, MAX_DISTANCE);
    const f = nd / g.dist;
    const p = this.groundAt(sx, sy);
    if (p && Math.hypot(p.x - g.tx, p.z - g.tz) < g.dist * 6) {
      g.tx = p.x + (g.tx - p.x) * f;
      g.tz = p.z + (g.tz - p.z) * f;
      this.clampTarget(g);
    }
    // Conserver l'inclinaison effective relative : le décalage personnel est borné pour la nouvelle distance.
    g.dist = nd;
    g.pitchOffset = this.clampOffset(g.pitchOffset);
  }

  /** Déplacement par « saisie » du sol : le point sous le doigt suit le doigt. */
  private panGrab(sx0: number, sy0: number, sx1: number, sy1: number, h: number, direct = true): void {
    const a = this.planeAt(sx0, sy0, this.cur.ty);
    const b = this.planeAt(sx1, sy1, this.cur.ty);
    let dx: number; let dz: number;
    if (a && b) { dx = a.x - b.x; dz = a.z - b.z; } else {
      // Rayon proche de l'horizon : repli sur un déplacement proportionnel à la distance.
      const s = (this.cur.dist / h) * 1.2;
      const cy = Math.cos(this.goal.yaw); const syw = Math.sin(this.goal.yaw);
      const right = -(sx1 - sx0) * s; const fwd = (sy1 - sy0) * s;
      dx = right * cy - fwd * syw; dz = -right * syw - fwd * cy;
    }
    const lim = this.cur.dist * 0.5 + 20;
    const l = Math.hypot(dx, dz);
    if (l > lim) { dx *= lim / l; dz *= lim / l; }
    this.goal.tx += dx; this.goal.tz += dz;
    this.clampTarget(this.goal);
    if (!direct) return; // pavé tactile : la caméra rejoint la pose visée avec l'amortissement habituel
    this.cur.tx += dx; this.cur.tz += dz; // saisie directe : pas de traînée
    this.clampTarget(this.cur);
  }

  private panLocal(right: number, forward: number): void {
    const cy = Math.cos(this.goal.yaw);
    const sy = Math.sin(this.goal.yaw);
    this.goal.tx += right * cy - forward * sy;
    this.goal.tz += -right * sy - forward * cy;
    this.clampTarget(this.goal);
  }

  private clampTarget(p: Pose): void {
    p.tx = clamp(p.tx, this.bounds.minX, this.bounds.maxX);
    p.tz = clamp(p.tz, this.bounds.minZ, this.bounds.maxZ);
  }

  private moveStreet(forward: number, right: number): void {
    const s = this.street;
    const cy = Math.cos(s.gyaw);
    const sy = Math.sin(s.gyaw);
    const nx = clamp(s.gx + right * cy - forward * sy, this.bounds.minX, this.bounds.maxX);
    const nz = clamp(s.gz - right * sy - forward * cy, this.bounds.minZ, this.bounds.maxZ);
    // Collision : on glisse le long des murs (axes séparés).
    const blocked = this.isBlocked;
    if (!blocked || !blocked(nx, nz)) { s.gx = nx; s.gz = nz; return; }
    if (!blocked(nx, s.gz)) s.gx = nx;
    else if (!blocked(s.gx, nz)) s.gz = nz;
  }

  /* ------------------------------ Image par image ------------------------------ */

  update(dt: number): void {
    if (this.pinchDirty && this.gesture === 'pinch') { this.pinchDirty = false; this.pinchMove(); }
    // Élan du glissé : déplacement décroissant (≈ 0,4 s), interrompu par tout nouveau geste.
    const fv = this.flingV;
    if (fv && this.mode === 'aerial' && this.pointers.size === 0) {
      const ms = Math.min(50, dt * 1000);
      // Glissé appliqué autour du centre de l'écran (point toujours sur le sol).
      const h0 = this.dom.clientHeight || 800, w0 = this.dom.clientWidth || 400;
      this.panGrab(w0 / 2, h0 / 2, w0 / 2 + fv.vx * ms, h0 / 2 + fv.vy * ms, h0);
      const decay = Math.pow(0.9, ms / 16);
      fv.vx *= decay; fv.vy *= decay;
      if (Math.hypot(fv.vx, fv.vy) < 0.02) this.flingV = null;
    }
    const k = this.keys;
    // Flèches : en vue aérienne, ↑/↓ inclinent (comme R/F) et ←/→ pivotent (comme A/E) ; en vue rue, elles font marcher.
    const street = this.mode !== 'aerial';
    const f = (k.has('KeyW') || (street && k.has('ArrowUp')) ? 1 : 0) - (k.has('KeyS') || (street && k.has('ArrowDown')) ? 1 : 0);
    const r = (k.has('KeyD') || (street && k.has('ArrowRight')) ? 1 : 0) - (k.has('KeyA') || (street && k.has('ArrowLeft')) ? 1 : 0);
    const c = this.camera;
    if (this.mode === 'aerial') {
      const g = this.goal;
      const anyKey = f || r || k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight') || k.has('KeyE') || k.has('KeyQ') || k.has('KeyR') || k.has('KeyF') || k.has('PageUp') || k.has('PageDown') || k.has('Equal') || k.has('NumpadAdd') || k.has('Minus') || k.has('NumpadSubtract');
      if (anyKey) this.stopCinematic();
      const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 2.2 : 1;
      const speed = g.dist * 0.9 * dt * fast;
      if (f || r) this.panLocal(r * speed, f * speed);
      // Glissement au bord (option) : curseur de la souris immobile ou non au bord de la fenêtre, au-dessus de la vue 3D,
      // aucun bouton enfoncé ; vitesse croissante vers le bord (même échelle que le clavier).
      const m = this.mouse;
      if (this.edgeScroll && m.over && this.pointers.size === 0 && typeof window !== 'undefined') {
        const W = window.innerWidth, H = window.innerHeight;
        const ramp = (v: number): number => clamp((EDGE_SCROLL_PX - v) / EDGE_SCROLL_PX, 0, 1);
        const er = ramp(W - 1 - m.x) - ramp(m.x);
        const ef = ramp(m.y) - ramp(H - 1 - m.y);
        if (er || ef) { this.stopCinematic(); this.panLocal(er * g.dist * 0.9 * dt, ef * g.dist * 0.9 * dt); }
      }
      if (k.has('KeyE') || k.has('ArrowRight')) g.yaw -= 1.4 * dt;
      if (k.has('KeyQ') || k.has('ArrowLeft')) g.yaw += 1.4 * dt;
      if (k.has('KeyR') || k.has('PageUp') || k.has('ArrowUp')) g.pitchOffset = this.clampOffset(g.pitchOffset + 0.9 * dt);
      if (k.has('KeyF') || k.has('PageDown') || k.has('ArrowDown')) g.pitchOffset = this.clampOffset(g.pitchOffset - 0.9 * dt);
      if (k.has('Equal') || k.has('NumpadAdd')) this.zoomAt((this.dom.clientWidth || 2) / 2, (this.dom.clientHeight || 2) / 2, Math.exp(-dt * 1.6));
      if (k.has('Minus') || k.has('NumpadSubtract')) this.zoomAt((this.dom.clientWidth || 2) / 2, (this.dom.clientHeight || 2) / 2, Math.exp(dt * 1.6));
      if (this.cinematic) g.yaw += 0.07 * dt;
      g.ty = this.heightAt(g.tx, g.tz);

      const cur = this.cur;
      const lam = this.smoothing;
      cur.tx = damp(cur.tx, g.tx, lam, dt);
      cur.tz = damp(cur.tz, g.tz, lam, dt);
      cur.ty = damp(cur.ty, g.ty, lam * 0.7, dt);
      // Zoom en espace logarithmique (vitesse perçue constante).
      cur.dist = Math.exp(damp(Math.log(cur.dist), Math.log(g.dist), lam, dt));
      cur.yaw = cur.yaw + angleDelta(cur.yaw, g.yaw) * (1 - Math.exp(-lam * dt));
      cur.pitchOffset = damp(cur.pitchOffset, g.pitchOffset, lam, dt);

      const pitch = this.pitchOf(cur);
      const cp = Math.cos(pitch);
      c.position.set(
        cur.tx + Math.sin(cur.yaw) * cp * cur.dist,
        cur.ty + Math.sin(pitch) * cur.dist,
        cur.tz + Math.cos(cur.yaw) * cp * cur.dist,
      );
      // Jamais sous le relief : on remonte la caméra (la cible reste en place).
      const ground = this.heightAt(c.position.x, c.position.z) + 1.4;
      if (c.position.y < ground) c.position.y = ground;
      c.lookAt(cur.tx, cur.ty + Math.min(1.6, cur.dist * 0.08), cur.tz);
      c.near = clamp(cur.dist / 300, 0.15, 4);
      c.far = Math.max(this.viewDistance, cur.dist * 3);
    } else {
      const s = this.street;
      const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.5 : 1;
      if (f || r) this.moveStreet(f * 5 * run * dt, r * 5 * run * dt);
      if (k.has('KeyE')) s.gyaw -= 1.6 * dt;
      if (k.has('KeyQ')) s.gyaw += 1.6 * dt;
      const lam = this.smoothing * 1.3;
      s.x = damp(s.x, s.gx, lam, dt);
      s.z = damp(s.z, s.gz, lam, dt);
      s.yaw = s.yaw + angleDelta(s.yaw, s.gyaw) * (1 - Math.exp(-lam * dt));
      s.pitch = damp(s.pitch, s.gpitch, lam, dt);
      const gy = this.heightAt(s.x, s.z) + EYE_HEIGHT;
      s.y = s.y === 0 ? gy : damp(s.y, gy, 12, dt);
      c.position.set(s.x, s.y, s.z);
      const cp = Math.cos(s.pitch);
      _v.set(s.x - Math.sin(s.yaw) * cp, s.y + Math.sin(s.pitch), s.z - Math.cos(s.yaw) * cp);
      c.lookAt(_v);
      c.near = 0.15;
      c.far = this.viewDistance;
    }
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
