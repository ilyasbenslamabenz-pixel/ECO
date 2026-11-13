/**
 * Modèles de chantier (géométrie) — propriété p2a-chantiers.
 * Chaque modèle est une fonction (CMesh) -> void, appelée une fois par LOD (0, 1, 2).
 * Conventions : mètres, Y vers le haut, origine au point d'ancrage du modèle (voir `anchor` de chaque
 * entrée), avant des engins vers +Z. Les pivots utiles au rendu (axe de rotation de la grue, départ du
 * câble, accroche du chariot…) sont décrits dans le manifeste (build.ts) et non dans la géométrie.
 */
import { CMesh, type V3 } from './mesh';

export interface ModelDef {
  id: string;
  nameFr: string;
  /** Description de l'origine du modèle (documentation du manifeste). */
  anchor: string;
  build(m: CMesh): void;
}

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Grue à tour                                                         */
/* ------------------------------------------------------------------ */

/** Lest et châssis d'embase : origine au sol, au centre. */
function grueBase(m: CMesh): void {
  // 4 blocs de lest en croix.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    m.push().rotY(a).translate(0, 0, 2.1);
    m.box('beton', 2.6, 1.0, 1.5, { tile: 2.5, bevel: 0.08 });
    m.pop();
  }
  // Châssis d'embase (poutres croisées) et pied de mât.
  for (let i = 0; i < 2; i++) {
    m.push().rotY((i * Math.PI) / 2).translate(0, 0.95, 0);
    m.box('acier_jaune', 0.5, 0.45, 6.0, { tile: 0.5 });
    m.pop();
  }
  m.push().translate(0, 1.4, 0);
  m.lattice('acier_jaune', 1.2, 1.9, 1.9, 1.2, 0.09, 0.05);
  m.pop();
  if (m.lod > 1) return;
  // Plots de scellement.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
    m.push().translate(sx * 1.6, 0, sz * 1.6);
    m.box('beton', 0.6, 1.1, 0.6, { tile: 2.5 });
    m.pop();
  }
}

/** Élément de mât (6 m), empilable : origine au bas de l'élément, au centre. */
function grueMat(m: CMesh): void {
  m.lattice('acier_jaune', 6, 1.8, 1.8, 1.5, 0.075, 0.042);
  if (m.lod > 1) return;
  m.push().translate(0.55, 0, -0.5);
  m.ladder('acier_galva', 6, 0.42);
  m.pop();
  // Paliers de repos.
  m.push().translate(0, 3, 0).rotZ(Math.PI / 2).translate(0, 0, 0);
  m.box('acier_galva', 0.02, 1.5, 0.8, { tile: 1 });
  m.pop();
}

/**
 * Tête pivotante : plateforme, cabine, flèche (vers +Z), contre-flèche et lest (vers −Z), mât de pointe
 * et tirants. Origine à l'axe de rotation, au niveau du haut du mât.
 */
function grueTete(m: CMesh): void {
  const JIB = 34, CJIB = 9;
  // Couronne d'orientation.
  m.push().translate(0, -0.35, 0);
  m.tube('acier_sombre', 0.95, 0.5, 14, true, 0.5);
  m.pop();
  m.push().translate(0, 0.15, 0);
  m.tube('acier_jaune', 1.05, 0.25, 14, true, 0.5);
  m.pop();
  // Plateforme tournante.
  m.push().translate(0, 0.4, 0);
  m.box('acier_jaune', 2.2, 0.35, 3.0, { tile: 0.5, bevel: 0.1 });
  m.pop();
  // Flèche (treillis horizontal) à partir de z = 1.2.
  m.push().translate(0, 0.8, 1.2);
  m.latticeZ('acier_jaune', JIB, 1.5, 1.35, 2.6, 0.065, 0.034);
  m.pop();
  // Contre-flèche.
  m.push().rotY(Math.PI).translate(0, 0.8, 1.0);
  m.latticeZ('acier_jaune', CJIB, 1.5, 1.1, 2.2, 0.06, 0.032);
  m.pop();
  // Treuil et lest sur la contre-flèche.
  m.push().translate(0, 1.0, -3.2);
  m.box('acier_sombre', 1.5, 0.9, 2.0, { tile: 0.8, bevel: 0.08 });
  m.pop();
  for (let i = 0; i < 3; i++) {
    m.push().translate(0, 1.0 + i * 0.0, -7.0 - i * 0.55);
    m.box('beton', 2.4, 1.6, 0.5, { tile: 2.5, bevel: 0.05 });
    m.pop();
  }
  // Mât de pointe (pyramide) et tirants.
  const apex: V3 = [0, 6.2, 0];
  for (const [sx, sz] of [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]] as [number, number][]) {
    m.bar('acier_jaune', [sx, 0.7, sz], apex, 0.07, m.lod === 0 ? 6 : 4);
  }
  for (const z of [JIB * 0.45, JIB * 0.95]) m.bar('acier_galva', apex, [0, 1.9, 1.2 + z], 0.045, 4);
  m.bar('acier_galva', apex, [0, 1.8, -CJIB + 0.5], 0.045, 4);
  // Cabine de conduite, côté flèche.
  m.push().translate(1.35, 0.6, 1.6);
  m.box('acier_jaune', 1.7, 2.0, 2.0, { tile: 0.5, bevel: 0.12, skip: ['x+'] });
  m.pop();
  m.push().translate(1.35, 0.75, 1.6);
  m.box('verre', 1.55, 1.3, 1.86, { tile: 1, skip: ['y+', 'y-'] });
  m.pop();
  if (m.lod > 1) return;
  // Chemin de roulement du chariot (2 rails sous la flèche) et passerelle.
  for (const sx of [-0.6, 0.6]) m.bar('acier_sombre', [sx, 0.82, 1.2], [sx, 0.82, 1.2 + JIB], 0.05, 4);
  m.push().translate(0, 2.2, -2.0);
  m.railing('acier_galva', 2.4, 0.9, 3);
  m.pop();
  // Gyrophare en pointe.
  m.push().translate(0, 6.25, 0);
  m.tube('optique', 0.16, 0.3, 8, true, 0.3);
  m.pop();
}

/** Chariot de distribution (coulisse sur la flèche) : origine au niveau des rails, au centre. */
function grueChariot(m: CMesh): void {
  m.push().translate(0, -0.3, 0);
  m.box('acier_jaune', 1.3, 0.3, 1.5, { tile: 0.5, bevel: 0.05 });
  m.pop();
  for (const sx of [-0.62, 0.62]) {
    for (const sz of [-0.55, 0.55]) {
      m.push().translate(sx, -0.12, sz).rotZ(Math.PI / 2).translate(0, -0.06, 0);
      m.tube('acier_sombre', 0.13, 0.12, 8, true, 0.3);
      m.pop();
    }
  }
  // Moufle de renvoi.
  m.push().translate(0, -0.45, 0).rotZ(Math.PI / 2).translate(0, -0.09, 0);
  m.tube('acier_galva', 0.22, 0.18, 10, true, 0.3);
  m.pop();
}

/** Moufle et crochet : origine au point d'attache du câble (en haut). */
function grueCrochet(m: CMesh): void {
  m.push().translate(0, -0.75, 0);
  m.box('acier_jaune', 0.55, 0.75, 0.3, { tile: 0.4, bevel: 0.05 });
  m.pop();
  m.push().translate(0, -0.42, 0).rotZ(Math.PI / 2).translate(0, -0.17, 0);
  m.tube('acier_sombre', 0.2, 0.34, 10, true, 0.3);
  m.pop();
  // Crochet : arc de barres.
  const r = 0.26;
  let prev: V3 = [0, -0.78, 0];
  for (let i = 1; i <= (m.lod === 0 ? 8 : 5); i++) {
    const a = (i / (m.lod === 0 ? 8 : 5)) * Math.PI * 1.35;
    const p: V3 = [r * Math.sin(a), -0.78 - r + r * Math.cos(a), 0];
    m.bar('acier_galva', prev, p, 0.05, m.lod === 0 ? 6 : 4);
    prev = p;
  }
}

/* ------------------------------------------------------------------ */
/* Échafaudage, palissade, baraque                                     */
/* ------------------------------------------------------------------ */

/**
 * Travée d'échafaudage (2,5 m × 2 m × 0,9 m) : montants, lisses, plancher bois, garde-corps, plinthe,
 * diagonale et filet de protection sur la face extérieure (+Z). Origine au sol, au centre de la travée.
 */
function echafaudage(m: CMesh): void {
  const W = 2.5, H = 2.0, D = 0.9;
  for (const sx of [-W / 2, W / 2]) {
    for (const sz of [-D / 2, D / 2]) {
      m.push().translate(sx, 0, sz);
      m.tube('acier_galva', 0.025, H + 0.15, 6, true, 0.5);
      m.pop();
    }
  }
  const ledger = (y: number): void => {
    for (const sz of [-D / 2, D / 2]) m.bar('acier_galva', [-W / 2, y, sz], [W / 2, y, sz], 0.022, 4);
    for (const sx of [-W / 2, W / 2]) m.bar('acier_galva', [sx, y, -D / 2], [sx, y, D / 2], 0.022, 4);
  };
  ledger(H - 0.05);
  ledger(0.15);
  // Plancher : deux madriers.
  for (const sz of [-0.22, 0.22]) {
    m.push().translate(0, H - 0.09, sz);
    m.box('bois', W - 0.08, 0.05, 0.36, { tile: 1.57 });
    m.pop();
  }
  // Garde-corps et plinthe côté extérieur.
  m.push().translate(0, H, D / 2);
  m.railing('acier_galva', W, 1.0, 2);
  m.pop();
  m.push().translate(0, H + 0.02, D / 2 - 0.02);
  m.box('bois', W - 0.08, 0.18, 0.04, { tile: 1.57 });
  m.pop();
  // Filet de protection (face extérieure).
  m.push().translate(0, 0, D / 2 + 0.04);
  m.box('filet', W, H + 1.0, 0.01, { tile: 1, skip: ['y+', 'y-', 'x+', 'x-'] });
  m.pop();
  if (m.lod > 1) return;
  m.bar('acier_galva', [-W / 2, 0.15, D / 2], [W / 2, H - 0.05, D / 2], 0.02, 4);
  ledger(H * 0.55);
}

/** Panneau de palissade (2,4 m × 2 m) sur plots béton. Origine au sol, au centre du panneau. */
function palissade(m: CMesh): void {
  const W = 2.4, H = 2.0;
  for (const sx of [-W / 2 + 0.06, W / 2 - 0.06]) {
    m.push().translate(sx, 0, 0);
    m.tube('acier_galva', 0.05, H, 6, true, 0.5);
    m.pop();
    m.push().translate(sx, 0, 0);
    m.box('beton', 0.7, 0.14, 0.42, { tile: 2.5, bevel: 0.04 });
    m.pop();
  }
  m.push().translate(0, 0.12, 0);
  m.box('bache', W - 0.14, H - 0.2, 0.035, { tile: 2 });
  m.pop();
  if (m.lod > 1) return;
  // Raidisseurs horizontaux et bandeau supérieur.
  for (const y of [0.35, H - 0.35]) m.bar('acier_galva', [-W / 2 + 0.06, y, 0.04], [W / 2 - 0.06, y, 0.04], 0.022, 4);
  m.push().translate(0, H - 0.1, 0);
  m.box('acier_jaune', W - 0.14, 0.1, 0.05, { tile: 0.5 });
  m.pop();
}

/** Baraque de chantier (base vie) 6 × 2,44 × 2,6 m. Origine au sol, au centre. */
function baraque(m: CMesh): void {
  const W = 6.0, H = 2.6, D = 2.44;
  m.push().translate(0, 0.18, 0);
  m.box('acier_sombre', W, H - 0.18, D, { tile: 1.94, bevel: 0.05 });
  m.pop();
  // Ossature basse et pieds.
  m.push().translate(0, 0.08, 0);
  m.box('acier_sombre', W + 0.06, 0.12, D + 0.06, { tile: 1 });
  m.pop();
  // Toit débordant.
  m.push().translate(0, H + 0.02, 0);
  m.box('acier_galva', W + 0.16, 0.08, D + 0.16, { tile: 2 });
  m.pop();
  // Porte et marche.
  m.push().translate(-W / 2 + 1.0, 0.2, D / 2 + 0.02);
  m.box('acier_jaune', 0.95, 2.0, 0.05, { tile: 0.5 });
  m.pop();
  m.push().translate(-W / 2 + 1.0, 0, D / 2 + 0.35);
  m.box('acier_galva', 1.1, 0.2, 0.5, { tile: 1 });
  m.pop();
  // Fenêtres.
  for (const x of [0.6, 2.2]) {
    m.push().translate(x, 1.25, D / 2 + 0.02);
    m.box('verre', 1.0, 0.85, 0.05, { tile: 1 });
    m.pop();
  }
  if (m.lod > 1) return;
  // Nervures de bardage.
  for (let i = 0; i < 12; i++) {
    const x = -W / 2 + 0.3 + i * ((W - 0.6) / 11);
    for (const sz of [-1, 1]) {
      m.push().translate(x, 0.25, (sz * D) / 2 + sz * 0.02);
      m.box('acier_sombre', 0.08, H - 0.4, 0.04, { tile: 1 });
      m.pop();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Engins                                                              */
/* ------------------------------------------------------------------ */

/** Châssis chenillé d'une pelle hydraulique. Origine au sol, au centre ; avant vers +Z. */
function pelleteuseBase(m: CMesh): void {
  for (const sx of [-0.95, 0.95]) {
    m.push().translate(sx, 0, 0);
    m.track(3.6, 0.85, 0.62);
    m.pop();
  }
  m.push().translate(0, 0.55, 0);
  m.box('acier_sombre', 1.5, 0.4, 2.6, { tile: 1, bevel: 0.08 });
  m.pop();
  m.push().translate(0, 0.9, 0);
  m.tube('acier_jaune', 0.85, 0.22, 14, true, 0.5);
  m.pop();
}

/** Tourelle : capot, cabine vitrée, contrepoids, flèche, balancier et godet (pose de travail). */
function pelleteuseTourelle(m: CMesh): void {
  // Plateforme.
  m.box('acier_jaune', 2.5, 0.22, 3.4, { tile: 0.5, bevel: 0.08 });
  // Capot moteur (arrière) et contrepoids.
  m.push().translate(0, 0.22, -1.0);
  m.box('acier_jaune', 2.4, 0.95, 1.5, { tile: 0.5, bevel: 0.1 });
  m.pop();
  m.push().translate(0, 0.1, -1.75);
  m.box('acier_sombre', 2.3, 1.0, 0.5, { tile: 1, bevel: 0.06 });
  m.pop();
  // Cabine.
  m.push().translate(-0.65, 0.22, 0.6);
  m.box('acier_jaune', 1.1, 1.9, 1.6, { tile: 0.5, bevel: 0.08 });
  m.pop();
  m.push().translate(-0.65, 0.65, 0.62);
  m.box('verre', 1.02, 1.25, 1.52, { tile: 1, skip: ['y+', 'y-'] });
  m.pop();
  // Flèche, balancier, godet (pose levée).
  const p0: V3 = [0.5, 0.6, 1.1];
  const p1: V3 = [0.5, 2.7, 2.6];
  const p2: V3 = [0.5, 1.7, 4.3];
  m.push().translate(p0[0], p0[1], p0[2]);
  m.pop();
  const beam = (a: V3, b: V3, w: number, h: number): void => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    m.push().translate(a[0], a[1], a[2]).rotY(yaw).rotX(-pitch).translate(0, -h / 2, l / 2);
    m.box('acier_jaune', w, h, l, { tile: 0.5, bevel: 0.05 });
    m.pop();
  };
  beam(p0, p1, 0.5, 0.6);
  beam(p1, p2, 0.42, 0.45);
  // Vérins.
  m.bar('acier_galva', [0.5, 0.75, 1.5], [0.5, 2.1, 2.3], 0.09, m.lod === 0 ? 8 : 5);
  m.bar('acier_galva', [0.5, 2.55, 2.75], [0.5, 2.0, 3.7], 0.08, m.lod === 0 ? 8 : 5);
  // Godet.
  m.push().translate(0.5, 1.45, 4.55).rotX(-0.5);
  m.box('acier_sombre', 1.1, 0.75, 0.9, { tile: 0.6, bevel: 0.06, skip: ['y+'] });
  m.pop();
  if (m.lod > 1) return;
  for (let i = 0; i < 5; i++) {
    m.push().translate(0.5 - 0.44 + i * 0.22, 1.1, 4.95);
    m.box('acier_galva', 0.1, 0.22, 0.14, { tile: 0.3 });
    m.pop();
  }
  // Gyrophare.
  m.push().translate(-0.65, 2.14, 1.3);
  m.tube('optique', 0.1, 0.2, 8, true, 0.3);
  m.pop();
}

/** Camion-benne (3 essieux). Origine au sol, au centre ; cabine vers +Z. */
function camionBenne(m: CMesh): void {
  // Châssis.
  m.push().translate(0, 0.75, -0.3);
  m.box('acier_sombre', 2.3, 0.25, 7.4, { tile: 1 });
  m.pop();
  // Cabine.
  m.push().translate(0, 1.0, 2.6);
  m.box('acier_rouge', 2.4, 1.9, 2.1, { tile: 0.5, bevel: 0.12 });
  m.pop();
  m.push().translate(0, 1.75, 3.1);
  m.box('verre', 2.2, 0.95, 1.1, { tile: 1, skip: ['y+', 'y-', 'z-'] });
  m.pop();
  // Calandre et pare-chocs.
  m.push().translate(0, 0.65, 3.72);
  m.box('acier_sombre', 2.4, 0.5, 0.25, { tile: 0.5, bevel: 0.05 });
  m.pop();
  // Benne.
  m.push().translate(0, 1.0, -1.6);
  m.box('acier_jaune', 2.45, 1.35, 5.0, { tile: 0.5, bevel: 0.06, skip: ['y+'] });
  m.pop();
  // Roues : 1 essieu avant, 2 arrière (jumelées).
  const wheels: [number, number][] = [[2.3, 0.52], [-1.4, 0.52], [-2.75, 0.52]];
  for (const [z, r] of wheels) {
    for (const sx of [-1.05, 1.05]) {
      m.push().translate(sx, r, z);
      m.wheel(r, 0.34);
      m.pop();
    }
  }
  if (m.lod > 1) return;
  // Optiques, échappement, ridelle arrière.
  for (const sx of [-0.85, 0.85]) {
    m.push().translate(sx, 0.95, 3.75);
    m.box('optique', 0.4, 0.22, 0.08, { tile: 0.3 });
    m.pop();
  }
  m.push().translate(1.1, 1.1, 1.6);
  m.tube('acier_galva', 0.09, 1.6, 8, true, 0.4);
  m.pop();
  m.push().translate(0, 2.05, 3.0);
  m.tube('optique', 0.09, 0.18, 8, true, 0.3);
  m.pop();
}

/** Porteur de la toupie à béton (sans tambour). Origine au sol, au centre ; cabine vers +Z. */
function toupieBase(m: CMesh): void {
  m.push().translate(0, 0.8, -0.2);
  m.box('acier_sombre', 2.3, 0.25, 7.2, { tile: 1 });
  m.pop();
  m.push().translate(0, 1.0, 2.5);
  m.box('acier_galva', 2.4, 1.9, 2.1, { tile: 0.5, bevel: 0.12 });
  m.pop();
  m.push().translate(0, 1.75, 3.0);
  m.box('verre', 2.2, 0.95, 1.1, { tile: 1, skip: ['y+', 'y-', 'z-'] });
  m.pop();
  // Berceau du tambour (deux chevalets) et goulotte arrière.
  m.push().translate(0, 1.05, 0.7);
  m.box('acier_jaune', 1.9, 0.9, 0.35, { tile: 0.5 });
  m.pop();
  m.push().translate(0, 1.05, -2.3);
  m.box('acier_jaune', 2.0, 1.5, 0.4, { tile: 0.5 });
  m.pop();
  m.push().translate(0, 1.9, -3.5).rotX(0.5);
  m.box('acier_galva', 0.6, 0.12, 1.6, { tile: 0.5 });
  m.pop();
  for (const [z, r] of [[2.2, 0.52], [-1.5, 0.52], [-2.8, 0.52]] as [number, number][]) {
    for (const sx of [-1.05, 1.05]) {
      m.push().translate(sx, r, z);
      m.wheel(r, 0.34);
      m.pop();
    }
  }
  if (m.lod > 1) return;
  m.push().translate(0, 2.05, 2.9);
  m.tube('optique', 0.09, 0.18, 8, true, 0.3);
  m.pop();
}

/** Tambour de la toupie (tournant). Origine à l'axe, au centre du tambour ; axe selon Z, incliné par le rendu. */
function toupieTambour(m: CMesh): void {
  const sides = m.segs(16);
  const profile: [number, number][] = [
    [-1.9, 0.45], [-1.5, 0.95], [-0.5, 1.22], [0.6, 1.22], [1.35, 0.85], [1.9, 0.55],
  ];
  const ring = (z: number, r: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * TAU;
      out.push(m.vert('acier_galva', [r * Math.cos(a), r * Math.sin(a), z], [Math.cos(a), Math.sin(a), 0], (a * r) / 2, z / 2));
    }
    return out;
  };
  let prev = ring(profile[0]![0], profile[0]![1]);
  for (let k = 1; k < profile.length; k++) {
    const cur = ring(profile[k]![0], profile[k]![1]);
    for (let i = 0; i < sides; i++) m.quad('acier_galva', prev[i]!, prev[i + 1]!, cur[i + 1]!, cur[i]!);
    prev = cur;
  }
  if (m.lod > 1) return;
  // Nervures hélicoïdales extérieures.
  const turns = 2;
  const steps = m.lod === 0 ? 24 : 14;
  for (const off of [0, Math.PI]) {
    let p: V3 | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = -1.6 + t * 3.2;
      const r = 1.24 - 0.5 * Math.abs(t - 0.45);
      const a = off + t * turns * TAU;
      const q: V3 = [r * Math.cos(a), r * Math.sin(a), z];
      if (p) m.bar('acier_sombre', p, q, 0.055, 4);
      p = q;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Matières                                                            */
/* ------------------------------------------------------------------ */

function tasTerre(m: CMesh): void { m.heap('terre', 2.4, 1.0, 7, 2); }
function tasGravats(m: CMesh): void {
  m.heap('gravats', 2.2, 0.85, 23, 2.25);
  if (m.lod > 1) return;
  // Quelques blocs de béton cassé émergents.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    const r = 0.5 + 0.9 * ((i * 7) % 5) / 5;
    m.push().translate(r * Math.cos(a), 0.1 + 0.25 * ((i * 3) % 4) / 4, r * Math.sin(a)).rotY(a * 1.7).rotX(0.3 + 0.2 * (i % 3));
    m.box('beton', 0.55 + 0.2 * (i % 3), 0.18, 0.45, { tile: 2.5, bevel: 0.03 });
    m.pop();
  }
}

/** Bloc de matériaux bâchés sur palettes (décor de chantier). */
function palettes(m: CMesh): void {
  for (let i = 0; i < 2; i++) {
    m.push().translate(i * 1.3 - 0.65, 0, 0);
    m.box('bois', 1.2, 0.14, 0.9, { tile: 1.57 });
    m.pop();
    m.push().translate(i * 1.3 - 0.65, 0.14, 0);
    m.box('beton', 1.1, 0.5, 0.82, { tile: 2.5, bevel: 0.04 });
    m.pop();
  }
  m.push().translate(0, 0.62, 0);
  m.box('bache', 2.7, 0.14, 1.1, { tile: 2, bevel: 0.07 });
  m.pop();
}

export const MODELS: readonly ModelDef[] = [
  { id: 'grue_base', nameFr: 'Embase lestée de grue à tour', anchor: 'sol, centre du lest', build: grueBase },
  { id: 'grue_mat', nameFr: 'Élément de mât de grue (6 m)', anchor: 'bas de l\'élément, centre', build: grueMat },
  { id: 'grue_tete', nameFr: 'Tête de grue : flèche, contre-flèche, cabine', anchor: 'axe d\'orientation, haut du mât', build: grueTete },
  { id: 'grue_chariot', nameFr: 'Chariot de distribution', anchor: 'rails de la flèche, centre', build: grueChariot },
  { id: 'grue_crochet', nameFr: 'Moufle et crochet', anchor: 'attache du câble', build: grueCrochet },
  { id: 'echafaudage', nameFr: 'Travée d\'échafaudage avec filet', anchor: 'sol, centre de la travée', build: echafaudage },
  { id: 'palissade', nameFr: 'Panneau de palissade de chantier', anchor: 'sol, centre du panneau', build: palissade },
  { id: 'baraque', nameFr: 'Baraque de chantier', anchor: 'sol, centre', build: baraque },
  { id: 'pelleteuse_base', nameFr: 'Pelle hydraulique : châssis chenillé', anchor: 'sol, centre', build: pelleteuseBase },
  { id: 'pelleteuse_tourelle', nameFr: 'Pelle hydraulique : tourelle et bras', anchor: 'axe d\'orientation, haut du châssis', build: pelleteuseTourelle },
  { id: 'camion_benne', nameFr: 'Camion-benne', anchor: 'sol, centre', build: camionBenne },
  { id: 'toupie_base', nameFr: 'Camion toupie : porteur', anchor: 'sol, centre', build: toupieBase },
  { id: 'toupie_tambour', nameFr: 'Camion toupie : tambour', anchor: 'axe du tambour', build: toupieTambour },
  { id: 'tas_terre', nameFr: 'Tas de terre excavée', anchor: 'sol, centre', build: tasTerre },
  { id: 'tas_gravats', nameFr: 'Tas de gravats', anchor: 'sol, centre', build: tasGravats },
  { id: 'palettes', nameFr: 'Matériaux bâchés sur palettes', anchor: 'sol, centre', build: palettes },
];
