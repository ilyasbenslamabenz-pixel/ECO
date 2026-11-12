/**
 * Tables SoA (structure-de-tableaux) de la population : citoyens, ménages, entreprises.
 * Table générique à colonnes typées : indices denses, suppression par permutation avec
 * le dernier, table id -> index, croissance par doublement. Sérialisation colonne par
 * colonne (tableaux de nombres) pour une sauvegarde JSON compacte et portable.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

type ColumnCtor = Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | Uint8ArrayConstructor | Uint16ArrayConstructor | Int8ArrayConstructor;
type ColumnOf<C> =
  C extends Int32ArrayConstructor ? Int32Array :
  C extends Uint32ArrayConstructor ? Uint32Array :
  C extends Float32ArrayConstructor ? Float32Array :
  C extends Float64ArrayConstructor ? Float64Array :
  C extends Uint8ArrayConstructor ? Uint8Array :
  C extends Uint16ArrayConstructor ? Uint16Array :
  C extends Int8ArrayConstructor ? Int8Array : never;

export type Schema = { id: Int32ArrayConstructor } & Record<string, ColumnCtor>;
export type Columns<S extends Schema> = { [K in keyof S]: ColumnOf<S[K]> };
type AnyColumn = Int32Array | Uint32Array | Float32Array | Float64Array | Uint8Array | Uint16Array | Int8Array;

/** Sérialisation colonne par colonne : { colonne: number[] }. */
export type ColumnsJSON = Record<string, number[]>;

export class SoaTable<S extends Schema> {
  count = 0;
  capacity: number;
  readonly col: Columns<S>;
  private readonly idToIndex = new Map<number, number>();
  private readonly names: (keyof S & string)[];

  constructor(private readonly schema: S, capacity = 256) {
    this.capacity = Math.max(1, capacity);
    this.names = Object.keys(schema) as (keyof S & string)[];
    const col = {} as Record<string, AnyColumn>;
    for (const n of this.names) col[n] = new (schema[n] as ColumnCtor)(this.capacity);
    this.col = col as Columns<S>;
  }

  private grow(min: number): void {
    let n = this.capacity * 2;
    while (n < min) n *= 2;
    const col = this.col as unknown as Record<string, AnyColumn>;
    for (const name of this.names) {
      const old = col[name]!;
      const next = new (this.schema[name] as ColumnCtor)(n);
      next.set(old as never);
      col[name] = next;
    }
    this.capacity = n;
  }

  /** Ajoute une ligne (colonnes à 0) et renvoie son index. */
  add(id: number): number {
    if (this.idToIndex.has(id)) throw new Error(`id ${id} déjà présent`);
    if (this.count === this.capacity) this.grow(this.count + 1);
    const i = this.count++;
    const col = this.col as unknown as Record<string, AnyColumn>;
    for (const name of this.names) col[name]![i] = 0;
    col.id![i] = id;
    this.idToIndex.set(id, i);
    return i;
  }

  indexOf(id: number): number { return this.idToIndex.get(id) ?? -1; }
  has(id: number): boolean { return this.idToIndex.has(id); }

  remove(id: number): boolean {
    const i = this.idToIndex.get(id);
    if (i === undefined) return false;
    const last = this.count - 1;
    const col = this.col as unknown as Record<string, AnyColumn>;
    if (i !== last) {
      for (const name of this.names) col[name]![i] = col[name]![last]!;
      this.idToIndex.set(col.id![i]!, i);
    }
    this.idToIndex.delete(id);
    this.count--;
    return true;
  }

  clear(): void { this.count = 0; this.idToIndex.clear(); }

  toJSON(): ColumnsJSON {
    const out: ColumnsJSON = {};
    const col = this.col as unknown as Record<string, AnyColumn>;
    for (const name of this.names) out[name] = Array.from(col[name]!.subarray(0, this.count));
    return out;
  }

  /** Recharge depuis des colonnes (longueurs déjà validées). Les colonnes absentes restent à 0. */
  fromJSON(j: ColumnsJSON): void {
    this.clear();
    const n = j.id?.length ?? 0;
    if (n > this.capacity) this.grow(n);
    const col = this.col as unknown as Record<string, AnyColumn>;
    for (const name of this.names) {
      const src = j[name];
      const dst = col[name]!;
      for (let i = 0; i < n; i++) dst[i] = src ? src[i]! : 0;
    }
    this.count = n;
    for (let i = 0; i < n; i++) this.idToIndex.set(col.id![i]!, i);
  }

  columnNames(): readonly string[] { return this.names; }
}

/** Niveaux d'éducation. */
export const Education = { None: 0, Primary: 1, Secondary: 2, Baccalaureate: 3, Higher: 4 } as const;
export const EDUCATION_NAMES_FR = ['Sans diplôme', 'Primaire', 'Brevet / CAP', 'Baccalauréat', 'Études supérieures'] as const;

/** Rôle dans le ménage. */
export const Role = { Adult: 0, Child: 1 } as const;

/** Activité courante (emploi du temps). 255 = non suivie individuellement (LOD statistique). */
export const Activity = {
  Sleep: 0, Home: 1, CommuteOut: 2, Work: 3, Break: 4, CommuteBack: 5, Leisure: 6, School: 7, Unknown: 255,
} as const;
export const ACTIVITY_NAMES_FR: Record<number, string> = {
  0: 'Sommeil', 1: 'À la maison', 2: 'Trajet aller', 3: 'Au travail', 4: 'Pause', 5: 'Trajet retour', 6: 'Loisirs', 7: 'À l\'école', 255: 'Non suivi',
};

/** Niveau de détail de simulation d'un citoyen (selon la distance à la caméra). */
export const SimLod = { Detailed: 0, Simplified: 1, Statistical: 2 } as const;

export const CITIZEN_SCHEMA = {
  id: Int32Array,
  household: Int32Array,
  sex: Uint8Array,
  firstName: Uint16Array,
  /** Minute de jeu de la naissance (négative pour les citoyens nés avant la partie). */
  birth: Int32Array,
  education: Uint8Array,
  role: Uint8Array,
  /** Bâtiment de logement (id) ou -1. */
  home: Int32Array,
  /** Bâtiment d'emploi (id) ou -1. */
  job: Int32Array,
  /** Bâtiment scolaire fréquenté (id) ou -1. */
  school: Int32Array,
  /** Revenu mensuel (crédits). */
  income: Float32Array,
  /** Bonheur 0..100. */
  happiness: Float32Array,
  /** Distance domicile-travail/école (m). */
  commute: Float32Array,
  /** Emploi du temps (minutes du jour). */
  wake: Uint16Array,
  workStart: Uint16Array,
  workEnd: Uint16Array,
  sleep: Uint16Array,
  activity: Uint8Array,
  lod: Uint8Array,
} as const;

export const HOUSEHOLD_SCHEMA = {
  id: Int32Array,
  surname: Uint16Array,
  home: Int32Array,
  size: Uint8Array,
  /** Minute d'emménagement. */
  movedIn: Int32Array,
  /** Mois consécutifs de mécontentement (déménagement hors de la ville à 3). */
  unhappyMonths: Uint8Array,
} as const;

/** Une entreprise par bâtiment d'emploi (id = id du bâtiment). */
export const COMPANY_SCHEMA = {
  id: Int32Array,
  /** 1 commerce, 2 industrie, 3 bureaux, 4 service public. */
  sector: Uint8Array,
  ownerSurname: Uint16Array,
  /** Chiffre d'affaires et bénéfice du dernier mois clos (crédits). */
  revenue: Float32Array,
  profit: Float32Array,
  founded: Int32Array,
} as const;

export type CitizenTable = SoaTable<typeof CITIZEN_SCHEMA>;
export type HouseholdTable = SoaTable<typeof HOUSEHOLD_SCHEMA>;
export type CompanyTable = SoaTable<typeof COMPANY_SCHEMA>;

export function createCitizenTable(cap = 1024): CitizenTable { return new SoaTable(CITIZEN_SCHEMA, cap); }
export function createHouseholdTable(cap = 512): HouseholdTable { return new SoaTable(HOUSEHOLD_SCHEMA, cap); }
export function createCompanyTable(cap = 256): CompanyTable { return new SoaTable(COMPANY_SCHEMA, cap); }
