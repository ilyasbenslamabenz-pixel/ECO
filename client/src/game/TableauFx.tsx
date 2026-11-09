// Animations de la vue tableau, dessinées sur un canevas au-dessus de l'illustration : bateaux sur le fleuve,
// phares sur le pont, scintillement des fenêtres, reflet du soleil sur la mer, feux des éoliennes, avion de ligne,
// pluie ou neige selon la météo du mois. Les positions sont en fractions de l'image recadrée (x, y entre 0 et 1).
// La circulation et les lumières suivent l'activité du pays (PIB par habitant) ; rien d'autre n'est simulé ici.
import { useEffect, useRef } from 'react';
import type { Weather } from './life';

type P = [number, number];
const RIVER: P[] = [[0.1, 0.33], [0.206, 0.427], [0.332, 0.551], [0.458, 0.631], [0.56, 0.78], [0.66, 0.96]];
const RIVER2: P[] = [[0.7, 0.99], [0.6, 0.86], [0.5, 0.69], [0.37, 0.6], [0.25, 0.48], [0.13, 0.36]];
const HARBOR: P[] = [[1.0, 0.3], [0.9, 0.36], [0.8, 0.44], [0.7, 0.5]];
const BRIDGE: P[] = [[0.37, 0.775], [0.455, 0.748], [0.542, 0.722], [0.62, 0.708], [0.69, 0.7]];
const QUAY: P[] = [[0.3, 0.5], [0.42, 0.58], [0.52, 0.66], [0.6, 0.705]];
/** zones de fenêtres qui scintillent : x0, y0, x1, y1, nombre */
const LIGHTS: [number, number, number, number, number][] = [[0.27, 0.16, 0.6, 0.5, 150], [0, 0.6, 0.45, 1, 150], [0.7, 0.36, 1, 0.6, 70], [0.55, 0.5, 0.8, 0.72, 60], [0, 0.25, 0.25, 0.45, 50]];
const SUN: P = [0.932, 0.164];

function along(path: P[], t: number): { x: number; y: number; a: number } {
  const n = path.length - 1;
  const f = Math.max(0, Math.min(0.9999, t)) * n;
  const i = Math.floor(f), u = f - i;
  const [ax, ay] = path[i], [bx, by] = path[i + 1];
  return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, a: Math.atan2(by - ay, bx - ax) };
}
// générateur déterministe (positions fixes d'une image à l'autre)
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function TableauFx({ left, top, W, H, weather, activity, night }: { left: number; top: number; W: number; H: number; weather: Weather; activity: number; night: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = useRef({ left, top, W, H, weather, activity, night });
  geo.current = { left, top, W, H, weather, activity, night };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const r = rng(2030);
    const lights = LIGHTS.flatMap(([x0, y0, x1, y1, n]) => Array.from({ length: n }, () => ({ x: x0 + r() * (x1 - x0), y: y0 + r() * (y1 - y0), p: r() * 6.28, s: 0.4 + r() * 1.2, warm: r() < 0.8 })));
    const boats = [
      ...Array.from({ length: 4 }, (_, k) => ({ path: RIVER, t: k / 4 + r() * 0.1, v: 0.008 + r() * 0.004, size: 1 + r() * 0.8 })),
      ...Array.from({ length: 3 }, (_, k) => ({ path: RIVER2, t: k / 3 + r() * 0.1, v: 0.007 + r() * 0.004, size: 0.9 + r() * 0.6 })),
      { path: HARBOR, t: 0.2, v: 0.004, size: 2.2 },
    ];
    const cars = [
      ...Array.from({ length: 26 }, () => ({ path: BRIDGE, t: r(), v: 0.05 + r() * 0.03, dir: r() < 0.5 ? 1 : -1 })),
      ...Array.from({ length: 16 }, () => ({ path: QUAY, t: r(), v: 0.035 + r() * 0.02, dir: r() < 0.5 ? 1 : -1 })),
    ];
    const turbines = Array.from({ length: 22 }, () => ({ x: 0.63 + r() * 0.29, y: 0.2 + r() * 0.05, p: r() * 6.28 }));
    const drops = Array.from({ length: 420 }, () => ({ x: r(), y: r(), v: 0.6 + r() * 0.6, d: r() }));
    let plane = { t: 0.4, y: 0.07 };
    let raf = 0, last = performance.now(), time = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      const g = geo.current;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const vw = cv.clientWidth, vh = cv.clientHeight;
      if (cv.width !== Math.round(vw * dpr) || cv.height !== Math.round(vh * dpr)) { cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      const X = (x: number) => g.left + x * g.W, Y = (y: number) => g.top + y * g.H;
      const k = g.W / 1700; // échelle des tailles
      const act = Math.max(0.35, Math.min(1.3, g.activity));
      ctx.globalCompositeOperation = 'lighter';

      // soleil : halo qui respire, et reflet scintillant sur la mer
      if (!g.night) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.6);
        const sg = ctx.createRadialGradient(X(SUN[0]), Y(SUN[1]), 0, X(SUN[0]), Y(SUN[1]), 150 * k);
        sg.addColorStop(0, `rgba(255,214,140,${0.22 + pulse * 0.1})`); sg.addColorStop(1, 'rgba(255,170,90,0)');
        ctx.fillStyle = sg; ctx.fillRect(X(SUN[0]) - 160 * k, Y(SUN[1]) - 160 * k, 320 * k, 320 * k);
        for (let i = 0; i < 46; i++) {
          const yy = SUN[1] + 0.03 + (i / 46) * 0.2;
          const w = (6 + i * 0.9) * k * (0.5 + 0.5 * Math.sin(time * 2.2 + i * 1.7));
          ctx.fillStyle = `rgba(255,200,130,${0.1 + 0.16 * Math.abs(Math.sin(time * 1.4 + i))})`;
          ctx.fillRect(X(SUN[0]) - w + Math.sin(time * 0.9 + i * 0.6) * 5 * k, Y(yy), w * 2, 1.4 * k);
        }
      }

      // fenêtres qui scintillent
      for (const l of lights) {
        const a = Math.max(0, Math.sin(time * l.s + l.p));
        if (a < 0.55) continue;
        const o = (a - 0.55) * 1.6 * (g.night ? 1 : 0.75) * Math.min(1, act);
        ctx.fillStyle = l.warm ? `rgba(255,214,150,${o})` : `rgba(190,220,255,${o})`;
        const s = 1.7 * k;
        ctx.fillRect(X(l.x) - s / 2, Y(l.y) - s / 2, s, s);
      }

      // feux rouges des éoliennes en mer
      for (const t of turbines) {
        const a = Math.sin(time * 1.6 + t.p) > 0.6 ? 0.9 : 0;
        if (!a) continue;
        ctx.fillStyle = `rgba(255,70,60,${a})`;
        ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), 1.5 * k, 0, 6.28); ctx.fill();
      }

      // bateaux : feu de mât, feu arrière et sillage clair
      for (const b of boats) {
        b.t += b.v * dt; if (b.t > 1) b.t -= 1;
        const p = along(b.path, b.t);
        const sx = X(p.x), sy = Y(p.y), s = b.size * k * (0.5 + p.y); // plus gros au premier plan
        for (let i = 1; i <= 9; i++) {
          const q = along(b.path, b.t - i * 0.0045);
          ctx.fillStyle = `rgba(220,235,255,${0.2 * (1 - i / 10)})`;
          ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), (1.2 + i * 0.5) * s, 0, 6.28); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,240,200,0.95)'; ctx.beginPath(); ctx.arc(sx, sy, 2.3 * s, 0, 6.28); ctx.fill();
        ctx.fillStyle = 'rgba(255,90,70,0.8)'; ctx.beginPath(); ctx.arc(sx - Math.cos(p.a) * 5 * s, sy - Math.sin(p.a) * 5 * s, 1.5 * s, 0, 6.28); ctx.fill();
      }

      // circulation : phares blancs dans un sens, feux rouges dans l'autre ; densité selon l'activité
      const nCars = Math.round(cars.length * Math.min(1, act));
      for (let i = 0; i < nCars; i++) {
        const c = cars[i];
        c.t += c.v * dt * c.dir; if (c.t > 1) c.t -= 1; if (c.t < 0) c.t += 1;
        const p = along(c.path, c.t);
        const off = c.dir * 2.2 * k;
        ctx.fillStyle = c.dir > 0 ? 'rgba(255,244,214,0.95)' : 'rgba(255,70,50,0.9)';
        ctx.beginPath(); ctx.arc(X(p.x) - Math.sin(p.a) * off, Y(p.y) + Math.cos(p.a) * off, 1.5 * k, 0, 6.28); ctx.fill();
      }

      // avion de ligne : feu à éclats qui traverse le ciel
      plane.t += dt * 0.012;
      if (plane.t > 1.3) plane = { t: -0.3, y: 0.04 + ((time * 7) % 10) * 0.008 };
      if (plane.t > 0 && plane.t < 1) {
        const px = X(plane.t), py = Y(plane.y + plane.t * 0.03);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(px, py, 2 * k, 1.2 * k);
        if (Math.sin(time * 9) > 0.5) { ctx.fillStyle = 'rgba(255,60,60,0.95)'; ctx.beginPath(); ctx.arc(px, py, 2 * k, 0, 6.28); ctx.fill(); }
      }

      // météo du mois : pluie, orage ou neige
      ctx.globalCompositeOperation = 'source-over';
      const rain = g.weather === 'pluie' || g.weather === 'orage';
      if (rain || g.weather === 'neige') {
        ctx.strokeStyle = 'rgba(200,215,240,0.33)'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
        const n = g.weather === 'orage' ? drops.length : Math.round(drops.length * 0.7);
        for (let i = 0; i < n; i++) {
          const d = drops[i];
          d.y += d.v * dt * (rain ? 1.5 : 0.12); d.x += dt * (rain ? -0.12 : Math.sin(time + d.d * 6) * 0.02);
          if (d.y > 1) { d.y = 0; d.x = Math.random(); }
          if (d.x < 0) d.x += 1;
          const sx = d.x * vw, sy = d.y * vh;
          if (rain) { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 3, sy + 13); ctx.stroke(); }
          else { ctx.beginPath(); ctx.arc(sx, sy, 1 + d.d * 1.6, 0, 6.28); ctx.fill(); }
        }
        if (g.weather === 'orage' && Math.sin(time * 0.7) > 0.995) { ctx.fillStyle = 'rgba(235,240,255,0.22)'; ctx.fillRect(0, 0, vw, vh); }
      }
      if (g.weather === 'brouillard') { ctx.fillStyle = 'rgba(200,190,185,0.16)'; ctx.fillRect(0, 0, vw, vh); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="tableau-fx" />;
}
