import { useEffect, useState } from 'react';
import { api, setPassword, watched, watchedExactly } from './api.ts';
import Settings from './Settings.tsx';

// Devices and IPs linked into one person; see linkViewers on the server
type Viewer = {
  devices: { agent: string; last_at: number }[];
  ips: { ip: string; location: string }[];
  channels: { channel: string; seconds: number }[];
  seconds: number;
  last_at: number;
};

// "Chrome on Windows" from a User-Agent; order matters, since Edge and Opera also claim Chrome, and Chrome claims Safari
function deviceName(agent: string) {
  if (!agent) return 'Unknown device'; // tracked per IP before devices were
  const browser = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['SamsungBrowser', 'Samsung Internet'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']]
    .find(([k]) => agent.includes(k))?.[1] ?? 'Browser';
  const os = [['SMART-TV', 'Smart TV'], ['Tizen', 'Samsung TV'], ['Web0S', 'LG TV'], ['CrOS', 'ChromeOS'], ['Android', 'Android'], ['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Windows', 'Windows'], ['Mac OS', 'Mac'], ['Linux', 'Linux']]
    .find(([k]) => agent.includes(k))?.[1];
  return os ? `${browser} on ${os}` : browser;
}

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

// Viewing time per device, most-watched first, with its latest IP and a rough location
function Viewers() {
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Viewer[]>('admin/viewers').then(setViewers, e => setError(e.message)); }, []);

  return (
    <main className="settings">
      <header>
        <h1>Viewers</h1>
        <a href="/admin">Channels</a>
        <a href="/">Back to Channels</a>
      </header>
      {error && <p className="error">{error}</p>}
      {viewers === null ? !error && <p>Loading…</p>
        : !viewers.length ? <p>Nobody has watched anything yet.</p>
        : viewers.map((v, i) => (
          <section key={i} className="channel">
            <div className="row">
              <b>{[...new Set(v.devices.map(d => deviceName(d.agent)))].join(' · ')}</b>
              <small className="dim">last seen {new Date(v.last_at).toLocaleString()}</small>
              <b className="watched" title={watchedExactly(v.seconds)}>{watched(v.seconds)}</b>
            </div>
            <small className="dim">{v.ips.map(x => `${x.ip} (${x.location})`).join(' · ')}</small>
            <ul className="sources">
              {v.channels.map(c => <li key={c.channel}>{c.channel} <small title={watchedExactly(c.seconds)}>{watched(c.seconds)}</small></li>)}
            </ul>
          </section>
        ))}
    </main>
  );
}
