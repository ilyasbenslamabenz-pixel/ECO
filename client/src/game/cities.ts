// Tissu urbain de la mégapole, îlot par îlot, selon une typologie réaliste :
// - centre d'affaires : gratte-ciel (socle, fût à retraits, couronnement, tours cylindriques ou en L,
//   tours signatures), façades vitrées réfléchissantes, équipements de toiture et héliports ;
// - centre ancien : îlots haussmanniens fermés (pierre crème, combles à brisis en zinc, cours arborées),
//   centres de villes plus bas à toits de tuiles ;
// - quartiers résidentiels : barres et tours d'habitation à balcons, petits collectifs ;
// - banlieue : pavillons à toits à deux pans, jardins et arbres ;
// - zones industrielles et portuaires : entrepôts, sheds, hangars cintrés, silos.
// Tout est dessiné en instances fines (un appel de rendu par gabarit). La population de chaque quartier,
// calculée par le serveur, fait apparaître ou disparaître des bâtiments (rang de visibilité par bâtiment).
import { GlowLayer, Matrix, MeshBuilder, type Camera, type Material, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';
import { fbm, mulberry32 } from '../../../shared/noise';
import { HALF_D, HALF_W, parkMask, urbanDensity } from '../../../shared/sim/country';
import type { CountryDef } from '../../../shared/sim/types';
import { ENV, densify, type Grid } from './terrain';
import { balconyTemplate, boxTemplate, ringTemplate, cylTemplate, houseTemplate, mansardTemplate, shedTemplate, siloTemplate, treeTemplate, vaultTemplate } from './buildings/geometry';
import { BLD_VIEW, balconyMaterial, buildingMaterial, treeMaterial, type Layer } from './buildings/materials';
import { acg, haussmannTexture, houseTexture, residTexture } from './buildings/textures';
import { setThinCount } from './thin';

export const GROWTH_CAP = 1.5;
const CELL = 0.2; // trame des rues peinte par le terrain (km)
const FLOOR = 0.003; // hauteur d'étage d'habitation (km)
const OFFICE = 0.0036; // hauteur d'étage de bureaux (km)
/** Rayon (km) autour du point visé dans lequel les pavillons sont dessinés ; au-delà, le jardin les peint. */
const houseRange = (camR: number) => Math.max(2.5, Math.min(6, camR));

// indices des couches de façade de chaque matériau
const TW = { f001: 0, f002: 1, f003: 2, f005: 3, f006: 4, f017: 5, metal: 6 } as const;
const HB = { hauss: 0, resid: 1, house: 2, brick: 3, brick2: 4, tower: 5 } as const;
const HR = { flat: 0, zinc: 1, tiles: 2, slate: 3 } as const;
const IN = { corr: 0, plates: 1, concrete: 2, brick: 3, garden: 4, helipad: 5, equip: 6 } as const;

type RGB = [number, number, number];
const PAL = {
  stone: [[1, 0.98, 0.93], [0.98, 0.94, 0.86], [0.95, 0.91, 0.83], [1, 0.96, 0.88], [0.94, 0.91, 0.86], [0.99, 0.95, 0.9]] as RGB[],
  pastel: [[1, 0.93, 0.8], [1, 0.88, 0.78], [0.98, 0.95, 0.85], [0.95, 0.88, 0.8], [1, 0.97, 0.9], [0.92, 0.86, 0.78]] as RGB[],
  render: [[1, 1, 1], [0.97, 0.94, 0.88], [0.9, 0.9, 0.9], [0.98, 0.91, 0.82], [0.86, 0.88, 0.9], [0.93, 0.87, 0.8], [0.82, 0.8, 0.78]] as RGB[],
  glass: [[1, 1, 1], [0.86, 0.95, 1.05], [0.92, 1.0, 0.97], [1.06, 0.96, 0.86], [0.82, 0.86, 0.92], [0.95, 0.98, 1.02]] as RGB[],
  house: [[1, 0.98, 0.93], [0.99, 0.93, 0.82], [0.95, 0.95, 0.93], [1, 0.94, 0.8], [0.93, 0.89, 0.83], [0.98, 0.9, 0.86]] as RGB[],
  metal: [[0.72, 0.75, 0.78], [0.62, 0.68, 0.74], [0.85, 0.86, 0.86], [0.55, 0.62, 0.58], [0.7, 0.66, 0.6], [0.5, 0.56, 0.66]] as RGB[],
};

/**
 * Ensemble d'instances fines d'un gabarit. Les tampons envoyés au GPU sont compactés : seules les
 * instances des bâtiments visibles (population) et situées dans le rayon de vue du lot sont dessinées.
 */
class Batch {
  mats: number[] = [];
  data: number[] = [];
  tint: number[] = [];
  owner: number[] = [];
  base!: Float32Array;
  bData!: Float32Array;
  bTint!: Float32Array;
  live!: Float32Array;
  lData!: Float32Array;
  lTint!: Float32Array;
  drawn = 0;
  constructor(public mesh: Mesh, public range: (camR: number) => number = () => Infinity, public far = false) {}
  add(bid: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, d: number[], t: number[]) {
    const c = Math.cos(rot), s = Math.sin(rot);
    this.mats.push(sx * c, 0, -sx * s, 0, 0, sy, 0, 0, sz * s, 0, sz * c, 0, x, y, z, 1);
    this.data.push(d[0], d[1], d[2], d[3]);
    this.tint.push(t[0], t[1], t[2], t[3]);
    this.owner.push(bid);
  }
  get count() { return this.owner.length; }
  finish() {
    const n = Math.max(1, this.count);
    this.base = new Float32Array(n * 16); this.base.set(this.mats);
    this.bData = new Float32Array(n * 4); this.bData.set(this.data);
    this.bTint = new Float32Array(n * 4); this.bTint.set(this.tint);
    this.live = new Float32Array(this.base);
    this.lData = new Float32Array(this.bData);
    this.lTint = new Float32Array(this.bTint);
    this.mesh.thinInstanceSetBuffer('matrix', this.live, 16, false);
    this.mesh.thinInstanceSetBuffer('bdata', this.lData, 4, false);
    this.mesh.thinInstanceSetBuffer('btint', this.lTint, 4, false);
    setThinCount(this.mesh, this.count);
    this.mats = []; this.data = []; this.tint = [];
  }
  /** Compacte les instances visibles autour de (cx, cz) dans les tampons GPU. */
  apply(on: Uint8Array, cx: number, cz: number, camR: number) {
    const r = this.range(camR), r2 = r * r;
    const b = this.base, l = this.live;
    let n = 0;
    for (let i = 0; i < this.owner.length; i++) {
      if (!on[this.owner[i]]) continue;
      const k = i * 16;
      if (r !== Infinity) { const dx = b[k + 12] - cx, dz = b[k + 14] - cz; if ((dx * dx + dz * dz > r2) !== this.far) continue; }
      l.set(b.subarray(k, k + 16), n * 16);
      this.lData.set(this.bData.subarray(i * 4, i * 4 + 4), n * 4);
      this.lTint.set(this.bTint.subarray(i * 4, i * 4 + 4), n * 4);
      n++;
    }
    this.drawn = n;
    setThinCount(this.mesh, n);
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('bdata');
    this.mesh.thinInstanceBufferUpdated('btint');
  }
}

export function createCities(scene: Scene, grid: Grid, country: CountryDef, block: number) {
  const rnd = mulberry32(country.seed * 31 + 7);
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const detail = block <= 0.2; // qualité moyenne/haute : balcons, équipements, arbres plus nombreux
  const keep = Math.min(1, (0.2 / block) ** 2); // qualité basse : moins d'îlots bâtis
  const cap = country.cities.find((c) => c.capital) ?? country.cities[0];

  // ---------- matériaux et gabarits ----------
  const towerLayers: Layer[] = [
    { tex: acg(scene, 'Facade001'), w: 0.035, h: 0.036, cols: 16, rows: 10, glass: 0.95, night: 0, nightH: 0.056 },
    { tex: acg(scene, 'Facade002'), w: 0.035, h: 0.036, cols: 16, rows: 10, glass: 0.85, night: 1, nightH: 0.07 },
    { tex: acg(scene, 'Facade003'), w: 0.035, h: 0.036, cols: 16, rows: 10, glass: 0.85, night: 0, nightH: 0.056 },
    { tex: acg(scene, 'Facade005'), w: 0.042, h: 0.042, cols: 32, rows: 12, glass: 1.0, night: 1, nightH: 0.07 },
    { tex: acg(scene, 'Facade006'), w: 0.03, h: 0.029, cols: 14, rows: 8, glass: 0.8, night: 0, nightH: 0.056 },
    { tex: acg(scene, 'Facade017'), w: 0.03, h: 0.029, cols: 12, rows: 8, glass: 0.55, night: 1, nightH: 0.07 },
    { tex: acg(scene, 'Facade001'), solid: 'vec3(0.33, 0.36, 0.40)', w: 1, h: 1, cols: 1, rows: 1, glass: 0.9 },
  ];
  const flatRoofGLSL = /* glsl */ `alb = flatRoof(vPositionW.xz, fract(seed * 7.13) * 0.88);`;
  const towerMat = buildingMaterial(scene, 'bldTowerMat', { // verre : reflets renforcés
    layers: towerLayers,
    nights: [acg(scene, 'Facade009'), acg(scene, 'Facade011')],
    roofGLSL: flatRoofGLSL,
    reflect: 1.25,
  });
  const habLayers: Layer[] = [
    { tex: haussmannTexture(scene), w: 0.0096, h: 1, fit: true, cols: 3, rows: 6, glass: 0.35 },
    { tex: residTexture(scene), w: 0.0144, h: 0.012, cols: 4, rows: 4, glass: 0.35 },
    { tex: houseTexture(scene), w: 0.0105, h: 0.006, cols: 3, rows: 2, glass: 0.3 },
    { tex: acg(scene, 'Facade018A'), nrm: acg(scene, 'Facade018A', 'normal'), w: 0.018, h: 0.018, cols: 6, rows: 6, glass: 0.35 },
    { tex: acg(scene, 'Facade020A'), nrm: acg(scene, 'Facade020A', 'normal'), w: 0.016, h: 0.016, cols: 6, rows: 5, glass: 0.35 },
    { tex: acg(scene, 'Facade013'), w: 0.096, h: 0.096, cols: 32, rows: 32, glass: 0.3 },
  ];
  const habMat = buildingMaterial(scene, 'bldHabMat', {
    layers: habLayers,
    extraSamplers: { zincTex: acg(scene, 'MetalPlates006'), tileTex: acg(scene, 'RoofingTiles014A'), slateTex: acg(scene, 'RoofingTiles012A') },
    reflect: 0.8,
    roofGLSL: /* glsl */ `
      float rl = floor(vB.y + 0.5);
      if (part < 1.5) {
        alb = flatRoof(vPositionW.xz, fract(seed * 7.13));
        if (rl > 0.5) alb = rl < 1.5 ? vec3(0.42, 0.45, 0.50) * (0.9 + 0.2 * bNoise(vPositionW.xz * 2500.0)) : vec3(0.52, 0.32, 0.24);
      } else if (abs(nN.y) < 0.2) {
        // souches de cheminée et murs mitoyens
        alb = rl < 1.5 ? vec3(0.74, 0.68, 0.60) * vT.rgb : rl < 2.5 ? vec3(0.62, 0.40, 0.31) : vec3(0.85, 0.82, 0.76);
      } else if (rl < 1.5) {
        // brisis en zinc gris-bleu et lucarnes
        float z = dot(texture2D(zincTex, fm / 0.005).rgb, vec3(0.33));
        // zinc gris-bleu, patine variable par îlot (plus clair ou plus sombre, plus ou moins bleuté)
        float zb = bHash(floor(vPositionW.xz / 0.2) + 0.71);
        alb = mix(vec3(0.40, 0.42, 0.46), vec3(0.50, 0.51, 0.53), zb) * (0.8 + 0.4 * z) * (0.9 + 0.2 * seed);
        float rv = (vP.y - 1.0) / 0.244;
        float bu = fract(fm.x / 0.0032 + 0.5);
        float luc = step(0.18, rv) * step(rv, 0.72) * step(abs(bu - 0.5), 0.15);
        float lin = luc * step(abs(bu - 0.5), 0.11) * step(0.24, rv) * step(rv, 0.66);
        alb = mix(alb, vec3(0.92, 0.9, 0.85), luc);
        alb = mix(alb, vec3(0.20, 0.24, 0.28), lin);
        gMask = lin * 0.4;
        float hl = bHash(vec2(floor(fm.x / 0.0032), seed * 33.0));
        emis = lin * step(hl, vB.w * 0.9) * litColor(fract(hl * 7.7)) * 0.9;
      } else if (rl < 2.5) {
        alb = texture2D(tileTex, fm / 0.0035).rgb * vec3(0.92, 0.86, 0.84) * (0.8 + 0.25 * seed);
      } else {
        vec3 sl = texture2D(slateTex, fm / 0.0035).rgb;
        alb = vec3(dot(sl, vec3(0.33))) * vec3(0.55, 0.58, 0.64);
      }
    `,
  });
  const indLayers: Layer[] = [
    { tex: acg(scene, 'CorrugatedSteel007A'), nrm: acg(scene, 'CorrugatedSteel007A', 'normal'), w: 0.005, h: 0.005, cols: 1, rows: 1 },
    { tex: acg(scene, 'MetalPlates006'), w: 0.006, h: 0.006, cols: 1, rows: 1 },
    { tex: acg(scene, 'Concrete034'), w: 0.008, h: 0.004, cols: 1, rows: 1 },
    { tex: acg(scene, 'Concrete034'), solid: 'vec3(0.56, 0.33, 0.25)', w: 1, h: 1, cols: 1, rows: 1 },
    { tex: acg(scene, 'Concrete034'), solid: 'vec3(0.22, 0.30, 0.15)', w: 1, h: 1, cols: 1, rows: 1 },
    { tex: acg(scene, 'Concrete034'), solid: 'vec3(0.45, 0.45, 0.46)', w: 1, h: 1, cols: 1, rows: 1, noTint: true },
    { tex: acg(scene, 'Concrete034'), solid: 'vec3(0.74, 0.75, 0.76)', w: 1, h: 1, cols: 1, rows: 1 },
  ];
  const indMat = buildingMaterial(scene, 'bldIndMat', {
    layers: indLayers,
    reflect: 0.6,
    roofGLSL: /* glsl */ `
      int ri = int(vB.x + 0.5);
      vec2 lc = (vP.zw);
      if (part < 1.5) {
        if (ri == ${IN.garden}) {
          // jardins : pelouse, massifs, allées
          float g = bNoise(vPositionW.xz * 600.0) * 0.6 + bNoise(vPositionW.xz * 2600.0) * 0.4;
          alb = mix(vec3(0.19, 0.26, 0.13), vec3(0.27, 0.32, 0.17), g);
          // cours d'immeubles : pavés et gravier autour des pelouses
          if (vB.y > 0.5) alb = mix(alb, vec3(0.42, 0.40, 0.37) * (0.92 + 0.12 * bNoise(vPositionW.xz * 3000.0)), smoothstep(0.38, 0.5, bNoise(vPositionW.xz * 45.0 + seed * 9.0)));
          alb = mix(alb, vec3(0.16, 0.24, 0.11), step(0.72, bNoise(vPositionW.xz * 1400.0 + 3.0)));
          vec2 lp = abs(fract(vPositionW.xz / 0.018) - 0.5);
          alb = mix(alb, vec3(0.13, 0.20, 0.09), step(0.47, max(lp.x, lp.y)) * 0.8 * step(vB.y, 0.5)); // haies entre parcelles (lotissements)
          alb = mix(alb, vec3(0.48, 0.46, 0.42), smoothstep(0.8, 0.9, bNoise(vPositionW.xz * 90.0 + 9.0)) * 0.6); // allées, terrasses
          // au-delà du rayon des pavillons détaillés : toits peints le long des rues (imposteur)
          float far = smoothstep(uView.z * 0.9, uView.z, distance(vPositionW.xz, uView.xy));
          if (far > 0.0 && vB.y < 0.5) {
            vec2 q = mod(vPositionW.xz, 0.2);
            vec2 e = min(q, 0.2 - q);
            vec2 cellB = floor(vPositionW.xz / 0.2);
            float lotA = q.x / 0.019, lotB = q.y / 0.019;
            float hA = step(0.023, e.y) * step(e.y, 0.033) * step(0.02, e.x) * step(0.2, fract(lotA)) * step(fract(lotA), 0.78);
            float hB = step(0.023, e.x) * step(e.x, 0.033) * step(0.045, e.y) * step(0.2, fract(lotB)) * step(fract(lotB), 0.78);
            float id = hA > 0.5 ? floor(lotA) + q.y * 7.0 : floor(lotB) + q.x * 7.0;
            float hh = bHash(cellB + vec2(id, id * 0.37));
            vec3 roofC = hh < 0.65 ? vec3(0.60, 0.33, 0.25) : vec3(0.32, 0.34, 0.38);
            float ridge = hA > 0.5 ? step(0.028, e.y) : step(0.028, e.x);
            roofC *= 0.82 + 0.3 * ridge;
            float house = max(hA, hB) * step(0.1, bHash(cellB + vec2(id * 1.3, 2.0)));
            alb = mix(alb, roofC, house * far);
          }
        } else if (ri == ${IN.helipad}) {
          vec2 q = (vPositionW.xz - vec2(vT.r, vT.g)) / vT.b;
          float r = length(q);
          alb = vec3(0.30, 0.31, 0.32);
          alb = mix(alb, vec3(0.85, 0.85, 0.8), step(0.36, r) * step(r, 0.41));
          float hh = step(abs(q.x), 0.16) * step(abs(q.y), 0.22) * (step(0.1, abs(q.x)) + step(abs(q.y), 0.03));
          alb = mix(alb, vec3(0.9, 0.9, 0.85), clamp(hh, 0.0, 1.0));
          emis = vec3(1.0, 0.85, 0.4) * step(0.42, r) * step(r, 0.45) * step(0.5, fract(atan(q.y, q.x) * 1.9)) * 2.0;
        } else if (ri == ${IN.corr} || ri == ${IN.plates}) {
          float m = dot(texture2D(fac1, fm / 0.006).rgb, vec3(0.33));
          alb = mix(vec3(0.55, 0.56, 0.57), vT.rgb * 0.8, 0.35) * (0.8 + 0.4 * m);
        } else alb = flatRoof(vPositionW.xz, fract(seed * 7.13));
      } else {
        vec3 c = texture2D(fac0, fm / 0.005).rgb;
        alb = vec3(dot(c, vec3(0.33))) * mix(vec3(0.85, 0.86, 0.88), vT.rgb, 0.5) * 1.1;
        if (ri == ${IN.concrete}) alb = texture2D(fac2, fm / 0.008).rgb * 0.9;
      }
    `,
  });
  const treeMat = treeMaterial(scene);
  const balcMat = balconyMaterial(scene);

  const mk = (m: Mesh, mat: Material, range?: (camR: number) => number, far = false) => { m.material = mat; m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.receiveShadows = true; m.doNotSyncBoundingInfo = true; return new Batch(m, range, far); };
  // rayons de vue (km) selon la distance de la caméra : les petits objets ne sont dessinés que près du point visé
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const midR = (r: number) => Math.max(5, r * 1.8);
  const lotR = (r: number) => clamp(r * 0.5, 1.2, 3); // lots haussmanniens détaillés ; au-delà, un volume par îlot
  const B = {
    tBox: mk(boxTemplate('bldTowerBox', scene), towerMat),
    tCyl: mk(cylTemplate('bldTowerCyl', scene), towerMat),
    hBox: mk(boxTemplate('bldHabBox', scene), habMat, midR),
    hMans: mk(mansardTemplate('bldHabMansard', scene), habMat, lotR),
    hRing: mk(ringTemplate('bldHabRing', scene, 0.1), habMat, lotR, true),
    hMansAll: mk(mansardTemplate('bldHabMansardAll', scene), habMat, midR), // îlots entamés par une voie
    hHouse: mk(houseTemplate('bldHabHouse', scene), habMat, houseRange),
    iBox: mk(boxTemplate('bldIndBox', scene), indMat),
    iShed: mk(shedTemplate('bldIndShed', scene), indMat),
    iVault: mk(vaultTemplate('bldIndVault', scene), indMat),
    iSilo: mk(siloTemplate('bldIndSilo', scene), indMat),
    det: mk(boxTemplate('bldDetails', scene), indMat, (r) => clamp(r * 1.2, 1.5, 4)), // petits volumes : édicules, antennes, héliports
    tree: mk(treeTemplate('bldTrees', scene), treeMat, (r) => clamp(r * 0.8, 1.5, 5)),
    balc: mk(balconyTemplate('bldBalconies', scene), balcMat, (r) => clamp(r, 1.5, 3)),
  };

  // ---------- bâtiments (unité de visibilité et de sélection) ----------
  interface Bld { district: number; threshold: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
  const blds: Bld[] = [];
  let curDistrict = 0, curThreshold = 0;
  const newBld = (thrJitter = 0.15) => {
    blds.push({ district: curDistrict, threshold: curThreshold * (1 - thrJitter / 2 + rnd() * thrJitter), x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity });
    return blds.length - 1;
  };
  const grow = (bid: number, x: number, z: number, hw: number, hd: number, y0: number, y1: number) => {
    const b = blds[bid];
    b.x0 = Math.min(b.x0, x - hw); b.x1 = Math.max(b.x1, x + hw);
    b.z0 = Math.min(b.z0, z - hd); b.z1 = Math.max(b.z1, z + hd);
    b.y0 = Math.min(b.y0, y0); b.y1 = Math.max(b.y1, y1);
  };
  /** Sol sous une emprise : base enterrée au point le plus bas, origine des façades au centre. */
  const ground = (x: number, z: number, w: number, d: number, rot: number) => {
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const hx = (w * c + d * s) / 2, hz = (w * s + d * c) / 2;
    const yc = grid.y(x, z);
    const ym = Math.min(yc, grid.y(x - hx, z - hz), grid.y(x + hx, z - hz), grid.y(x - hx, z + hz), grid.y(x + hx, z + hz));
    return { yc, base: ym - 0.0015 };
  };
  /** Volume posé au sol (h = hauteur au-dessus du sol au centre). */
  const dead = new Set<number>(); // bâtiments abandonnés (emprise sur une voie)
  let noClear = false; // volumes lointains d'îlot : pas de test d'emprise
  const put = (bt: Batch, bid: number, x: number, z: number, w: number, d: number, h: number, rot: number, layer: number, roof: number, lit: number, tint: RGB) => {
    const g = ground(x, z, w, d, rot);
    if (dead.has(bid)) return g.yc;
    const cr = Math.abs(Math.cos(rot)), sr = Math.abs(Math.sin(rot));
    if (!noClear && !clear(x, z, (w * cr + d * sr) / 2, (w * sr + d * cr) / 2)) { dead.add(bid); return g.yc; }
    const bury = g.yc - g.base;
    bt.add(bid, x, g.base, z, w, h + bury, d, rot, [layer, roof, rnd(), lit], [tint[0], tint[1], tint[2], bury]);
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    grow(bid, x, z, (w * c + d * s) / 2, (w * s + d * c) / 2, g.base, g.yc + h);
    return g.yc;
  };
  /** Volume posé à une altitude donnée (étages supérieurs, couronnements). */
  const putAt = (bt: Batch, bid: number, x: number, y: number, z: number, w: number, d: number, h: number, rot: number, layer: number, roof: number, lit: number, tint: RGB, facadeY = y) => {
    if (dead.has(bid)) return;
    bt.add(bid, x, y, z, w, h, d, rot, [layer, roof, rnd(), lit], [tint[0], tint[1], tint[2], facadeY - y]);
    grow(bid, x, z, Math.max(w, d) / 2, Math.max(w, d) / 2, y, y + h);
  };
  const tree = (x: number, z: number, h: number) => {
    if (!clear(x, z, h * 0.3, h * 0.3)) return;
    const y = grid.y(x, z) - 0.001;
    const s = h * R(0.5, 0.75);
    B.tree.add(0, x, y, z, s, h, s, rnd() * 6.28, [0, rnd(), rnd(), 0], [1, 1, 1, 0]);
  };
  /** Balcons filants sur une façade (pile de dalles escamotées au-delà de « floors » étages). */
  const balconies = (bid: number, x: number, z: number, len: number, rot: number, y0: number, floors: number, dark: boolean) => {
    if (!detail || floors < 2 || dead.has(bid)) return;
    B.balc.add(bid, x, y0 + FLOOR, z, len, FLOOR, 0.0015, rot, [Math.min(23, floors - 1), dark ? 1 : 0, rnd(), 0], [1, 1, 1, 0]);
  };
  const edicule = (bid: number, x: number, y: number, z: number, s: number) => {
    if (!detail || rnd() < 0.4) return;
    putAt(B.det, bid, x + R(-s, s) * 0.25, y, z + R(-s, s) * 0.25, R(0.004, 0.008), R(0.003, 0.006), R(0.0025, 0.0045), 0, IN.equip, 0, 0, [1, 1, 1]);
  };

  // ---------- emprises interdites : voies (test fin par segment), équipements ----------
  // Les grandes voies convergent vers le centre : on teste chaque emprise de bâtiment contre les
  // segments proches (demi-largeur de la voie + marge) au lieu de supprimer des îlots entiers.
  const blocked = new Set<number>();
  const key = (i: number, j: number) => i * 10000 + j;
  const toCell = (v: number) => Math.floor(v / CELL);
  const segs: number[] = []; // ax, az, bx, bz, demi-largeur
  const segHash = new Map<number, number[]>();
  const capC = country.cities.find((c) => c.capital) ?? country.cities[0];
  for (const l of country.links) {
    // métro souterrain dans le centre (voir roads.ts, METRO_TUNNEL) : pas d'emprise à dégager
    if (l.kind === 'rail' && l.points.every(([x, z]) => Math.hypot(x - capC.x, z - capC.z) < 4.5)) continue;
    const hw = (l.kind === 'autoroute' ? 0.0275 : l.kind === 'nationale' ? 0.016 : 0.01) + 0.012;
    for (let k = 0; k < l.points.length - 1; k++) {
      const [ax, az] = l.points[k], [bx, bz] = l.points[k + 1];
      if (l.kind === 'rail' && Math.hypot(ax - capC.x, az - capC.z) < 4.5 && Math.hypot(bx - capC.x, bz - capC.z) < 4.5) continue;
      const id = segs.length / 5;
      segs.push(ax, az, bx, bz, hw);
      for (let i = toCell(Math.min(ax, bx) - hw); i <= toCell(Math.max(ax, bx) + hw); i++) {
        for (let j = toCell(Math.min(az, bz) - hw); j <= toCell(Math.max(az, bz) + hw); j++) {
          const kk = key(i, j);
          let a = segHash.get(kk);
          if (!a) segHash.set(kk, (a = []));
          a.push(id);
        }
      }
    }
    if (l.kind === 'autoroute') for (const [x, z] of densify(l.points, CELL * 0.4)) blocked.add(key(toCell(x), toCell(z)));
  }
  const spots: number[] = []; // petits équipements : x, z, rayon
  for (const inf of country.infra) {
    const big = inf.type === 'aeroport' ? 2.2 : inf.type === 'port' ? 1.2 : ['centrale_nucleaire', 'zone_industrielle', 'centrale_charbon'].includes(inf.type) ? 0.6 : 0;
    if (big) { for (let i = toCell(inf.x - big); i <= toCell(inf.x + big); i++) for (let j = toCell(inf.z - big); j <= toCell(inf.z + big); j++) blocked.add(key(i, j)); }
    else spots.push(inf.x, inf.z, inf.type === 'gare' || inf.type === 'stade' || inf.type === 'universite' || inf.type === 'hopital' ? 0.17 : 0.12);
  }
  /** Le rectangle (centre, demi-côtés) est-il libre de toute voie et de tout équipement ? */
  const clear = (x: number, z: number, hx: number, hz: number) => {
    for (let k = 0; k < spots.length; k += 3) {
      const dx = Math.max(0, Math.abs(x - spots[k]) - hx), dz = Math.max(0, Math.abs(z - spots[k + 1]) - hz);
      if (dx * dx + dz * dz < spots[k + 2] * spots[k + 2]) return false;
    }
    const ids = segHash.get(key(toCell(x), toCell(z)));
    if (!ids) return true;
    for (const id of ids) {
      const o = id * 5, w = segs[o + 4];
      // segment contre boîte élargie (méthode des tranches)
      const x0 = x - hx - w, x1 = x + hx + w, z0 = z - hz - w, z1 = z + hz + w;
      const ax = segs[o], az = segs[o + 1], dx = segs[o + 2] - ax, dz = segs[o + 3] - az;
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]] as [number, number][]) {
        if (p === 0) { if (q < 0) { ok = false; break; } continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
        else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
      }
      if (ok) return false;
    }
    return true;
  };
  const industrial = country.infra.filter((i) => i.type === 'zone_industrielle' || i.type === 'port');
  const ports = country.infra.filter((i) => i.type === 'port');

  // ---------- typologies ----------
  interface Rect { x0: number; x1: number; z0: number; z1: number }

  /** Gratte-ciel : socle, fût (retraits, cylindre, L, lame) et couronnement. */
  const skyscraper = (r: Rect, H: number, sig: number, podium = 0.9) => {
    const bid = newBld(0.05);
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    const glass = pick(PAL.glass);
    const layer = sig ? pick([TW.f001, TW.f005, TW.f002]) : pick([TW.f001, TW.f002, TW.f005, TW.f006, TW.f001, TW.f005, TW.f003]);
    const lit = R(0.35, 0.75);
    // socle commercial
    const s = Math.min(Math.min(W, D) * 0.8, Math.max(0.028, Math.min(0.056, 0.024 + H * 0.08)));
    let ph = R(0.012, 0.022);
    const pw = Math.max(s * 1.3, W * podium * R(0.88, 1.05)), pd = Math.max(s * 1.3, D * podium * R(0.88, 1.05));
    let y0: number, y: number;
    if (clear(cx, cz, pw / 2, pd / 2)) {
      y0 = put(B.tBox, bid, cx, cz, pw, pd, ph, 0, pick([TW.f006, TW.f006, TW.f002]), 0, lit, pick(PAL.glass));
      y = y0 + ph;
    } else if (clear(cx, cz, s * 0.85, s * 0.85)) {
      // pas de socle : la tour part du sol, entre les voies
      const g = ground(cx, cz, s * 1.2, s * 1.2, 0);
      y0 = g.yc; y = g.base; ph = 0;
    } else { dead.add(bid); return; }
    const form = sig ? sig : rnd();
    let topW = s, topD = s, cyl = false;
    const sections: [number, number, number][] = []; // largeur, profondeur, hauteur
    if (sig === 2 || (!sig && form < 0.2)) {
      // tour cylindrique, couronnement en retrait
      cyl = true;
      const k = sig ? 3 : 1 + Math.floor(rnd() * 2);
      let dd = s * 1.05;
      for (let i = 0; i < k; i++) { const hh = (H - ph) * (i === 0 ? (k === 1 ? 1 : 0.62) : (1 - 0.62) / (k - 1)); sections.push([dd, dd, hh]); dd *= 0.8; }
    } else if (!sig && form < 0.35) {
      // plan en L : deux ailes de hauteurs différentes
      const hh = H - ph;
      putAt(B.tBox, bid, cx - s * 0.25, y, cz, s * 0.5, s, hh, 0, layer, 0, lit, glass, y0);
      putAt(B.tBox, bid, cx + s * 0.25, y, cz - s * 0.25, s * 0.5, s * 0.5, hh * R(0.65, 0.85), 0, layer, 0, lit, glass, y0);
      topW = s * 0.5; topD = s;
      edicule(bid, cx - s * 0.25, y + hh, cz, s * 0.3);
      if (rnd() < 0.4) putAt(B.det, bid, cx - s * 0.25, y + hh, cz + s * 0.2, 0.0015, 0.0015, R(0.015, 0.04), 0, IN.equip, 0, 0, [1, 1, 1]);
      return;
    } else if (!sig && form < 0.5) {
      // lame : plan allongé
      const a = rnd() < 0.5;
      sections.push([a ? s * 1.6 : s * 0.62, a ? s * 0.62 : s * 1.6, H - ph]);
    } else {
      // retraits successifs
      const k = sig ? 6 : 1 + Math.floor(rnd() * 3);
      let ww = s, dd = s * R(0.8, 1.2);
      const fr = sig ? [0.36, 0.2, 0.14, 0.12, 0.1, 0.08] : k === 1 ? [1] : k === 2 ? [0.7, 0.3] : [0.55, 0.28, 0.17];
      for (let i = 0; i < k; i++) { sections.push([ww, dd, (H - ph) * fr[i]]); ww *= sig ? 0.86 : 0.8; dd *= sig ? 0.86 : 0.8; }
    }
    for (const [ww, dd, hh] of sections) {
      if (cyl) putAt(B.tCyl, bid, cx, y, cz, ww, dd, hh, 0, layer, 0, lit, glass, y0);
      else putAt(B.tBox, bid, cx, y, cz, ww, dd, hh, 0, layer, 0, lit, glass, y0);
      // bandeau technique sombre entre deux retraits
      if (sections.length > 1 && !cyl) putAt(B.tBox, bid, cx, y + hh - 0.0025, cz, ww * 1.01, dd * 1.01, 0.0025, 0, TW.metal, 0, 0, [1, 1, 1]);
      y += hh;
      topW = ww; topD = dd;
    }
    // couronnement
    if (sig) {
      putAt(B.tCyl, bid, cx, y, cz, 0.004, 0.004, R(0.05, 0.08), 0, TW.metal, 0, 0, [1, 1, 1]);
      return;
    }
    if (H > 0.15 && rnd() < 0.35) {
      const hs = Math.min(topW, topD) * 0.8;
      putAt(B.det, bid, cx, y, cz, hs, hs, 0.0012, 0, IN.helipad, 0, 0, [cx, cz, hs]);
      return;
    }
    if (!cyl) putAt(B.det, bid, cx, y, cz, topW * 0.6, topD * 0.5, R(0.004, 0.008), 0, IN.equip, 0, 0, [1, 1, 1]);
    else putAt(B.tCyl, bid, cx, y, cz, topW * 0.7, topD * 0.7, 0.006, 0, TW.metal, 0, 0, [1, 1, 1]);
    if (rnd() < 0.35) putAt(B.det, bid, cx + topW * 0.2, y, cz, 0.0012, 0.0012, R(0.02, 0.05), 0, IN.equip, 0, 0, [1, 1, 1]);
  };

  /** Immeuble de bureaux de moyenne hauteur (6 à 14 étages). */
  const officeBlock = (x: number, z: number, w: number, d: number, floors: number) => {
    const bid = newBld();
    const h = floors * OFFICE;
    const y = put(B.tBox, bid, x, z, w, d, h, 0, pick([TW.f006, TW.f017, TW.f002, TW.f003]), 0, R(0.3, 0.7), pick(PAL.glass));
    edicule(bid, x, y + h, z, Math.min(w, d));
  };

  /** Îlot fermé : bâtiments en périmètre, cour intérieure arborée. */
  const perimeterBlock = (r: Rect, mode: 'hauss' | 'ville' | 'modern') => {
    const dW = mode === 'modern' ? R(0.013, 0.016) : R(0.013, 0.018);
    const sides: { x: number; z: number; len: number; rot: number }[] = [];
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    sides.push({ x: (r.x0 + r.x1) / 2, z: r.z1 - dW / 2, len: W, rot: 0 });
    sides.push({ x: (r.x0 + r.x1) / 2, z: r.z0 + dW / 2, len: W, rot: Math.PI });
    sides.push({ x: r.x0 + dW / 2, z: (r.z0 + r.z1) / 2, len: D - 2 * dW, rot: -Math.PI / 2 });
    sides.push({ x: r.x1 - dW / 2, z: (r.z0 + r.z1) / 2, len: D - 2 * dW, rot: Math.PI / 2 });
    // aile traversante (cœur d'îlot) une fois sur deux
    if (rnd() < 0.5 && mode !== 'modern') sides.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 + R(-0.02, 0.02), len: W - 2 * dW, rot: 0 });
    const floorsBase = mode === 'hauss' ? 6 : mode === 'ville' ? 4 : 7;
    const roofKind = mode === 'hauss' ? HR.zinc : mode === 'ville' ? (rnd() < 0.7 ? HR.tiles : HR.slate) : HR.flat;
    // lots : on vérifie d'abord les emprises ; un îlot entamé par une voie garde ses lots détaillés à
    // toute distance (pas de volume d'îlot lointain qui recouvrirait la voie)
    const lots: { cx: number; cz: number; lw: number; rot: number }[] = [];
    for (const sd of sides) {
      const ux = Math.cos(sd.rot), uz = -Math.sin(sd.rot); // axe local x dans le monde
      let t = -sd.len / 2;
      while (t < sd.len / 2 - 0.004) {
        let lw = mode === 'modern' ? R(0.03, 0.05) : R(0.014, 0.028);
        if (t + lw > sd.len / 2 - 0.01) lw = sd.len / 2 - t;
        lots.push({ cx: sd.x + ux * (t + lw / 2), cz: sd.z + uz * (t + lw / 2), lw, rot: sd.rot });
        t += lw;
      }
    }
    const intact = lots.every((l) => { const c = Math.abs(Math.cos(l.rot)), s2 = Math.abs(Math.sin(l.rot)); return clear(l.cx, l.cz, (l.lw * c + dW * s2) / 2, (l.lw * s2 + dW * c) / 2); });
    for (const { cx, cz, lw, rot } of lots) {
      const bid = newBld(0.06);
      const floors = Math.max(3, floorsBase + Math.floor(R(-1, 1.6)));
      if (mode === 'modern') {
        const h = floors * FLOOR;
        const lay = pick([HB.resid, HB.resid, HB.brick, HB.brick2]);
        const y = put(B.hBox, bid, cx, cz, lw, dW, h, rot, lay, HR.flat, R(0.3, 0.6), pick(PAL.render));
        if (lay === HB.resid) balconies(bid, cx + Math.sin(rot) * dW / 2, cz + Math.cos(rot) * dW / 2, lw * 0.85, rot, y, floors, rnd() < 0.5);
        edicule(bid, cx, y + h, cz, lw);
      } else {
        const wallH = 0.0045 + (floors - 1) * 0.0031;
        const lay = mode === 'hauss' ? (rnd() < 0.92 ? HB.hauss : HB.brick2) : pick([HB.hauss, HB.hauss, HB.brick, HB.brick2, HB.resid]);
        const tint = mode === 'hauss' ? pick(PAL.stone) : pick(PAL.pastel);
        put(intact ? B.hMans : B.hMansAll, bid, cx, cz, lw + 0.0004, dW, wallH / 0.78, rot, lay, roofKind, R(0.3, 0.65), tint);
      }
    }
    // niveau de détail lointain : l'îlot entier en un volume
    if (mode !== 'modern' && intact) {
      const rid = newBld(0.1);
      const H = (0.0045 + (floorsBase - 1) * 0.0031) / 0.78;
      noClear = true;
      put(B.hRing, rid, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, W, D, H, 0, mode === 'hauss' ? HB.hauss : HB.brick, roofKind, R(0.3, 0.6), mode === 'hauss' ? pick(PAL.stone) : pick(PAL.pastel));
      noClear = false;
    }
    // cour intérieure : jardin et arbres
    if (intact || clear((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, W / 2 - dW, D / 2 - dW)) {
      noClear = true;
      put(B.iBox, newBld(0), (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, W - 2 * dW, D - 2 * dW, 0.0005, 0, IN.garden, 1, 0, [1, 1, 1]);
      noClear = false;
    }
    const nt = detail ? 4 + Math.floor(rnd() * 6) : 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < nt; k++) tree(R(r.x0 + dW + 0.01, r.x1 - dW - 0.01), R(r.z0 + dW + 0.01, r.z1 - dW - 0.01), R(0.011, 0.018));
  };

  /** Barre d'habitation (avec balcons) ; renvoie l'identifiant. */
  const slab = (x: number, z: number, len: number, floors: number, rot: number, layer: number) => {
    const bid = newBld();
    const d = R(0.012, 0.015);
    const h = floors * FLOOR;
    const y = put(B.hBox, bid, x, z, len, d, h, rot, layer, HR.flat, R(0.3, 0.6), pick(PAL.render));
    if (layer === HB.resid && rnd() < 0.75) {
      const dark = rnd() < 0.5;
      // axe local +z dans le monde : (sin rot, cos rot)
      const ox = Math.sin(rot) * d / 2, oz = Math.cos(rot) * d / 2;
      balconies(bid, x + ox, z + oz, len * 0.9, rot, y, floors, dark);
      balconies(bid, x - ox, z - oz, len * 0.9, rot + Math.PI, y, floors, dark);
    }
    edicule(bid, x, y + h, z, len * 0.3);
    if (len > 0.08) edicule(bid, x + (rnd() - 0.5) * len * 0.6, y + h, z, 0.01);
  };

  /** Tour d'habitation. */
  const resTower = (x: number, z: number, s: number, floors: number) => {
    const bid = newBld();
    const h = floors * FLOOR;
    const lay = rnd() < 0.25 ? HB.tower : pick([HB.resid, HB.resid, HB.brick, HB.brick2]);
    const y = put(B.hBox, bid, x, z, s, s * R(0.85, 1.15), h, 0, lay, HR.flat, R(0.3, 0.6), pick(PAL.render));
    if (lay === HB.resid) { const dark = rnd() < 0.5; balconies(bid, x, z + s / 2, s * 0.8, 0, y, floors, dark); balconies(bid, x, z - s / 2, s * 0.8, Math.PI, y, floors, dark); }
    edicule(bid, x, y + h, z, s * 0.3);
  };

  const residentialBlock = (r: Rect) => {
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const u = rnd();
    const lay = () => (rnd() < 0.6 ? HB.resid : pick([HB.brick, HB.brick2]));
    if (u < 0.35) {
      const L = W * R(0.6, 0.9);
      slab(cx + R(-0.01, 0.01), r.z0 + 0.025, L, 8 + Math.floor(rnd() * 7), 0, lay());
      slab(cx + R(-0.01, 0.01), r.z1 - 0.025, L * R(0.7, 1), 8 + Math.floor(rnd() * 7), 0, lay());
    } else if (u < 0.6) {
      const n = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) resTower(r.x0 + W * (k + 0.5) / n, cz + R(-D * 0.25, D * 0.25), R(0.02, 0.027), 12 + Math.floor(rnd() * 14));
    } else if (u < 0.85) {
      slab(cx, r.z1 - 0.012, W * 0.85, 7 + Math.floor(rnd() * 6), 0, lay());
      slab(r.x0 + 0.012, cz - 0.015, D * 0.6, 7 + Math.floor(rnd() * 6), Math.PI / 2, lay());
      if (rnd() < 0.5) resTower(cx + W * 0.2, cz - D * 0.2, 0.022, 14 + Math.floor(rnd() * 10));
    } else {
      perimeterBlock(r, 'modern');
      return;
    }
    const nt = detail ? 2 + Math.floor(rnd() * 4) : 2;
    for (let k = 0; k < nt; k++) tree(R(r.x0 + 0.01, r.x1 - 0.01), R(cz - 0.03, cz + 0.03), R(0.01, 0.016));
  };

  /** Petits collectifs (3 à 6 étages), toits plats ou à deux pans. */
  const collectiveBlock = (r: Rect) => {
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    const nx = 2, nz = detail ? 2 : 1;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (rnd() < 0.12) continue;
        const x = r.x0 + W * (i + 0.5) / nx + R(-0.004, 0.004), z = r.z0 + D * (j + 0.5) / nz + R(-0.006, 0.006);
        const w = Math.min(W / nx - 0.012, R(0.03, 0.046)), d = R(0.012, 0.016);
        const floors = 3 + Math.floor(rnd() * 4);
        const bid = newBld();
        const lay = pick([HB.resid, HB.resid, HB.brick, HB.brick2, HB.house]);
        if (rnd() < 0.35) {
          const wallH = floors * FLOOR;
          put(B.hHouse, bid, x, z, w, d, wallH / 0.6 * 0.8, 0, lay, pick([HR.tiles, HR.slate]), R(0.3, 0.6), pick(PAL.house));
        } else {
          const h = floors * FLOOR;
          const y = put(B.hBox, bid, x, z, w, d, h, 0, lay, HR.flat, R(0.3, 0.6), pick(PAL.render));
          if (lay === HB.resid && rnd() < 0.5) balconies(bid, x, z + d / 2, w * 0.85, 0, y, floors, rnd() < 0.5);
          edicule(bid, x, y + h, z, w * 0.3);
        }
      }
    }
    const nt = detail ? 2 + Math.floor(rnd() * 3) : 1;
    for (let k = 0; k < nt; k++) tree(R(r.x0, r.x1), R(r.z0, r.z1), R(0.009, 0.015));
  };

  /** Lotissement pavillonnaire : maisons alignées sur rue, jardins à l'arrière, arbres. */
  const suburbBlock = (r: Rect) => {
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    const gid = newBld(0);
    put(B.iBox, gid, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, W, D, 0.0006, 0, IN.garden, 0, 0, [1, 1, 1]);
    const sides = detail ? 4 : 2;
    const wallT = pick(PAL.house);
    for (let sdi = 0; sdi < sides; sdi++) {
      const horiz = sdi < 2;
      const len = horiz ? W : D - 0.05;
      const lot = detail ? R(0.024, 0.03) : R(0.02, 0.026);
      const n = Math.max(1, Math.floor(len / lot));
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.1) continue;
        const t = -len / 2 + (k + 0.5) * (len / n);
        const w = R(0.009, 0.013), d = R(0.008, 0.0105);
        const set = R(0.005, 0.008) + d / 2;
        let x: number, z: number, rot: number;
        if (sdi === 0) { x = (r.x0 + r.x1) / 2 + t; z = r.z1 - set; rot = 0; }
        else if (sdi === 1) { x = (r.x0 + r.x1) / 2 + t; z = r.z0 + set; rot = 0; }
        else if (sdi === 2) { x = r.x0 + set; z = (r.z0 + r.z1) / 2 + t; rot = Math.PI / 2; }
        else { x = r.x1 - set; z = (r.z0 + r.z1) / 2 + t; rot = Math.PI / 2; }
        const bid = newBld(0.3);
        const two = rnd() < 0.55;
        const h = (two ? 0.0058 : 0.0031) / 0.6;
        put(B.hHouse, bid, x, z, w, d, h * R(0.95, 1.1), rot, HB.house, rnd() < 0.65 ? HR.tiles : HR.slate, R(0.25, 0.55), rnd() < 0.6 ? wallT : pick(PAL.house));
        // arbre de jardin à l'arrière
        if (rnd() < 0.3) {
          const back = set + d / 2 + R(0.008, 0.02);
          const tx = sdi === 2 ? r.x0 + back : sdi === 3 ? r.x1 - back : x + R(-0.004, 0.004);
          const tz = sdi === 0 ? r.z1 - back : sdi === 1 ? r.z0 + back : z + R(-0.004, 0.004);
          tree(tx, tz, R(0.008, 0.014));
        }
      }
    }
  };

  /** Zone d'activités : entrepôts (toits plats, sheds, cintrés), silos, petit bâtiment de bureaux. */
  const industrialBlock = (r: Rect, nearPort: boolean) => {
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    if (nearPort && rnd() < 0.3) {
      // batterie de silos
      const bid = newBld();
      const n = 3 + Math.floor(rnd() * 4), m = 1 + Math.floor(rnd() * 2);
      const dia = R(0.009, 0.013), h = R(0.025, 0.042);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) put(B.iSilo, bid, cx + (i - (n - 1) / 2) * dia * 1.05, cz + (j - (m - 1) / 2) * dia * 1.05, dia, dia, h, 0, IN.concrete, 0, 0, [1, 1, 1]);
      put(B.iBox, bid, cx, cz + D * 0.35, W * 0.5, D * 0.2, 0.01, 0, IN.corr, 0, 0, pick(PAL.metal));
      return;
    }
    const split = rnd() < 0.55;
    const parts: Rect[] = split ? [{ ...r, x1: cx - 0.008 }, { ...r, x0: cx + 0.008 }] : [r];
    for (const p of parts) {
      const pw = (p.x1 - p.x0) * R(0.75, 0.95), pd = (p.z1 - p.z0) * R(0.55, 0.85);
      const px = (p.x0 + p.x1) / 2, pz = (p.z0 + p.z1) / 2 + R(-0.01, 0.01);
      const bid = newBld();
      const h = R(0.008, 0.016);
      const u = rnd();
      const tint = pick(PAL.metal);
      const lay = rnd() < 0.7 ? IN.corr : IN.plates;
      if (u < 0.35) put(B.iBox, bid, px, pz, pw, pd, h, 0, lay, 0, 0, tint);
      else if (u < 0.65) put(B.iShed, bid, px, pz, pw, pd, h * 1.3, 0, lay, 0, 0, tint);
      else if (u < 0.85) put(B.iVault, bid, px, pz, pw, pd, h * 1.6, rnd() < 0.5 ? 0 : Math.PI / 2, lay, 0, 0, tint);
      else { put(B.iBox, bid, px, pz, pw, pd, h, 0, IN.concrete, 0, 0, [1, 1, 1]); if (detail) putAt(B.det, bid, px + pw * 0.3, grid.y(px, pz) + h, pz, 0.004, 0.004, R(0.02, 0.04), 0, IN.brick, 0, 0, [1, 1, 1]); }
      if (detail && rnd() < 0.5) edicule(bid, px, grid.y(px, pz) + h * 1.3, pz, pw * 0.3);
    }
    if (rnd() < 0.35) officeBlock(r.x0 + 0.015, r.z1 - 0.012, 0.025, 0.015, 3 + Math.floor(rnd() * 3));
    void W;
  };

  // ---------- parcours des îlots ----------
  interface Plan { rect: Rect; zone: string; core: number; best: number; district: number; thr: number; nearPort: boolean; x: number; z: number }
  const plans: Plan[] = [];
  const i0 = Math.ceil(-HALF_W / CELL), i1 = Math.floor(HALF_W / CELL) - 1;
  const j0 = Math.ceil(-HALF_D / CELL), j1 = Math.floor(HALF_D / CELL) - 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const bx0 = i * CELL, bz0 = j * CELL;
      const x = bx0 + CELL / 2, z = bz0 + CELL / 2;
      const dens = urbanDensity(country, x, z);
      if (dens < 0.06) continue;
      if (blocked.has(key(i, j))) continue;
      if (parkMask(country.seed, x, z) > 0.5) continue;
      if (Math.min(grid.sample(x, z), grid.sample(bx0 + 0.02, bz0 + 0.02), grid.sample(bx0 + 0.18, bz0 + 0.02), grid.sample(bx0 + 0.02, bz0 + 0.18), grid.sample(bx0 + 0.18, bz0 + 0.18)) < 0.024) continue;
      const p0 = Math.min(1, Math.pow(dens, 0.55) * 1.08);
      const u = rnd();
      if (u > p0 * GROWTH_CAP) continue;
      let district = 0, best = Infinity;
      for (const c of country.cities) { const v = Math.hypot(c.x - x, c.z - z) / c.radius; if (v < best) { best = v; district = c.id; } }
      const dc = country.cities[district];
      const dCap = Math.hypot(x - cap.x, z - cap.z);
      const n = fbm(x * 0.5 + 11, z * 0.5 - 3, 3);
      const nearInd = industrial.some((q) => Math.hypot(q.x - x, q.z - z) < 1.3);
      const nearPort = ports.some((q) => Math.hypot(q.x - x, q.z - z) < 2.2);
      // marges : trottoirs le long des rues, plus larges le long des boulevards (multiples de 1 km)
      const isBlvd = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
      const m = (v: number) => (isBlvd(v) ? 0.03 : 0.017);
      const rect = { x0: bx0 + m(bx0), x1: bx0 + CELL - m(bx0 + CELL), z0: bz0 + m(bz0), z1: bz0 + CELL - m(bz0 + CELL) };
      let zone: string;
      const cbdR = 1.6 + n * 0.8;
      if (nearInd) zone = 'ind';
      else if (dc.capital && dCap < cbdR) zone = 'cbd';
      else if (dc.kind === 'metropole' && !dc.capital && best < 0.16) zone = 'cbd2';
      else if ((dc.capital && dCap < 4.6 + n * 1.2 && dens > 0.5) || (dc.kind === 'metropole' && best < 0.4)) zone = rnd() < 0.08 ? 'office' : 'hauss';
      else if (dc.kind === 'ville' && best < 0.3) zone = 'ville';
      else if (dens > 0.56) zone = rnd() < 0.1 ? 'collectif' : 'resid';
      else if (dens > 0.33) zone = rnd() < 0.15 ? 'suburb' : 'collectif';
      else zone = 'suburb';
      // qualité basse : moins d'îlots dans le tissu courant (le centre reste complet)
      if (!['cbd', 'cbd2', 'hauss', 'office'].includes(zone) && rnd() > keep) continue;
      plans.push({ rect, zone, core: dc.capital ? 1 - dCap / cbdR : 0.4 * (1 - best / 0.16), best, district, thr: u / Math.max(0.01, p0), nearPort, x, z });
    }
  }
  // tours signatures : les îlots les plus centraux du centre d'affaires de la capitale
  const sigs = plans.filter((p) => p.zone === 'cbd' && clear((p.rect.x0 + p.rect.x1) / 2, (p.rect.z0 + p.rect.z1) / 2, 0.06, 0.06))
    .sort((a, b) => b.core - a.core).slice(0, 40);
  const sigOrder = [1, 2, 1, 3];
  const sigH = [0.46, 0.38, 0.33, 0.3];
  const sigSet = new Map<Plan, number>();
  for (let k = 0, s = 0; k < sigs.length && s < 4; k++) {
    if ([...sigSet.keys()].some((q) => Math.hypot(q.x - sigs[k].x, q.z - sigs[k].z) < 0.3)) continue;
    sigSet.set(sigs[k], s++);
  }
  // exemples d'îlots par zone (diagnostic) : l'îlot le plus proche du centre ayant au moins 8 voisins de même zone
  {
    const ex: Record<string, [number, number]> = {};
    const byKey = new Map(plans.map((p) => [Math.round(p.x * 5) * 100000 + Math.round(p.z * 5), p.zone]));
    const sorted = [...plans].sort((a, b) => Math.hypot(a.x - cap.x, a.z - cap.z) - Math.hypot(b.x - cap.x, b.z - cap.z));
    for (const p of sorted) {
      if (ex[p.zone]) continue;
      let same = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (byKey.get((Math.round(p.x * 5) + a) * 100000 + Math.round(p.z * 5) + b) === p.zone) same++;
      if (same >= 8) ex[p.zone] = [p.x, p.z];
    }
    (window as unknown as Record<string, unknown>).__bldZones = ex;
  }
  (window as unknown as Record<string, unknown>).__bldSig = [...sigSet.keys()].map((q) => [q.x, q.z]);
  console.log('[bld] tours signatures (dx, dz depuis le centre) : ' + [...sigSet.keys()].map((q) => `${(q.x - cap.x).toFixed(2)},${(q.z - cap.z).toFixed(2)}`).join(' '));

  for (const pl of plans) {
    curDistrict = pl.district;
    curThreshold = pl.thr;
    const r = pl.rect;
    const W = r.x1 - r.x0;
    switch (pl.zone) {
      case 'cbd':
      case 'cbd2': {
        const si = sigSet.get(pl);
        if (si !== undefined) { skyscraper(r, sigH[si], sigOrder[si]); break; }
        const core = Math.max(0, pl.core);
        const H = pl.zone === 'cbd'
          ? 0.08 + 0.28 * Math.pow(core, 0.7) * (0.3 + 0.7 * Math.pow(rnd(), 0.7)) + rnd() * 0.04
          : 0.05 + 0.08 * core * rnd() + rnd() * 0.02;
        if (rnd() < 0.35 && H < 0.2) {
          // deux tours sur l'îlot
          const mid = (r.x0 + r.x1) / 2;
          skyscraper({ ...r, x1: mid - 0.004 }, H, 0);
          skyscraper({ ...r, x0: mid + 0.004 }, H * R(0.6, 0.95), 0);
        } else if (rnd() < 0.15) {
          officeBlock((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, W * 0.8, (r.z1 - r.z0) * 0.5, 8 + Math.floor(rnd() * 8));
        } else {
          // tour sur socle réduit, immeubles de bureaux aux angles de l'îlot
          skyscraper(r, H, 0, 0.6);
          const corners: [number, number][] = [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]];
          for (const [qx, qz] of corners) {
            if (rnd() < 0.35) continue;
            const w = R(0.03, 0.045), d = R(0.028, 0.04);
            officeBlock(qx + Math.sign(r.x0 + W / 2 - qx) * (w / 2 + 0.002), qz + Math.sign(r.z0 + (r.z1 - r.z0) / 2 - qz) * (d / 2 + 0.002), w, d, 5 + Math.floor(rnd() * (pl.zone === 'cbd' ? 12 : 6)));
          }
        }
        break;
      }
      case 'office':
        officeBlock((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, W * 0.7, (r.z1 - r.z0) * 0.6, 6 + Math.floor(rnd() * 8));
        break;
      case 'hauss': perimeterBlock(r, 'hauss'); break;
      case 'ville': perimeterBlock(r, 'ville'); break;
      case 'resid': residentialBlock(r); break;
      case 'collectif': collectiveBlock(r); break;
      case 'suburb': suburbBlock(r); break;
      case 'ind': industrialBlock(r, pl.nearPort); break;
    }
  }

  // ---------- envoi au GPU ----------
  const all = Object.values(B);
  for (const b of all) b.finish();
  B.balc.mesh.receiveShadows = false;

  // volume de sélection invisible : une boîte par bâtiment (clic → quartier)
  const box = MeshBuilder.CreateBox('buildings', { size: 1 }, scene);
  box.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  box.isVisible = false;
  box.isPickable = true;
  box.thinInstanceEnablePicking = true;
  const pickMat = new Float32Array(Math.max(1, blds.length) * 16);
  const pickBase = new Float32Array(pickMat.length);
  blds.forEach((b, i) => {
    if (!isFinite(b.x0)) { b.x0 = b.x1 = b.z0 = b.z1 = 0; b.y0 = b.y1 = 0; }
    pickBase.set([b.x1 - b.x0, 0, 0, 0, 0, Math.max(0.001, b.y1 - b.y0), 0, 0, 0, 0, b.z1 - b.z0, 0, (b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2, 1], i * 16);
  });
  box.thinInstanceSetBuffer('matrix', pickMat, 16, false);

  const on = new Uint8Array(Math.max(1, blds.length));
  const view = { x: cap.x, z: cap.z, r: 16 };
  const refresh = () => { for (const b of all) b.apply(on, view.x, view.z, view.r); };
  const update = (ratios: number[]) => {
    for (let i = 0; i < blds.length; i++) on[i] = blds[i].threshold < Math.min(GROWTH_CAP, Math.max(0.3, ratios[blds[i].district] ?? 1)) ? 1 : 0;
    on[0] = 1; // propriétaire des arbres : toujours visibles
    refresh();
    for (let i = 0; i < blds.length; i++) {
      const k = i * 16;
      if (on[i]) for (let j = 0; j < 16; j++) pickMat[k + j] = pickBase[k + j];
      else { pickMat.fill(0, k, k + 12); pickMat[k + 12] = pickBase[k + 12]; pickMat[k + 13] = pickBase[k + 13]; pickMat[k + 14] = pickBase[k + 14]; pickMat[k + 15] = 1; }
    }
    box.thinInstanceBufferUpdated('matrix');
    box.thinInstanceRefreshBoundingInfo(false);
  };
  update(country.cities.map(() => 1));

  // niveau de détail : recompactage des lots quand le point visé ou la distance changent nettement
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera as (Camera & { target?: Vector3; radius?: number }) | null;
    if (!cam) return;
    const t = cam.target ?? cam.globalPosition;
    const r = cam.radius ?? 10;
    BLD_VIEW.x = t.x; BLD_VIEW.z = t.z; BLD_VIEW.houseR = houseRange(view.r);
    const moved = Math.hypot(t.x - view.x, t.z - view.z);
    if (moved > Math.max(0.25, view.r * 0.12) || Math.abs(r - view.r) > view.r * 0.15) {
      view.x = t.x; view.z = t.z; view.r = r;
      refresh();
      BLD_VIEW.houseR = houseRange(r);
    }
  });

  const meshes = all.map((b) => b.mesh).filter((m) => (m.thinInstanceCount ?? 0) > 0);
  // halo nocturne : les bâtiments n'ont pas d'émissif Babylon, inutile de les redessiner dans la passe de halo
  for (const l of scene.effectLayers ?? []) if (l instanceof GlowLayer) for (const m of all) l.addExcludedMesh(m.mesh);
  const instances = all.reduce((s, b) => s + b.count, 0);
  // outils de diagnostic (captures automatisées) : instances dessinées par gabarit, gabarits
  (window as unknown as Record<string, unknown>).__bld = () => Object.fromEntries(Object.entries(B).map(([k, b]) => [k, b.drawn]));
  (window as unknown as Record<string, unknown>).__bldMeshes = B;
  (window as unknown as Record<string, unknown>).__bldView = view;
  (window as unknown as Record<string, unknown>).__bldCam = () => scene.activeCamera;
  (window as unknown as Record<string, unknown>).__bldEnv = ENV;
  console.log(`[bld] ${blds.length} bâtiments, ${instances} instances, ${meshes.length} gabarits : ` + Object.entries(B).map(([k, b]) => `${k}=${b.count}`).join(' '));
  return {
    box,
    roof: B.hHouse.mesh,
    meshes,
    // ombres : les balcons (escamotés dans le shader) et les arbres ne projettent pas d'ombre
    shadowCasters: meshes.filter((m) => m !== B.balc.mesh && m !== B.det.mesh),
    update,
    count: blds.length,
    cityOfInstance: (i: number) => blds[i]?.district ?? -1,
  };
}
