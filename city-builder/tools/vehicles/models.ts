/**
 * Définitions des véhicules (silhouettes réellement différentes) : voitures particulières, taxi,
 * police, utilitaire, ambulance, camion porteur, bus, fourgon-pompe des pompiers, benne à ordures.
 * Chaque définition construit le modèle pour un LOD donné (mb.lod) de façon déterministe.
 */
import { CarBody, type CabinSpec, type Curve, type LowerSpec } from './body';
import type { Mat, V3 } from './mesh';
import { archTrim, bodySideStrip, doorSeam, exhaust, handle, lamp, lightbar, mirror, plate, roofRails, sideDecal, slab, VMesh, wheel, wiper, type RimStyle } from './parts';
import type { RegionName } from './textures';

export type VehicleKind = 'car' | 'van' | 'bus' | 'truck' | 'service';

export interface PaintVariant { id: string; nameFr: string; color: string }

export interface VehicleDef {
  id: string;
  nameFr: string;
  kind: VehicleKind;
  maxSpeedKmh: number;
  /** Rôle dans le trafic (étiquette `usage:*`). */
  usage: 'prive' | 'taxi' | 'police' | 'livraison' | 'ambulance' | 'fret' | 'bus' | 'pompiers' | 'proprete';
  lengthM: number;
  /** Variantes de peinture (la première est la teinte d'origine). */
  paints: PaintVariant[];
  /** Distances de bascule LOD0 → LOD1 → LOD2 (m). */
  lodDistances: [number, number];
  build(mb: VMesh): void;
}

const P = (id: string, nameFr: string, color: string): PaintVariant => ({ id, nameFr, color });

/* ------------------------------------------------------------------ */
/* Voiture particulière paramétrique                                    */
/* ------------------------------------------------------------------ */

interface CarParams {
  L: number; W: number; R: number; wheelW: number; track: number; axleF: number; axleR: number;
  hoodFront: number; hoodRear: number; beltRear: number; deckY: number; tailTop: number;
  sill: number; noseBottom: number; tailBottom: number;
  zWs0: number; zWs1: number; zRf1: number; zRw1: number; roofY: number; roofArc?: number;
  planF: number; planR: number; rb?: number; rt?: number; bulge?: number; tumble?: number;
  cabinInset?: number; cabinTumble?: number; cabinRt?: number;
  sideGlass: [number, number][]; rearGlass?: boolean; sillH?: number; header?: number;
  rim: RimStyle; cladding?: boolean;
  /** Montant B (z) et fin de porte arrière (z) pour joints et poignées ; null = 2 portes. */
  bPillar: number | null; rearDoorEnd?: number;
  headlightW?: number; taillightW?: number;
}

function sortCurve(c: Curve): Curve {
  const s = [...c].sort((a, b) => a[0] - b[0]);
  const out: Curve = [];
  for (const p of s) if (!out.length || p[0] - out[out.length - 1]![0] > 0.04) out.push(p);
  return out;
}

function passengerCar(mb: VMesh, p: CarParams): CarBody {
  const nose = p.L / 2, tail = -p.L / 2;
  const top: Curve = sortCurve([
    [tail, p.tailTop], [tail + 0.2, p.deckY - 0.01], [Math.max(tail + 0.3, p.zRw1), p.deckY],
    [p.zRw1 + 0.05 > p.zWs0 ? p.zRw1 : (p.zRw1 + p.zWs0) / 2, (p.beltRear + p.hoodRear) / 2],
    [p.zWs0, p.hoodRear], [nose - 0.35, p.hoodFront + 0.05], [nose, p.hoodFront],
  ]);
  const bottom: Curve = [[tail, p.tailBottom], [tail + 0.45, p.sill], [nose - 0.45, p.sill], [nose, p.noseBottom]];
  const archR = p.R + 0.07;
  const cladY = p.sill + 0.16;
  const lower: LowerSpec = {
    noseZ: nose, tailZ: tail, hw: p.W / 2, planF: p.planF, planR: p.planR, top, bottom,
    arches: [{ z: p.axleF, r: archR }, { z: p.axleR, r: archR }], archY: p.R - 0.02,
    rb: p.rb ?? 0.12, rt: p.rt ?? 0.14, bulge: p.bulge ?? 0.025, tumble: p.tumble ?? 0.05,
    matAt: (_z: number, y: number) => (y < (p.cladding ? cladY : p.sill + 0.05) ? { mat: 'atlas' as Mat, region: 'plastique' as RegionName } : null),
  };
  const cabin: CabinSpec = {
    zWs0: p.zWs0, zWs1: p.zWs1, zRf1: p.zRf1, zRw1: p.zRw1, roofY: p.roofY, roofArc: p.roofArc ?? 0.03,
    inset: p.cabinInset ?? 0.05, tumble: p.cabinTumble ?? 0.16, rt: p.cabinRt ?? 0.1,
    sideGlass: p.sideGlass, rearGlass: p.rearGlass ?? true, sill: p.sillH ?? 0.06, header: p.header ?? 0.04,
  };
  const body = new CarBody(lower, cabin);
  body.build(mb);

  // roues
  for (const z of [p.axleF, p.axleR]) for (const s of [1, -1] as const) wheel(mb, s * (p.track / 2), p.R, z, p.R, p.wheelW, s, p.rim);
  archLiners(mb, body, p.R, archR, [p.axleF, p.axleR]);
  if (p.cladding) for (const az of [p.axleF, p.axleR]) for (const s of [1, -1] as const) archTrim(mb, body, s, az, archR, p.R - 0.02, 0.07);

  // face avant : calandre, prise d'air, plaque, phares, antibrouillards
  const hwN = body.hwAt(nose);
  const yTopN = body.topAt(nose), yBotN = body.bottomAt(nose);
  const zf = nose + 0.004;
  const gH = Math.min(0.16, (yTopN - yBotN) * 0.3);
  mb.quad('atlas', [-hwN * 0.62, yTopN - 0.05 - gH, zf], [hwN * 0.62, yTopN - 0.05 - gH, zf], [hwN * 0.62, yTopN - 0.05, zf], [-hwN * 0.62, yTopN - 0.05, zf], 'calandre');
  mb.quad('atlas', [-hwN * 0.85, yBotN + 0.03, zf], [hwN * 0.85, yBotN + 0.03, zf], [hwN * 0.85, yBotN + 0.13, zf], [-hwN * 0.85, yBotN + 0.13, zf], 'calandre');
  plate(mb, Math.min(yBotN + 0.22, yTopN - gH - 0.14), zf + 0.002, 1);
  const hlW = p.headlightW ?? 0.42;
  const yHL = yTopN - 0.085;
  for (const s of [1, -1]) {
    const x = s * (p.W / 2 - p.planF * 0.45 - hlW * 0.3);
    const zA = body.frontZ(x - 0.06 * s, yHL), zB = body.frontZ(x + 0.06 * s, yHL);
    const yaw = Math.atan2(-(zB - zA) / 0.12, 1) * s;
    lamp(mb, 'phare', x, yHL, body.frontZ(x, yHL) - 0.012, hlW, 0.1, yaw, 0.05);
    if (mb.lod === 0) lamp(mb, 'clignotant', x + s * (hlW / 2 + 0.03), yHL - 0.01, body.frontZ(x + s * (hlW / 2 + 0.03), yHL - 0.01) - 0.015, 0.07, 0.06, yaw * 1.6, 0.04);
  }
  // arrière : feux, plaque, diffuseur, échappement
  const hwT = body.hwAt(tail);
  const yTopT = body.topAt(tail), yBotT = body.bottomAt(tail);
  const zt = tail - 0.004;
  plate(mb, (yTopT + yBotT) / 2 - 0.04, zt - 0.002, -1);
  mb.quad('atlas', [hwT * 0.9, yBotT + 0.03, zt], [-hwT * 0.9, yBotT + 0.03, zt], [-hwT * 0.9, yBotT + 0.12, zt], [hwT * 0.9, yBotT + 0.12, zt], 'plastique');
  const tlW = p.taillightW ?? 0.34;
  const yTL = yTopT - 0.07;
  for (const s of [1, -1]) {
    const x = s * (p.W / 2 - p.planR * 0.4 - tlW * 0.3);
    const zA = body.rearZ(x - 0.06 * s, yTL), zB = body.rearZ(x + 0.06 * s, yTL);
    const yaw = Math.PI - Math.atan2((zB - zA) / 0.12, 1) * s;
    lamp(mb, 'feu', x, yTL, body.rearZ(x, yTL) + 0.012, tlW, 0.11, yaw, 0.05);
    if (mb.lod === 0) lamp(mb, 'catadioptre', s * hwT * 0.75, yBotT + 0.16, zt - 0.01, 0.12, 0.04, Math.PI, 0.02);
  }
  exhaust(mb, -p.W * 0.3, p.sill + 0.02, tail + 0.06);

  // flancs : joints d'ouvrants, poignées, rétroviseurs, essuie-glaces
  const yb0 = p.sill + 0.08, yb1 = p.hoodRear - 0.04;
  for (const s of [1, -1] as const) {
    doorSeam(mb, body, s, p.zWs0 - 0.02, yb0, yb1);
    if (p.bPillar !== null) {
      doorSeam(mb, body, s, p.bPillar, yb0, yb1);
      if (p.rearDoorEnd !== undefined) doorSeam(mb, body, s, p.rearDoorEnd, yb0 + 0.12, yb1);
      handle(mb, body, s, p.bPillar + 0.18, yb1 - 0.08);
      handle(mb, body, s, (p.rearDoorEnd ?? p.bPillar - 0.8) + 0.2, yb1 - 0.08);
    } else {
      const end = p.zRf1 + 0.1;
      doorSeam(mb, body, s, end, yb0, yb1);
      handle(mb, body, s, end + 0.18, yb1 - 0.08);
    }
    const xm = body.hwAt(p.zWs0 - 0.12) - (p.tumble ?? 0.05) - (p.cabinInset ?? 0.05);
    mirror(mb, s, xm, p.hoodRear + 0.08, p.zWs0 - 0.12);
  }
  const wsSlope = Math.atan2(p.roofY - p.hoodRear, p.zWs0 - p.zWs1);
  for (const s of [1, -1]) wiper(mb, s * 0.28, p.hoodRear + 0.012, p.zWs0 - 0.04, 0.5, wsSlope);
  return body;
}

/** Passages de roues : demi-tunnel sombre qui masque l'intérieur de la caisse. */
function archLiners(mb: VMesh, body: CarBody, R: number, archR: number, axles: number[]): void {
  if (mb.lod === 2) return;
  const n = mb.lod === 0 ? 10 : 6;
  for (const az of axles) for (const s of [1, -1]) {
    const hw = body.hwAt(az);
    const xs = [s * (hw - 0.02), s * (hw - 0.34)];
    const rows: V3[][] = xs.map((x) => {
      const row: V3[] = [];
      for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI; row.push([x, R - 0.02 + Math.sin(a) * (archR - 0.01), az + Math.cos(a) * (archR - 0.01)]); }
      return row;
    });
    mb.surface(rows, { mat: () => ({ mat: 'atlas', region: 'noir_mat' }), smoothAngle: 60, flip: s > 0 });
  }
}

/* ------------------------------------------------------------------ */
/* Véhicules particuliers                                               */
/* ------------------------------------------------------------------ */

const citadine: VehicleDef = {
  id: 'vehicule_citadine', nameFr: 'Citadine', kind: 'car', maxSpeedKmh: 140, usage: 'prive', lengthM: 3.85, lodDistances: [90, 320],
  paints: [P('rouge', 'Rouge vif', '#b3261e'), P('blanc', 'Blanc nacré', '#e9e7e2'), P('bleu', 'Bleu azur', '#2f6db3'), P('jaune', 'Jaune moutarde', '#d2a12a'), P('gris', 'Gris clair', '#a7abb0'), P('vert', 'Vert d\'eau', '#7fb7a4')],
  build(mb) {
    passengerCar(mb, {
      L: 3.85, W: 1.74, R: 0.31, wheelW: 0.19, track: 1.5, axleF: 1.2, axleR: -1.24,
      hoodFront: 0.72, hoodRear: 0.92, beltRear: 0.98, deckY: 0.98, tailTop: 0.98, sill: 0.3, noseBottom: 0.36, tailBottom: 0.4,
      zWs0: 0.8, zWs1: -0.05, zRf1: -1.45, zRw1: -1.85, roofY: 1.47, roofArc: 0.02,
      planF: 0.42, planR: 0.3, rt: 0.12, cabinTumble: 0.17,
      sideGlass: [[-1.4, -0.06], [-0.04, 0.55]], bPillar: -0.05, rearDoorEnd: -0.95, rim: 'alliage', headlightW: 0.36, taillightW: 0.18,
    });
  },
};

const berline: VehicleDef = {
  id: 'vehicule_berline', nameFr: 'Berline', kind: 'car', maxSpeedKmh: 190, usage: 'prive', lengthM: 4.75, lodDistances: [100, 340],
  paints: [P('noir', 'Noir profond', '#1b1d21'), P('argent', 'Argent', '#b9bdc2'), P('bleu_nuit', 'Bleu nuit', '#1f2f4f'), P('blanc', 'Blanc', '#ecebe7'), P('bordeaux', 'Bordeaux', '#5d1a24'), P('gris_anthracite', 'Gris anthracite', '#3e4247')],
  build(mb) {
    passengerCar(mb, {
      L: 4.75, W: 1.84, R: 0.33, wheelW: 0.22, track: 1.58, axleF: 1.42, axleR: -1.42,
      hoodFront: 0.68, hoodRear: 0.94, beltRear: 1.0, deckY: 1.02, tailTop: 0.98, sill: 0.3, noseBottom: 0.34, tailBottom: 0.38,
      zWs0: 0.95, zWs1: 0.2, zRf1: -0.95, zRw1: -1.6, roofY: 1.44, roofArc: 0.03,
      planF: 0.5, planR: 0.38, rt: 0.13,
      sideGlass: [[-1.18, -0.12], [-0.06, 0.82]], bPillar: -0.09, rearDoorEnd: -1.05, rim: 'alliage', headlightW: 0.46, taillightW: 0.42,
    });
  },
};

const breakCar: VehicleDef = {
  id: 'vehicule_break', nameFr: 'Break familial', kind: 'car', maxSpeedKmh: 185, usage: 'prive', lengthM: 4.8, lodDistances: [100, 340],
  paints: [P('vert_foret', 'Vert forêt', '#2e4a3a'), P('argent', 'Argent', '#b5b9be'), P('blanc', 'Blanc', '#e8e6e1'), P('bleu_acier', 'Bleu acier', '#4a6378'), P('beige', 'Beige sable', '#c2b394')],
  build(mb) {
    const body = passengerCar(mb, {
      L: 4.8, W: 1.84, R: 0.33, wheelW: 0.21, track: 1.58, axleF: 1.4, axleR: -1.38,
      hoodFront: 0.7, hoodRear: 0.95, beltRear: 1.0, deckY: 1.0, tailTop: 1.0, sill: 0.3, noseBottom: 0.34, tailBottom: 0.4,
      zWs0: 0.95, zWs1: 0.2, zRf1: -2.15, zRw1: -2.36, roofY: 1.46, roofArc: 0.02,
      planF: 0.5, planR: 0.24, rt: 0.12,
      sideGlass: [[-2.05, -1.12], [-1.06, -0.1], [-0.04, 0.82]], bPillar: -0.07, rearDoorEnd: -1.09, rim: 'alliage', headlightW: 0.44, taillightW: 0.2,
    });
    roofRails(mb, body, -1.95, 0.05, 0.62);
  },
};

const suv: VehicleDef = {
  id: 'vehicule_suv', nameFr: 'SUV', kind: 'car', maxSpeedKmh: 180, usage: 'prive', lengthM: 4.6, lodDistances: [110, 360],
  paints: [P('gris_titane', 'Gris titane', '#5b6066'), P('blanc', 'Blanc', '#eeede9'), P('noir', 'Noir', '#16181b'), P('orange', 'Orange cuivré', '#b5602a'), P('kaki', 'Kaki', '#6b6a4b'), P('bleu', 'Bleu profond', '#20406a')],
  build(mb) {
    const body = passengerCar(mb, {
      L: 4.6, W: 1.88, R: 0.37, wheelW: 0.24, track: 1.62, axleF: 1.36, axleR: -1.36,
      hoodFront: 0.88, hoodRear: 1.1, beltRear: 1.16, deckY: 1.16, tailTop: 1.14, sill: 0.42, noseBottom: 0.46, tailBottom: 0.5,
      zWs0: 0.9, zWs1: 0.2, zRf1: -1.9, zRw1: -2.22, roofY: 1.68, roofArc: 0.015,
      planF: 0.45, planR: 0.26, rt: 0.14, rb: 0.1,
      sideGlass: [[-1.82, -1.05], [-0.99, -0.08], [-0.02, 0.75]], bPillar: -0.05, rearDoorEnd: -1.02, rim: 'alliage', cladding: true, headlightW: 0.44, taillightW: 0.22,
    });
    roofRails(mb, body, -1.8, 0.1, 0.62);
  },
};

const coupe: VehicleDef = {
  id: 'vehicule_coupe', nameFr: 'Coupé sport', kind: 'car', maxSpeedKmh: 250, usage: 'prive', lengthM: 4.45, lodDistances: [100, 330],
  paints: [P('rouge_course', 'Rouge course', '#a3121a'), P('jaune', 'Jaune', '#e2b318'), P('bleu', 'Bleu électrique', '#1d56c4'), P('blanc', 'Blanc', '#efefec'), P('gris_mat', 'Gris', '#585c61')],
  build(mb) {
    passengerCar(mb, {
      L: 4.45, W: 1.88, R: 0.34, wheelW: 0.26, track: 1.62, axleF: 1.38, axleR: -1.28,
      hoodFront: 0.6, hoodRear: 0.86, beltRear: 0.92, deckY: 0.92, tailTop: 0.9, sill: 0.24, noseBottom: 0.24, tailBottom: 0.32,
      zWs0: 0.75, zWs1: -0.12, zRf1: -0.75, zRw1: -1.75, roofY: 1.28, roofArc: 0.02,
      planF: 0.52, planR: 0.42, rt: 0.12, bulge: 0.04, cabinTumble: 0.2,
      sideGlass: [[-0.95, 0.55]], bPillar: null, rim: 'alliage_sport', headlightW: 0.4, taillightW: 0.5,
    });
  },
};

const monospace: VehicleDef = {
  id: 'vehicule_monospace', nameFr: 'Monospace', kind: 'car', maxSpeedKmh: 175, usage: 'prive', lengthM: 4.65, lodDistances: [110, 360],
  paints: [P('bleu_gris', 'Bleu-gris', '#55708a'), P('blanc', 'Blanc', '#ebeae6'), P('argent', 'Argent', '#b3b7bc'), P('rouge', 'Rouge', '#8e2323'), P('vert', 'Vert sauge', '#7d9479')],
  build(mb) {
    passengerCar(mb, {
      L: 4.65, W: 1.86, R: 0.33, wheelW: 0.21, track: 1.6, axleF: 1.45, axleR: -1.4,
      hoodFront: 0.78, hoodRear: 1.02, beltRear: 1.06, deckY: 1.06, tailTop: 1.05, sill: 0.32, noseBottom: 0.38, tailBottom: 0.42,
      zWs0: 1.4, zWs1: 0.4, zRf1: -2.2, zRw1: -2.3, roofY: 1.72, roofArc: 0.03,
      planF: 0.5, planR: 0.22, rt: 0.15,
      sideGlass: [[-2.1, -1.2], [-1.12, 0.08], [0.16, 1.1]], bPillar: 0.12, rearDoorEnd: -1.2, rim: 'alliage', headlightW: 0.42, taillightW: 0.18,
    });
  },
};

const pickup: VehicleDef = {
  id: 'vehicule_pickup', nameFr: 'Pick-up double cabine', kind: 'car', maxSpeedKmh: 170, usage: 'prive', lengthM: 5.3, lodDistances: [110, 380],
  paints: [P('blanc', 'Blanc', '#e8e7e3'), P('rouge', 'Rouge', '#9a2219'), P('gris', 'Gris acier', '#71777e'), P('noir', 'Noir', '#1a1c1f'), P('sable', 'Sable', '#b9a27a')],
  build(mb) {
    const p: CarParams = {
      L: 5.3, W: 1.9, R: 0.39, wheelW: 0.26, track: 1.64, axleF: 1.72, axleR: -1.48,
      hoodFront: 1.0, hoodRear: 1.16, beltRear: 1.18, deckY: 1.18, tailTop: 1.16, sill: 0.48, noseBottom: 0.52, tailBottom: 0.58,
      zWs0: 1.12, zWs1: 0.45, zRf1: -0.82, zRw1: -0.92, roofY: 1.82, roofArc: 0.01,
      planF: 0.36, planR: 0.12, rt: 0.12, rb: 0.08,
      sideGlass: [[-0.8, 0.0], [0.06, 0.95]], bPillar: 0.03, rearDoorEnd: -0.86, rim: 'acier', cladding: true, headlightW: 0.38, taillightW: 0.12,
    };
    const body = passengerCar(mb, p);
    // benne : plancher creusé (bac sombre) et ridelles peintes
    const z0 = -2.6, z1 = -0.98, hw = body.hwAt(-1.6) - 0.06;
    const yTop = 1.2, yFloor = 0.86;
    slab(mb, 'atlas', 'tole_striee', -hw + 0.04, yFloor, z0 + 0.05, hw - 0.04, yFloor + 0.02, z1);
    for (const s of [1, -1]) slab(mb, 'atlas', 'noir_mat', s * (hw - 0.04), yFloor, z0 + 0.05, s * (hw - 0.06), yTop - 0.02, z1, 'ny');
    slab(mb, 'peinture', undefined, -hw, yTop - 0.02, z1 - 0.06, hw, yTop + 0.01, z1);
    slab(mb, 'peinture', undefined, -hw, yTop - 0.02, z0, hw, yTop + 0.01, z0 + 0.06);
    for (const s of [1, -1]) slab(mb, 'atlas', 'alu', s * (hw - 0.03), yTop + 0.005, z0, s * (hw + 0.01), yTop + 0.03, z1);
  },
};

const taxi: VehicleDef = {
  id: 'vehicule_taxi', nameFr: 'Taxi (berline hybride)', kind: 'car', maxSpeedKmh: 180, usage: 'taxi', lengthM: 4.6, lodDistances: [100, 340],
  paints: [P('noir', 'Noir', '#1c1e22'), P('blanc', 'Blanc', '#ebeae6'), P('gris', 'Gris perle', '#9fa4aa')],
  build(mb) {
    const body = passengerCar(mb, {
      L: 4.6, W: 1.78, R: 0.32, wheelW: 0.2, track: 1.54, axleF: 1.36, axleR: -1.34,
      hoodFront: 0.66, hoodRear: 0.9, beltRear: 0.98, deckY: 0.98, tailTop: 0.96, sill: 0.28, noseBottom: 0.3, tailBottom: 0.36,
      zWs0: 0.85, zWs1: 0.05, zRf1: -0.7, zRw1: -1.95, roofY: 1.47, roofArc: 0.04,
      planF: 0.55, planR: 0.32, rt: 0.13, bulge: 0.03,
      sideGlass: [[-1.25, -0.15], [-0.09, 0.7]], bPillar: -0.12, rearDoorEnd: -1.1, rim: 'alliage', headlightW: 0.44, taillightW: 0.6,
    });
    // enseigne lumineuse « TAXI » sur le pavillon
    const y = body.roofAt(-0.3);
    slab(mb, 'atlas', 'noir_mat', -0.2, y - 0.01, -0.38, 0.2, y + 0.03, -0.22);
    mb.push().translate(0, y + 0.1, -0.3);
    mb.roundedBox(() => ({ mat: 'atlas', region: 'txt_taxi' }), 0, 0, 0, 0.52, 0.15, 0.13, 0.03, mb.lod === 0 ? 2 : 1, 'txt_taxi');
    mb.pop();
  },
};

const police: VehicleDef = {
  id: 'vehicule_police', nameFr: 'Voiture de police', kind: 'service', maxSpeedKmh: 200, usage: 'police', lengthM: 4.35, lodDistances: [110, 360],
  paints: [P('blanc', 'Sérigraphie blanche', '#f1f1ee'), P('bleu_nuit', 'Banalisée bleu nuit', '#1c2a46')],
  build(mb) {
    const body = passengerCar(mb, {
      L: 4.35, W: 1.82, R: 0.34, wheelW: 0.22, track: 1.56, axleF: 1.3, axleR: -1.3,
      hoodFront: 0.78, hoodRear: 1.0, beltRear: 1.05, deckY: 1.05, tailTop: 1.02, sill: 0.36, noseBottom: 0.4, tailBottom: 0.44,
      zWs0: 0.85, zWs1: 0.15, zRf1: -1.65, zRw1: -2.0, roofY: 1.56, roofArc: 0.02,
      planF: 0.45, planR: 0.28, rt: 0.13, rb: 0.1,
      sideGlass: [[-1.58, -1.0], [-0.94, -0.09], [-0.03, 0.72]], bPillar: -0.06, rearDoorEnd: -1.0, rim: 'alliage', cladding: true, headlightW: 0.4, taillightW: 0.22,
    });
    lightbar(mb, body.roofAt(-0.25), -0.25, 1.1, 'bleu');
    const yb = 0.62, yt = 0.86;
    for (const s of [1, -1] as const) {
      bodySideStrip(mb, body, 'txt_police', s, -1.05, 0.8, yb, yt, 0.005, mb.lod === 0 ? 8 : 3);
      bodySideStrip(mb, body, 'bande_tricolore', s, -2.0, -1.06, yb + 0.06, yb + 0.12, 0.005, mb.lod === 0 ? 4 : 2);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Utilitaire et ambulance                                              */
/* ------------------------------------------------------------------ */

function vanBody(mb: VMesh, L: number, roofY: number, glassRear: boolean, cabOnly: boolean): CarBody {
  const nose = L / 2, tail = -L / 2;
  const W = 2.04;
  const lower: LowerSpec = {
    noseZ: nose, tailZ: tail, hw: W / 2, planF: 0.42, planR: 0.08,
    top: [[tail, 1.08], [nose - 1.15, 1.1], [nose - 0.5, 1.02], [nose, 0.9]],
    bottom: [[tail, 0.5], [tail + 0.3, 0.42], [nose - 0.4, 0.42], [nose, 0.42]],
    arches: cabOnly ? [{ z: nose - 0.95, r: 0.43 }] : [{ z: nose - 0.95, r: 0.43 }, { z: tail + 1.15, r: 0.43 }], archY: 0.35,
    rb: 0.08, rt: 0.1, bulge: 0.02, tumble: 0.03,
    matAt: (_z, y) => (y < 0.5 ? { mat: 'atlas', region: 'plastique' } : null),
  };
  const cabin: CabinSpec = {
    zWs0: nose - 1.1, zWs1: nose - 1.85, zRf1: tail + 0.06, zRw1: tail, roofY, roofArc: 0.02,
    inset: 0.0, tumble: 0.08, rt: 0.12, sideGlass: [[nose - 2.15, nose - 1.15]],
    rearGlass: glassRear, sill: 0.08, header: 0.06,
  };
  const body = new CarBody(lower, cabin);
  body.build(mb);
  return body;
}

function vanFront(mb: VMesh, body: CarBody, nose: number, R: number): void {
  const hwN = body.hwAt(nose);
  const yTop = body.topAt(nose), yBot = body.bottomAt(nose);
  const zf = nose + 0.004;
  mb.quad('atlas', [-hwN * 0.6, yTop - 0.24, zf], [hwN * 0.6, yTop - 0.24, zf], [hwN * 0.6, yTop - 0.06, zf], [-hwN * 0.6, yTop - 0.06, zf], 'calandre');
  slab(mb, 'atlas', 'plastique', -hwN - 0.02, yBot - 0.02, nose - 0.25, hwN + 0.02, yBot + 0.2, nose + 0.06);
  plate(mb, yBot + 0.1, nose + 0.064, 1);
  for (const s of [1, -1]) {
    const x = s * (hwN + 0.08);
    lamp(mb, 'phare', x, yTop - 0.12, body.frontZ(x, yTop - 0.12) - 0.04, 0.34, 0.16, s * 0.35, 0.06);
  }
  void R;
}

function vanSides(mb: VMesh, body: CarBody, nose: number, L: number, slidingDoor: boolean): void {
  const yb0 = 0.55, yb1 = 1.05;
  for (const s of [1, -1] as const) {
    doorSeam(mb, body, s, nose - 1.15, yb0, yb1);
    doorSeam(mb, body, s, nose - 2.62, yb0, yb1);
    handle(mb, body, s, nose - 2.4, 1.0, 'peinture');
    if (slidingDoor && s > 0) { doorSeam(mb, body, s, nose - 3.8, yb0, yb1 + 0.6); handle(mb, body, s, nose - 3.6, 1.0, 'peinture'); }
    mirror(mb, s, body.hwAt(nose - 1.2), 1.15, nose - 1.25, true);
  }
  for (const s of [1, -1]) wiper(mb, s * 0.3, 1.12, nose - 1.14, 0.6, 0.9);
  void L;
}

const utilitaire: VehicleDef = {
  id: 'vehicule_utilitaire', nameFr: 'Fourgon de livraison', kind: 'van', maxSpeedKmh: 150, usage: 'livraison', lengthM: 5.4, lodDistances: [120, 400],
  paints: [P('blanc', 'Blanc utilitaire', '#eceae4'), P('gris', 'Gris', '#8e9399'), P('bleu', 'Bleu artisan', '#2b5a8c'), P('jaune', 'Jaune', '#d8b02b'), P('vert', 'Vert', '#3f6b45')],
  build(mb) {
    const L = 5.4, nose = L / 2, tail = -L / 2, R = 0.36;
    const body = vanBody(mb, L, 2.45, false, false);
    for (const z of [nose - 0.95, tail + 1.15]) for (const s of [1, -1] as const) wheel(mb, s * 0.86, R, z, R, 0.22, s, 'acier');
    archLiners(mb, body, R, 0.43, [nose - 0.95, tail + 1.15]);
    vanFront(mb, body, nose, R);
    vanSides(mb, body, nose, L, true);
    // portes arrière battantes : joints, vitres teintées, feux verticaux, marchepied
    const zt = tail - 0.004;
    slab(mb, 'atlas', 'noir_mat', -0.006, 0.55, zt - 0.003, 0.006, 2.3, zt);
    for (const s of [1, -1]) {
      mb.quad('atlas', [s * 0.12, 1.55, zt - 0.004], [s * 0.72, 1.55, zt - 0.004], [s * 0.72, 2.12, zt - 0.004], [s * 0.12, 2.12, zt - 0.004], 'vitre_peinte');
      lamp(mb, 'feu', s * 0.93, 1.0, tail - 0.02, 0.12, 0.42, Math.PI, 0.05);
    }
    slab(mb, 'atlas', 'pare_choc_pl', -0.95, 0.36, tail - 0.12, 0.95, 0.56, tail + 0.04);
    plate(mb, 0.68, zt - 0.006, -1);
  },
};

const ambulance: VehicleDef = {
  id: 'vehicule_ambulance', nameFr: 'Ambulance', kind: 'service', maxSpeedKmh: 140, usage: 'ambulance', lengthM: 6.0, lodDistances: [120, 400],
  paints: [P('blanc', 'Blanc', '#f2f2ef'), P('jaune', 'Jaune sécurité', '#e8d34a')],
  build(mb) {
    const L = 6.0, nose = L / 2, tail = -L / 2, R = 0.37;
    const vanL = 2.6, off = nose - vanL / 2;
    // cabine de fourgon (avant seul), décalée au nez de l'ambulance
    mb.push().translate(0, 0, off);
    const cab = vanBody(mb, vanL, 2.2, false, true);
    vanFront(mb, cab, vanL / 2, R);
    for (const s of [1, -1] as const) {
      doorSeam(mb, cab, s, vanL / 2 - 1.15, 0.55, 1.05);
      handle(mb, cab, s, vanL / 2 - 1.95, 1.0, 'peinture');
      mirror(mb, s, cab.hwAt(vanL / 2 - 1.2), 1.15, vanL / 2 - 1.25, true);
    }
    for (const s of [1, -1]) wiper(mb, s * 0.3, 1.12, vanL / 2 - 1.14, 0.6, 0.9);
    lightbar(mb, 2.2, vanL / 2 - 1.95, 1.3, 'bleu');
    archLiners(mb, cab, R, 0.43, [vanL / 2 - 0.95]);
    mb.pop();
    // cellule sanitaire : caisse galbée avec passage de roue arrière
    const bz0 = tail + 0.05, bz1 = nose - 2.25, zr = tail + 1.25;
    const cell = new CarBody({ ...boxLower(bz0, bz1, 1.06, 0.52, 2.74), rb: 0.06, rt: 0.12, arches: [{ z: zr, r: 0.45 }], archY: R }, null);
    cell.build(mb);
    archLiners(mb, cell, R, 0.45, [zr]);
    for (const z of [nose - 0.95, zr]) for (const s of [1, -1] as const) wheel(mb, s * 0.87, R, z, R, 0.22, s, 'acier', z < 0 && mb.lod < 2);
    for (const s of [1, -1] as const) {
      const x = 1.06 + 0.004;
      sideDecal(mb, 'damier', s, x, bz0 + 0.1, zr - 0.5, 1.02, 1.3);
      sideDecal(mb, 'damier', s, x, zr + 0.5, bz1 - 0.08, 1.02, 1.3);
      sideDecal(mb, 'txt_ambulance', s, x, bz0 + 0.5, bz1 - 0.35, 1.45, 1.75);
      sideDecal(mb, 'logo_croix', s, x, bz0 + 0.25, bz0 + 0.75, 2.05, 2.55);
      sideDecal(mb, 'vitre_peinte', s, x, bz1 - 1.1, bz1 - 0.4, 2.0, 2.55);
      lamp(mb, 'gyro_bleu', s * 0.95, 2.66, bz1 + 0.02, 0.14, 0.12, 0, 0.05);
      lamp(mb, 'gyro_bleu', s * 0.95, 2.66, bz0 - 0.02, 0.14, 0.12, Math.PI, 0.05);
      lamp(mb, 'feu', s * 0.95, 1.0, bz0 - 0.02, 0.14, 0.4, Math.PI, 0.05);
    }
    // arrière : portes, chevrons, vitres, marchepied, plaque
    const zt = bz0 - 0.004;
    mb.quad('atlas', [1.0, 0.7, zt], [-1.0, 0.7, zt], [-1.0, 0.95, zt], [1.0, 0.95, zt], 'chevrons');
    slab(mb, 'atlas', 'noir_mat', -0.006, 0.6, zt - 0.003, 0.006, 2.6, zt);
    for (const s of [1, -1]) mb.quad('atlas', [s * 0.12, 1.85, zt - 0.003], [s * 0.7, 1.85, zt - 0.003], [s * 0.7, 2.4, zt - 0.003], [s * 0.12, 2.4, zt - 0.003], 'vitre_peinte');
    slab(mb, 'atlas', 'tole_striee', -0.7, 0.4, bz0 - 0.25, 0.7, 0.46, bz0);
    plate(mb, 0.55, bz0 - 0.03, -1);
  },
};

/** Caisse basse « boîte » (pour les passages de roues d'une caisse rapportée). */
function boxLower(z0: number, z1: number, hw: number, yb: number, yt: number): Omit<LowerSpec, 'arches' | 'archY'> {
  return { noseZ: z1, tailZ: z0, hw, planF: 0.05, planR: 0.05, top: [[z0, yt], [z1, yt]], bottom: [[z0, yb], [z1, yb]], rb: 0.05, rt: 0.05, bulge: 0, tumble: 0 };
}

/* ------------------------------------------------------------------ */
/* Poids lourds : cabine avancée commune                                */
/* ------------------------------------------------------------------ */

interface CabParams { nose: number; cabL: number; W: number; roofY: number; crew: boolean; R: number }

function truckCab(mb: VMesh, c: CabParams): CarBody {
  const tail = c.nose - c.cabL;
  const lower: LowerSpec = {
    noseZ: c.nose, tailZ: tail, hw: c.W / 2, planF: 0.22, planR: 0.06,
    top: [[tail, 1.72], [c.nose - 0.25, 1.72], [c.nose, 1.66]],
    bottom: [[tail, 0.78], [c.nose, 0.72]],
    arches: [{ z: c.nose - 0.62, r: c.R + 0.08 }], archY: c.R,
    rb: 0.06, rt: 0.08, bulge: 0.015, tumble: 0.02,
  };
  const cabin: CabinSpec = {
    zWs0: c.nose - 0.03, zWs1: c.nose - 0.28, zRf1: tail + 0.08, zRw1: tail, roofY: c.roofY, roofArc: 0.03,
    inset: 0.0, tumble: 0.06, rt: 0.14,
    sideGlass: c.crew ? [[c.nose - 1.15, c.nose - 0.32], [tail + 0.25, c.nose - 1.25]] : [[c.nose - 1.15, c.nose - 0.3]],
    rearGlass: false, sill: 0.1, header: 0.12,
  };
  const body = new CarBody(lower, cabin);
  body.build(mb);
  const hw = c.W / 2;
  const zf = c.nose + 0.004;
  // calandre, pare-chocs, phares, plaque, marchepieds, rétroviseurs, pare-soleil
  mb.quad('atlas', [-hw * 0.72, 1.0, zf], [hw * 0.72, 1.0, zf], [hw * 0.72, 1.6, zf], [-hw * 0.72, 1.6, zf], 'calandre_pl');
  slab(mb, 'atlas', 'pare_choc_pl', -hw - 0.02, 0.38, c.nose - 0.2, hw + 0.02, 0.78, c.nose + 0.1);
  plate(mb, 0.5, c.nose + 0.104, 1);
  for (const s of [1, -1]) {
    lamp(mb, 'phare', s * (hw - 0.3), 0.66, c.nose + 0.1, 0.36, 0.14, 0, 0.04);
    lamp(mb, 'clignotant', s * (hw - 0.08), 0.66, c.nose + 0.1, 0.1, 0.12, 0, 0.04);
    lamp(mb, 'feu_gabarit', s * (hw - 0.15), c.roofY + 0.02, c.nose - 0.25, 0.1, 0.05, 0, 0.04);
  }
  if (mb.lod < 2) slab(mb, 'atlas', 'noir_mat', -hw + 0.05, c.roofY - 0.12, c.nose - 0.25, hw - 0.05, c.roofY - 0.04, c.nose + 0.05);
  for (const s of [1, -1] as const) {
    const zs = c.nose - 0.62;
    slab(mb, 'atlas', 'tole_striee', s * (hw - 0.3), 0.55, zs - 0.4, s * (hw + 0.02), 0.6, zs + 0.4);
    doorSeam(mb, body, s, c.nose - 0.3, 0.85, 1.65);
    doorSeam(mb, body, s, c.nose - 1.2, 0.85, 1.65);
    handle(mb, body, s, c.nose - 1.05, 1.5);
    mirror(mb, s, hw, 1.9, c.nose - 0.35, true);
  }
  for (const s of [1, -1]) wiper(mb, s * 0.4, 1.76, c.nose - 0.06, 0.7, 1.35);
  return body;
}

/** Châssis : longerons, réservoir, batteries, garde-boue et roues (avant simple, arrière jumelé). */
function truckChassis(mb: VMesh, nose: number, tail: number, W: number, R: number, axleF: number, axlesR: number[]): void {
  const hw = W / 2;
  for (const s of [1, -1]) slab(mb, 'atlas', 'dessous', s * 0.42, 0.62, tail + 0.1, s * 0.52, 0.9, nose - 0.4);
  // réservoir (cylindre) et coffre à batteries
  if (mb.lod < 2) {
    mb.push().translate(hw - 0.35, 0.78, nose - 2.6).rotY(Math.PI / 2);
    mb.latheX('atlas', [[0.001, -0.55], [0.26, -0.55], [0.28, -0.5], [0.28, 0.5], [0.26, 0.55], [0.001, 0.55]], mb.lod === 0 ? 14 : 8, 'alu', 'band', 50);
    mb.pop();
    slab(mb, 'atlas', 'noir_mat', -hw + 0.12, 0.6, nose - 3.0, -hw + 0.52, 1.0, nose - 2.3);
  }
  for (const s of [1, -1] as const) {
    wheel(mb, s * (hw - 0.3), R, axleF, R, 0.3, s, 'pl');
    for (const z of axlesR) {
      wheel(mb, s * (hw - 0.42), R, z, R, 0.26, s, 'pl', true);
      // garde-boue
      if (mb.lod < 2) {
        slab(mb, 'atlas', 'plastique', s * (hw - 0.02), R + 0.02, z - R - 0.15, s * (hw - 0.62), R + 0.06, z + R + 0.15);
        slab(mb, 'atlas', 'caoutchouc', s * (hw - 0.04), 0.25, z - R - 0.15, s * (hw - 0.6), R + 0.02, z - R - 0.13);
      }
    }
  }
}

function rearUnderrun(mb: VMesh, tail: number, W: number): void {
  slab(mb, 'atlas', 'chevrons', -W / 2 + 0.1, 0.42, tail - 0.08, W / 2 - 0.1, 0.58, tail + 0.02);
  for (const s of [1, -1]) {
    lamp(mb, 'feu', s * (W / 2 - 0.3), 0.75, tail - 0.04, 0.32, 0.14, Math.PI, 0.05);
    lamp(mb, 'recul', s * (W / 2 - 0.55), 0.75, tail - 0.04, 0.12, 0.12, Math.PI, 0.05);
  }
  plate(mb, 0.75, tail - 0.07, -1);
}

const camion: VehicleDef = {
  id: 'vehicule_camion', nameFr: 'Camion porteur (caisse)', kind: 'truck', maxSpeedKmh: 90, usage: 'fret', lengthM: 8.6, lodDistances: [150, 500],
  paints: [P('blanc', 'Blanc', '#ecebe6'), P('rouge', 'Rouge', '#a02a20'), P('bleu', 'Bleu', '#25528a'), P('vert', 'Vert', '#2f6040'), P('orange', 'Orange', '#d0681f')],
  build(mb) {
    const L = 8.6, nose = L / 2, tail = -L / 2, W = 2.48, R = 0.5;
    truckCab(mb, { nose, cabL: 2.05, W, roofY: 2.95, crew: false, R });
    truckChassis(mb, nose, tail, W, R, nose - 0.62, [tail + 2.1]);
    // caisse fourgon (panneaux à profils), plancher, portes arrière
    const z0 = tail + 0.05, z1 = nose - 2.2;
    const H = 3.55;
    mb.roundedBox('peinture', 0, (1.05 + H) / 2, (z0 + z1) / 2, W, H - 1.05, z1 - z0, 0.05, mb.lod === 0 ? 2 : 1);
    slab(mb, 'atlas', 'dessous', -W / 2, 0.95, z0, W / 2, 1.05, z1);
    if (mb.lod < 2) {
      for (const s of [1, -1] as const) {
        const nRib = mb.lod === 0 ? 7 : 3;
        for (let k = 0; k <= nRib; k++) {
          const z = z0 + 0.1 + ((z1 - z0 - 0.2) * k) / nRib;
          slab(mb, 'atlas', 'alu', s * (W / 2), 1.06, z - 0.03, s * (W / 2 + 0.015), H - 0.02, z + 0.03, s > 0 ? 'nx' : 'px');
        }
        slab(mb, 'atlas', 'alu', s * (W / 2), 1.0, z0, s * (W / 2 + 0.02), 1.1, z1);
        for (let k = 0; k < 4; k++) lamp(mb, 'feu_gabarit', s * (W / 2 + 0.01), 1.1, z0 + 0.6 + k * 1.3, 0.08, 0.05, s * Math.PI / 2, 0.03);
      }
    }
    const zt = z0 - 0.004;
    for (const s of [1, -1]) slab(mb, 'atlas', 'chrome', s * 0.02, 1.15, zt - 0.03, s * 0.06, H - 0.1, zt);
    for (const s of [1, -1]) {
      slab(mb, 'atlas', 'alu', s * 0.4, 1.3, zt - 0.04, s * 0.44, H - 0.3, zt);
      mb.quad('atlas', [s > 0 ? 1.18 : -0.08, 1.2, zt - 0.002], [s > 0 ? 0.08 : -1.18, 1.2, zt - 0.002], [s > 0 ? 0.08 : -1.18, 1.32, zt - 0.002], [s > 0 ? 1.18 : -1.18 + 1.1, 1.32, zt - 0.002], 'chevrons');
    }
    rearUnderrun(mb, tail, W);
    exhaust(mb, -W / 2 + 0.3, 0.55, nose - 2.2, 0.05);
  },
};

const pompiers: VehicleDef = {
  id: 'vehicule_pompiers', nameFr: 'Fourgon pompe-tonne (pompiers)', kind: 'service', maxSpeedKmh: 100, usage: 'pompiers', lengthM: 8.2, lodDistances: [150, 500],
  paints: [P('rouge', 'Rouge incendie', '#b0141c'), P('rouge_fonce', 'Rouge sombre', '#8a1016')],
  build(mb) {
    const L = 8.2, nose = L / 2, tail = -L / 2, W = 2.5, R = 0.5;
    const cab = truckCab(mb, { nose, cabL: 2.9, W, roofY: 2.95, crew: true, R });
    truckChassis(mb, nose, tail, W, R, nose - 0.62, [tail + 1.8]);
    lightbar(mb, 2.98, nose - 0.55, 1.5, 'bleu');
    const z0 = tail + 0.05, z1 = nose - 3.0, H = 3.05;
    mb.roundedBox('peinture', 0, (1.06 + H) / 2, (z0 + z1) / 2, W, H - 1.06, z1 - z0, 0.06, mb.lod === 0 ? 2 : 1);
    // coffres à rideaux sur les deux flancs, bande blanche, lettrage, passages de roues
    for (const s of [1, -1] as const) {
      const x = W / 2 + 0.004;
      const n = 3;
      for (let k = 0; k < n; k++) {
        const za = z0 + 0.15 + k * ((z1 - z0 - 0.3) / n), zb = za + (z1 - z0 - 0.3) / n - 0.08;
        if (k === 1) continue;
        sideDecal(mb, 'rideau', s, x, za, zb, 1.45, H - 0.15);
      }
      const zr = tail + 1.8;
      sideDecal(mb, 'rideau', s, x, zr - 0.7, zr + 0.7, 1.45, H - 0.15);
      sideDecal(mb, 'bande_blanche', s, x, z0 + 0.05, z1 - 0.05, 1.05, 1.25);
      bodySideStrip(mb, cab, 'txt_pompiers', s, nose - 2.7, nose - 1.35, 1.05, 1.32, 0.006, mb.lod === 0 ? 6 : 2);
      bodySideStrip(mb, cab, 'bande_blanche', s, nose - 2.85, nose - 0.25, 0.86, 0.98, 0.006, mb.lod === 0 ? 6 : 2);
    }
    // échelle sur le toit, supports, dévidoir à l'arrière
    if (mb.lod < 2) {
      for (const s of [1, -1]) slab(mb, 'atlas', 'alu', s * 0.45, H, z0 + 0.4, s * 0.5, H + 0.25, z1 + 1.2);
      mb.push().translate(0, H + 0.3, (z0 + nose - 0.9) / 2);
      mb.quad('atlas', [-0.42, 0, (nose - 0.9 - z0) / 2], [0.42, 0, (nose - 0.9 - z0) / 2], [0.42, 0, -(nose - 0.9 - z0) / 2], [-0.42, 0, -(nose - 0.9 - z0) / 2], 'echelle', [0, 0, 1, 1]);
      mb.quad('atlas', [-0.42, 0, -(nose - 0.9 - z0) / 2], [0.42, 0, -(nose - 0.9 - z0) / 2], [0.42, 0, (nose - 0.9 - z0) / 2], [-0.42, 0, (nose - 0.9 - z0) / 2], 'echelle', [0, 0, 1, 1]);
      for (const s of [1, -1]) slab(mb, 'atlas', 'alu', s * 0.42, -0.05, -(nose - 0.9 - z0) / 2, s * 0.38, 0.05, (nose - 0.9 - z0) / 2);
      mb.pop();
    } else slab(mb, 'atlas', 'echelle', -0.42, H + 0.25, z0 + 0.3, 0.42, H + 0.33, nose - 0.9, 'ny');
    const zt = z0 - 0.004;
    mb.quad('atlas', [1.15, 1.0, zt], [-1.15, 1.0, zt], [-1.15, 2.85, zt], [1.15, 2.85, zt], 'rideau');
    for (const s of [1, -1]) lamp(mb, 'gyro_bleu', s * 1.05, 2.98, zt, 0.16, 0.14, Math.PI, 0.05);
    rearUnderrun(mb, tail, W);
    if (mb.lod === 0) {
      mb.push().translate(0, 0.62, tail + 0.15).rotZ(Math.PI / 2);
      mb.latheX('atlas', [[0.001, -0.5], [0.28, -0.5], [0.28, 0.5], [0.001, 0.5]], 12, 'tuyau', 'band', 30);
      mb.pop();
    }
  },
};

const benne: VehicleDef = {
  id: 'vehicule_benne_ordures', nameFr: 'Benne à ordures', kind: 'service', maxSpeedKmh: 85, usage: 'proprete', lengthM: 8.8, lodDistances: [150, 500],
  paints: [P('blanc', 'Blanc', '#eeede8'), P('vert', 'Vert propreté', '#3d7a3a'), P('gris', 'Gris', '#8b9096')],
  build(mb) {
    const L = 8.8, nose = L / 2, tail = -L / 2, W = 2.5, R = 0.5;
    truckCab(mb, { nose, cabL: 2.2, W, roofY: 2.85, crew: true, R });
    truckChassis(mb, nose, tail, W, R, nose - 0.62, [tail + 2.4, tail + 1.15]);
    lightbar(mb, 2.88, nose - 0.5, 1.4, 'orange');
    // corps de compaction (caisse à flancs bombés) et trémie arrière inclinée
    const z0 = tail + 1.0, z1 = nose - 2.35, H = 3.35;
    const seg = mb.lod === 0 ? 4 : mb.lod === 1 ? 2 : 1;
    mb.roundedBox('peinture', 0, (1.08 + H) / 2, (z0 + z1) / 2, W - 0.02, H - 1.08, z1 - z0, 0.32, seg);
    for (const s of [1, -1] as const) {
      sideDecal(mb, 'bande_jaune', s, W / 2 - 0.005, z0 + 0.4, z1 - 0.3, 1.25, 1.4);
      if (mb.lod === 0) for (let k = 0; k < 6; k++) slab(mb, 'peinture', undefined, s * (W / 2 - 0.02), 1.05, z0 + 0.4 + k * 0.8, s * (W / 2 + 0.02), H - 0.25, z0 + 0.46 + k * 0.8);
    }
    // trémie (lève-conteneurs) : volume incliné
    mb.push().translate(0, 1.95, tail + 0.55).rotX(-0.22);
    mb.roundedBox(() => ({ mat: 'atlas', region: 'benne' }), 0, 0, 0, W - 0.08, 2.1, 1.05, 0.12, seg, 'benne');
    mb.pop();
    mb.quad('atlas', [1.1, 1.0, tail + 0.0], [-1.1, 1.0, tail + 0.0], [-1.1, 1.22, tail + 0.0], [1.1, 1.22, tail + 0.0], 'chevrons');
    for (const s of [1, -1]) {
      slab(mb, 'atlas', 'tole_striee', s * 0.55, 0.45, tail - 0.25, s * 1.15, 0.5, tail + 0.1);
      slab(mb, 'atlas', 'alu', s * 1.1, 0.5, tail - 0.22, s * 1.13, 1.6, tail - 0.18);
      lamp(mb, 'gyro_orange', s * 1.1, 3.0, tail + 0.75, 0.16, 0.14, Math.PI, 0.05);
    }
    rearUnderrun(mb, tail, W);
  },
};

/* ------------------------------------------------------------------ */
/* Bus urbain                                                           */
/* ------------------------------------------------------------------ */

const bus: VehicleDef = {
  id: 'vehicule_bus', nameFr: 'Bus urbain', kind: 'bus', maxSpeedKmh: 80, usage: 'bus', lengthM: 12.0, lodDistances: [160, 550],
  paints: [P('vert_ville', 'Livrée verte', '#2a7a68'), P('bleu', 'Livrée bleue', '#2a5ea8'), P('rouge', 'Livrée rouge', '#b23a2e'), P('blanc', 'Blanc', '#efefea')],
  build(mb) {
    const L = 12, nose = L / 2, tail = -L / 2, W = 2.55, R = 0.5;
    const pillars: number[] = [];
    for (let z = tail + 0.6; z < nose - 1.2; z += 1.42) pillars.push(z);
    const glass: [number, number][] = [];
    for (let k = 0; k + 1 < pillars.length; k++) glass.push([pillars[k]! + 0.05, pillars[k + 1]! - 0.05]);
    glass.push([pillars[pillars.length - 1]! + 0.05, nose - 0.45]);
    const lower: LowerSpec = {
      noseZ: nose, tailZ: tail, hw: W / 2, planF: 0.3, planR: 0.25,
      top: [[tail, 1.12], [nose, 1.06]], bottom: [[tail, 0.4], [tail + 0.3, 0.32], [nose - 0.3, 0.32], [nose, 0.36]],
      arches: [{ z: nose - 2.5, r: R + 0.1 }, { z: tail + 3.3, r: R + 0.1 }], archY: R,
      rb: 0.08, rt: 0.06, bulge: 0.01, tumble: 0.0,
      matAt: (_z, y) => (y < 0.42 ? { mat: 'atlas', region: 'plastique' } : null),
    };
    const cabin: CabinSpec = {
      zWs0: nose - 0.02, zWs1: nose - 0.25, zRf1: tail + 0.12, zRw1: tail + 0.02, roofY: 3.0, roofArc: 0.01,
      inset: 0.0, tumble: 0.04, rt: 0.16, sideGlass: glass, rearGlass: true, sill: 0.04, header: 0.28,
    };
    const body = new CarBody(lower, cabin);
    body.build(mb);
    for (const s of [1, -1] as const) {
      wheel(mb, s * (W / 2 - 0.32), R, nose - 2.5, R, 0.3, s, 'pl');
      wheel(mb, s * (W / 2 - 0.45), R, tail + 3.3, R, 0.26, s, 'pl', true);
    }
    archLiners(mb, body, R, R + 0.1, [nose - 2.5, tail + 3.3]);
    // portes vitrées côté droit (+X) : avant, milieu
    for (const [za, zb] of [[nose - 1.45, nose - 0.35], [-0.8, 0.45]] as [number, number][]) {
      const x = body.sideX((za + zb) / 2, 0.9) + 0.006;
      mb.quad('verre', [x, 0.42, za], [x, 0.42, zb], [x, 2.5, zb], [x, 2.5, za]);
      slab(mb, 'atlas', 'caoutchouc', x, 0.42, (za + zb) / 2 - 0.02, x + 0.01, 2.5, (za + zb) / 2 + 0.02);
      for (const z of [za, zb]) slab(mb, 'atlas', 'caoutchouc', x, 0.42, z - 0.03, x + 0.012, 2.52, z + 0.03);
    }
    // girouette, face avant, rétroviseurs « antennes », feux
    const zf = nose + 0.004;
    mb.quad('atlas', [-1.0, 2.62, nose - 0.27], [1.0, 2.62, nose - 0.27], [1.0, 2.88, nose - 0.27], [-1.0, 2.88, nose - 0.27], 'girouette');
    mb.quad('atlas', [-0.8, 0.5, zf], [0.8, 0.5, zf], [0.8, 0.9, zf], [-0.8, 0.9, zf], 'grille_aeration');
    plate(mb, 0.45, zf + 0.002, 1);
    for (const s of [1, -1] as const) {
      lamp(mb, 'phare', s * 0.95, 0.62, body.frontZ(s * 0.95, 0.62) - 0.02, 0.36, 0.14, s * 0.25, 0.05);
      mirror(mb, s, W / 2 - 0.05, 2.3, nose - 0.25, true);
      sideDecal(mb, 'txt_bus', s, body.sideX(-3, 0.75) + 0.005, -4.2, -1.6, 0.6, 0.95);
      for (let k = 0; k < 4; k++) lamp(mb, 'feu_gabarit', s * (W / 2 + 0.005), 0.5, tail + 1 + k * 2.6, 0.08, 0.05, s * Math.PI / 2, 0.02);
    }
    for (const s of [1, -1]) wiper(mb, s * 0.5, 1.15, nose - 0.04, 0.9, 1.45);
    // arrière : grille moteur, feux, plaque ; toit : climatisation
    const zt = tail - 0.004;
    mb.quad('atlas', [1.0, 0.55, zt], [-1.0, 0.55, zt], [-1.0, 1.0, zt], [1.0, 1.0, zt], 'grille_aeration');
    plate(mb, 1.1, zt - 0.002, -1);
    for (const s of [1, -1]) lamp(mb, 'feu', s * 1.05, 1.0, body.rearZ(s * 1.05, 1.0) + 0.02, 0.2, 0.5, Math.PI, 0.05);
    mb.roundedBox('peinture', 0, 3.12, -1.0, 1.7, 0.26, 2.6, 0.1, mb.lod === 0 ? 2 : 1);
    if (mb.lod < 2) mb.quad('atlas', [-0.7, 3.252, 0.2], [0.7, 3.252, 0.2], [0.7, 3.252, -2.2], [-0.7, 3.252, -2.2], 'grille_aeration');
  },
};

export const VEHICLES: VehicleDef[] = [citadine, berline, breakCar, suv, coupe, monospace, pickup, taxi, police, utilitaire, ambulance, camion, bus, pompiers, benne];

export { VMesh };
