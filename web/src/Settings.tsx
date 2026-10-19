import { useEffect, useState, type FormEvent } from 'react';
import { api, type Channel } from './api.ts';

const ORDERINGS = { shuffle: 'Shuffle', new_first: 'New uploads first', fixed: 'Fixed order' };
const KINDS = { youtube_channel: 'YouTube channel', playlist: 'Playlist', list: 'Hand-picked list' };

function values(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const form = e.currentTarget;
  const v = Object.fromEntries(new FormData(form)) as Record<string, string>;
  form.reset();
  return v;
}

export default function Settings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api<Channel[]>('channels').then(setChannels, e => setError(e.message));
  useEffect(() => { load(); }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
    load();
  }

  const swap = (a: Channel, b: Channel) => run(() => Promise.all([
    api(`channels/${a.id}`, 'PUT', { position: b.position }),
    api(`channels/${b.id}`, 'PUT', { position: a.position }),
  ]));

  return (
    <main className="settings">
      <header>
        <h1>Channels</h1>
        <a href="#/">Back to TV</a>
      </header>
      {error && <p className="error">{error}</p>}
      {busy && <p className="busy">Working… adding a big YouTube channel can take a minute.</p>}

      {channels.map((c, i) => (
        <section key={c.id} className="channel">
          <form onSubmit={e => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            run(() => api(`channels/${c.id}`, 'PUT', { ...f, skip_shorts: f.skip_shorts === 'on' }));
          }}>
            <div className="row">
              <span className="number">{i + 1}</span>
              <input name="name" defaultValue={c.name} required aria-label="Channel name" />
              <button type="button" disabled={i === 0} onClick={() => swap(c, channels[i - 1])} aria-label="Move up">↑</button>
              <button type="button" disabled={i === channels.length - 1} onClick={() => swap(c, channels[i + 1])} aria-label="Move down">↓</button>
              <button type="button" onClick={() => confirm(`Delete ${c.name}?`) && run(() => api(`channels/${c.id}`, 'DELETE'))}>Delete</button>
            </div>
            <label>Ordering
              <select name="ordering" defaultValue={c.ordering}>
                {Object.entries(ORDERINGS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <label>Recent videos per Back catalog video <input name="recent_ratio" type="number" min={0} defaultValue={c.recent_ratio} /></label>
            <label>Recent means newer than (days) <input name="recent_days" type="number" min={1} defaultValue={c.recent_days} /></label>
            <label>Skip Shorts <input name="skip_shorts" type="checkbox" defaultChecked={!!c.skip_shorts} /></label>
            <label>Max length (minutes) <input name="max_minutes" type="number" min={1} defaultValue={c.max_minutes ?? ''} placeholder="no limit" /></label>
            <label>Max age (days) <input name="max_age_days" type="number" min={1} defaultValue={c.max_age_days ?? ''} placeholder="no limit" /></label>
            <label>Blocked words (comma-separated) <input name="blocked_words" defaultValue={c.blocked_words} /></label>
            <button>Save</button>
          </form>

          <ul className="sources">
            {c.sources.map(s => (
              <li key={s.id}>
                {s.label} <small>{KINDS[s.kind]} · {s.videos} videos</small>
                <button onClick={() => confirm(`Remove ${s.label}?`) && run(() => api(`sources/${s.id}`, 'DELETE'))}>Remove</button>
              </li>
            ))}
          </ul>
          <form onSubmit={e => { const { input } = values(e); run(() => api(`channels/${c.id}/sources`, 'POST', { input })); }}>
            <textarea name="input" rows={2} required placeholder="YouTube channel (@handle or URL), playlist URL, or video URLs (one per line)" aria-label="New Source" />
            <button disabled={busy}>Add Source</button>
          </form>
        </section>
      ))}

      <form className="new" onSubmit={e => { const { name } = values(e); run(() => api('channels', 'POST', { name })); }}>
        <input name="name" required placeholder="New Channel name" aria-label="New Channel name" />
        <button>Add Channel</button>
      </form>
    </main>
  );
}
