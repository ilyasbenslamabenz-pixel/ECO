/**
 * Registre des grilles d'indicateurs d'une partie : une géométrie commune par défaut (résolution configurable),
 * définition paresseuse (une grille n'existe que si un module l'utilise), lecture / écriture typées,
 * propagation par fréquence, couplages simples entre indicateurs, sérialisation.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
import { STANDARD_INDICATOR_SPECS } from '../../shared/municipal/indicators';
import type { Frequency, GridGeometry, IndicatorId, IndicatorSpec, StandardIndicatorId } from '../../shared/municipal/types';
import { checkGeometry, IndicatorGrid } from './grid';
import { decodeFloat32, encodeFloat32 } from './codec';

/** Grille sauvegardée (valeurs en base64). */
export interface GridJSON {
  spec: IndicatorSpec;
  geometry: GridGeometry;
  values: string;
}

/**
 * Couplage : à chaque échéance, `to += factor · (from - fromRef)` cellule par cellule (géométries identiques,
 * sinon échantillonnage). Ex. : valeur foncière -= 2 ¢/m² par point de pollution de l'air et par jour.
 */
export interface Coupling {
  id: string;
  from: IndicatorId;
  to: IndicatorId;
  factor: number;
  /** Valeur de référence de la source (défaut : sa valeur de fond). */
  fromRef?: number;
  every: Frequency;
}

const isStandard = (id: string): id is StandardIndicatorId => id in STANDARD_INDICATOR_SPECS;

export class IndicatorGrids {
  private geometry: GridGeometry;
  private readonly grids = new Map<IndicatorId, IndicatorGrid>();
  private readonly couplings: Coupling[] = [];
  /** Incrémenté à chaque définition / suppression (pas à chaque écriture : voir IndicatorGrid.version). */
  version = 0;

  constructor(geometry: GridGeometry) {
    checkGeometry(geometry);
    this.geometry = { ...geometry };
  }

  /** Géométrie par défaut des nouvelles grilles. */
  get defaultGeometry(): Readonly<GridGeometry> { return this.geometry; }

  /**
   * Change la résolution par défaut ; `resampleExisting` rééchantillonne les grilles déjà définies (bilinéaire),
   * sinon elles gardent leur géométrie.
   */
  setDefaultGeometry(g: GridGeometry, resampleExisting = true): void {
    checkGeometry(g);
    this.geometry = { ...g };
    if (resampleExisting) for (const [id, grid] of this.grids) this.grids.set(id, grid.resample(g));
    this.version++;
  }

  has(id: IndicatorId): boolean { return this.grids.has(id); }
  ids(): IndicatorId[] { return [...this.grids.keys()]; }
  get count(): number { return this.grids.size; }

  /** Grille existante (undefined si non définie). */
  get(id: IndicatorId): IndicatorGrid | undefined { return this.grids.get(id); }

  /** Grille existante ; lève si elle n'est pas définie (erreur de programmation d'un module). */
  require(id: IndicatorId): IndicatorGrid {
    const g = this.grids.get(id);
    if (!g) throw new Error(`indicateur ${id} non défini`);
    return g;
  }

  /**
   * Définit une grille (ou renvoie celle qui existe). Indicateur standard : spécification par défaut, surchargée
   * par `overrides`. Indicateur de module (`module:nom`) : `overrides` doit fournir une spécification complète.
   */
  ensure(id: IndicatorId, overrides: Partial<IndicatorSpec> = {}, geometry?: GridGeometry): IndicatorGrid {
    const existing = this.grids.get(id);
    if (existing) return existing;
    let spec: IndicatorSpec;
    if (isStandard(id)) {
      const std = STANDARD_INDICATOR_SPECS[id];
      spec = { ...std, diffusion: std.diffusion ? { ...std.diffusion } : undefined, ...overrides, id };
    } else {
      if (!/^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(id)) throw new Error(`indicateur ${id} : identifiant « module:nom » attendu`);
      const o = overrides;
      if (o.nameFr === undefined || o.unit === undefined || o.base === undefined || o.min === undefined || o.max === undefined) {
        throw new Error(`indicateur ${id} : spécification complète attendue (nameFr, unit, base, min, max)`);
      }
      spec = { id, nameFr: o.nameFr, unit: o.unit, base: o.base, min: o.min, max: o.max, diffusion: o.diffusion };
    }
    if (spec.diffusion === undefined) delete spec.diffusion;
    const g = new IndicatorGrid(spec, geometry ?? this.geometry);
    this.grids.set(id, g);
    this.version++;
    return g;
  }

  remove(id: IndicatorId): boolean {
    const ok = this.grids.delete(id);
    if (ok) this.version++;
    return ok;
  }

  /* ------------------------ Raccourcis typés ------------------------ */

  /** Valeur en (x, z) (cellule) ; valeur de fond standard si la grille n'existe pas, NaN pour un indicateur de module inconnu. */
  read(id: IndicatorId, x: number, z: number): number {
    const g = this.grids.get(id);
    if (g) return g.at(x, z);
    return isStandard(id) ? STANDARD_INDICATOR_SPECS[id].base : NaN;
  }

  /** Ajoute en (x, z) (crée la grille si besoin) ; renvoie la variation appliquée. */
  add(id: IndicatorId, x: number, z: number, dv: number): number { return this.ensure(id).addAt(x, z, dv); }

  /* --------------------------- Propagation --------------------------- */

  addCoupling(c: Coupling): void {
    if (this.couplings.some((k) => k.id === c.id)) throw new Error(`couplage ${c.id} déjà défini`);
    if (!Number.isFinite(c.factor)) throw new Error(`couplage ${c.id} : facteur invalide`);
    this.couplings.push({ ...c });
  }
  removeCoupling(id: string): boolean {
    const k = this.couplings.findIndex((c) => c.id === id);
    if (k >= 0) this.couplings.splice(k, 1);
    return k >= 0;
  }
  listCouplings(): readonly Coupling[] { return this.couplings; }

  /**
   * Échéance d'une fréquence : diffusion des grilles dont la propagation tombe à cette fréquence (ordre des
   * identifiants), puis couplages de cette fréquence (ordre de déclaration). Déterministe.
   */
  propagate(freq: Frequency): void {
    const ids = [...this.grids.keys()].sort();
    for (const id of ids) {
      const g = this.grids.get(id)!;
      if (g.spec.diffusion && g.spec.diffusion.every === freq) g.diffuse();
    }
    for (const c of this.couplings) if (c.every === freq) this.applyCoupling(c);
  }

  applyCoupling(c: Coupling): void {
    const src = this.grids.get(c.from), dst = this.grids.get(c.to);
    if (!src || !dst) return;
    const ref = c.fromRef ?? src.spec.base;
    const same = src.cols === dst.cols && src.rows === dst.rows && src.cellSize === dst.cellSize && src.originX === dst.originX && src.originZ === dst.originZ;
    const d = dst.data, min = dst.spec.min, max = dst.spec.max;
    for (let j = 0; j < dst.rows; j++) {
      for (let i = 0; i < dst.cols; i++) {
        const k = j * dst.cols + i;
        const s = same ? src.data[k]! : src.sample(dst.centerX(i), dst.centerZ(j));
        let v = d[k]! + c.factor * (s - ref);
        if (v < min) v = min; else if (v > max) v = max;
        d[k] = v;
      }
    }
    dst.version++;
  }

  /* --------------------------- Sauvegarde --------------------------- */

  toJSON(): { geometry: GridGeometry; grids: GridJSON[]; couplings: Coupling[] } {
    return {
      geometry: { ...this.geometry },
      grids: this.ids().sort().map((id) => {
        const g = this.grids.get(id)!;
        return { spec: JSON.parse(JSON.stringify(g.spec)) as IndicatorSpec, geometry: { ...g.geometry }, values: encodeFloat32(g.data) };
      }),
      couplings: this.couplings.map((c) => ({ ...c })),
    };
  }

  static fromJSON(j: { geometry: GridGeometry; grids: GridJSON[]; couplings?: Coupling[] }): IndicatorGrids {
    const r = new IndicatorGrids(j.geometry);
    for (const gj of j.grids) {
      const n = gj.geometry.cols * gj.geometry.rows;
      const g = new IndicatorGrid(gj.spec, gj.geometry, decodeFloat32(gj.values, n));
      r.grids.set(gj.spec.id, g);
    }
    for (const c of j.couplings ?? []) r.addCoupling(c);
    return r;
  }
}
