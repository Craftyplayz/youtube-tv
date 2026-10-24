import { useEffect, useState } from 'react';
import { api, setPassword, watched, watchedExactly, type Totals } from './api.ts';
import Settings from './Settings.tsx';
import { Summary, VideoList } from './Stats.tsx';

// Devices and IPs linked into one person; see linkViewers on the server
type Viewer = {
  key: string; // one of their devices, for the address of their stats page
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

// Asks for the Admin password, then shows Channel editing, Viewers, one Viewer's stats, or the whole Household's
export default function Admin({ page, viewer }: { page: 'channels' | 'viewers' | 'viewer' | 'household'; viewer?: string }) {
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
  if (ok) return page === 'viewers' ? <Viewers /> : page === 'viewer' ? <Stats viewer={viewer} /> : page === 'household' ? <Stats /> : <Settings />;
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
        <a href="/admin/household">Household stats</a>
        <a href="/admin">Channels</a>
        <a href="/">Back to Channels</a>
      </header>
      {error && <p className="error">{error}</p>}
      {viewers === null ? !error && <p>Loading…</p>
        : !viewers.length ? <p>Nobody has watched anything yet.</p>
        : viewers.map((v, i) => (
          <section key={i} className="channel">
            <div className="row">
              <a href={`/admin/viewers/${encodeURIComponent(v.key)}`} title="See their stats"><b>{[...new Set(v.devices.map(d => deviceName(d.agent)))].join(' · ')}</b></a>
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

type Breakdown = Totals & { channels: (Totals & { id: number; name: string })[] };
type ViewerStats = Breakdown & { devices: { agent: string; last_at: number }[]; ips: { ip: string; location: string }[]; last_at: number };

// One Viewer's stats, or the whole Household's with no viewer: time and views per Channel, then the most viewed videos
// on whichever Channel is picked, or across every Channel
function Stats({ viewer }: { viewer?: string }) {
  const base = viewer ? `admin/viewers/${encodeURIComponent(viewer)}` : 'admin/household';
  const [stats, setStats] = useState<ViewerStats | Breakdown | null>(null);
  const [channel, setChannel] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<ViewerStats | Breakdown>(base).then(setStats, e => setError(e.message)); }, [base]);

  const who = stats && 'devices' in stats ? stats : null;
  const picked = stats?.channels.find(c => c.id === channel);
  return (
    <main className="settings">
      <header>
        <h1>{viewer ? 'Viewer' : 'Household'}</h1>
        <a href="/admin/viewers">Viewers</a>
        <a href="/">Back to Channels</a>
      </header>
      {error && <p className="error">{error}</p>}
      {stats === null ? !error && <p>Loading…</p> : (
        <>
          {who && (
            <section className="channel">
              <b>{[...new Set(who.devices.map(d => deviceName(d.agent)))].join(' · ')}</b>
              <small className="dim">last seen {new Date(who.last_at).toLocaleString()}</small>
              <small className="dim">{who.ips.map(x => `${x.ip} (${x.location})`).join(' · ')}</small>
            </section>
          )}
          <div className="summaries"><Summary label="All Channels" t={stats} /></div>
          <h2>Channels</h2>
          <ul className="picker">
            <li><button className={channel === null ? 'on' : ''} onClick={() => setChannel(null)}><b>All Channels</b></button></li>
            {stats.channels.map(c => (
              <li key={c.id}>
                <button className={channel === c.id ? 'on' : ''} onClick={() => setChannel(c.id)}>
                  <b>{c.name}</b>
                  <small title={watchedExactly(c.seconds)}>{watched(c.seconds)}</small>
                  <small>{c.views.toLocaleString()} views</small>
                </button>
              </li>
            ))}
          </ul>
          <h2>Most viewed {picked ? `on ${picked.name}` : 'across all Channels'}</h2>
          <VideoList key={channel ?? 'all'} path={`${viewer ? `${base}/videos` : 'admin/videos'}?channel=${channel ?? ''}`}
            compare={viewer ? 'household' : undefined} />
        </>
      )}
    </main>
  );
}
