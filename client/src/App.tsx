import { useStore } from './store';
import { MainMenu } from './ui/Menu';
import { MapView } from './game/MapView';
import { Dock, Inspector, Panels, ReformBar, Toasts, TopBar, Tutorial, useHotkeys } from './ui/Hud';
import './net';

function Game() {
  useHotkeys();
  return (
    <div className="game">
      <MapView />
      <TopBar />
      <Dock />
      <Panels />
      <Inspector />
      <ReformBar />
      <Tutorial />
    </div>
  );
}

export default function App() {
  const screen = useStore((s) => s.screen);
  return (
    <>
      {screen === 'menu' ? <MainMenu /> : <Game />}
      <Toasts />
    </>
  );
}
