// Formatage des nombres, montants et dates (fr-FR).
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const int = (v: number) => nf0.format(Math.round(v));
export const dec1 = (v: number) => nf1.format(v);
export const dec2 = (v: number) => nf2.format(v);
export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
export const pts = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')} pt`;
export function money(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}${nf2.format(a / 1e12)} Bn€`;
  if (a >= 1e9) return `${s}${nf1.format(a / 1e9)} Md€`;
  if (a >= 1e6) return `${s}${nf1.format(a / 1e6)} M€`;
  if (a >= 1e4) return `${s}${nf0.format(a / 1e3)} k€`;
  return `${s}${nf0.format(a)} €`;
}
export const eur = (v: number) => `${nf0.format(Math.round(v))} €`;
export function people(v: number): string {
  if (v >= 1e6) return `${nf2.format(v / 1e6)} M`;
  if (v >= 1e4) return `${nf0.format(v / 1e3)} k`;
  return nf0.format(Math.round(v));
}
export const signed = (v: number, f: (x: number) => string) => (v > 0 ? '+' : '') + f(v);
