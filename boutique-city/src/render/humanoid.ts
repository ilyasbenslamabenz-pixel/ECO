/**
 * Personnage stylisé (joueur, clients, employés, passants proches) : bassin, torse, tête, cheveux, bras et jambes
 * articulés aux épaules et aux hanches. Marche animée par balancement, pose assise, pose au comptoir.
 * Face avant vers −z : une rotation y = cap fait regarder vers (−sin cap, −cos cap). Dépend de three.
 */
import * as THREE from 'three';
import { ASSETS, CONFIG, assets, filesMatching, fitInto, keysWith } from '../assets';
import { box, hashRand, mat, sph } from './kit';

export interface Look { skin: string; shirt: string; pants: string; hair: string; shoes: string; hairLong: boolean; apron?: string }

const SKINS = ['#f1c9a5', '#e0ac85', '#c68863', '#9a6646', '#6e4630', '#f5d6bd'];
const SHIRTS = ['#2f5d8a', '#8a2f3c', '#3c7a4a', '#c9a227', '#6b4a8a', '#2b2b2b', '#d06a3a', '#4a8a8a', '#e8e8e8', '#7a5a3a', '#b0476a', '#4f6fd0'];
const PANTS = ['#2a3142', '#3d3d3d', '#5a4a3a', '#1f3a5f', '#6b6b6b', '#2e2e38'];
const HAIRS = ['#1d1612', '#3b2a1e', '#6b4a2a', '#a07a4a', '#d8c08a', '#555555'];

export function lookFrom(seed: number, apron?: string): Look {
  const r = hashRand(seed + 17);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  return { skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS), shoes: r() < 0.5 ? '#222222' : '#f0f0f0', hairLong: r() < 0.45, apron };
}

/** Tenue du joueur. */
export const PLAYER_LOOK: Look = { skin: '#d9a47e', shirt: '#2a7fd4', pants: '#26303d', hair: '#2a1d14', shoes: '#f2f2f2', hairLong: false };

export class Humanoid {
  readonly group = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly body = new THREE.Group();
  private phase = Math.random() * 6;
  private sitting = false;

  constructor(look: Look, readonly scale = 1) {
    const g = this.body;
    this.group.add(g);
    const skin = mat(look.skin, { rough: 0.6 }), shirt = mat(look.shirt), pants = mat(look.pants), hair = mat(look.hair, { rough: 0.9 }), shoes = mat(look.shoes);
    // Torse, cou, tête.
    box(g, 0.42, 0.56, 0.24, 0, 0.98, 0, shirt);
    if (look.apron) box(g, 0.36, 0.62, 0.02, 0, 0.82, -0.13, mat(look.apron));
    box(g, 0.1, 0.08, 0.1, 0, 1.53, 0, skin);
    sph(g, 0.24, 0.27, 0.25, 0, 1.7, 0, skin);
    sph(g, 0.26, 0.15, 0.27, 0, 1.79, 0.02, hair);
    if (look.hairLong) box(g, 0.25, 0.3, 0.08, 0, 1.5, 0.1, hair);
    // Nez : indique le regard (vers −z).
    box(g, 0.04, 0.05, 0.05, 0, 1.68, -0.13, skin, false);
    box(g, 0.42, 0.14, 0.24, 0, 0.86, 0, pants);
    // Bras (pivot à l'épaule).
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * 0.27, 1.5, 0);
      box(arm, 0.11, 0.3, 0.12, 0, -0.3, 0, shirt);
      box(arm, 0.09, 0.26, 0.1, 0, -0.55, 0, skin);
      g.add(arm);
    }
    // Jambes (pivot à la hanche).
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(sx * 0.11, 0.9, 0);
      box(leg, 0.15, 0.82, 0.16, 0, -0.84, 0, pants);
      box(leg, 0.16, 0.08, 0.26, 0, -0.9, -0.04, shoes);
      g.add(leg);
    }
    this.group.scale.setScalar(scale);
  }

  /** Animation : `speed` en m/s (0 = immobile). */
  update(dt: number, speed: number): void {
    if (this.sitting) return;
    const moving = speed > 0.1;
    this.phase += dt * (moving ? 2.4 + speed * 1.6 : 1.2);
    const a = moving ? Math.min(0.75, 0.25 + speed * 0.1) : 0;
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * a; this.legR.rotation.x = -s * a;
    this.armL.rotation.x = -s * a * 0.8; this.armR.rotation.x = s * a * 0.8;
    this.armL.rotation.z = 0; this.armR.rotation.z = 0;
    this.body.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.04 : Math.sin(this.phase) * 0.008;
  }

  /** Assis (jambes à l'horizontale, bassin abaissé). */
  sit(on: boolean): void {
    this.sitting = on;
    this.legL.rotation.x = this.legR.rotation.x = on ? -Math.PI / 2 : 0;
    this.body.position.y = on ? -0.45 : 0;
    this.armL.rotation.x = this.armR.rotation.x = on ? -0.5 : 0;
  }

  /** Bras tendus vers l'avant (tenir la caisse, porter). */
  reach(): void { this.armL.rotation.x = this.armR.rotation.x = -0.9; }
}

/** Personnage du jeu : fait en code (Humanoid) ou modèle animé (KitPerson), même interface. */
export interface Person { readonly group: THREE.Group; update(dt: number, speed: number): void; sit(on: boolean): void; reach(): void }

/**
 * Personnage animé des Mini Characters (Kenney) : squelette cloné, AnimationMixer (idle, walk, sprint, sit), teinte
 * légère propre à chaque personnage pour varier les tenues ; `accent` : tenue de l'employé (teinte plus marquée).
 */
export class KitPerson implements Person {
  readonly group = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current = '';

  /** Fauteuil roulant : animations « wheelchair-* » à la place de la marche. */
  private readonly wheel: boolean;

  constructor(key: string, seed: number, accent?: string, opts: { wheelchair?: string; accessory?: string } = {}) {
    const c = assets.clone(key)!;
    this.wheel = !!opts.wheelchair;
    const r = hashRand(seed + 3);
    const tint = new THREE.Color().setHSL(r(), 0.55, 0.6);
    const k = accent ? 0.38 : 0.2;
    c.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const tintOf = (src: THREE.Material): THREE.Material => {
        const own = (src as THREE.MeshStandardMaterial).clone();
        own.color = new THREE.Color(1, 1, 1).lerp(accent ? new THREE.Color(accent) : tint, k);
        own.userData['own'] = true;
        return own;
      };
      m.material = Array.isArray(m.material) ? m.material.map(tintOf) : tintOf(m.material);
      m.castShadow = true;
      m.frustumCulled = false;
    });
    // Échelle et décalage calculés une fois par modèle (boîte englobante d'un squelette : coûteuse), puis réutilisés.
    let fit = FIT_CACHE.get(key);
    if (!fit) {
      const probe = fitInto(c.obj, 3, CONFIG.npcHeight, 3, false, ASSETS[key]!.scale);
      fit = { s: c.obj.scale.x, p: c.obj.position.clone() };
      FIT_CACHE.set(key, fit);
      probe.remove(c.obj);
    }
    c.obj.scale.setScalar(fit.s);
    c.obj.position.copy(fit.p);
    this.group.add(c.obj);
    // Accessoire sur la tête (lunettes, lunettes de soleil, appareil auditif : modèles prévus pour l'os « head »).
    if (opts.accessory) {
      let head: THREE.Object3D | null = null;
      c.obj.traverse((o) => { if (!head && o.name === 'head') head = o; });
      const acc = assets.clone(opts.accessory);
      if (head && acc) { acc.obj.rotation.y = 0; acc.obj.position.set(0, 0.12, 0.085); (head as THREE.Object3D).add(acc.obj); }
    }
    // Fauteuil roulant posé au sol sous le personnage assis, à son échelle.
    if (opts.wheelchair) {
      const ch = assets.clone(opts.wheelchair);
      if (ch) { ch.obj.scale.setScalar(fit.s); ch.obj.rotation.y = Math.PI; this.group.add(ch.obj); }
    }
    this.mixer = new THREE.AnimationMixer(c.obj);
    for (const clip of c.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.mixer.update(r() * 2);
    this.play('idle');
  }

  /** Joue une animation du modèle (repli sur « idle »). */
  play(name: string, timeScale = 1): void {
    const a = this.actions.get(name) ?? this.actions.get('idle');
    if (!a) return;
    a.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.actions.get(this.current);
    a.reset().fadeIn(0.18).play();
    prev?.fadeOut(0.18);
    this.current = name;
  }

  update(dt: number, speed: number): void {
    if (this.wheel) { this.play(speed > 0.1 ? 'wheelchair-move-forward' : 'wheelchair-sit', Math.max(0.6, speed / 1.2)); this.mixer.update(dt); return; }
    if (this.current !== 'sit') {
      if (speed > 3) this.play('sprint', speed / 5);
      else if (speed > 0.1) this.play('walk', Math.max(0.6, speed / 1.4));
      else this.play('idle');
    }
    this.mixer.update(dt);
  }

  sit(on: boolean): void { if (!this.wheel) this.play(on ? 'sit' : 'idle'); }
  reach(): void { /* pose « au comptoir » : posture de repos du modèle */ }
}

const FIT_CACHE = new Map<string, { s: number; p: THREE.Vector3 }>();
/** Clients : les 12 Mini Characters et les 18 Blocky Characters (Kenney). */
const PERSONS = [...keysWith('perso.').filter((k) => k !== 'perso.employe'), ...filesMatching(/^blk-character-/)];
const ACCESSORIES = ['f:aid-glasses', 'f:aid-sunglasses', 'f:aid_hearing', 'f:aid-glasses'];
const WHEELCHAIRS = ['f:wheelchair', 'f:wheelchair-deluxe', 'f:wheelchair-power', 'f:wheelchair-power-deluxe'];

/**
 * Client ou employé : modèle animé si chargé (douze clients différents ; employés en tenue du Mini Market), sinon
 * personnage fait en code.
 */
export function makePerson(seed: number, accent?: string, scale = 1, employee = false): Person {
  const keys = PERSONS.filter((k) => assets.has(k));
  if (keys.length) {
    const key = employee && assets.has('perso.employe') ? 'perso.employe' : keys[Math.abs(Math.floor(seed)) % keys.length]!;
    // Variété : un client sur quatre porte un accessoire (Mini Characters), un sur quinze se déplace en fauteuil.
    const r = hashRand(seed * 7 + 11);
    const mini = key.startsWith('perso.');
    const a = r(), w = r();
    const opts = employee ? {} : {
      accessory: mini && a < 0.25 ? ACCESSORIES[Math.floor(a * 16) % ACCESSORIES.length] : undefined,
      wheelchair: w < 0.065 ? WHEELCHAIRS[Math.floor(w * 61) % WHEELCHAIRS.length] : undefined,
    };
    const p = new KitPerson(key, seed, accent, opts);
    p.group.scale.setScalar(scale);
    return p;
  }
  return new Humanoid(lookFrom(seed, accent), scale);
}
