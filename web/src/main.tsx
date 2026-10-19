import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Player from './Player.tsx';
import Settings from './Settings.tsx';
import './style.css';

function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash === '#/settings' ? <Settings /> : <Player />;
}

createRoot(document.getElementById('root')!).render(<App />);
