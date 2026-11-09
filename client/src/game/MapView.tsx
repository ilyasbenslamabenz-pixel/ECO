// Composant React hébergeant la scène Babylon.js.
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { camApi, createWorld } from './world';
import { CityTableau } from './CityTableau';

export function MapView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const country = useStore((s) => s.country);
  const gameId = useStore((s) => s.gameId);
  const quality = useStore((s) => s.settings.quality);
  const view = useStore((s) => s.settings.view ?? '2d');
  useEffect(() => {
    if (view === '2d') { camApi.focus = () => {}; return; } // vue tableau : pas de scène 3D
    if (!canvas.current || !labels.current || !country) return;
    let dispose: (() => void) | null = null;
    try {
      dispose = createWorld(canvas.current, useStore.getState().country!, quality, labels.current);
    } catch (e) {
      console.error(e);
      useStore.getState().toast("Impossible d'initialiser la 3D (WebGL indisponible ?)", 'bad');
    }
    return () => dispose?.();
    // la scène n'est reconstruite qu'au changement de partie ou de qualité ; les équipements se mettent à jour à chaud
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, !!country, quality, view]);
  if (view === '2d') return <CityTableau />;
  return (
    <>
      <canvas ref={canvas} className="map-canvas" onContextMenu={(e) => e.preventDefault()} />
      <div ref={labels} id="labels" className="labels" />
    </>
  );
}
