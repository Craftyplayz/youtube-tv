import { useEffect, useState } from 'react';
import { api, type Channel } from './api.ts';

const ORDERINGS = { shuffle: 'Shuffle', new_first: 'New uploads first', fixed: 'Fixed order' };
const KINDS = { youtube_channel: 'YouTube channel', playlist: 'Playlist', list: 'Hand-picked list' };

export default function Settings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [open, setOpen] = useState<number[]>([]);
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

  const toggle = (id: number) => setOpen(o => o.includes(id) ? o.filter(x => x !== id) : [...o, id]);

  function newChannel() {
    const name = prompt('New Channel name');
    if (name) run(async () => {
      const { id } = await api<{ id: number }>('channels', 'POST', { name });
      setOpen(o => [...o, id]);
    });
  }

  return (
    <main className="settings">
      <header>
        <h1>Channels</h1>
        <a href="/">Back to Channels</a>
        <button onClick={newChannel} disabled={busy}>+ New Channel</button>
      </header>
      {error && <p className="error">{error}</p>}
      {busy && <p className="busy">Working… adding a big YouTube channel can take a minute.</p>}

      {channels.map((c, i) => {
        const isOpen = open.includes(c.id);
        return (
          <section key={c.id} className="channel">
            <div className="row">
              <button type="button" className="toggle" aria-expanded={isOpen} onClick={() => toggle(c.id)}>
                <span className="caret">{isOpen ? '▾' : '▸'}</span>
                <span className="number">{i + 1}</span>
                <b>{c.name}</b>
                <small>{c.sources.length} Source{c.sources.length === 1 ? '' : 's'}</small>
              </button>
              <a href={'/' + c.slug}>/{c.slug}</a>
              <button type="button" disabled={i === 0} onClick={() => swap(c, channels[i - 1])} aria-label="Move up">↑</button>
              <button type="button" disabled={i === channels.length - 1} onClick={() => swap(c, channels[i + 1])} aria-label="Move down">↓</button>
              <button type="button" onClick={() => confirm(`Delete ${c.name}?`) && run(() => api(`channels/${c.id}`, 'DELETE'))}>Delete</button>
            </div>

            {/* hidden rather than unmounted, so unsaved edits survive collapsing */}
            <div className="channel-body" hidden={!isOpen}>
              <form onSubmit={e => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                run(() => api(`channels/${c.id}`, 'PUT', { ...f, skip_shorts: f.skip_shorts === 'on', skip_live: f.skip_live === 'on' }));
              }}>
                <label>Name <input name="name" defaultValue={c.name} required /></label>
                <label>Ordering
                  <select name="ordering" defaultValue={c.ordering}>
                    {Object.entries(ORDERINGS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </label>
                <label>Recent videos per Back catalog video <input name="recent_ratio" type="number" min={0} defaultValue={c.recent_ratio} /></label>
                <label>Recent means newer than (days) <input name="recent_days" type="number" min={1} defaultValue={c.recent_days} /></label>
                <label>Skip Shorts <input name="skip_shorts" type="checkbox" defaultChecked={!!c.skip_shorts} /></label>
                <label>Skip livestreams from YouTube channels (playlists keep theirs) <input name="skip_live" type="checkbox" defaultChecked={!!c.skip_live} /></label>
                <label>Max length (minutes) <input name="max_minutes" type="number" min={1} defaultValue={c.max_minutes ?? ''} placeholder="no limit" /></label>
                <label>Max age (days) <input name="max_age_days" type="number" min={1} defaultValue={c.max_age_days ?? ''} placeholder="no limit" /></label>
                <label>Blocked words (comma-separated) <input name="blocked_words" defaultValue={c.blocked_words} /></label>
                <button>Save</button>
              </form>

              <h2>Sources</h2>
              <ul className="sources">
                {c.sources.map(s => (
                  <li key={s.id}>
                    {s.label} <small>{KINDS[s.kind]} · {s.videos} videos</small>
                    <button onClick={() => confirm(`Remove ${s.label}?`) && run(() => api(`sources/${s.id}`, 'DELETE'))}>Remove</button>
                  </li>
                ))}
              </ul>
              <form onSubmit={e => {
                e.preventDefault();
                const box = e.currentTarget.elements.namedItem('input') as HTMLTextAreaElement;
                run(async () => {
                  const r = await api<{ failed: string; error: string }>(`channels/${c.id}/sources`, 'POST', { input: box.value });
                  box.value = r.failed; // lines that couldn't be added stay in the box to fix
                  if (r.error) throw new Error(r.error);
                });
              }}>
                {/* a Channel that mounts open was just created, so jump straight to adding its Sources */}
                <textarea name="input" rows={4} required autoFocus={isOpen} aria-label="New Sources"
                  placeholder={'One per line: YouTube channels (@handle or URL), playlist URLs, or video URLs.\nVideo URLs are grouped into one Hand-picked list.'} />
                <button disabled={busy}>Add Sources</button>
              </form>
            </div>
          </section>
        );
      })}
    </main>
  );
}
