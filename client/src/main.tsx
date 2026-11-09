import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-400-italic.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import './styles.css';
import { useStore } from './store';
import { camApi } from './game/world';

createRoot(document.getElementById('root')!).render(<App />);
// accès de débogage depuis la console du navigateur
(window as unknown as Record<string, unknown>).__eco = { useStore, camApi };
