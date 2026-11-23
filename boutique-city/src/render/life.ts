/**
 * Vie du quartier (modèles Kenney animés) : animaux de compagnie qui se promènent sur les trottoirs (Cube Pets),
 * mini-zoo clôturé dans le parc avec un bassin, skate-park (Mini Skate) avec deux skateurs, promeneurs du parc
 * (Blocky Characters), une personne en fauteuil roulant. Animations mises à jour seulement près de la caméra.
 * Décor fixe (clôture, bassin, modules du skate-park…) fusionné en un maillage par matériau, matrices figées.
 * Rien n'est créé si les modèles manquent. Dépend de three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH, STREET_W, blockCenter, type District } from '../sim/district';
import { assets, fitInto } from '../assets';
import { mat } from './kit';

interface Mover {
  obj: THREE.Object3D; mixer: THREE.AnimationMixer | null; actions: Map<string, THREE.AnimationAction>; cur: string;
  /** Trajet : aller-retour entre a et b (ou errance dans une zone). */
  a: THREE.Vector2; b: THREE.Vector2; t: number; dir: 1 | -1; speed: number; pause: number;
  zone: { x0: number; z0: number; x1: number; z1: number } | null; target: THREE.Vector2 | null;
  walk: string; idle: string; y: number;
  /** Circuit fermé (points de passage parcourus en boucle) au lieu d'un aller-retour ; index du prochain point. */
  loop: THREE.Vector2[] | null; idx: number;
  /** Probabilité d'une pause (animation `idle`) à chaque point atteint, et figure jouée en roulant de temps en temps. */
  rest: number; trick: string | null; trickT: number;
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
  /** Décor fixe en attente de fusion (voir `still`) : géométries par matériau équivalent et réglage d'ombre. */
  private readonly statics = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();

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
    const pond = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28).rotateX(-Math.PI / 2), this.water);
    pond.position.set(zoo.x1 - 4, 0.2, zoo.z0 + 4); this.still(pond);
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
    border.position.set(sx, 0.185, sz); border.receiveShadow = true; this.still(border);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(sk.x1 - sk.x0, sk.z1 - sk.z0).rotateX(-Math.PI / 2), mat('#c9cbcd', { rough: 0.9 }));
    ground.position.set(sx, 0.19, sz); ground.receiveShadow = true; this.still(ground);
    // Piste centrale marquée (bande légèrement plus foncée) : là où roulent les skateurs.
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(sk.x1 - sk.x0 - 7, 4.2).rotateX(-Math.PI / 2), mat('#b3b6b9', { rough: 0.9 }));
    lane.position.set(sx, 0.195, sz); this.still(lane);
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
    // Deux skateurs désynchronisés : le garçon fait des allers-retours rapides sur un côté de la piste (pauses
    // rares) ; la fille tourne en boucle sur un circuit ovale dans l'autre sens, plus lentement, avec des pauses
    // et des figures. Départs aux deux bouts opposés de la piste.
    const laneHalf = (sk.x1 - sk.x0) / 2 - 4.6;
    const oval: THREE.Vector2[] = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; oval.push(new THREE.Vector2(sx + Math.cos(a) * laneHalf * 0.85, sz + 0.7 + Math.sin(a) * 1.3)); }
    const riders: [string, Parameters<StreetLife['add']>[2]][] = [
      ['f:skt-character-skate-boy', { a: new THREE.Vector2(sk.x0 + 4.4, sz - 1.5), b: new THREE.Vector2(sk.x1 - 4.4, sz - 1.5), speed: 2.9, t: 0.1 + rnd() * 0.2, walk: 'skate', idle: 'skate-stand', person: true, y: 0.33, rest: 0.25, trick: 'skate-air' }],
      ['f:skt-character-skate-girl', { loop: oval, idx: 1 + Math.floor(rnd() * 2), speed: 1.9, walk: 'skate', idle: 'skate-stand', person: true, y: 0.33, rest: 0.12, trick: 'skate-grab' }],
    ];
    for (const [k, o] of riders) {
      const m = this.add(k, 1.3, o);
      if (m) { const board = assets.fitted('f:skt-skateboard', 0.85, 0.13, 0.3); if (board) { board.rotation.y = Math.PI / 2; board.position.y = -0.13; m.obj.add(fix(board)); } }
    }

    // Promeneurs du parc (Blocky Characters) et une personne en fauteuil roulant ; joueur d'arcade près des parasols.
    for (let k = 0; k < 8; k++) {
      const r = 10 + rnd() * 6, a0 = rnd() * Math.PI * 2;
      const a = new THREE.Vector2(pc.x + Math.cos(a0) * r, pc.z - 4 - Math.abs(Math.sin(a0)) * r * 0.6);
      const b = new THREE.Vector2(pc.x + Math.cos(a0 + 1.2) * r, pc.z - 4 - Math.abs(Math.sin(a0 + 1.2)) * r * 0.6);
      this.add(`f:blk-character-${'abcdefghijklmnopqr'[Math.floor(rnd() * 18)]}`, 1.15, { a, b, speed: 0.9 + rnd() * 0.4, t: rnd(), person: true });
    }
    const wc = this.add('f:character-female-b', 1.0, { a: new THREE.Vector2(pc.x - 14, pc.z - 2), b: new THREE.Vector2(pc.x + 4, pc.z - 2), speed: 0.8, walk: 'wheelchair-move-forward', idle: 'wheelchair-sit', person: true });
    if (wc) { const ch = assets.fitted('f:wheelchair', 0.62, 0.72, 0.75); if (ch) { ch.rotation.y = Math.PI; wc.obj.add(fix(ch)); } }
    this.add('f:arc-character-gamer', 1.0, { a: new THREE.Vector2(pc.x - 7, pc.z + 2.5), b: new THREE.Vector2(pc.x - 7, pc.z + 2.5), speed: 0, idle: 'emote-yes', person: true });
    this.mergeStill();
  }

  /** Objet fixe ajusté dans une boîte, posé au sol du trottoir / parc (fusionné au décor fixe). */
  private prop(key: string, w: number, h: number, d: number, x: number, z: number, ry: number, y = 0.17): void {
    const o = assets.fitted(key, w, h, d);
    if (!o) return;
    o.position.set(x, y, z); o.rotation.y = ry;
    this.still(o, h > 1.2);
  }

  /**
   * Décor fixe : les maillages de `o` (déjà placé, sans parent) attendent la fusion, géométrie ramenée dans le repère
   * du groupe, rangés par matériau équivalent et par réglage d'ombre (`cast` : ombre portée imposée).
   */
  private still(o: THREE.Object3D, cast?: boolean): void {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const castShadow = cast ?? m.castShadow;
      // Cas rares (plusieurs matériaux, repère miroir) : maillage gardé tel quel, matrice figée.
      if (Array.isArray(m.material) || m.matrixWorld.determinant() <= 0) {
        const k = new THREE.Mesh(m.geometry, m.material);
        k.matrix.copy(m.matrixWorld); k.matrixAutoUpdate = false; k.matrixWorldNeedsUpdate = true;
        k.castShadow = castShadow; k.receiveShadow = m.receiveShadow;
        this.group.add(k);
        return;
      }
      const key = `${materialKey(m.material)}|${castShadow}|${m.receiveShadow}`;
      let e = this.statics.get(key);
      if (!e) this.statics.set(key, (e = { mat: m.material, cast: castShadow, receive: m.receiveShadow, geos: [] }));
      e.geos.push(m.geometry.clone().applyMatrix4(m.matrixWorld));
    });
  }

  /** Fusion du décor fixe : un maillage par matériau équivalent et réglage d'ombre, matrice figée. */
  private mergeStill(): void {
    for (const e of this.statics.values()) {
      const merged = mergeAll(e.geos);
      // Attributs incompatibles (cas improbable) : géométries gardées séparées, matrices figées quand même.
      for (const g of merged ? [merged] : e.geos) {
        const m = new THREE.Mesh(g, e.mat);
        m.name = 'décor fixe';
        m.castShadow = e.cast; m.receiveShadow = e.receive;
        m.matrixAutoUpdate = false; m.updateMatrix();
        this.group.add(m);
      }
    }
    this.statics.clear();
  }

  /** Personnage ou animal animé. */
  private add(key: string, size: number, o: { a?: THREE.Vector2; b?: THREE.Vector2; zone?: Mover['zone']; loop?: THREE.Vector2[]; idx?: number; speed: number; t?: number; walk?: string; idle?: string; person?: boolean; y?: number; rest?: number; trick?: string }): Mover | null {
    const c = assets.clone(key);
    if (!c) return null;
    const fitted = fitInto(c.obj, o.person ? 3 : size, o.person ? size : size, o.person ? 3 : size, false);
    // Animaux et promeneurs « Blocky » (pièces rigides animées) : un seul maillage à squelette (voir rigidSkin).
    const rigid = c.animations.length ? rigidSkin(c.obj) : [];
    // Enveloppes d'ajustement et nœuds que l'animation ne touche pas : matrices figées (seul `holder` se déplace).
    const animated = animatedNodes(c.animations);
    fitted.traverse((n) => { if (!animated.has(n.name)) { n.updateMatrix(); n.matrixAutoUpdate = false; } });
    const holder = new THREE.Group();
    holder.add(fitted);
    // Découpés hors champ : pièces rigides (boule englobante élargie), pas les personnages à squelette du modèle
    // (boîte non mise à jour par l'animation).
    holder.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = o.person !== true; m.frustumCulled = rigid.includes(m as THREE.SkinnedMesh) || !(m as THREE.SkinnedMesh).isSkinnedMesh; } });
    const mixer = c.animations.length ? new THREE.AnimationMixer(c.obj) : null;
    const actions = new Map<string, THREE.AnimationAction>();
    if (mixer) for (const clip of c.animations) actions.set(clip.name, mixer.clipAction(clip));
    const a = o.a ?? o.loop?.[0] ?? new THREE.Vector2(o.zone!.x0, o.zone!.z0), b = o.b ?? a.clone();
    const m: Mover = {
      obj: holder, mixer, actions, cur: '', a, b, t: o.t ?? 0, dir: 1, speed: o.speed, pause: 0, zone: o.zone ?? null, target: null,
      walk: o.walk ?? 'walk', idle: o.idle ?? 'idle', y: o.y ?? 0.17, loop: o.loop ?? null, idx: 0, rest: o.rest ?? 0.5, trick: o.trick ?? null, trickT: 3 + Math.random() * 6,
      face: o.person ? Math.PI : 0,
    };
    if (m.zone) { m.target = new THREE.Vector2(); this.pick(m); holder.position.set(m.target.x, m.y, m.target.y); }
    else if (m.loop) {
      // Circuit : départ sur le point idx − 1, en route vers le point idx.
      const n = m.loop.length;
      m.idx = (o.idx ?? 0) % n;
      const p0 = m.loop[(m.idx + n - 1) % n]!;
      holder.position.set(p0.x, m.y, p0.y);
    } else {
      // Aller-retour : départ à la fraction t du trajet, dans un sens tiré au hasard (les trajets ne restent pas en phase).
      const t0 = Math.max(0, Math.min(1, m.t));
      holder.position.set(a.x + (b.x - a.x) * t0, m.y, a.y + (b.y - a.y) * t0);
      if (Math.random() < 0.5) m.dir = -1;
    }
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

  /**
   * Eau du bassin : lisse et sombre (elle reflète le ciel quand l'environnement est présent) ; en qualité haute et
   * ultra, ondulations animées (normale perturbée par quelques ondes en coordonnées du monde).
   */
  private readonly water = waterMaterial();
  setQuality(q: number): void {
    const on = q >= 2, defs = (this.water.defines ??= {});
    if (('RIPPLES' in defs) === on) return;
    if (on) defs['RIPPLES'] = ''; else delete defs['RIPPLES'];
    this.water.needsUpdate = true;
  }

  /** Avance les animaux et personnages proches de `focus` (au-delà de 90 m : figés). */
  update(dt: number, focus: THREE.Vector3): void {
    (this.water.userData['time'] as { value: number }).value += dt;
    for (const m of this.movers) {
      const p = m.obj.position;
      if (Math.abs(p.x - focus.x) > 90 || Math.abs(p.z - focus.z) > 90) continue;
      m.mixer?.update(dt);
      if (m.speed <= 0) continue;
      if (m.pause > 0) { m.pause -= dt; if (m.pause <= 0) this.play(m, m.walk); continue; }
      // Figure de temps en temps (skateurs) : jouée environ une seconde sans s'arrêter.
      if (m.trick) {
        m.trickT -= dt;
        if (m.cur === m.trick) { if (m.trickT <= 0) { this.play(m, m.walk); m.trickT = 5 + Math.random() * 8; } }
        else if (m.trickT <= 0 && m.cur === m.walk) { this.play(m, m.trick); m.trickT = 1.1; }
      }
      let tx: number, tz: number;
      if (m.zone) { tx = m.target!.x; tz = m.target!.y; }
      else if (m.loop) { const to = m.loop[m.idx]!; tx = to.x; tz = to.y; }
      else { const to = m.dir > 0 ? m.b : m.a; tx = to.x; tz = to.y; }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = m.speed * dt;
      if (d <= step) {
        p.x = tx; p.z = tz;
        if (m.zone) this.pick(m); else if (m.loop) m.idx = (m.idx + 1) % m.loop.length; else m.dir = m.dir > 0 ? -1 : 1;
        // Pause éventuelle (sur un circuit, seulement aux deux bouts de l'ovale : pas au milieu d'un virage).
        const atEnd = !m.loop || m.idx % (m.loop.length / 2) === 1;
        if (atEnd && Math.random() < m.rest) { m.pause = (m.walk === 'skate' ? 0.8 : 1) + Math.random() * (m.walk === 'skate' ? 1.6 : 3); this.play(m, m.idle); }
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

/** Objet fixe (sous-arbre entier) : matrices calculées une fois. */
function fix<T extends THREE.Object3D>(o: T): T {
  o.traverse((n) => { n.updateMatrix(); n.matrixAutoUpdate = false; });
  return o;
}

/**
 * Modèle animé par pièces rigides (Cube Pets, Blocky Characters : chaque pièce est un nœud animé) : les pièces sont
 * regroupées en un maillage à squelette par matériau, chaque pièce liée à son propre nœud comme à un os (poids 1).
 * Les nœuds d'origine restent animés et servent d'os (leurs maillages sont masqués) : mouvement identique, mais un
 * appel de dessin par modèle au lieu d'un par pièce (de même pour l'ombre). Boule englobante de la pose de repos,
 * élargie de moitié pour les gestes, pour le découpage hors champ. Renvoie les maillages créés (aucun si le modèle
 * ne s'y prête pas : déjà à squelette, une seule pièce, plusieurs matériaux par pièce, attributs incompatibles).
 */
function rigidSkin(model: THREE.Object3D): THREE.SkinnedMesh[] {
  const parts: THREE.Mesh[] = [];
  let skinned = false;
  model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; else if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh); });
  if (skinned || parts.length < 2 || parts.some((m) => Array.isArray(m.material))) return [];
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert(), mtx = new THREE.Matrix4();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  parts.forEach((m, i) => {
    const g = m.geometry.clone().applyMatrix4(mtx.multiplyMatrices(toModel, m.matrixWorld));
    const n = g.getAttribute('position').count, idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) { idx[v * 4] = i; w[v * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    const mt = m.material as THREE.Material;
    const list = byMat.get(mt);
    if (list) list.push(g); else byMat.set(mt, [g]);
  });
  const merged = [...byMat].map(([mt, gs]) => ({ mt, geo: mergeAll(gs) }));
  if (merged.some((x) => !x.geo)) return [];
  // Des nœuds quelconques servent d'os : Skeleton ne lit que leur matrixWorld (inverses prises dans la pose actuelle).
  const skeleton = new THREE.Skeleton(parts as unknown as THREE.Bone[]);
  const out = merged.map(({ mt, geo }) => {
    const s = new THREE.SkinnedMesh(geo!, mt);
    model.add(s);
    s.updateMatrixWorld(true);
    s.bind(skeleton, s.matrixWorld);
    geo!.computeBoundingSphere();
    s.boundingSphere = geo!.boundingSphere!.clone();
    s.boundingSphere.radius *= 1.5;
    s.receiveShadow = parts[0]!.receiveShadow;
    return s;
  });
  for (const m of parts) m.visible = false;
  return out;
}

/** Noms des nœuds animés par une liste de clips (calculé une fois par modèle : les clips sont partagés). */
const animatedCache = new WeakMap<THREE.AnimationClip[], Set<string>>();
function animatedNodes(clips: THREE.AnimationClip[]): Set<string> {
  let s = animatedCache.get(clips);
  if (!s) {
    s = new Set(clips.flatMap((c) => c.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name).nodeName)));
    animatedCache.set(clips, s);
  }
  return s;
}

/**
 * Signature d'un matériau : deux matériaux de même signature rendent à l'identique (type, couleurs, rugosité,
 * cartes…), même s'ils viennent de fichiers différents (chaque modèle Kenney embarque sa copie de matériaux et de
 * palette). Matériau d'un autre type : propre à lui-même (jamais regroupé).
 */
function materialKey(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || s.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return m.uuid;
  const tex = (t: THREE.Texture | null): string => (t ? textureKey(t) : '-');
  return [m.type, s.color.getHexString(), s.emissive.getHexString(), s.emissiveIntensity, s.roughness, s.metalness, s.envMapIntensity,
    tex(s.map), tex(s.normalMap), s.normalScale.x, s.normalScale.y, tex(s.roughnessMap), tex(s.metalnessMap), tex(s.emissiveMap), tex(s.aoMap), tex(s.alphaMap), tex(s.lightMap), tex(s.bumpMap),
    m.side, m.transparent, m.opacity, m.alphaTest, m.vertexColors, s.flatShading, s.wireframe, s.fog, m.toneMapped, m.depthWrite, m.depthTest, m.blending, m.polygonOffset].join('|');
}

/**
 * Signature d'une texture : contenu de l'image (empreinte des pixels) et réglages d'échantillonnage. Repli sur
 * l'identifiant de la texture si l'image est illisible.
 */
const textureKeys = new WeakMap<THREE.Texture, string>();
function textureKey(t: THREE.Texture): string {
  let k = textureKeys.get(t);
  if (k) return k;
  k = t.uuid;
  const img = t.image as (CanvasImageSource & { width?: number; height?: number }) | null;
  try {
    if (img && img.width && img.height && typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      let h = 2166136261;
      for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619);
      k = `${cv.width}x${cv.height}:${(h >>> 0).toString(36)}`;
    }
  } catch { /* image illisible : texture propre à elle-même */ }
  k += `|${t.wrapS},${t.wrapT},${t.magFilter},${t.minFilter},${t.anisotropy},${t.flipY},${t.colorSpace},${t.channel},${t.offset.x},${t.offset.y},${t.repeat.x},${t.repeat.y},${t.rotation}`;
  textureKeys.set(t, k);
  return k;
}

/**
 * Géométries fusionnées en une seule, ou null si elles ne sont pas compatibles (mêmes attributs, de même format,
 * toutes indexées ou aucune) : vérifié avant `mergeGeometries`, qui sinon se plaint dans la console.
 */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 1) return geos[0]!;
  const sig = (g: THREE.BufferGeometry): string => `${g.index ? 'i' : '-'}|${Object.keys(g.morphAttributes).length}|` + Object.entries(g.attributes)
    .map(([n, a]) => `${n}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${(a as THREE.BufferAttribute).gpuType ?? ''}`).sort().join(',');
  const first = sig(geos[0]!);
  if (geos.some((g) => sig(g) !== first)) return null;
  const out = mergeGeometries(geos, false);
  out?.computeBoundingSphere();
  return out;
}

/** Matériau de l'eau du bassin (voir StreetLife.water) ; horloge des ondes dans userData.time. */
function waterMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x2c78a0, roughness: 0.05, metalness: 0 });
  const time = { value: 0 };
  m.userData['time'] = time;
  m.onBeforeCompile = (sh): void => {
    sh.uniforms['uTime'] = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n#ifdef RIPPLES\nvarying vec2 vWaterP;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef RIPPLES\nvWaterP = (modelMatrix * vec4(transformed, 1.0)).xz;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n#ifdef RIPPLES\nuniform float uTime;\nvarying vec2 vWaterP;\n#endif')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
#ifdef RIPPLES
  vec2 wp = vWaterP;
  float gx = cos(wp.x * 3.1 + uTime * 1.6) * 0.6 + cos((wp.x + wp.y) * 5.3 - uTime * 2.3) * 0.4;
  float gz = cos(wp.y * 2.7 - uTime * 1.3) * 0.6 + cos((wp.x - wp.y) * 4.7 + uTime * 1.9) * 0.4;
  normal = normalize(normal + (viewMatrix * vec4(gx, 0.0, gz, 0.0)).xyz * 0.12);
#endif`);
  };
  m.customProgramCacheKey = (): string => 'eau-bassin';
  return m;
}
