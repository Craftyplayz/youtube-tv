import { useEffect, useState } from 'react';
import { api, setPassword, watched } from './api.ts';
import Settings from './Settings.tsx';

type Row = { ip: string; location: string; channel: string; seconds: number; last_at: number };

// Asks for the Admin password, then shows Channel editing or Viewers
export default function Admin({ page }: { page: 'channels' | 'viewers' }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  // The first check runs with no password typed yet, so it only says why when that's not just a wrong password
  const check = (first = false) => api('admin').then(() => setOk(true), e => {
    setOk(false);
    if (!first || e.message !== 'Wrong password') setError(e.message);
  });
  useEffect(() => {
    document.title = 'Admin · Youtube TV';
    check(true);
  }, []);

  if (ok === null) return <main className="settings"><p>Loading…</p></main>;
  if (ok) return page === 'viewers' ? <Viewers /> : <Settings />;
  return (
    <main className="settings">
      <header>
        <h1>Admin</h1>
        <a href="/">Back to Channels</a>
      </header>
      <form className="login" onSubmit={e => {
        e.preventDefault();
        setPassword((e.currentTarget.elements.namedItem('password') as HTMLInputElement).value);
        check();
      }}>
        <input name="password" type="password" autoFocus required placeholder="Password" aria-label="Admin password" />
        <button>Log in</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

// Viewing time per IP, most-watched first, with a rough location for each
function Viewers() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Row[]>('admin/viewers').then(setRows, e => setError(e.message)); }, []);

  const ips = new Map<string, Row[]>();
  for (const r of rows ?? []) ips.set(r.ip, [...ips.get(r.ip) ?? [], r]);
  const total = (list: Row[]) => list.reduce((a, r) => a + r.seconds, 0);

  return (
    <main className="settings">
      <header>
        <h1>Viewers</h1>
        <a href="/admin">Channels</a>
        <a href="/">Back to Channels</a>
      </header>
      {error && <p className="error">{error}</p>}
      {rows === null ? !error && <p>Loading…</p>
        : !rows.length ? <p>Nobody has watched anything yet.</p>
        : [...ips].sort(([, a], [, b]) => total(b) - total(a)).map(([ip, list]) => (
          <section key={ip} className="channel">
            <div className="row">
              <b>{ip}</b>
              <small className="dim">{list[0].location} · last seen {new Date(Math.max(...list.map(r => r.last_at))).toLocaleString()}</small>
              <b className="watched">{watched(total(list))}</b>
            </div>
            <ul className="sources">
              {list.map(r => <li key={r.channel}>{r.channel} <small>{watched(r.seconds)}</small></li>)}
            </ul>
          </section>
        ))}
    </main>
  );
}
