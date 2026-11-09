// Composant React hébergeant la scène Babylon.js.
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { createWorld } from './world';

export function MapView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const country = useStore((s) => s.country);
  const gameId = useStore((s) => s.gameId);
  const quality = useStore((s) => s.settings.quality);
  useEffect(() => {
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
  }, [gameId, !!country, quality]);
  return (
    <>
      <canvas ref={canvas} className="map-canvas" onContextMenu={(e) => e.preventDefault()} />
      <div ref={labels} id="labels" className="labels" />
    </>
  );
}
