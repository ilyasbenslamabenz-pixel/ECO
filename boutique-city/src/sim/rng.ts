/**
 * Générateur pseudo-aléatoire déterministe (sfc32) : même graine, même partie. État sérialisable (sauvegarde).
 * TypeScript pur.
 */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;

  constructor(seed: number | readonly number[]) {
    if (typeof seed === 'number') {
      this.a = 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = seed >>> 0;
      for (let i = 0; i < 12; i++) this.next();
    } else {
      this.a = seed[0]! >>> 0; this.b = seed[1]! >>> 0; this.c = seed[2]! >>> 0; this.d = seed[3]! >>> 0;
    }
  }

  /** Nombre dans [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return (r >>> 0) / 4294967296;
  }

  /** Entier dans [min, max]. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }

  /** Élément au hasard. */
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]!; }

  /** Tirage de Poisson (petites moyennes : méthode de Knuth ; grandes : approximation normale). */
  poisson(mean: number): number {
    if (!(mean > 0)) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const L = Math.exp(-mean);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > L);
    return k - 1;
  }

  /** Loi normale centrée réduite (Box-Muller). */
  normal(): number {
    const u = Math.max(1e-12, this.next()), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  state(): number[] { return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0]; }
}
