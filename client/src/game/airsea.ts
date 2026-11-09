// Trafic aérien et maritime : avions de ligne garés aux portes, cycle complet des mouvements
// (approche, atterrissage, roulage, stationnement, repoussage, roulage, décollage, montée et disparition),
// navires à quai, manœuvres d'entrée et de sortie du port, navires au mouillage et au large.
// Tout est en instances fines (un appel de rendu par type d'avion ou de navire).
// Se reconstruit seul quand country.infra change (nouvel aéroport, port en service, fermeture…).
// Avec la bibliothèque de modèles (cityModels.ts) : moyen-courriers et gros porteurs, porte-conteneurs,
// pétroliers et remorqueurs Blender (les autres types restent procéduraux), portiques STS et RTG du port
// avec chariot animé (à la place des portiques procéduraux).
import { Matrix, type Mesh, type Scene } from '@babylonjs/core';
import { mulberry32 } from '../../../shared/noise';
import { coastX } from '../../../shared/sim/country';
import type { CountryDef, Infra } from '../../../shared/sim/types';
import { useStore } from '../store';
import { airportLayout, type AirportLayout, type Stand } from './airport';
import { Kit, LIVERIES, PLANES, SHIP_DIM, buildFin, buildPlane, buildShip, col3, poseMatrix, type ShipKind } from './infraModels';
import { PORT_CRANES, PORT_CRANES_VERSION, SEA_Y, portLayout, type Berth } from './port';
import type { Grid } from './terrain';
import { whenModels } from './cityModels';
import { createThinInstances, partMatrix, type ModelLibrary, type ModelPart, type ThinInstanceBuffer } from './modelLibrary';

/** Remplacements par la bibliothèque : [modèle, échelle] par classe d'avion (PLANES) ; null = procédural. */
const LIB_PLANES: ([string, number] | null)[] = [['avion_moyen_courrier', 1], ['avion_gros_porteur', 1.05], ['avion_gros_porteur', 1.14], ['avion_moyen_courrier', 0.73]];
const LIB_SHIPS: Partial<Record<ShipKind, string>> = { conteneurs: 'porte_conteneurs', petrolier: 'petrolier', remorqueur: 'remorqueur' };
/** Les modèles de la bibliothèque regardent vers +Z ; les poses d'avions et de navires vers +X local. */
const TO_X = Matrix.RotationY(Math.PI / 2);

const DT = 0.25; // pas d'échantillonnage des trajectoires (s)
interface Track { T: number; off: number; s: Float32Array } // échantillons [x, y, z, yaw, pitch, visible] × n
interface Actor { mesh: number; slot: number; track?: Track; fixed?: Float32Array; color?: string }

/** Lissage de Chaikin (virages arrondis). */
function chaikin(pts: [number, number][], it = 2): [number, number][] {
  let p = pts;
  for (let k = 0; k < it; k++) {
    const o: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      o.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    o.push(p[p.length - 1]);
    p = o;
  }
  return p;
}
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

/** Enregistreur de trajectoire : ajoute des échantillons à pas fixe. */
class Rec {
  s: number[] = [];
  last = [0, 0, 0, 0, 0, 0];
  get t() { return (this.s.length / 6) * DT; }
  push(x: number, y: number, z: number, yaw: number, pitch: number, vis = 1) { this.last = [x, y, z, yaw, pitch, vis]; this.s.push(x, y, z, yaw, pitch, vis); }
  wait(sec: number, vis = 1) { const [x, y, z, yaw, p] = this.last; for (let q = 0; q < sec / DT; q++) this.push(x, y, z, yaw, p, vis); }
  /** tourne sur place jusqu'au cap visé */
  turnTo(yaw: number, sec: number) { const [x, y, z, y0, p] = this.last; const d = angDiff(y0, yaw); const n = Math.max(1, Math.round(sec / DT)); for (let q = 1; q <= n; q++) this.push(x, y, z, y0 + (d * q) / n, p); }
  /** suit une polyligne 2D (monde) à vitesse variable v(parcouru, restant) ; cap lissé */
  follow(pts: [number, number][], y: (x: number, z: number, d: number, rem: number) => number, v: (d: number, rem: number) => number, opts: { reverse?: boolean; pitch?: (d: number, rem: number) => number; smooth?: number } = {}) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1];
    if (len < 1e-6) return;
    let d = 0, seg = 0;
    let yaw = this.s.length ? this.last[3] : NaN;
    const tau = opts.smooth ?? 1.2;
    for (let guard = 0; guard < 200000; guard++) {
      while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
      const t = (d - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
      const [ax, az] = pts[seg], [bx, bz] = pts[seg + 1];
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      let target = Math.atan2(-(bz - az), bx - ax);
      if (opts.reverse) target += Math.PI;
      if (Number.isNaN(yaw)) yaw = target;
      yaw += angDiff(yaw, target) * Math.min(1, DT / tau);
      this.push(x, y(x, z, d, len - d), z, yaw, opts.pitch ? opts.pitch(d, len - d) : 0);
      if (d >= len) break;
      d = Math.min(len, d + Math.max(1e-4, v(d, len - d)) * DT);
    }
  }
  track(T: number, off: number): Track {
    // complète jusqu'à T (invisible)
    const n = Math.round(T / DT);
    while (this.s.length / 6 < n) { const [x, y, z, yaw, p] = this.last; this.push(x, y, z, yaw, p, 0); }
    return { T: (this.s.length / 6) * DT, off, s: new Float32Array(this.s) };
  }
}

export function createAirSea(scene: Scene, grid: Grid, country: CountryDef) {
  Object.assign(window as unknown as Record<string, unknown>, { __ecoScene: scene, __ecoT0: performance.now() }); // accès de débogage (captures automatisées)
  // ---------- maillages ----------
  const planeMeshes: Mesh[] = [];
  const finMeshes: Mesh[] = [];
  PLANES.forEach((p, c) => {
    const k = new Kit(); buildPlane(k, p);
    const m = k.build('avions-' + c, scene); m.isPickable = false; m.alwaysSelectAsActiveMesh = true; planeMeshes.push(m);
    const f = new Kit(); buildFin(f, p);
    const fm = f.build('derives-' + c, scene); fm.isPickable = false; fm.alwaysSelectAsActiveMesh = true; finMeshes.push(fm);
  });
  const shipKinds: { kind: ShipKind; seed: number }[] = [
    { kind: 'conteneurs', seed: 1 }, { kind: 'conteneurs', seed: 2 }, { kind: 'feeder', seed: 3 }, { kind: 'petrolier', seed: 4 },
    { kind: 'vraquier', seed: 5 }, { kind: 'ferry', seed: 6 }, { kind: 'remorqueur', seed: 7 },
  ];
  const shipMeshes = shipKinds.map((s) => { const k = new Kit(); buildShip(k, s.kind, mulberry32(s.seed * 99)); const m = k.build('navires-' + s.kind, scene); m.isPickable = false; m.alwaysSelectAsActiveMesh = true; return m; });
  const shipMeshOf = (kind: ShipKind, r: number) => kind === 'conteneurs' ? (r < 0.5 ? 0 : 1) : shipKinds.findIndex((s) => s.kind === kind);

  let planes: Actor[] = [];
  let ships: Actor[] = [];
  let lanes: { mesh: number; slot: number; z: number; dir: number; v: number; off: number }[] = [];
  let bufs: { mesh: Mesh; buf: Float32Array; col?: Float32Array }[] = [];

  const build = (c: CountryDef) => {
    planes = []; ships = []; lanes = [];
    const rnd = mulberry32(c.seed + 4242);
    const ok = (i: Infra) => !i.status || i.status === 'active';
    const counts = new Array(planeMeshes.length).fill(0);
    const scounts = new Array(shipMeshes.length).fill(0);
    const fixedPose = (x: number, y: number, z: number, yaw: number) => new Float32Array([x, y, z, yaw, 0, 1]);

    // ----- aéroports -----
    for (const inf of c.infra.filter((i) => i.type === 'aeroport' && ok(i))) {
      const L: AirportLayout = airportLayout(inf, grid);
      const yaw = (du: number, dv: number) => L.rot + Math.atan2(-dv, du);
      const pass = L.stands.filter((s) => !s.cargo);
      const N = L.big ? 8 : 2;
      const reserved = new Set<Stand>();
      for (let k = 0; k < N && pass.length; k++) reserved.add(pass[Math.floor(((k + 0.5) / N) * pass.length)]);
      for (const s of L.stands) {
        if (reserved.has(s)) continue;
        if (!s.cargo && rnd() < 0.22) continue;
        const [x, z] = L.toWorld(s.u, s.v);
        planes.push({ mesh: s.cls, slot: counts[s.cls]++, fixed: fixedPose(x, L.y + 0.0006, z, yaw(0, s.dir)), color: s.cargo ? ['#5a189a', '#f77f00', '#6c757d'][Math.floor(rnd() * 3)] : LIVERIES[Math.floor(rnd() * LIVERIES.length)] });
      }
      // avions en mouvement : un cycle complet chacun
      const T = L.big ? 900 : 700;
      const P = L.big ? 720 : 520;
      const A = L.rwys[0], B = L.rwys[L.rwys.length - 1];
      const W = (pts: [number, number][]) => pts.map(([u, v]) => L.toWorld(u, v));
      const gy = L.y + 0.0006;
      [...reserved].forEach((st, k) => {
        const spec = PLANES[st.cls];
        const R = new Rec();
        const glide = Math.tan((3 * Math.PI) / 180);
        const uTd = A.u0 + 0.32;
        const D = L.big ? 11 : 8;
        // approche finale (pente de 3°) puis arrondi
        R.follow(W([[uTd - D, A.v], [uTd, A.v]]), (_x, _z, _d, rem) => gy + Math.max(0, rem * glide - (rem < 0.25 ? (0.25 - rem) * glide * 0.6 : 0)), (_d, rem) => 0.072 + Math.min(0.05, rem * 0.006), { pitch: (_d, rem) => (rem < 0.3 ? 0.09 : 0.045) });
        // roulement à l'atterrissage jusqu'à la sortie rapide
        const ex = L.exitPath;
        const dRoll = ex[0][0] - uTd;
        const a = (0.072 ** 2 - 0.022 ** 2) / (2 * Math.max(0.3, dRoll));
        R.follow(W([[uTd, A.v], [ex[0][0], A.v]]), () => gy, (d) => Math.sqrt(Math.max(0.022 ** 2, 0.072 ** 2 - 2 * a * d)), { pitch: (d) => (d < 0.15 ? 0.06 * (1 - d / 0.15) : 0) });
        // roulage vers le poste
        const lane = st.lane ?? 'N';
        const lv = L.laneV[lane];
        const toLane = L.toLane[lane] ?? [];
        const laneStart = toLane.length ? toLane[toLane.length - 1] : [st.u, lv];
        const route: [number, number][] = [...ex, ...toLane.slice(1), [laneStart[0], lv], [st.u + (laneStart[0] > st.u ? 0.05 : -0.05), lv], [st.u, lv - (lv - st.v) * 0.25], [st.u, st.v]];
        const vt = L.big ? 0.026 : 0.02;
        R.follow(chaikin(W(route), 2), () => gy, (_d, rem) => Math.min(vt, 0.002 + rem * 0.08), { smooth: 1.5 });
        const parked = R.t;
        // repoussage, virage, roulage vers la piste de décollage
        const fl = L.fromLane[lane] ?? L.fromLane.N!;
        const outRoute: [number, number][] = [[st.u, lv], [fl.end, lv], ...fl.path, L.lineup];
        let dOut = 0; { const w = W(outRoute); for (let q = 1; q < w.length; q++) dOut += Math.hypot(w[q][0] - w[q - 1][0], w[q][1] - w[q - 1][1]); }
        const tOut = dOut / vt + 30 + 8;
        const startPush = Math.max(parked + 30, P - tOut - 10);
        R.wait(startPush - parked);
        R.follow(W([[st.u, st.v], [st.u, lv]]), () => gy, () => 0.004, { reverse: true, smooth: 0.3 });
        const p2 = W([[st.u, lv], [fl.end, lv]]);
        R.turnTo(Math.atan2(-(p2[1][1] - p2[0][1]), p2[1][0] - p2[0][0]), 8);
        R.follow(chaikin(W(outRoute), 2), () => gy, (_d, rem) => Math.min(vt, 0.003 + rem * 0.06), { smooth: 1.5 });
        R.turnTo(yaw(1, 0), 4);
        R.wait(Math.max(4, P - R.t));
        // décollage : accélération, rotation, montée, disparition au loin
        const [lu, lvv] = L.lineup;
        const vr = 0.082, acc = 0.0028;
        const dRot = (vr * vr) / (2 * acc);
        R.follow(W([[lu, lvv], [lu + dRot, lvv]]), () => gy, (d) => Math.max(0.004, Math.sqrt(2 * acc * d)), { pitch: (d) => (d > dRot - 0.12 ? 0.15 * (1 - (dRot - d) / 0.12) : 0) });
        const climb = Math.tan((7 * Math.PI) / 180);
        R.follow(W([[lu + dRot, lvv], [lu + dRot + 16, lvv]]), (_x, _z, d) => gy + d * climb * Math.min(1, 0.4 + d * 1.5), (d) => Math.min(0.13, vr + d * 0.01), { pitch: () => 0.15 });
        planes.push({ mesh: st.cls, slot: counts[st.cls]++, track: R.track(T, (k / N) * T), color: LIVERIES[Math.floor(rnd() * LIVERIES.length)] });
        void B; void spec;
      });
    }

    // ----- ports -----
    for (const inf of c.infra.filter((i) => i.type === 'port' && ok(i))) {
      const P = portLayout(inf, c.seed);
      const T = 4200;
      P.berths.forEach((b: Berth) => {
        const R = new Rec();
        const yb = (x: number, z: number) => SEA_Y + 0.0001 * Math.sin(x * 40 + z * 30);
        const vIn = (_d: number, rem: number) => Math.min(0.03, 0.0025 + rem * 0.012);
        const vOut = (d: number) => Math.min(0.03, 0.0025 + d * 0.012);
        R.follow(chaikin(b.approach, 2), yb, vIn, { smooth: 6 });
        R.turnTo(b.yaw, 20);
        const dwell = 2300 + rnd() * 600;
        R.wait(dwell);
        if (b.reverseOut) {
          const back = b.depart.slice(0, b.reverseOut + 1);
          R.follow(back, yb, () => 0.0035, { reverse: true, smooth: 4 });
          R.follow(chaikin(b.depart.slice(b.reverseOut), 2), yb, vOut, { smooth: 6 });
        } else R.follow(chaikin(b.depart, 2), yb, vOut, { smooth: 6 });
        const mi = shipMeshOf(b.kind, rnd());
        // décalage : la plupart des navires sont à quai au lancement
        const tArr = 650;
        ships.push({ mesh: mi, slot: scounts[mi]++, track: R.track(Math.max(T, R.t + 60), -(tArr + rnd() * dwell * 0.8)) });
      });
      // remorqueurs qui accompagnent les manœuvres : patrouille dans le bassin
      for (let q = 0; q < 2; q++) {
        const R = new Rec();
        const loop: [number, number][] = [[P.X0 - 1.6, P.Z - 0.6 + q * 0.9], [P.X0 - 2.1, P.Z - 1.0 + q * 0.9], [P.X0 - 2.2, P.Z + 0.2 + q * 0.9], [P.X0 - 1.7, P.Z + 0.5 + q * 0.9], [P.X0 - 1.6, P.Z - 0.6 + q * 0.9]];
        R.follow(chaikin(loop, 3), () => SEA_Y, () => 0.006, { smooth: 3 });
        const mi = shipMeshOf('remorqueur', 0);
        ships.push({ mesh: mi, slot: scounts[mi]++, track: R.track(R.t, q * 200) });
      }
      // navires au mouillage
      for (let q = 0; q < 6; q++) {
        const z = P.Z - 4.5 - (q % 3) * 1.1 - rnd() * 0.4;
        const x = Math.min(P.X0 - 3.2 - Math.floor(q / 3) * 0.9 - rnd() * 0.3, coastX(c.seed, z) - 2);
        const kind: ShipKind = (['conteneurs', 'vraquier', 'petrolier', 'conteneurs', 'feeder', 'vraquier'] as ShipKind[])[q];
        const mi = shipMeshOf(kind, rnd());
        ships.push({ mesh: mi, slot: scounts[mi]++, fixed: fixedPose(x, SEA_Y, z, 2.0 + rnd() * 0.6) });
      }
    }
    // ----- trafic au large (couloirs nord-sud) -----
    const kinds: ShipKind[] = ['conteneurs', 'petrolier', 'vraquier', 'ferry', 'conteneurs', 'feeder', 'vraquier', 'conteneurs', 'ferry', 'petrolier', 'conteneurs', 'feeder'];
    kinds.forEach((kind, q) => {
      const mi = shipMeshOf(kind, rnd());
      lanes.push({ mesh: mi, slot: scounts[mi]++, z: -60 + rnd() * 120, dir: q % 2 ? 1 : -1, v: 0.02 + rnd() * 0.012, off: 6.5 + (q % 2) * 2 + rnd() * 1.5 });
    });

    // tampons d'instances
    for (const b of bufs) { b.mesh.thinInstanceCount = 0; }
    bufs = [];
    const mk = (mesh: Mesh, n: number, colors: boolean) => {
      const buf = new Float32Array(Math.max(1, n) * 16);
      mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
      let col: Float32Array | undefined;
      if (colors) { col = new Float32Array(Math.max(1, n) * 4).fill(1); mesh.thinInstanceSetBuffer('color', col, 4, true); }
      mesh.thinInstanceCount = n;
      mesh.setEnabled(n > 0);
      const e = { mesh, buf, col };
      bufs.push(e);
      return e;
    };
    const pb = planeMeshes.map((m, i) => mk(m, counts[i], false));
    const fb = finMeshes.map((m, i) => mk(m, counts[i], true));
    for (const p of planes) { const cc = col3(p.color ?? '#ffffff'); fb[p.mesh].col!.set([cc.r, cc.g, cc.b, 1], p.slot * 4); }
    for (const f of fb) f.mesh.thinInstanceBufferUpdated('color');
    const sb = shipMeshes.map((m, i) => mk(m, scounts[i], false));
    planeBufs = pb; finBufs = fb; shipBufs = sb;
    // modèles de la bibliothèque : instances dynamiques à la place des maillages procéduraux remplacés
    for (const b of [...libPlanes, ...libShips]) b?.buf.dispose();
    libPlanes = planeMeshes.map(() => null);
    libShips = shipMeshes.map(() => null);
    if (lib) {
      const L = lib;
      PLANES.forEach((_, i) => {
        const spec = LIB_PLANES[i], tpl = spec && L.get(spec[0]);
        if (!spec || !tpl || !counts[i]) return;
        libPlanes[i] = { buf: createThinInstances(tpl, counts[i], { dynamic: true, name: 'lib_avions_' + i }), pre: Matrix.Scaling(spec[1], spec[1], spec[1]).multiply(TO_X) };
        for (const m of [planeMeshes[i], finMeshes[i]]) { m.thinInstanceCount = 0; m.setEnabled(false); }
      });
      shipKinds.forEach((s, i) => {
        const id = LIB_SHIPS[s.kind], tpl = id && L.get(id);
        if (!tpl || !scounts[i]) return;
        libShips[i] = { buf: createThinInstances(tpl, scounts[i], { dynamic: true, name: 'lib_navires_' + i }), pre: TO_X };
        shipMeshes[i].thinInstanceCount = 0; shipMeshes[i].setEnabled(false);
      });
    }
  };
  let lib: ModelLibrary | null = null;
  type LibSlot = { buf: ThinInstanceBuffer; pre: Matrix } | null;
  let libPlanes: LibSlot[] = [];
  let libShips: LibSlot[] = [];
  let curCountry = country;
  let planeBufs: { mesh: Mesh; buf: Float32Array }[] = [];
  let finBufs: { mesh: Mesh; buf: Float32Array }[] = [];
  let shipBufs: { mesh: Mesh; buf: Float32Array }[] = [];
  build(country);
  const unsub = useStore.subscribe((s, prev) => { if (s.country && prev.country && s.country.infra !== prev.country.infra) { curCountry = s.country; build(s.country); } });
  scene.onDisposeObservable.addOnce(unsub);
  const cranes = createLibCranes();
  whenModels((l) => { if (scene.isDisposed) return; lib = l; build(curCountry); cranes.setLibrary(l); });

  const m = new Matrix();
  const zero = Matrix.Scaling(0, 0, 0);
  const pose = (a: Actor, t: number) => {
    if (a.fixed) { const f = a.fixed; return poseMatrix(m, f[0], f[1], f[2], f[3], f[4]); }
    const tr = a.track!;
    const n = tr.s.length / 6;
    const ft = ((((t - tr.off) % tr.T) + tr.T) % tr.T) / DT;
    const i0 = Math.floor(ft) % n, i1 = (i0 + 1) % n, w = ft - Math.floor(ft);
    const s = tr.s, o0 = i0 * 6, o1 = i1 * 6;
    if (s[o0 + 5] < 0.5) return zero;
    const yaw = s[o0 + 3] + angDiff(s[o0 + 3], s[o1 + 3]) * w;
    return poseMatrix(m, s[o0] + (s[o1] - s[o0]) * w, s[o0 + 1] + (s[o1 + 1] - s[o0 + 1]) * w, s[o0 + 2] + (s[o1 + 2] - s[o0 + 2]) * w, yaw, s[o0 + 4] + (s[o1 + 4] - s[o0 + 4]) * w);
  };
  let t = 0;
  return {
    update: (dt: number) => {
      t += dt;
      for (const p of planes) {
        const mm = pose(p, t);
        const L = libPlanes[p.mesh];
        if (L) { L.pre.multiplyToArray(mm, L.buf.matrices, p.slot * 16); continue; }
        mm.copyToArray(planeBufs[p.mesh].buf, p.slot * 16);
        mm.copyToArray(finBufs[p.mesh].buf, p.slot * 16);
      }
      const shipOut = (mesh: number, slot: number, mm: Matrix) => {
        const L = libShips[mesh];
        if (L) L.pre.multiplyToArray(mm, L.buf.matrices, slot * 16);
        else mm.copyToArray(shipBufs[mesh].buf, slot * 16);
      };
      for (const s of ships) shipOut(s.mesh, s.slot, pose(s, t));
      for (const l of lanes) {
        const z = ((((l.z + l.dir * l.v * t) + 60) % 120) + 120) % 120 - 60;
        const x = coastX(country.seed, z) - l.off;
        const x2 = coastX(country.seed, z + l.dir * 0.5) - l.off;
        shipOut(l.mesh, l.slot, poseMatrix(m, x, SEA_Y, z, Math.atan2(-(l.dir * 0.5), x2 - x), 0));
      }
      for (const b of [...planeBufs, ...finBufs, ...shipBufs]) if (b.mesh.thinInstanceCount > 0) b.mesh.thinInstanceBufferUpdated('matrix');
      for (const L of [...libPlanes, ...libShips]) if (L) { L.buf.count = L.buf.capacity; L.buf.commit(); }
      cranes.update(t);
    },
    dispose: () => { unsub(); for (const mm of [...planeMeshes, ...finMeshes, ...shipMeshes]) mm.dispose(); },
  };
}

export const SHIP_KINDS = Object.keys(SHIP_DIM);

/**
 * Portiques du port en modèles de la bibliothèque : structure en instances statiques, chariot (et spreader)
 * en instances dynamiques animées (va-et-vient le long de la flèche des STS, transversal sur les RTG).
 * Suit les reconstructions du port (PORT_CRANES_VERSION) ; masque alors les portiques procéduraux.
 */
function createLibCranes() {
  let lib: ModelLibrary | null = null;
  let version = -1;
  type Group = { body: ThinInstanceBuffer; trolley: ThinInstanceBuffer; poses: { w: Matrix; ph: number }[]; axis: 'x' | 'z'; course: [number, number]; pivot: number; part: ModelPart; speed: number };
  let groups: Group[] = [];
  const local = new Matrix();
  const rebuild = () => {
    for (const g of groups) { g.body.dispose(); g.trolley.dispose(); }
    groups = [];
    if (!lib) return;
    const all = [...PORT_CRANES.values()].filter((c) => c.mesh && !c.mesh.isDisposed());
    for (const [id, key, speed] of [['portique_sts', 'sts', 0.11], ['portique_rtg', 'rtg', 0.07]] as const) {
      const tpl = lib.get(id), part = tpl?.parts.chariot;
      const poses = all.flatMap((c) => c[key]);
      if (!tpl || !part || !poses.length) continue;
      const body = createThinInstances(tpl, poses.length, { name: 'lib_' + id });
      const trolley = createThinInstances(tpl, poses.length, { name: 'lib_' + id + '_chariot', source: part.mesh, dynamic: true });
      const w = poses.map((p, i) => {
        body.set(i, p.x, p.y, p.z, p.yaw, 1);
        return { w: Matrix.RotationY(p.yaw).multiply(Matrix.Translation(p.x, p.y, p.z)), ph: p.ph };
      });
      body.commit();
      const info = part.info;
      const axis = info?.axe === 'x' ? 'x' : 'z';
      const pv = info?.pivot_m ?? [0, 0, 0];
      groups.push({ body, trolley, poses: w, axis, course: info?.course_m ?? [0, 0], pivot: axis === 'x' ? pv[0] : pv[2], part, speed });
    }
    // portiques procéduraux masqués dès que les modèles sont en place
    if (groups.length) for (const c of all) c.mesh!.setEnabled(false);
  };
  return {
    setLibrary(l: ModelLibrary) { lib = l; version = -1; },
    update(t: number) {
      if (!lib) return;
      if (version !== PORT_CRANES_VERSION.v) { version = PORT_CRANES_VERSION.v; rebuild(); }
      for (const g of groups) {
        const [a, b] = g.course;
        g.poses.forEach((p, i) => {
          // cycle de manutention : aller-retour lent avec pauses aux extrémités
          const s = Math.sin(t * g.speed + p.ph);
          const u = 0.5 + 0.5 * Math.sign(s) * Math.min(1, Math.abs(s) * 1.6);
          const d = (a + (b - a) * u - g.pivot) * 0.001;
          if (g.axis === 'x') Matrix.TranslationToRef(d, 0, 0, local); else Matrix.TranslationToRef(0, 0, d, local);
          partMatrix(g.part, local, p.w).copyToArray(g.trolley.matrices, i * 16);
        });
        g.trolley.count = g.poses.length;
        g.trolley.commit();
      }
    },
  };
}
