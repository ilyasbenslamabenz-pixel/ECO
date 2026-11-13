/**
 * Encodage compact des tableaux Float32Array pour la sauvegarde JSON (base64 des octets, petit-boutiste).
 * Implémentation autonome (pas de btoa/Buffer) : identique dans le worker, le navigateur et Node.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

function bytesOf(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i]!, true);
  return out;
}

export function encodeFloat32(values: Float32Array): string {
  const b = bytesOf(values);
  let s = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!;
    s += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = b.length - i;
  if (rest === 1) {
    const n = b[i]! << 16;
    s += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8);
    s += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return s;
}

/** Décode ; lève si la chaîne n'est pas du base64 valide ou si la longueur ne correspond pas à `expected` valeurs. */
export function decodeFloat32(s: string, expected: number): Float32Array {
  if (typeof s !== 'string' || s.length % 4 !== 0) throw new Error('base64 invalide');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const nBytes = (s.length / 4) * 3 - pad;
  if (nBytes !== expected * 4) throw new Error(`grille : ${nBytes / 4} valeurs, ${expected} attendues`);
  const bytes = new Uint8Array(nBytes);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = s.charCodeAt(i + k);
      if (c === 61 /* = */ && i + k >= s.length - pad) { n <<= 6; continue; }
      const v = c < 128 ? LOOKUP[c]! : -1;
      if (v < 0) throw new Error('base64 invalide');
      n = (n << 6) | v;
    }
    if (o < nBytes) bytes[o++] = (n >> 16) & 255;
    if (o < nBytes) bytes[o++] = (n >> 8) & 255;
    if (o < nBytes) bytes[o++] = n & 255;
  }
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(expected);
  for (let i = 0; i < expected; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
