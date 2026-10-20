export type Slot = { start: number; end: number; videoId: string; title: string; by: string };
export type Lineup = { id: number; name: string; slug: string; slots: Slot[] };
export type Source = { id: number; kind: 'youtube_channel' | 'playlist' | 'list'; label: string; share: number; videos: number };
export type Channel = {
  id: number;
  name: string;
  slug: string;
  position: number;
  ordering: 'shuffle' | 'new_first' | 'fixed';
  recent_ratio: number;
  recent_days: number;
  skip_shorts: number;
  skip_live: number;
  by_share: number;
  max_minutes: number | null;
  max_age_days: number | null;
  blocked_words: string;
  sources: Source[];
};

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

export async function api<T = null>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api/' + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
