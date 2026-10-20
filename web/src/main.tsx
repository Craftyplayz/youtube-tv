import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { go } from './api.ts';
import Admin from './Admin.tsx';
import Home from './Home.tsx';
import Player from './Player.tsx';
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
    addEventListener('popstate', onPop);
    addEventListener('click', onClick);
    return () => {
      removeEventListener('popstate', onPop);
      removeEventListener('click', onClick);
    };
  }, []);
  if (path === '/') return <Home />;
  if (path === '/admin') return <Admin page="channels" />;
  if (path === '/admin/viewers') return <Admin page="viewers" />;
  return <Player key={path} slug={path.slice(1)} />;
}

createRoot(document.getElementById('root')!).render(<App />);
