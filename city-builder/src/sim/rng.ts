/**
 * Générateur pseudo-aléatoire déterministe à état SÉRIALISABLE (sfc32).
 * L'état (4 entiers 32 bits) est enregistré dans la sauvegarde : une partie rechargée
 * reproduit exactement les mêmes tirages. Même algorithme portable en C#/C++.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed = 1) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Flottant uniforme dans [0, 1). */
  next(): number { return this.nextU32() / 4294967296; }

  /** Entier uniforme dans [min, max] (bornes incluses). */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }

  /** Flottant uniforme dans [min, max). */
  range(min: number, max: number): number { return min + this.next() * (max - min); }

  chance(p: number): boolean { return this.next() < p; }

  /** Tirage pondéré : renvoie l'index choisi dans `weights`. */
  weighted(weights: readonly number[]): number {
    let sum = 0;
    for (const w of weights) sum += w;
    let r = this.next() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  getState(): [number, number, number, number] { return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0]; }

  setState(s: readonly number[]): void {
    this.a = (s[0] ?? 0) | 0;
    this.b = (s[1] ?? 0) | 0;
    this.c = (s[2] ?? 0) | 0;
    this.d = (s[3] ?? 0) | 0;
  }
}
