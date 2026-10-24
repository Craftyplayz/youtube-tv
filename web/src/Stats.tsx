import { useEffect, useRef, useState } from 'react';
import { api, device, thumb, watched, watchedExactly, type Totals, type VideoViews } from './api.ts';
import Icon from './Icon.tsx';

const PAGE = 50; // matches the server
const count = (n: number) => `${n.toLocaleString()} view${n === 1 ? '' : 's'}`;

// Videos most viewed first, fetching the next page as the end of the list scrolls into sight; compare names who the
// everyone column stands for, if it's shown
export function VideoList({ path, compare }: { path: string; compare?: string }) {
  const [list, setList] = useState<VideoViews[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLLIElement>(null);
  const busy = useRef(false); // a ref so the observer can't fetch one page twice

  async function more(from: number) {
    if (busy.current) return;
    busy.current = true;
    setError('');
    try {
      const page = await api<VideoViews[]>(`${path}${path.includes('?') ? '&' : '?'}offset=${from}`);
      setList(l => [...l, ...page]);
      if (page.length < PAGE) setDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
    busy.current = false;
  }

  useEffect(() => {
    if (done || error || !end.current) return;
    const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting) more(list.length); });
    seen.observe(end.current);
    return () => seen.disconnect();
  }, [list, done, error]);

  return (
    <ul className="video-list">
      {list.map((v, i) => (
        <li key={v.videoId}>
          <span className="rank">{i + 1}</span>
          <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer"><img src={thumb(v.videoId)} alt="" loading="lazy" /></a>
          <div>
            <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer">{v.title}</a>
            <small>{v.by}</small>
          </div>
          <div className="counts">
            <b>{count(v.views)}</b>
            {compare && <small>{compare} {v.everyone.toLocaleString()}</small>}
          </div>
        </li>
      ))}
      {done ? !list.length && <li className="dim">Nothing watched yet.</li>
        : <li ref={end} className="dim">{error ? <span className="error">{error} <button onClick={() => more(list.length)}>Retry</button></span> : 'Loading…'}</li>}
    </ul>
  );
}

export function Summary({ label, t }: { label: string; t: Totals }) {
  return (
    <div className="summary">
      <small>{label}</small>
      <b title={watchedExactly(t.seconds)}>{watched(t.seconds)}</b>
      <small>{count(t.views)}</small>
    </div>
  );
}

// A Channel's viewing time for everyone and for whoever this Screen belongs to, then their most-watched videos on it
export default function ChannelStats({ channel, onClose }: { channel: { id: number; name: string }; onClose: () => void }) {
  const [stats, setStats] = useState<{ everyone: Totals; you: Totals }>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ everyone: Totals; you: Totals }>(`channels/${channel.id}/stats?device=${device}`).then(setStats, e => setError(e.message));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="stats-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="stats" role="dialog" aria-label={`${channel.name} stats`}>
        <header>
          <h2>{channel.name} stats</h2>
          <button onClick={onClose} title="Close (Esc)" aria-label="Close"><Icon name="close" /></button>
        </header>
        {error && <p className="error">{error}</p>}
        {stats && (
          <div className="summaries">
            <Summary label="Everyone" t={stats.everyone} />
            <Summary label="You" t={stats.you} />
          </div>
        )}
        <h3>Your most-watched videos</h3>
        <VideoList path={`channels/${channel.id}/videos?device=${device}`} compare="everyone" />
      </section>
    </div>
  );
}
