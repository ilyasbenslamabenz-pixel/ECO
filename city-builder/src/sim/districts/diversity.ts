/**
 * Quartiers — MESURE DE LA DIVERSITÉ du bâti.
 *
 * Indice de répétition de voisinage (`repetitionIndex`) :
 *   pour chaque bâtiment i, r(i) = part de ses voisins (centres à moins de `radius` mètres, défaut 40 m ;
 *   à défaut de voisin dans le rayon, ses `k` plus proches, défaut 4) qui ont le MÊME modèle (assetId) ;
 *   indice = moyenne des r(i) sur les bâtiments ayant au moins un voisin.
 *   0 = aucun voisin identique nulle part ; 1 = tous les voisins identiques (lotissement de clones).
 * Mesures complémentaires :
 *   - `adjacentTwinRate` : part des paires CONTIGUËS (distance entre centres ≤ demi-tailles + 6 m) identiques
 *     modèle + variante (ce que l'œil repère immédiatement dans une rue) ;
 *   - `distinctAssets`, `styles` (tags `style:` via la fonction fournie) ;
 *   - `entropy` : entropie de Shannon de la distribution des modèles, normalisée par log(n modèles) (1 = équilibrée).
 * Utilisable sur un plan (lots) comme sur les bâtiments réels d'une partie.
 * TypeScript pur : AUCUN import de three ni du DOM.
 */

export interface DiversityItem {
  assetId: string;
  variant: number;
  x: number;
  z: number;
  /** Plus grande dimension de l'emprise (m) ; 16 par défaut. */
  size?: number;
}

export interface DiversityOptions {
  radius?: number;
  k?: number;
  /** Style d'un modèle (pour `styles`) ; absent = non compté. */
  styleOf?: (assetId: string) => string | undefined;
}

export interface DiversityReport {
  count: number;
  distinctAssets: number;
  styles: number;
  repetitionIndex: number;
  adjacentTwinRate: number;
  adjacentPairs: number;
  entropy: number;
  /** Part du modèle le plus fréquent. */
  topShare: number;
}

export const DEFAULT_DIVERSITY_RADIUS = 40;

export function measureDiversity(items: readonly DiversityItem[], opts: DiversityOptions = {}): DiversityReport {
  const n = items.length;
  const radius = opts.radius ?? DEFAULT_DIVERSITY_RADIUS;
  const k = opts.k ?? 4;
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.assetId, (counts.get(it.assetId) ?? 0) + 1);
  const styles = new Set<string>();
  if (opts.styleOf) for (const id of counts.keys()) { const s = opts.styleOf(id); if (s) styles.add(s); }
  let entropy = 0;
  let top = 0;
  for (const c of counts.values()) { const p = c / n; entropy -= p * Math.log(p); if (c > top) top = c; }
  entropy = counts.size > 1 ? entropy / Math.log(counts.size) : 0;

  // Grille de hachage spatial (cellule = rayon) : voisinage en O(n) pour des milliers de bâtiments.
  const cell = Math.max(radius, 1);
  const grid = new Map<string, number[]>();
  const key = (cx: number, cz: number): string => `${cx},${cz}`;
  items.forEach((it, i) => {
    const kk = key(Math.floor(it.x / cell), Math.floor(it.z / cell));
    const l = grid.get(kk);
    if (l) l.push(i); else grid.set(kk, [i]);
  });
  let sum = 0, measured = 0, pairs = 0, twins = 0;
  const r2 = radius * radius;
  const near: { j: number; d2: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = items[i]!;
    const cx = Math.floor(a.x / cell), cz = Math.floor(a.z / cell);
    let same = 0, total = 0;
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const l = grid.get(key(gx, gz));
        if (!l) continue;
        for (const j of l) {
          if (j === i) continue;
          const b = items[j]!;
          const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
          if (d2 > r2) continue;
          total++;
          if (b.assetId === a.assetId) same++;
          if (j > i) {
            const adj = ((a.size ?? 16) + (b.size ?? 16)) / 2 + 6;
            if (d2 <= adj * adj) { pairs++; if (b.assetId === a.assetId && b.variant === a.variant) twins++; }
          }
        }
      }
    }
    if (total === 0 && n > 1) {
      // Bâtiment isolé : ses k plus proches voisins (recherche exhaustive, cas rare).
      near.length = 0;
      for (let j = 0; j < n; j++) if (j !== i) near.push({ j, d2: (a.x - items[j]!.x) ** 2 + (a.z - items[j]!.z) ** 2 });
      near.sort((p, q) => p.d2 - q.d2 || p.j - q.j);
      for (const e of near.slice(0, k)) { total++; if (items[e.j]!.assetId === a.assetId) same++; }
    }
    if (total > 0) { sum += same / total; measured++; }
  }
  return {
    count: n, distinctAssets: counts.size, styles: styles.size,
    repetitionIndex: measured > 0 ? sum / measured : 0,
    adjacentTwinRate: pairs > 0 ? twins / pairs : 0, adjacentPairs: pairs,
    entropy, topShare: n > 0 ? top / n : 0,
  };
}
