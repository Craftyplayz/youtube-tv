export type Slot = { start: number; end: number; videoId: string; title: string; by: string };
export type Lineup = { id: number; name: string; slots: Slot[] };
export type Source = { id: number; kind: 'youtube_channel' | 'playlist' | 'list'; label: string; videos: number };
export type Channel = {
  id: number;
  name: string;
  position: number;
  ordering: 'shuffle' | 'new_first' | 'fixed';
  recent_ratio: number;
  recent_days: number;
  skip_shorts: number;
  max_minutes: number | null;
  max_age_days: number | null;
  blocked_words: string;
  sources: Source[];
};

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
