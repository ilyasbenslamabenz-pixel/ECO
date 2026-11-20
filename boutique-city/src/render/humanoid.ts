/**
 * Personnage stylisé (joueur, clients, employés, passants proches) : bassin, torse, tête, cheveux, bras et jambes
 * articulés aux épaules et aux hanches. Marche animée par balancement, pose assise, pose au comptoir.
 * Face avant vers −z : une rotation y = cap fait regarder vers (−sin cap, −cos cap). Dépend de three.
 */
import * as THREE from 'three';
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
