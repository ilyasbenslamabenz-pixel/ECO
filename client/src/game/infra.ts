// Équipements sélectionnables à l'échelle réelle (1 unité = 1 km) : aéroport et port (airport.ts, port.ts),
// centrales (tours aéroréfrigérantes hyperboloïdes, cheminées rayées), stades, hôpitaux, universités,
// gares, zones d'activité, éoliennes, parcs solaires, barrage… Chaque équipement est un maillage fusionné
// (couleurs par sommet, matériau partagé) portant metadata = { kind: 'infra', id } ; les éléments répétés
// (conteneurs, panneaux, pales, voitures) sont des instances fines. Les fumées suivent les émissions.
import { Color3, Color4, DynamicTexture, Matrix, Mesh, ParticleSystem, Quaternion, StandardMaterial, Vector3, type Scene } from '@babylonjs/core';
import { mulberry32 } from '../../../shared/noise';
import type { CountryDef, Infra } from '../../../shared/sim/types';
import { airportLayout, buildAirport } from './airport';
import { Kit, M, addInst, applyInst, buildLights, buildPools, newInst, newLights, unitBox, type Col } from './infraModels';
import { SEA_Y, buildPort, portLayout } from './port';
import { VS, type Grid } from './terrain';

interface Smoke { pos: Vector3; steam: boolean; size: number }

export function createInfrastructure(scene: Scene, grid: Grid, country: CountryDef) {
  const roots: Mesh[] = [];
  const extras: Mesh[] = []; // feux et instances non sélectionnables
  const smokes: Smoke[] = [];
  const rotors: { mesh: Mesh; hubs: { x: number; y: number; z: number; yaw: number; ph: number; s: number }[]; buf: Float32Array }[] = [];
  const siteMat = new StandardMaterial('chantierMat', scene);
  siteMat.diffuseColor = Color3.FromHexString('#ffb703');
  siteMat.emissiveColor = Color3.FromHexString('#ffb703').scale(0.35);
  siteMat.specularColor = Color3.Black();
  siteMat.alpha = 0.55;
  siteMat.backFaceCulling = false;
  const closedMat = new StandardMaterial('fermeMat', scene);
  closedMat.diffuseColor = Color3.FromHexString('#5c5f66');
  closedMat.specularColor = Color3.Black();
  closedMat.backFaceCulling = false;

  const tag = (m: Mesh, i: Infra) => { m.metadata = { kind: 'infra', id: i.id }; m.isPickable = true; return m; };
  /** Altitude d'une plateforme horizontale couvrant un disque de rayon r. */
  const padY = (x: number, z: number, r: number) => {
    let y = grid.y(x, z);
    for (let a = 0; a < 8; a++) for (const f of [0.5, 1]) y = Math.max(y, grid.y(x + Math.cos(a * 0.785) * r * f, z + Math.sin(a * 0.785) * r * f));
    return y;
  };
  /** Point local → monde (pour les fumées). */
  const world = (k: Kit, x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), k.base);
  const finish = (k: Kit, i: Infra, name: string) => {
    const site = i.status === 'construction' || i.status === 'chantier';
    if (site) {
      // grue à tour à côté de l'emprise
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let q = 0; q < k.p.length; q += 3) { x0 = Math.min(x0, k.p[q]); x1 = Math.max(x1, k.p[q]); y0 = Math.min(y0, k.p[q + 1]); y1 = Math.max(y1, k.p[q + 1]); z0 = Math.min(z0, k.p[q + 2]); z1 = Math.max(z1, k.p[q + 2]); }
      const h = Math.min(0.09, Math.max(0.035, (y1 - y0) * 1.3));
      const save = k.base;
      k.base = Matrix.Identity();
      k.box(x1, y0, z1, 0.0025, h, 0.0025, '#f77f00');
      k.box(x1 - h * 0.3, y0 + h, z1, h * 1.0, 0.0018, 0.0018, '#f77f00');
      k.base = save;
    }
    const m = tag(k.build(name, scene), i);
    if (site) { m.material = siteMat; m.useVertexColors = false; }
    else if (i.status === 'closed') { m.material = closedMat; m.useVertexColors = false; }
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    roots.push(m);
    return m;
  };
  const active = (i: Infra) => !i.status || i.status === 'active';
  const pushSmoke = (k: Kit, i: Infra, x: number, y: number, z: number, steam: boolean, size: number) => { if (active(i)) smokes.push({ pos: world(k, x, y, z), steam, size }); };

  // petits modèles réutilisables
  const building = (k: Kit, x: number, z: number, w: number, d: number, h: number, mat: number, roof: Col = '#b9bcc0', col: Col = '#ffffff', ry = 0) => {
    k.box(x, -0.004, z, w, h + 0.004, d, col, { mat, ry });
    k.box(x, h, z, w + 0.001, 0.0012, d + 0.001, roof, { mat: M.concrete, ry });
    k.box(x + w * 0.2 * Math.cos(ry), h + 0.0012, z - w * 0.2 * Math.sin(ry), Math.min(0.01, w * 0.2), 0.002, Math.min(0.008, d * 0.3), '#9aa0a6', { ry });
  };
  const tree = (k: Kit, x: number, z: number, s = 1) => { k.cyl(x, 0, z, 0.0004 * s, 0.0004 * s, 0.003 * s, '#5b4632', { tess: 4 }); k.sphere(x, 0.0055 * s, z, 0.0032 * s, '#3f6b35', { seg: 3 }); };
  const parking = (k: Kit, x: number, z: number, w: number, d: number, rnd: () => number, ry = 0) => {
    k.rect(x, 0.0004, z, w, d, '#505255', M.asphalt, ry);
    const pal = ['#e63946', '#f1faee', '#457b9d', '#1d3557', '#adb5bd', '#2b2d42', '#ffffff'];
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (let u = -w / 2 + 0.003; u < w / 2 - 0.002; u += 0.0028) for (let v = -d / 2 + 0.004; v < d / 2; v += 0.012) {
      if (rnd() < 0.35) continue;
      k.box(x + u * cs + v * sn, 0.0005, z - u * sn + v * cs, 0.0018, 0.0014, 0.0044, pal[Math.floor(rnd() * pal.length)], { ry });
    }
  };
  const chimney = (k: Kit, x: number, z: number, h: number, r: number, bands: boolean) => {
    const n = bands ? 8 : 1;
    for (let b = 0; b < n; b++) {
      const y0 = (b / n) * h, y1 = ((b + 1) / n) * h;
      const r0 = r * (1 - (0.35 * b) / n), r1 = r * (1 - (0.35 * (b + 1)) / n);
      k.cyl(x, y0, z, r0, r1, y1 - y0, bands && b >= n - 3 ? (b % 2 ? '#f1f1f1' : '#c1121f') : '#bdbab3', { tess: 12, mat: bands && b >= n - 3 ? M.plain : M.concrete });
    }
    k.box(x, h, z, 0.0012, 0.0008, 0.0012, '#ff2020', { glow: 3 });
  };
  const coolingTower = (k: Kit, x: number, z: number, s: number) => {
    // hyperboloïde de révolution : base Ø 130 m, col Ø 76 m à 120 m, sommet 165 m
    const prof: [number, number][] = [];
    for (let j = 0; j <= 12; j++) {
      const yy = (j / 12) * 0.165;
      prof.push([0.038 * Math.sqrt(1 + ((yy - 0.12) / 0.0864) ** 2) * s, yy * s]);
    }
    k.lathe(prof, x, 0, z, (j) => (j === 0 ? '#9a978f' : '#d6d3cc'), { tess: 28, mat: M.concrete });
    k.lathe([[prof[0][0] * 1.02, 0], [prof[0][0] * 1.02, 0.006 * s]], x, 0, z, '#5a5852', { tess: 28 });
  };
  const dome = (k: Kit, x: number, y: number, z: number, r: number, c: Col, mat = 0) => {
    const prof: [number, number][] = [];
    for (let j = 0; j <= 6; j++) { const a = (j / 6) * Math.PI / 2; prof.push([Math.cos(a) * r + 1e-5, Math.sin(a) * r]); }
    k.lathe(prof, x, y, z, c, { tess: 18, mat });
  };
  const pylon = (k: Kit, x: number, z: number, h = 0.04) => {
    k.cyl(x, 0, z, 0.003, 0.0006, h, '#8d99ae', { tess: 4 });
    for (const y of [h * 0.75, h * 0.92]) k.box(x, y, z, 0.002, 0.0008, 0.016, '#8d99ae');
  };

  for (const i of country.infra) {
    const rnd = mulberry32(i.id * 7919 + 17);
    const y = grid.y(i.x, i.z);
    const k = new Kit();
    switch (i.type) {
      case 'aeroport': {
        const L = airportLayout(i, grid);
        const lights = newLights(), pools = newLights();
        const { mesh, extra } = buildAirport(scene, grid, i, L, lights, pools);
        tag(mesh, i);
        roots.push(mesh);
        for (const e of extra) { tag(e, i); roots.push(e); }
        if (i.status === 'construction' || i.status === 'chantier') { mesh.material = siteMat; mesh.useVertexColors = false; }
        else if (i.status === 'closed') { mesh.material = closedMat; mesh.useVertexColors = false; }
        else { const lm = buildLights(scene, 'aeroport-feux', lights, 0.0035); if (lm) extras.push(lm); const pm = buildPools(scene, 'aeroport-halos', pools); if (pm) extras.push(pm); }
        continue;
      }
      case 'port': {
        const P = portLayout(i, country.seed);
        const lights = newLights(), pools = newLights();
        const { mesh, extra } = buildPort(scene, grid, i, P, lights, pools);
        tag(mesh, i);
        roots.push(mesh);
        for (const e of extra) { tag(e, i); roots.push(e); }
        if (i.status === 'construction' || i.status === 'chantier') { mesh.material = siteMat; mesh.useVertexColors = false; }
        else if (i.status === 'closed') { mesh.material = closedMat; mesh.useVertexColors = false; }
        else { const lm = buildLights(scene, 'port-feux', lights, 0.004); if (lm) extras.push(lm); const pm = buildPools(scene, 'port-halos', pools); if (pm) extras.push(pm); }
        continue;
      }
      case 'parc_eolien': case 'parc_eolien_mer': {
        const sea = i.type === 'parc_eolien_mer';
        const n = sea ? 4 : 3, sp = sea ? 0.75 : 0.45;
        const hubH = sea ? 0.125 : 0.1, blade = sea ? 0.085 : 0.065;
        k.frame(0, 0, 0, 0);
        const hubs: { x: number; y: number; z: number; yaw: number; ph: number; s: number }[] = [];
        const yaw = Math.PI + 0.25; // rotors face au vent d'ouest
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          const lx = (a - (n - 1) / 2) * sp + (b % 2) * sp * 0.3, lz = (b - (n - 1) / 2) * sp;
          const c = Math.cos(i.rot), s = Math.sin(i.rot);
          const x = i.x + lx * c + lz * s, z = i.z - lx * s + lz * c;
          const gy = sea ? SEA_Y : grid.y(x, z);
          if (sea) { k.cyl(x, gy - 0.01, z, 0.0042, 0.0042, 0.03, '#f2c14e', { tess: 10 }); k.cyl(x, gy + 0.02, z, 0.007, 0.007, 0.0015, '#9aa0a6', { tess: 10 }); }
          else k.cyl(x, gy - 0.003, z, 0.008, 0.008, 0.004, '#a8a49b', { tess: 10, mat: M.concrete });
          k.cyl(x, gy, z, sea ? 0.0035 : 0.003, 0.0016, hubH, '#f1f3f5', { tess: 10 });
          // nacelle
          const nx = Math.cos(yaw), nz = -Math.sin(yaw);
          k.box(x - nx * 0.003, gy + hubH - 0.002, z - nz * 0.003, 0.012, 0.0038, 0.004, '#eceff1', { ry: yaw });
          k.box(x - nx * 0.008, gy + hubH + 0.0018, z - nz * 0.008, 0.0009, 0.0009, 0.0009, '#ff2020', { glow: 3 });
          hubs.push({ x: x + nx * 0.0035, y: gy + hubH, z: z + nz * 0.0035, yaw, ph: rnd() * 6.28, s: 0.9 + rnd() * 0.2 });
        }
        const mast = finish(k, i, sea ? 'eoliennes-mer' : 'eoliennes');
        mast.freezeWorldMatrix();
        // rotor : moyeu + 3 pales (plan YZ, axe selon +x), en instances fines animées
        const rk = new Kit();
        rk.sphere(0.0015, 0, 0, 0.0022, '#f1f3f5', { seg: 4 });
        for (let b = 0; b < 3; b++) {
          const a = (b * Math.PI * 2) / 3;
          const save = rk.base;
          rk.base = Matrix.RotationX(a);
          rk.box(0, 0.0015, 0, 0.0012, blade * 0.25, 0.0042, '#f8f9fa', { rx: 0 });
          rk.box(0, 0.0015 + blade * 0.25, 0, 0.001, blade * 0.4, 0.0032, '#f8f9fa');
          rk.box(0, 0.0015 + blade * 0.65, 0, 0.0008, blade * 0.35, 0.0018, '#f8f9fa');
          rk.base = save;
        }
        const rm = tag(rk.build('rotors', scene), i);
        if (i.status === 'construction' || i.status === 'chantier') { rm.material = siteMat; rm.useVertexColors = false; }
        const buf = new Float32Array(hubs.length * 16);
        rm.thinInstanceSetBuffer('matrix', buf, 16, false);
        rm.alwaysSelectAsActiveMesh = true;
        roots.push(rm);
        rotors.push({ mesh: rm, hubs, buf });
        continue;
      }
      case 'parc_solaire': {
        // tables orientées plein sud (−z), suivant le relief
        k.frame(i.x, 0, i.z, 0);
        const W = 0.9, D = 0.62;
        const panels = newInst();
        const c = Math.cos(i.rot * 0.15), s = Math.sin(i.rot * 0.15);
        for (let v = -D / 2; v < D / 2; v += 0.0085) for (let u = -W / 2; u < W / 2; u += 0.032) {
          if (Math.abs(u) < 0.006 || Math.abs(v - 0.1) < 0.006) continue; // pistes d'accès
          const x = i.x + u * c, z = i.z + v - u * s * 0.2;
          addInst(panels, x, grid.y(x, z) + 0.0013, z, 0, 0.03, 1, 1, rnd() < 0.03 ? '#2b3f5c' : '#ffffff');
        }
        for (let q = 0; q < 6; q++) { const x = (q % 3 - 1) * 0.3, z = (Math.floor(q / 2) - 1) * 0.2 + 0.1; k.box(x, grid.y(i.x + x, i.z + z), z, 0.006, 0.0028, 0.0025, '#e9ecef'); }
        const fy = grid.y(i.x, i.z);
        k.box(0.48, fy - 0.004, 0, 0.03, 0.008, 0.02, '#dee2e6');
        for (let q = 0; q < 3; q++) pylon(k, 0.5 + q * 0.012, 0.02, 0.02 + fy);
        finish(k, i, 'solaire');
        const pk = new Kit();
        pk.box(0, 0, 0, 1, 0.00012, 0.0042, '#34507e', { rx: -0.44 });
        pk.box(0, 0.00013, 0, 1, 0.00002, 0.0001, '#c9d1d9', { rx: -0.44 });
        pk.box(0, -0.0013, 0.0012, 1, 0.0013, 0.0002, '#8d99ae');
        pk.box(0, -0.0013, -0.0012, 1, 0.0008, 0.0002, '#8d99ae');
        const pm = applyInst(pk.build('panneaux', scene), panels);
        if (pm) {
          tag(pm, i);
          if (i.status === 'construction' || i.status === 'chantier') { pm.material = siteMat; pm.useVertexColors = false; }
          else if (i.status === 'closed') { pm.material = closedMat; pm.useVertexColors = false; }
          roots.push(pm);
        }
        continue;
      }
      case 'barrage': {
        // barrage-poids en béton, couronnement au niveau du lac, crête selon z (lac à l'est)
        const l = country.lakes.reduce((b, q) => (Math.hypot(q.x - i.x, q.z - i.z) < Math.hypot(b.x - i.x, b.z - i.z) ? q : b), country.lakes[0] ?? { x: i.x + 1, z: i.z, r: 1, level: y / VS });
        const top = l.level * VS + 0.007;
        const R = l.r * 1.25, dx = Math.abs(l.x - i.x);
        const len = Math.max(0.45, 2 * Math.sqrt(Math.max(0, R * R - dx * dx)) * 1.05);
        let bot = top;
        for (let q = -4; q <= 4; q++) bot = Math.min(bot, grid.y(i.x - 0.05, i.z + (q / 4) * len / 2));
        bot -= 0.01;
        const H = top - bot, base = Math.max(0.03, H * 0.8);
        k.frame(i.x, 0, i.z, 0);
        const zL = len / 2;
        // parement amont vertical, aval incliné
        k.quad([0.004, bot, -zL], [0.004, bot, zL], [0.004, top, zL], [0.004, top, -zL], '#c9c6bf', M.concrete);
        k.quad([-base, bot, -zL], [-base, bot, zL], [-0.006, top, zL], [-0.006, top, -zL], '#bdbab2', M.concrete);
        k.box(-0.001, top, 0, 0.011, 0.002, len, '#d4d1ca', { mat: M.concrete });
        for (const s of [-1, 1]) k.box(-base / 2, bot, s * zL, base + 0.01, H, 0.004, '#bdbab2', { mat: M.concrete });
        // évacuateur de crues en marches et usine au pied
        for (let q = 0; q < 6; q++) k.box(-0.006 - (q / 6) * (base - 0.006), top - (q / 6) * H - H / 6, 0, 0.006 + base / 6, 0.002, 0.08, '#e3e0d8', { mat: M.concrete });
        k.box(-base - 0.02, bot, 0.12, 0.04, 0.02, 0.06, '#e9ecef', { mat: M.office });
        for (const dz of [-0.015, 0, 0.015]) k.beam(new Vector3(-0.006, top - 0.01, 0.12 + dz), new Vector3(-base - 0.002, bot + 0.012, 0.12 + dz), 0.003, 0.003, '#495057');
        for (let z = -zL + 0.02; z < zL; z += 0.05) { k.box(0, top + 0.002, z, 0.0005, 0.006, 0.0005, '#868e96'); k.box(0, top + 0.008, z, 0.0016, 0.0008, 0.0016, '#ffd9a0', { glow: 1 }); }
        k.rect(-base - 0.1, bot + 0.004, 0, 0.18, 0.05, '#2f6f95', M.plain);
        for (const z of [0.15, 0.3]) pylon(k, -base - 0.05, z, bot + 0.05);
        finish(k, i, 'barrage');
        continue;
      }
    }

    // modèles posés sur une plateforme locale
    const big = ['centrale_nucleaire', 'centrale_charbon', 'centrale_gaz', 'stade', 'zone_industrielle', 'universite', 'zone_commerciale', 'gare', 'hopital'].includes(i.type);
    const R = i.type === 'centrale_nucleaire' ? 0.5 : i.type === 'zone_industrielle' ? 0.55 : ['hopital', 'gare', 'zone_commerciale'].includes(i.type) ? 0.13 : big ? 0.2 : 0.06;
    // plateforme limitée à 15 m au-dessus du sol local : près d'une berge ou d'un relief, padY pouvait créer un « socle » géant
    const py = big ? Math.min(padY(i.x, i.z, R), y + 0.015) : y;
    k.frame(i.x, py, i.z, i.rot);
    if (big) {
      // plateforme terrassée (talus jusqu'au sol)
      const drop = Math.min(0.03, py - Math.min(y, grid.y(i.x + R, i.z), grid.y(i.x - R, i.z), grid.y(i.x, i.z + R), grid.y(i.x, i.z - R)) + 0.01);
      const green = ['centrale_nucleaire', 'centrale_charbon', 'centrale_gaz', 'stade', 'universite'].includes(i.type);
      k.lathe([[R * 1.25, -drop], [R * 1.02, -0.0002], [0.0001, -0.0002]], 0, 0, 0, green ? '#9a9c6c' : '#a3a099', { tess: 20, mat: green ? M.grass : M.concrete });
    }
    switch (i.type) {
      case 'centrale_nucleaire': {
        const units = Math.max(2, Math.min(4, Math.round(i.capacity / 900)));
        k.rect(0, 0.0003, 0, 0.9, 0.62, '#b9b6ae', M.concrete);
        for (let u = 0; u < units; u++) {
          const x = (u - (units - 1) / 2) * 0.2;
          // bâtiment réacteur : cylindre + dôme
          k.cyl(x, 0, 0.05, 0.023, 0.023, 0.045, '#e6e3dc', { tess: 24, mat: M.concrete });
          dome(k, x, 0.045, 0.05, 0.023, '#d9d6cf', M.concrete);
          k.box(x, 0, 0.12, 0.13, 0.034, 0.042, '#dfe3e6', { mat: M.steel });
          k.box(x, 0.034, 0.12, 0.132, 0.0015, 0.044, '#8d99ae', { mat: M.metal });
          k.box(x + 0.04, 0, 0.05, 0.035, 0.03, 0.05, '#c9c6bf', { mat: M.concrete });
          k.cyl(x + 0.05, 0, 0.0, 0.0025, 0.002, 0.07, '#c9c6bf', { tess: 8, mat: M.concrete });
          // tour aéroréfrigérante
          coolingTower(k, x, -0.2, 1);
          pushSmoke(k, i, x, 0.17, -0.2, true, 0.06);
        }
        k.box(-0.36, 0, 0.24, 0.12, 0.016, 0.06, '#ffffff', { mat: M.office });
        k.rect(-0.2, 0.0006, 0.26, 0.16, 0.06, '#505255', M.asphalt);
        for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) pylon(k, 0.28 + a * 0.025, 0.2 + b * 0.03, 0.025);
        for (let q = 0; q < 4; q++) pylon(k, 0.45 + q * 0.1, 0.3 + q * 0.04, 0.05);
        // clôture
        for (const [a, b, w, d] of [[0, -0.31, 0.9, 0.001], [0, 0.31, 0.9, 0.001], [-0.45, 0, 0.001, 0.62], [0.45, 0, 0.001, 0.62]]) k.box(a, 0, b, w, 0.0025, d, '#9aa0a6');
        break;
      }
      case 'centrale_charbon': case 'centrale_fioul': case 'centrale_biomasse': {
        const coal = i.type === 'centrale_charbon';
        const s = coal ? 1 : 0.6;
        k.rect(0, 0.0003, 0, 0.4 * s + 0.1, 0.3 * s + 0.08, '#a8a59e', M.concrete);
        k.box(0, 0, 0, 0.07 * s, 0.09 * s, 0.06 * s, '#8e9aa6', { mat: M.steel });
        k.box(0.07 * s, 0, 0, 0.07 * s, 0.035 * s, 0.1 * s, '#c5ccd3', { mat: M.steel });
        k.box(-0.06 * s, 0, 0, 0.04 * s, 0.045 * s, 0.07 * s, '#6c7a89', { mat: M.steel });
        chimney(k, -0.12 * s, 0.0, 0.2 * s, 0.009 * s, true);
        pushSmoke(k, i, -0.12 * s, 0.2 * s + 0.004, 0, false, 0.05 * s);
        if (coal) {
          chimney(k, -0.12, 0.05, 0.18, 0.008, true);
          pushSmoke(k, i, -0.12, 0.184, 0.05, false, 0.045);
          coolingTower(k, 0.18, -0.12, 0.75);
          pushSmoke(k, i, 0.18, 0.126, -0.12, true, 0.045);
          for (let q = 0; q < 3; q++) k.gable(-0.05 + q * 0.0, 0, 0.14 + q * 0.05, 0.22, 0.014, 0.04, q === 1 ? '#3a3a3a' : '#262626');
          k.beam(new Vector3(0.06, 0.004, 0.13), new Vector3(0, 0.07, 0.03), 0.003, 0.004, '#8d99ae');
        } else k.cyl(0.06, 0, -0.07, 0.02, 0.02, 0.02, i.type === 'centrale_biomasse' ? '#8d6e63' : '#e9ecef', { tess: 14 });
        for (let a = 0; a < 4; a++) pylon(k, 0.12 + a * 0.03, 0.1, 0.03);
        break;
      }
      case 'centrale_gaz': case 'centrale_geothermique': {
        k.rect(0, 0.0003, 0, 0.3, 0.2, '#a8a59e', M.concrete);
        k.box(0, 0, 0, 0.1, 0.03, 0.035, '#d9dee3', { mat: M.steel });
        k.box(0, 0.03, 0, 0.102, 0.0012, 0.037, '#8d99ae', { mat: M.metal });
        const n = Math.max(1, Math.min(3, Math.round(i.capacity / 900)));
        for (let q = 0; q < n; q++) {
          const x = (q - (n - 1) / 2) * 0.05;
          k.box(x, 0, -0.05, 0.03, 0.035, 0.022, '#aab4bf', { mat: M.steel });
          k.cyl(x, 0, -0.07, 0.0035, 0.0032, 0.06, '#b5b9be', { tess: 10 });
          pushSmoke(k, i, x, 0.062, -0.07, i.type === 'centrale_geothermique', 0.03);
        }
        // aérocondenseur sur pilotis avec ventilateurs
        for (const dx of [-0.035, 0.035]) for (const dz of [-0.015, 0.015]) k.box(0.0 + dx, 0, 0.06 + dz, 0.002, 0.02, 0.002, '#8d99ae');
        k.box(0, 0.02, 0.06, 0.08, 0.006, 0.035, '#aeb6bf', { mat: M.steel });
        for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) k.cyl(-0.03 + a * 0.02, 0.026, 0.051 + b * 0.018, 0.007, 0.007, 0.0008, '#3d434a', { tess: 12 });
        for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) pylon(k, 0.09 + a * 0.016, -0.03 + b * 0.025, 0.022);
        k.cyl(-0.11, 0, 0.05, 0.014, 0.014, 0.015, '#eeebe4', { tess: 16 });
        break;
      }
      case 'centrale_smr': {
        k.rect(0, 0.0003, 0, 0.16, 0.12, '#b9b6ae', M.concrete);
        k.cyl(0, 0, 0, 0.012, 0.012, 0.02, '#e6e3dc', { tess: 18, mat: M.concrete });
        dome(k, 0, 0.02, 0, 0.012, '#d9d6cf', M.concrete);
        k.box(0.035, 0, 0, 0.04, 0.018, 0.03, '#dfe3e6', { mat: M.steel });
        break;
      }
      case 'stockage_batteries': {
        for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) k.box((a - 2.5) * 0.016, 0, (b - 1) * 0.008, 0.0122, 0.0029, 0.0025, '#f1f3f5', { mat: M.steel });
        k.box(0.06, 0, 0, 0.012, 0.006, 0.01, '#adb5bd');
        break;
      }
      case 'stade': {
        const s = Math.max(0.7, Math.min(1, Math.sqrt(i.capacity / 80000)));
        const sx = 0.075 * s, sz = 0.055 * s;
        const team = ['#c1121f', '#1d4e89', '#2a9d8f', '#f77f00'][i.id % 4];
        k.lathe([[2.35, 0.0004], [2.6, 0.0004]], 0, 0, 0, '#c9c3b6', { tess: 40, sx, sz, mat: M.paving });
        // tribunes : deux anneaux en gradins
        k.lathe([[1.0, 0.002], [1.05, 0.004], [1.45, 0.02], [1.5, 0.022], [1.95, 0.04]], 0, 0, 0, (j) => (j < 2 ? '#e9ecef' : j < 3 ? team : j < 4 ? '#e9ecef' : team), { tess: 40, sx, sz });
        // façade extérieure en béton clair ajouré (le métal réfléchissait un ciel sombre et donnait un « tambour » noir)
        k.lathe([[2.0, 0.0], [2.0, 0.036], [1.95, 0.036]], 0, 0, 0, '#d8d4cc', { tess: 40, sx, sz, mat: M.concrete });
        // toit annulaire (membrane) et rampe lumineuse
        k.lathe([[2.08, 0.043], [1.6, 0.05], [1.45, 0.049]], 0, 0, 0, '#f4f5f6', { tess: 40, sx, sz });
        k.lathe([[1.46, 0.0485], [1.44, 0.0478]], 0, 0, 0, '#fff4d6', { tess: 40, sx, sz, glow: 1 });
        for (let q = 0; q < 16; q++) { const a = (q / 16) * Math.PI * 2; k.box(Math.cos(a) * 2.02 * sx, 0, Math.sin(a) * 2.02 * sz, 0.003, 0.05, 0.003, '#adb5bd', { ry: -a }); }
        // pelouse rayée et lignes
        const pw = 0.105, pd = 0.068;
        k.rect(0, 0.001, 0, pw + 0.03, pd + 0.02, '#3f7d3a', M.grass);
        for (let q = 0; q < 12; q++) k.rect(-pw / 2 + (q + 0.5) * (pw / 12), 0.0012, 0, pw / 12, pd, q % 2 ? '#4f9a45' : '#45883e', M.grass);
        for (const [a, b, w, d] of [[0, -pd / 2, pw, 0.0004], [0, pd / 2, pw, 0.0004], [-pw / 2, 0, 0.0004, pd], [pw / 2, 0, 0.0004, pd], [0, 0, 0.0004, pd]]) k.rect(a, 0.0014, b, w, d, '#f1f1ee');
        k.lathe([[0.0092, 0.0014], [0.0088, 0.0014]], 0, 0, 0, '#f1f1ee', { tess: 24 });
        for (const s2 of [-1, 1]) { k.rect(s2 * (pw / 2 - 0.0083), 0.0014, 0, 0.0004, 0.04, '#f1f1ee'); k.rect(s2 * (pw / 2 - 0.0041), 0.0014, -0.02, 0.0083, 0.0004, '#f1f1ee'); k.rect(s2 * (pw / 2 - 0.0041), 0.0014, 0.02, 0.0083, 0.0004, '#f1f1ee'); }
        parking(k, 0, 0.19 * s, 0.25, 0.05, rnd);
        parking(k, 0.24 * s, 0, 0.05, 0.2, rnd, Math.PI / 2);
        break;
      }
      case 'hopital': case 'clinique': case 'centre_medical': {
        const s = i.type === 'hopital' ? Math.max(0.6, Math.min(1, Math.sqrt(i.capacity / 1100))) : 0.4;
        const L = 0.17 * s;
        k.rect(0, 0.0004, 0, L + 0.06, 0.16 * s + 0.04, '#bdbab3', M.concrete);
        building(k, 0, 0, L, 0.026, 0.032 * Math.max(0.7, s), M.glass);
        const teeth = Math.max(2, Math.round(4 * s));
        for (let q = 0; q < teeth; q++) building(k, -L / 2 + 0.015 + (q * (L - 0.03)) / Math.max(1, teeth - 1), 0.05 * s, 0.022, 0.075 * s, 0.02 * Math.max(0.8, s), M.office);
        // tour avec héliport
        const hx = L / 2 - 0.02, hz = -0.035 * s;
        building(k, hx, hz, 0.036, 0.036, 0.048 * Math.max(0.75, s), M.glass);
        const hy = 0.048 * Math.max(0.75, s) + 0.0012;
        k.cyl(hx, hy, hz, 0.014, 0.014, 0.0012, '#2f3e46', { tess: 20 });
        k.lathe([[0.0125, hy + 0.00125], [0.0118, hy + 0.00125]], hx, 0, hz, '#f1faee', { tess: 20 });
        k.box(hx - 0.004, hy + 0.0012, hz, 0.0012, 0.0002, 0.01, '#f1faee');
        k.box(hx + 0.004, hy + 0.0012, hz, 0.0012, 0.0002, 0.01, '#f1faee');
        k.box(hx, hy + 0.0012, hz, 0.008, 0.0002, 0.0012, '#f1faee');
        for (let a = 0; a < 8; a++) k.box(hx + Math.cos(a * 0.785) * 0.014, hy + 0.0012, hz + Math.sin(a * 0.785) * 0.014, 0.0008, 0.0006, 0.0008, '#ffe066', { glow: 1 });
        // croix rouge lumineuse
        const cy = 0.032 * Math.max(0.7, s) + 0.0014;
        k.box(-L / 4, cy, 0, 0.014, 0.0012, 0.004, '#e63946', { glow: 1 });
        k.box(-L / 4, cy, 0, 0.004, 0.0012, 0.014, '#e63946', { glow: 1 });
        // urgences
        k.box(-L / 2 - 0.006, 0.006, -0.015, 0.02, 0.0012, 0.012, '#e63946');
        parking(k, 0, -0.07 * s, L, 0.035, rnd);
        for (let q = 0; q < 10; q++) tree(k, -L / 2 - 0.02 + rnd() * 0.01, -0.06 + q * 0.014, 1.6);
        break;
      }
      case 'universite': {
        const s = Math.max(0.7, Math.min(1, Math.sqrt(i.capacity / 60000)));
        k.rect(0, 0.0004, 0, 0.42 * s, 0.32 * s, '#6f8f4f', M.grass);
        k.rect(0, 0.0007, 0, 0.16 * s, 0.1 * s, '#7fa25a', M.grass);
        k.rect(0, 0.0008, 0, 0.012, 0.1 * s, '#cfc8b8', M.paving);
        k.rect(0, 0.0008, 0, 0.16 * s, 0.012, '#cfc8b8', M.paving);
        for (const sgn of [-1, 1]) {
          building(k, 0, sgn * 0.075 * s, 0.16 * s, 0.025, 0.018, M.brick, '#7b5f4a');
          building(k, sgn * 0.11 * s, 0, 0.025, 0.12 * s, 0.016, M.brick, '#7b5f4a');
        }
        // bibliothèque à coupole
        k.cyl(-0.11 * s, 0, -0.11 * s, 0.018, 0.018, 0.016, '#e8e2d4', { tess: 18, mat: M.concrete });
        dome(k, -0.11 * s, 0.016, -0.11 * s, 0.016, '#6c8d7a', M.metal);
        building(k, 0.12 * s, -0.11 * s, 0.06, 0.04, 0.026, M.glass);
        // piste d'athlétisme
        k.lathe([[1.0, 0.0008], [1.35, 0.0008]], 0.12 * s, 0, 0.11 * s, '#b5523b', { tess: 24, sx: 0.04, sz: 0.022 });
        k.lathe([[0.0001, 0.0009], [1.0, 0.0009]], 0.12 * s, 0, 0.11 * s, '#4f8f45', { tess: 24, sx: 0.04, sz: 0.022, mat: M.grass });
        parking(k, -0.12 * s, 0.13 * s, 0.1, 0.035, rnd);
        for (let q = 0; q < 40; q++) tree(k, (rnd() - 0.5) * 0.4 * s, (rnd() - 0.5) * 0.3 * s * (rnd() < 0.5 ? 1 : 0.2) + (rnd() < 0.5 ? 0.14 : -0.14) * s, 1.5 + rnd());
        break;
      }
      case 'gare': {
        const s = Math.max(0.55, Math.min(1, Math.sqrt(i.capacity / 400000)));
        const nV = s > 0.8 ? 3 : s > 0.6 ? 2 : 1;
        const len = 0.25 * s, span = 0.055;
        const w = nV * span;
        // voies et quais (prolongés hors de la halle)
        k.rect(len / 2 + 0.05, 0.0004, 0, len + 0.5, w + 0.01, '#6b625a', M.concrete);
        for (let t = 0; t < nV * 4; t++) {
          const z = -w / 2 + 0.006 + t * (w - 0.012) / Math.max(1, nV * 4 - 1);
          if (t % 2) k.box(len / 2 + 0.02, 0.0004, z, len + 0.2, 0.001, 0.008, '#bdbab2', { mat: M.concrete });
          else for (const dz of [-0.0007, 0.0007]) k.rect(len / 2 + 0.05, 0.0012, z + dz, len + 0.5, 0.0003, '#8a8580');
        }
        // halles voûtées (métal + verrière)
        for (let q = 0; q < nV; q++) {
          const z = -w / 2 + span / 2 + q * span;
          k.vault(len / 2, 0.012, z, span * 0.98, len, 0.022, '#8fa3ad', { mat: M.metal, ry: Math.PI / 2, ends: false, seg: 12 });
          k.vault(len / 2, 0.0335, z, span * 0.3, len * 0.96, 0.0025, '#cfe3ea', { ry: Math.PI / 2, ends: false, glow: 1, seg: 6 });
          for (let x = 0; x <= len; x += 0.025) for (const sgn of [-1, 1]) k.box(x, 0, z + sgn * span * 0.48, 0.0012, 0.012, 0.0012, '#5b6770');
        }
        // bâtiment voyageurs en tête
        building(k, -0.012, 0, 0.024, w + 0.02, 0.028, M.brick, '#5b5b5b');
        k.box(-0.012, 0.028, 0, 0.006, 0.02, 0.006, '#d9d4c7', { mat: M.concrete });
        k.box(-0.012, 0.042, 0, 0.0065, 0.004, 0.0065, '#fff3cf', { glow: 1 });
        k.rect(-0.06, 0.0005, 0, 0.06, w + 0.04, '#cdc6b6', M.paving);
        parking(k, -0.06, w / 2 + 0.05, 0.08, 0.04, rnd);
        break;
      }
      case 'zone_industrielle': {
        k.rect(0, 0.0003, 0, 1.0, 0.8, '#8f8c85', M.concrete);
        for (const v of [-0.2, 0.2]) k.rect(0, 0.0006, v, 1.0, 0.014, '#46484b', M.asphalt);
        k.rect(0, 0.0006, 0, 0.014, 0.8, '#46484b', M.asphalt);
        const cols = ['#c5ccd3', '#aebdcc', '#d6d0c4', '#9fb3c8', '#e2e2dc', '#b7c4b0'];
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
          const cx = -0.375 + a * 0.25, cz = -0.3 + b * 0.2;
          if (rnd() < 0.15) { parking(k, cx, cz, 0.16, 0.08, rnd); continue; }
          const w = 0.12 + rnd() * 0.08, d = 0.08 + rnd() * 0.05, h = 0.008 + rnd() * 0.012;
          const c = cols[Math.floor(rnd() * cols.length)];
          k.box(cx, 0, cz, w, h, d, c, { mat: M.steel });
          if (rnd() < 0.4) for (let q = 0; q < 6; q++) k.gable(cx, h, cz - d / 2 + (q + 0.5) * d / 6, w, 0.005, d / 6, '#8d99ae', { mat: M.metal });
          else k.box(cx, h, cz, w + 0.001, 0.001, d + 0.001, '#9aa0a6', { mat: M.metal });
          if (rnd() < 0.4) for (let q = 0; q < 3; q++) k.cyl(cx + w / 2 + 0.012, 0, cz - 0.02 + q * 0.018, 0.007, 0.007, 0.014, '#e9ecef', { tess: 12 });
          for (let q = 0; q < 4; q++) k.box(cx - w / 2 + 0.01 + q * 0.012, 0, cz + d / 2 + 0.006, 0.0025, 0.0035, 0.016, '#f1faee');
        }
        chimney(k, 0.05, 0.05, 0.08, 0.004, false);
        pushSmoke(k, i, 0.05, 0.083, 0.05, false, 0.025);
        break;
      }
      case 'usine': {
        const c = ['#c5ccd3', '#aebdcc', '#d6d0c4'][i.id % 3];
        k.rect(0, 0.0004, 0, 0.2, 0.13, '#8f8c85', M.concrete);
        k.box(0, 0, 0, 0.14, 0.012, 0.08, c, { mat: M.steel });
        for (let q = 0; q < 6; q++) k.gable(0, 0.012, -0.04 + (q + 0.5) * 0.08 / 6, 0.14, 0.005, 0.08 / 6, '#8d99ae', { mat: M.metal });
        k.box(-0.08, 0, 0.02, 0.025, 0.018, 0.03, '#ffffff', { mat: M.office });
        chimney(k, 0.06, 0.05, 0.05, 0.003, false);
        pushSmoke(k, i, 0.06, 0.052, 0.05, false, 0.018);
        for (let q = 0; q < 2; q++) k.cyl(0.085, 0, -0.03 + q * 0.02, 0.008, 0.008, 0.018, '#e9ecef', { tess: 12 });
        break;
      }
      case 'zone_commerciale': {
        k.box(0, 0, 0, 0.2, 0.012, 0.11, '#e9ecef', { mat: M.concrete });
        k.box(0, 0.012, 0, 0.202, 0.001, 0.112, '#adb5bd', { mat: M.metal });
        k.box(0, 0.004, 0.056, 0.12, 0.008, 0.002, '#ffffff', { mat: M.glass });
        k.box(0, 0.0125, 0.056, 0.06, 0.004, 0.0015, ['#ffb703', '#e63946', '#2a9d8f'][i.id % 3], { glow: 1 });
        parking(k, 0, 0.12, 0.24, 0.11, rnd);
        break;
      }
      case 'ecole': case 'college': case 'lycee': case 'centre_formation': {
        k.rect(0, 0.0003, 0, 0.12, 0.09, '#c9c3b6', M.paving);
        building(k, -0.015, -0.015, 0.08, 0.018, 0.011, M.brick, '#8d5b4c');
        building(k, 0.034, 0.01, 0.018, 0.06, 0.008, M.brick, '#8d5b4c');
        k.rect(-0.015, 0.0006, 0.025, 0.06, 0.03, '#4f8f45', M.grass);
        for (let q = 0; q < 5; q++) tree(k, -0.05 + q * 0.016, 0.045, 1.4);
        break;
      }
      case 'commissariat': {
        building(k, 0, 0, 0.05, 0.03, 0.015, M.office);
        k.box(0, 0.016, 0, 0.012, 0.0012, 0.004, '#3a86ff', { glow: 1 });
        for (let q = 0; q < 6; q++) k.box(-0.02 + q * 0.008, 0, 0.026, 0.0018, 0.0014, 0.0044, q % 2 ? '#1d3557' : '#f1faee');
        break;
      }
      case 'caserne': case 'caserne_pompiers': {
        building(k, 0, 0, 0.05, 0.026, 0.01, M.plain, '#9b2226', '#c1121f');
        for (let q = 0; q < 4; q++) k.box(-0.018 + q * 0.012, 0, 0.0132, 0.009, 0.007, 0.0006, '#f1faee');
        k.box(0.03, 0, -0.008, 0.006, 0.022, 0.006, '#c1121f');
        break;
      }
      case 'tribunal': {
        k.box(0, 0, 0, 0.07, 0.006, 0.05, '#d9d4c7', { mat: M.concrete });
        building(k, 0, 0, 0.06, 0.04, 0.018, M.plain, '#9a9a94', '#ece6d8');
        for (let q = 0; q < 8; q++) k.cyl(-0.026 + q * 0.0075, 0.006, 0.023, 0.0012, 0.0012, 0.013, '#f8f9fa', { tess: 8 });
        k.gable(0, 0.019, 0.023, 0.062, 0.006, 0.008, '#ece6d8');
        break;
      }
      case 'prison': {
        k.rect(0, 0.0003, 0, 0.2, 0.2, '#a8a59e', M.concrete);
        for (const [a, b, w, d] of [[0, -0.1, 0.2, 0.002], [0, 0.1, 0.2, 0.002], [-0.1, 0, 0.002, 0.2], [0.1, 0, 0.002, 0.2]]) k.box(a, 0, b, w, 0.006, d, '#d9d4c7', { mat: M.concrete });
        for (let q = 0; q < 3; q++) building(k, -0.05 + q * 0.05, 0, 0.02, 0.12, 0.012, M.concrete, '#6c757d', '#c9c6bf');
        for (const [a, b] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) { k.box(a, 0, b, 0.006, 0.014, 0.006, '#adb5bd'); k.box(a, 0.014, b, 0.003, 0.001, 0.003, '#fff3cf', { glow: 1 }); }
        break;
      }
      case 'laboratoire': {
        building(k, 0, 0, 0.07, 0.04, 0.016, M.glass);
        dome(k, 0.045, 0, 0, 0.012, '#dee2e6', M.metal);
        break;
      }
      case 'ferme': {
        k.rect(0, 0.0003, 0.06, 0.25, 0.14, '#7d9a4a', M.grass);
        k.box(0, 0, 0, 0.035, 0.008, 0.016, '#a4161a');
        k.gable(0, 0.008, 0, 0.035, 0.005, 0.017, '#5c5f66');
        k.cyl(0.025, 0, 0.0, 0.004, 0.004, 0.016, '#d9d4c7', { tess: 10 });
        for (let q = 0; q < 4; q++) k.rect(-0.09 + q * 0.06, 0.0006, 0.07, 0.05, 0.12, q % 2 ? '#c9b458' : '#6a994e', M.grass);
        break;
      }
      case 'zone_residentielle': case 'eco_quartier': case 'logements_sociaux': {
        const eco = i.type === 'eco_quartier';
        const n = i.type === 'logements_sociaux' ? 3 : 6;
        for (let q = 0; q < n; q++) {
          const x = ((q % 3) - 1) * 0.04, z = (Math.floor(q / 3) - 0.5) * 0.05;
          const h = i.type === 'logements_sociaux' ? 0.03 + q * 0.006 : 0.012 + (q % 2) * 0.006;
          building(k, x, z, 0.026, 0.016, h, i.type === 'logements_sociaux' ? M.office : M.brick, eco ? '#52b788' : '#7b6f63');
          if (eco) tree(k, x + 0.016, z + 0.014, 1.5);
        }
        break;
      }
      default: building(k, 0, 0, 0.04, 0.03, 0.012, M.office); break;
    }
    finish(k, i, i.type);
  }

  // ---------- fumées et panaches de vapeur ----------
  const tex = new DynamicTexture('smokeTex', 64, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tex.hasAlpha = true;
  tex.update();
  const systems = smokes.map((s) => {
    const ps = new ParticleSystem('smoke', s.steam ? 90 : 70, scene);
    ps.particleTexture = tex;
    ps.emitter = s.pos;
    const e = s.size * (s.steam ? 0.25 : 0.1);
    ps.minEmitBox = new Vector3(-e, 0, -e);
    ps.maxEmitBox = new Vector3(e, 0, e);
    ps.color1 = s.steam ? new Color4(1, 1, 1, 0.6) : new Color4(0.72, 0.72, 0.73, 0.5);
    ps.color2 = s.steam ? new Color4(0.94, 0.95, 0.98, 0.5) : new Color4(0.52, 0.53, 0.55, 0.45);
    ps.colorDead = new Color4(0.85, 0.85, 0.85, 0);
    ps.minSize = s.size * 0.5; ps.maxSize = s.size * 1.4;
    ps.minScaleY = 0.8; ps.maxScaleY = 1;
    ps.addSizeGradient(0, s.size * 0.5, s.size * 0.8);
    ps.addSizeGradient(1, s.size * 2.2, s.size * 3.2);
    ps.minLifeTime = s.steam ? 5 : 6; ps.maxLifeTime = s.steam ? 9 : 11;
    ps.emitRate = s.steam ? 9 : 7;
    ps.direction1 = new Vector3(0.1, 1, -0.05); ps.direction2 = new Vector3(0.35, 1.3, 0.1);
    ps.minEmitPower = s.size * 0.12; ps.maxEmitPower = s.size * 0.22;
    ps.gravity = new Vector3(s.size * 0.06, s.size * 0.01, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return { ps, steam: s.steam };
  });

  const m = new Matrix();
  const q = new Quaternion();
  const sc = new Vector3();
  const tr = new Vector3();
  let t = 0;
  return {
    roots,
    animate: (dt: number) => {
      t += dt;
      for (const r of rotors) {
        r.hubs.forEach((h, k) => {
          Quaternion.RotationYawPitchRollToRef(h.yaw, t * 1.4 * h.s + h.ph, 0, q);
          sc.setAll(1);
          tr.set(h.x, h.y, h.z);
          Matrix.ComposeToRef(sc, q, tr, m);
          m.copyToArray(r.buf, k * 16);
        });
        r.mesh.thinInstanceBufferUpdated('matrix');
      }
    },
    /** Débit des fumées proportionnel aux émissions industrielles et électriques (relatives à l'état initial). */
    setEmissionFactor: (f: number) => { for (const s of systems) s.ps.emitRate = s.steam ? 9 : Math.max(0, 7 * f); },
    dispose: () => {
      for (const s of systems) s.ps.dispose();
      for (const r of roots) r.dispose();
      for (const e of extras) e.dispose();
      siteMat.dispose();
      closedMat.dispose();
      tex.dispose();
    },
  };
}

export { unitBox };
