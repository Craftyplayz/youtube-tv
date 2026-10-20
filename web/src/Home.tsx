import { useEffect, useState } from 'react';
import { go, now, schedule, thumb, watched, type Lineup } from './api.ts';

// Every Channel and what's on it right now
export default function Home() {
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Youtube TV';
    const load = () => schedule(now(), now() + 1).then(setLineups);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const q = query.trim().toLowerCase();
  const shown = lineups?.filter(l => `${l.name} ${l.slots[0]?.title ?? ''}`.toLowerCase().includes(q)) ?? [];

  return (
    <main className="home">
      <header>
        <h1>Youtube TV</h1>
        <input
          type="search" autoFocus placeholder="Search Channels" aria-label="Search Channels"
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && shown[0]) go('/' + shown[0].slug); }}
        />
        <a href="/admin">Admin</a>
      </header>
      {lineups === null ? <p>Loading…</p>
        : !lineups.length ? <p>No Channels yet. <a href="/admin">Add one in Admin</a></p>
        : !shown.length ? <p>No Channels match “{query}”.</p>
        : (
          <ul className="channel-grid">
            {shown.map(l => {
              const s = l.slots[0];
              return (
                <li key={l.id}>
                  <a href={'/' + l.slug} className="channel-card">
                    {s ? <img src={thumb(s.videoId)} alt="" /> : <span className="off">Off air</span>}
                    <span className="card-name"><b>{lineups.indexOf(l) + 1}</b>{l.name}</span>
                    <span className="card-now">{s ? s.title : 'Off air'}</span>
                    <span className="card-watched">{watched(l.watched)} watched</span>
                    {s && <progress max={s.end - s.start} value={now() - s.start} />}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
    </main>
  );
}
