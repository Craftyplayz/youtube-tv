import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { go } from './api.ts';
import Home from './Home.tsx';
import Player from './Player.tsx';
import Settings from './Settings.tsx';
import './style.css';

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a');
      if (!a || a.origin !== location.origin || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      go(a.pathname);
    };
    // The Android app's back button: Settings goes back to Channels, and from Channels the app closes (a Channel handles its own)
    const onBack = (e: Event) => {
      if (location.pathname !== '/settings') return;
      e.preventDefault();
      go('/');
    };
    addEventListener('popstate', onPop);
    addEventListener('click', onClick);
    addEventListener('app-back', onBack);
    return () => {
      removeEventListener('popstate', onPop);
      removeEventListener('click', onClick);
      removeEventListener('app-back', onBack);
    };
  }, []);
  if (path === '/') return <Home />;
  if (path === '/settings') return <Settings />;
  return <Player key={path} slug={path.slice(1)} />;
}

createRoot(document.getElementById('root')!).render(<App />);
