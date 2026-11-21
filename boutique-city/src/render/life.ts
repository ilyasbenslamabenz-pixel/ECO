/**
 * Vie du quartier (modèles Kenney animés) : animaux de compagnie qui se promènent sur les trottoirs (Cube Pets),
 * mini-zoo clôturé dans le parc avec un bassin, skate-park (Mini Skate) avec deux skateurs, promeneurs du parc
 * (Blocky Characters), une personne en fauteuil roulant. Animations mises à jour seulement près de la caméra.
 * Rien n'est créé si les modèles manquent. Dépend de three.
 */
import * as THREE from 'three';
import { PITCH, STREET_W, blockCenter, type District } from '../sim/district';
import { assets, fitInto } from '../assets';
import { mat } from './kit';

interface Mover {
  obj: THREE.Object3D; mixer: THREE.AnimationMixer | null; actions: Map<string, THREE.AnimationAction>; cur: string;
  /** Trajet : aller-retour entre a et b (ou errance dans une zone). */
  a: THREE.Vector2; b: THREE.Vector2; t: number; dir: 1 | -1; speed: number; pause: number;
  zone: { x0: number; z0: number; x1: number; z1: number } | null; target: THREE.Vector2 | null;
  walk: string; idle: string; y: number;
  /** Décalage de cap : les personnages (rotation d'ASSETS) regardent vers −z, les animaux vers +z. */
  face: number;
}

/** Zones du parc réservées (le décor du parc les évite) : mini-zoo et skate-park. */
export function parkZones(d: District): { zoo: { x0: number; z0: number; x1: number; z1: number }; skate: { x0: number; z0: number; x1: number; z1: number } } {
  const pc = blockCenter(d, d.parkBlock.i, d.parkBlock.j);
  return {
    zoo: { x0: pc.x + 7, z0: pc.z + 7, x1: pc.x + 25, z1: pc.z + 23 },
    skate: { x0: pc.x - 25, z0: pc.z + 7, x1: pc.x - 8, z1: pc.z + 23 },
  };
}

/** Taille (m, plus grande dimension) de chaque animal. */
const ANIMAL_SIZE: Record<string, number> = {
  elephant: 1.8, giraffe: 2.2, cow: 1.1, deer: 1.0, hog: 0.8, pig: 0.75, lion: 0.95, tiger: 0.95, polar: 1.0, panda: 0.9,
  koala: 0.55, monkey: 0.6, penguin: 0.55, beaver: 0.55, fox: 0.7, dog: 0.75, cat: 0.55, bunny: 0.5, chick: 0.35,
  parrot: 0.45, bee: 0.4, caterpillar: 0.5, crab: 0.45, fish: 0.5,
};

export class StreetLife {
  readonly group = new THREE.Group();
  private readonly movers: Mover[] = [];

  constructor(private readonly d: District) {
    this.group.name = 'vie-du-quartier';
    if (!assets.has('f:pet-animal-dog')) return;
    let seed = d.seed * 131 + 9;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pc = blockCenter(d, d.parkBlock.i, d.parkBlock.j);
    const z = parkZones(d);

    // Animaux de compagnie sur les trottoirs (aller-retour le long d'un îlot).
    const pets = ['dog', 'cat', 'bunny', 'dog', 'fox', 'chick', 'dog', 'cat', 'parrot', 'dog', 'bunny', 'cat'];
    pets.forEach((name, k) => {
      const vertical = k % 2 === 0;
      const line = (Math.floor(rnd() * (vertical ? d.nx : d.nz) + 0.5) - (vertical ? d.nx : d.nz) / 2) * PITCH + (rnd() < 0.5 ? -1 : 1) * (STREET_W / 2 + 1.2);
      const along = (rnd() - 0.5) * (vertical ? d.size.d : d.size.w) * 0.8;
      const a = vertical ? new THREE.Vector2(line, along - 12) : new THREE.Vector2(along - 12, line);
      const b = vertical ? new THREE.Vector2(line, along + 12) : new THREE.Vector2(along + 12, line);
      this.add(`f:pet-animal-${name}`, ANIMAL_SIZE[name]!, { a, b, speed: 0.9 + rnd() * 0.6, t: rnd() });
    });

    // Mini-zoo : clôture, bassin (nénuphars, poisson, crabe, pingouin), animaux en liberté dans l'enclos.
    const zoo = z.zoo;
    const fence = assets.has('f:nat-fence_simple') ? 'f:nat-fence_simple' : null;
    if (fence) {
      for (let x = zoo.x0; x < zoo.x1; x += 2) { this.prop(fence, 2, 1, 0.3, x + 1, zoo.z0, 0); this.prop(fence, 2, 1, 0.3, x + 1, zoo.z1, 0); }
      for (let zz = zoo.z0; zz < zoo.z1; zz += 2) { this.prop(fence, 2, 1, 0.3, zoo.x0, zz + 1, Math.PI / 2); this.prop(fence, 2, 1, 0.3, zoo.x1, zz + 1, Math.PI / 2); }
    }
    const pond = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28).rotateX(-Math.PI / 2), mat('#3f8fbf', { rough: 0.15, metal: 0.1 }));
    pond.position.set(zoo.x1 - 4, 0.2, zoo.z0 + 4); this.group.add(pond);
    for (const [dx, dz, k] of [[-1, 0.6, 'f:nat-lily_large'], [1.1, -0.8, 'f:nat-lily_small'], [0.2, 1.4, 'f:nat-lily_small']] as const) this.prop(k, 0.9, 0.2, 0.9, zoo.x1 - 4 + dx, zoo.z0 + 4 + dz, rnd() * 6, 0.21);
    this.add('f:pet-animal-fish', ANIMAL_SIZE['fish']!, { zone: { x0: zoo.x1 - 5.5, z0: zoo.z0 + 2.5, x1: zoo.x1 - 2.5, z1: zoo.z0 + 5.5 }, speed: 0.5, y: 0.05 });
    this.prop('f:nat-tree_oak', 2.4, 3.6, 2.4, zoo.x0 + 2.5, zoo.z1 - 2.5, rnd() * 6);
    this.prop('f:nat-log_stack', 1.6, 0.8, 1.2, zoo.x0 + 3, zoo.z0 + 2, 0.3);
    this.prop('f:nat-rock_largeA', 1.6, 1.2, 1.6, zoo.x1 - 2, zoo.z1 - 2, 0);
    const inner = { x0: zoo.x0 + 1.5, z0: zoo.z0 + 1.5, x1: zoo.x1 - 1.5, z1: zoo.z1 - 1.5 };
    for (const name of ['elephant', 'giraffe', 'cow', 'deer', 'hog', 'pig', 'lion', 'tiger', 'polar', 'panda', 'koala', 'monkey', 'penguin', 'beaver', 'crab', 'bee', 'caterpillar']) {
      this.add(`f:pet-animal-${name}`, ANIMAL_SIZE[name]!, { zone: inner, speed: 0.4 + rnd() * 0.5, t: rnd() });
    }
    // Panneau du zoo.
    this.prop('f:nat-sign', 1, 1.4, 0.4, zoo.x0 - 1, zoo.z0 - 0.8, 0);

    // Skate-park lisible : dalle claire bordée, deux half-pipes face à face aux extrémités, une piste centrale
    // dégagée pour les skateurs, et seulement quatre modules bien espacés (deux de chaque côté de la piste).
    const sk = z.skate;
    const sx = (sk.x0 + sk.x1) / 2, sz = (sk.z0 + sk.z1) / 2;
    const border = new THREE.Mesh(new THREE.PlaneGeometry(sk.x1 - sk.x0 + 1.2, sk.z1 - sk.z0 + 1.2).rotateX(-Math.PI / 2), mat('#6f7378', { rough: 0.95 }));
    border.position.set(sx, 0.185, sz); border.receiveShadow = true; this.group.add(border);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(sk.x1 - sk.x0, sk.z1 - sk.z0).rotateX(-Math.PI / 2), mat('#c9cbcd', { rough: 0.9 }));
    ground.position.set(sx, 0.19, sz); ground.receiveShadow = true; this.group.add(ground);
    // Piste centrale marquée (bande légèrement plus foncée) : là où roulent les skateurs.
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(sk.x1 - sk.x0 - 7, 4.2).rotateX(-Math.PI / 2), mat('#b3b6b9', { rough: 0.9 }));
    lane.position.set(sx, 0.195, sz); this.group.add(lane);
    const sp: [string, number, number, number, number, number, number][] = [
      ['f:skt-half-pipe', 4, 2.2, 3, sk.x0 + 2, sz, Math.PI / 2], ['f:skt-half-pipe', 4, 2.2, 3, sk.x1 - 2, sz, -Math.PI / 2],
      // Rails : modèles longs selon z (boîte allongée en profondeur), tournés parallèlement à la piste.
      ['f:skt-rail-low', 0.5, 0.9, 3.4, sx - 3.2, sz - 5, Math.PI / 2], ['f:skt-obstacle-box', 2.2, 0.6, 2.2, sx + 3.4, sz - 5, 0],
      ['f:skt-rail-high', 0.5, 1.4, 3.2, sx - 3.2, sz + 5, Math.PI / 2],
      // Plan incliné – table – plan incliné (funbox) dans l'axe de la piste.
      ['f:skt-obstacle-middle', 2, 1.1, 2, sx + 3.4, sz + 5, 0],
      ['f:skt-obstacle-end', 2, 0.7, 1, sx + 1.9, sz + 5, -Math.PI / 2], ['f:skt-obstacle-end', 2, 0.7, 1, sx + 4.9, sz + 5, Math.PI / 2],
    ];
    for (const [k, w, h, dd, x, zz, ry] of sp) this.prop(k, w, h, dd, x, zz, ry, 0.2);
    for (const [k, off, sp2] of [['f:skt-character-skate-boy', -1, 2.6], ['f:skt-character-skate-girl', 1, 2.2]] as const) {
      const m = this.add(k, 1.3, { a: new THREE.Vector2(sk.x0 + 4.2, sz + off), b: new THREE.Vector2(sk.x1 - 4.2, sz + off), speed: sp2, t: off < 0 ? 0.1 : 0.6, walk: 'skate', idle: 'skate-stand', person: true, y: 0.33 });
      if (m) { const board = assets.fitted('f:skt-skateboard', 0.85, 0.13, 0.3); if (board) { board.rotation.y = Math.PI / 2; board.position.y = -0.13; m.obj.add(board); } }
    }

    // Promeneurs du parc (Blocky Characters) et une personne en fauteuil roulant ; joueur d'arcade près des parasols.
    for (let k = 0; k < 8; k++) {
      const r = 10 + rnd() * 6, a0 = rnd() * Math.PI * 2;
      const a = new THREE.Vector2(pc.x + Math.cos(a0) * r, pc.z - 4 - Math.abs(Math.sin(a0)) * r * 0.6);
      const b = new THREE.Vector2(pc.x + Math.cos(a0 + 1.2) * r, pc.z - 4 - Math.abs(Math.sin(a0 + 1.2)) * r * 0.6);
      this.add(`f:blk-character-${'abcdefghijklmnopqr'[Math.floor(rnd() * 18)]}`, 1.15, { a, b, speed: 0.9 + rnd() * 0.4, t: rnd(), person: true });
    }
    const wc = this.add('f:character-female-b', 1.0, { a: new THREE.Vector2(pc.x - 14, pc.z - 2), b: new THREE.Vector2(pc.x + 4, pc.z - 2), speed: 0.8, walk: 'wheelchair-move-forward', idle: 'wheelchair-sit', person: true });
    if (wc) { const ch = assets.fitted('f:wheelchair', 0.62, 0.72, 0.75); if (ch) { ch.rotation.y = Math.PI; wc.obj.add(ch); } }
    this.add('f:arc-character-gamer', 1.0, { a: new THREE.Vector2(pc.x - 7, pc.z + 2.5), b: new THREE.Vector2(pc.x - 7, pc.z + 2.5), speed: 0, idle: 'emote-yes', person: true });
  }

  /** Objet fixe ajusté dans une boîte, posé au sol du trottoir / parc. */
  private prop(key: string, w: number, h: number, d: number, x: number, z: number, ry: number, y = 0.17): void {
    const o = assets.fitted(key, w, h, d);
    if (!o) return;
    o.position.set(x, y, z); o.rotation.y = ry;
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = h > 1.2; });
    this.group.add(o);
  }

  /** Personnage ou animal animé. */
  private add(key: string, size: number, o: { a?: THREE.Vector2; b?: THREE.Vector2; zone?: Mover['zone']; speed: number; t?: number; walk?: string; idle?: string; person?: boolean; y?: number }): Mover | null {
    const c = assets.clone(key);
    if (!c) return null;
    const fitted = fitInto(c.obj, o.person ? 3 : size, o.person ? size : size, o.person ? 3 : size, false);
    const holder = new THREE.Group();
    holder.add(fitted);
    // Animaux (animation par nœuds) : découpés hors champ ; personnages à squelette : jamais (boîte non mise à jour).
    holder.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = o.person !== true; m.frustumCulled = !(m as THREE.SkinnedMesh).isSkinnedMesh; } });
    const mixer = c.animations.length ? new THREE.AnimationMixer(c.obj) : null;
    const actions = new Map<string, THREE.AnimationAction>();
    if (mixer) for (const clip of c.animations) actions.set(clip.name, mixer.clipAction(clip));
    const a = o.a ?? new THREE.Vector2(o.zone!.x0, o.zone!.z0), b = o.b ?? a.clone();
    const m: Mover = { obj: holder, mixer, actions, cur: '', a, b, t: o.t ?? 0, dir: 1, speed: o.speed, pause: 0, zone: o.zone ?? null, target: null, walk: o.walk ?? 'walk', idle: o.idle ?? 'idle', y: o.y ?? 0.17, face: o.person ? Math.PI : 0 };
    if (m.zone) { m.target = new THREE.Vector2(); this.pick(m); holder.position.set(m.target.x, m.y, m.target.y); }
    else holder.position.set(a.x, m.y, a.y);
    mixer?.update(Math.random() * 2);
    this.play(m, m.speed > 0 ? m.walk : m.idle);
    this.group.add(holder);
    this.movers.push(m);
    return m;
  }

  private pick(m: Mover): void {
    const z = m.zone!;
    m.target!.set(z.x0 + Math.random() * (z.x1 - z.x0), z.z0 + Math.random() * (z.z1 - z.z0));
  }

  private play(m: Mover, name: string): void {
    if (m.cur === name || !m.mixer) return;
    const act = m.actions.get(name) ?? m.actions.get('walk') ?? m.actions.get('idle');
    if (!act) return;
    act.reset().fadeIn(0.2).play();
    m.actions.get(m.cur)?.fadeOut(0.2);
    m.cur = name;
  }

  /** Avance les animaux et personnages proches de `focus` (au-delà de 90 m : figés). */
  update(dt: number, focus: THREE.Vector3): void {
    for (const m of this.movers) {
      const p = m.obj.position;
      if (Math.abs(p.x - focus.x) > 90 || Math.abs(p.z - focus.z) > 90) continue;
      m.mixer?.update(dt);
      if (m.speed <= 0) continue;
      if (m.pause > 0) { m.pause -= dt; if (m.pause <= 0) this.play(m, m.walk); continue; }
      let tx: number, tz: number;
      if (m.zone) { tx = m.target!.x; tz = m.target!.y; }
      else { const to = m.dir > 0 ? m.b : m.a; tx = to.x; tz = to.y; }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = m.speed * dt;
      if (d <= step) {
        p.x = tx; p.z = tz;
        if (m.zone) this.pick(m); else m.dir = m.dir > 0 ? -1 : 1;
        if (Math.random() < 0.5 && m.walk !== 'skate') { m.pause = 1 + Math.random() * 3; this.play(m, m.idle); }
      } else {
        p.x += (dx / d) * step; p.z += (dz / d) * step;
        const want = Math.atan2(dx, dz) + m.face;
        let diff = want - m.obj.rotation.y;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        m.obj.rotation.y += diff * Math.min(1, dt * 6);
      }
    }
  }
}
