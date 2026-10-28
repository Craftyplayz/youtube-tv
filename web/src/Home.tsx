import { useEffect, useState } from 'react';
import { go, now, schedule, thumb, watched, watchedExactly, type Lineup } from './api.ts';
import Icon from './Icon.tsx';
import ChannelStats from './Stats.tsx';

// Every Channel and what's on it right now
export default function Home() {
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<Lineup>();

  useEffect(() => {
    document.title = 'Youtube TV';
    // Channels in a Group are picked from inside their Group's Channel
    const load = () => schedule(now(), now() + 1).then(ls => setLineups(ls.filter(l => !l.parent)));
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
                    <span className="card-watched" title={watchedExactly(l.watched)}>Watched: {watched(l.watched)} · {l.views.toLocaleString()} video{l.views === 1 ? '' : 's'}</span>
                    {s && <progress max={s.end - s.start} value={now() - s.start} />}
                  </a>
                  <button className="card-stats" title="Stats" aria-label={`${l.name} stats`} onClick={() => setStats(l)}><Icon name="stats" /></button>
                </li>
              );
            })}
          </ul>
        )}
      {stats && <ChannelStats channel={stats} onClose={() => setStats(undefined)} />}
    </main>
  );
}
