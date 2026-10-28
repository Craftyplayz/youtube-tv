export type Slot = { start: number; end: number; videoId: string; title: string; by: string };
export type Lineup = { id: number; name: string; slug: string; parent: number | null; slots: Slot[]; watched: number; views: number };
export type Source = { id: number; kind: 'youtube_channel' | 'playlist' | 'list'; label: string; share: number; videos: number };
export type Channel = {
  id: number;
  name: string;
  slug: string;
  position: number;
  ordering: 'shuffle' | 'new_first' | 'fixed' | 'release';
  recent_ratio: number;
  recent_days: number;
  skip_shorts: number;
  skip_live: number;
  by_share: number;
  by_age: number;
  max_minutes: number | null;
  max_age_days: number | null;
  blocked_words: string;
  parent_id: number | null;
  sources: Source[];
};

// Viewing time and views, for one Viewer or everyone
export type Totals = { seconds: number; views: number };
export type VideoViews = { videoId: string; title: string; by: string; views: number; everyone: number };

export const thumb = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

// The tab's icon: the YouTube logo, or on a Channel page the avatar of whoever uploaded the video playing
export function setIcon(href = '/favicon.svg') {
  document.querySelector<HTMLLinkElement>('link[rel=icon]')!.href = href;
}

// Switches page without reloading, so the click still counts as the gesture browsers require before playing sound
export function go(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

let skew = 0; // server clock minus this machine's clock, so every Screen agrees on what is Live
export const now = () => Date.now() + skew;

// Viewing time, rounded for reading: "45 min", "12.5 hours", "10.7 days"
export const watched = (seconds: number) =>
  seconds < 3600 ? `${Math.round(seconds / 60)} min`
    : seconds < 86_400 ? `${(seconds / 3600).toFixed(1)} hours`
    : `${(seconds / 86_400).toFixed(1)} days`;

// The same exactly, for hovering: "254 hours 11 minutes"
export function watchedExactly(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60;
  return [h && `${h} hour${h === 1 ? '' : 's'}`, `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}

// Tells this browser apart in Viewers; randomUUID needs HTTPS, which a home server usually lacks
export const device = (() => {
  const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const d = localStorage.getItem('device') ?? fresh;
    localStorage.setItem('device', d);
    return d;
  } catch {
    return fresh; // storage blocked: a new device each visit
  }
})();

// The Admin password, remembered on this Screen once it's right
let password = '';
try { password = localStorage.getItem('adminPassword') ?? ''; } catch { /* storage blocked */ }
export function setPassword(p: string) {
  password = p;
  try { localStorage.setItem('adminPassword', p); } catch { /* storage blocked */ }
}

export async function api<T = null>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api/' + path, {
    method,
    headers: {
      ...body === undefined ? {} : { 'content-type': 'application/json' },
      ...password ? { authorization: `Bearer ${encodeURIComponent(password)}` } : {},
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export async function schedule(from: number, to: number, channel?: number) {
  const r = await api<{ now: number; channels: Lineup[] }>(`schedule?from=${Math.round(from)}&to=${Math.round(to)}${channel ? `&channel=${channel}` : ''}`);
  skew = r.now - Date.now();
  return r.channels;
}
