/**
 * Chemin sur la grille d'un intérieur (cases de 1 m, 4 voisins), recherche en largeur. TypeScript pur.
 */
export function findPath(w: number, d: number, blocked: (x: number, z: number) => boolean, from: [number, number], to: [number, number]): [number, number][] | null {
  const key = (x: number, z: number): number => z * w + x;
  if (from[0] === to[0] && from[1] === to[1]) return [to];
  const prev = new Int32Array(w * d).fill(-1);
  const start = key(from[0], from[1]);
  prev[start] = start;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const k = q[h]!;
    const x = k % w, z = (k - x) / w;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
      const n = key(nx, nz);
      if (prev[n] !== -1) continue;
      if (blocked(nx, nz) && !(nx === to[0] && nz === to[1])) continue;
      prev[n] = k;
      if (nx === to[0] && nz === to[1]) {
        const path: [number, number][] = [];
        let c = n;
        while (c !== start) { path.push([c % w, Math.floor(c / w)]); c = prev[c]!; }
        return path.reverse();
      }
      q.push(n);
    }
  }
  return null;
}
