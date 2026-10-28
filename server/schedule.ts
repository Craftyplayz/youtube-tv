import { WITHIN, type Db } from './db.ts';

const DAY = 86_400_000;

export type Channel = {
  id: number;
  name: string;
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
};
export type Slot = { start: number; end: number; videoId: string; title: string; by: string };

type Video = { id: string; title: string; channel_title: string; published_at: number; duration: number; is_short: number; added_at: number; source_id: number; share: number };
type State = { n: number; counts: Map<string, number>; queue: string[]; last: string | null };

// Videos the Channel's Filters allow from its own Sources and its Group's, in Fixed order (or Release order) sequence
function pool(db: Db, ch: Channel, now: number): Video[] {
  const rows = db.prepare(`${WITHIN}
    SELECT v.id, v.title, v.channel_title, v.published_at, v.duration, v.is_short, s.added_at, s.id AS source_id, s.share
    FROM sources s JOIN channels c ON c.id = s.channel_id JOIN source_videos sv ON sv.source_id = s.id JOIN videos v ON v.id = sv.video_id
    WHERE s.channel_id IN within AND v.playable = 1 AND v.duration > 0
      AND NOT EXISTS (SELECT 1 FROM exclusions e WHERE e.channel_id = ? AND e.video_id = v.id)
      -- Skipped per row, so a stream also in one of the Channel's playlists still airs from there
      AND NOT (? AND s.kind = 'youtube_channel' AND v.is_live = 1)
    ORDER BY c.position, c.id, s.position, s.id, CASE s.kind WHEN 'youtube_channel' THEN v.published_at ELSE sv.position END`).all(ch.id, ch.id, ch.skip_live) as Video[];
  if (ch.ordering === 'release') rows.sort((a, b) => a.published_at - b.published_at);
  const words = ch.blocked_words.toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
  const seen = new Set<string>();
  return rows.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    const title = v.title.toLowerCase();
    return !(ch.skip_shorts && v.is_short)
      && !(ch.max_minutes && v.duration > ch.max_minutes * 60)
      && !(ch.max_age_days && v.published_at < now - ch.max_age_days * DAY)
      && !words.some(w => title.includes(w));
  });
}

function loadState(db: Db, ch: Channel): State {
  const counts = new Map<string, number>();
  const rows = db.prepare('SELECT video_id, COUNT(*) AS c FROM slots WHERE channel_id = ? GROUP BY video_id').all(ch.id) as { video_id: string; c: number }[];
  for (const r of rows) counts.set(r.video_id, r.c);
  const last = db.prepare('SELECT video_id FROM slots WHERE channel_id = ? ORDER BY start_at DESC LIMIT 1').get(ch.id) as { video_id: string } | undefined;
  const queue = db.prepare('SELECT q.video_id FROM queue q JOIN videos v ON v.id = q.video_id WHERE q.channel_id = ? ORDER BY v.published_at').all(ch.id) as { video_id: string }[];
  return { n: rows.reduce((a, r) => a + r.c, 0), counts, queue: queue.map(r => r.video_id), last: last?.video_id ?? null };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick(ch: Channel, videos: Video[], s: State, at: number): Video | undefined {
  if (!videos.length) return undefined;
  if (ch.ordering === 'fixed' || ch.ordering === 'release') return videos[(videos.findIndex(v => v.id === s.last) + 1) % videos.length];
  if (ch.ordering === 'new_first') {
    const queued = s.queue.map(id => videos.find(v => v.id === id)).find(v => v);
    if (queued) return queued;
    // New uploads that aren't queued yet wait for someone to Tune in
    videos = videos.filter(v => !(v.published_at > v.added_at && !s.counts.has(v.id)));
  }
  if (ch.by_share) {
    // Draw a Source first, weighted by Share, so a small playlist can air as often as a big one; its videos then repeat sooner
    const shares = new Map(videos.map(v => [v.source_id, v.share]));
    let r = hash(`${s.n}:source:${ch.id}`) / 2 ** 32 * [...shares.values()].reduce((a, w) => a + w, 0);
    const source = [...shares].find(([, w]) => (r -= w) < 0)?.[0];
    videos = videos.filter(v => v.source_id === source);
  }
  let group = videos;
  if (ch.by_age) {
    const cutoff = at - ch.recent_days * DAY;
    const recent = videos.filter(v => v.published_at >= cutoff);
    const back = videos.filter(v => v.published_at < cutoff);
    // One Back catalog Slot per block of ratio + 1, at a seeded spot in the block so it isn't exactly every nth Slot
    const size = ch.recent_ratio + 1;
    // Block number goes first so the rest of the string mixes it; FNV barely mixes a change at the end
    const spot = Math.floor(hash(`${Math.floor(s.n / size)}:block:${ch.id}`) / 2 ** 32 * size);
    group = s.n % size === spot ? back : recent;
    if (!group.length) group = group === back ? recent : back;
  }
  // No repeats: only the least-aired videos are eligible, and a seeded hash picks among them so the result is repeatable
  const min = group.reduce((m, v) => Math.min(m, s.counts.get(v.id) ?? 0), Infinity);
  let best: Video | undefined;
  let bestHash = Infinity;
  for (const v of group) {
    if ((s.counts.get(v.id) ?? 0) !== min) continue;
    const h = hash(`${ch.id}:${s.n}:${v.id}`);
    if (h < bestHash) [best, bestHash] = [v, h];
  }
  return best;
}

function advance(s: State, v: Video) {
  s.n++;
  s.counts.set(v.id, (s.counts.get(v.id) ?? 0) + 1);
  s.last = v.id;
  s.queue = s.queue.filter(id => id !== v.id);
}

const slot = (v: Video, start: number): Slot => ({ start, end: start + v.duration * 1000, videoId: v.id, title: v.title, by: v.channel_title });

// Stores every Slot up to the one airing at `now`; returns when the next Slot starts. Stored Slots never change.
function commit(db: Db, ch: Channel, videos: Video[], s: State, now: number): number {
  const last = db.prepare('SELECT end_at FROM slots WHERE channel_id = ? ORDER BY start_at DESC LIMIT 1').get(ch.id) as { end_at: number } | undefined;
  // shortcut: after more than a day with no Slots (server off, Channel empty) the gap stays off air instead of being back-filled
  let t = last && now - last.end_at < DAY ? last.end_at : now;
  const insert = db.prepare('INSERT INTO slots (channel_id, start_at, end_at, video_id) VALUES (?, ?, ?, ?)');
  const dequeue = db.prepare('DELETE FROM queue WHERE channel_id = ? AND video_id = ?');
  db.exec('BEGIN');
  try {
    while (t <= now) {
      const v = pick(ch, videos, s, t);
      if (!v) break;
      insert.run(ch.id, t, t + v.duration * 1000, v.id);
      dequeue.run(ch.id, v.id);
      advance(s, v);
      t += v.duration * 1000;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return t;
}

export function schedule(db: Db, ch: Channel, from: number, to: number, now = Date.now()): Slot[] {
  const videos = pool(db, ch, now);
  const s = loadState(db, ch);
  let t = commit(db, ch, videos, s, now);
  const slots = db.prepare(`
    SELECT sl.start_at AS start, sl.end_at AS end, sl.video_id AS videoId, v.title, v.channel_title AS by
    FROM slots sl JOIN videos v ON v.id = sl.video_id
    WHERE sl.channel_id = ? AND sl.end_at > ? AND sl.start_at < ? ORDER BY sl.start_at`).all(ch.id, from, to) as Slot[];
  // Upcoming Slots are projected, not stored, so they can change (docs/adr/0001)
  while (t < to) {
    const v = pick(ch, videos, s, t);
    if (!v) break;
    if (t + v.duration * 1000 > from) slots.push(slot(v, t));
    advance(s, v);
    t += v.duration * 1000;
  }
  return slots;
}

// A New upload waits until someone Tunes in, then airs right after the current Slot
export function queueNewUploads(db: Db, ch: Channel) {
  if (ch.ordering !== 'new_first') return;
  db.prepare(`${WITHIN}
    INSERT OR IGNORE INTO queue (channel_id, video_id)
    SELECT ?, v.id FROM sources s
    JOIN source_videos sv ON sv.source_id = s.id JOIN videos v ON v.id = sv.video_id
    WHERE s.channel_id IN within AND v.published_at > s.added_at
      AND NOT EXISTS (SELECT 1 FROM slots WHERE channel_id = ? AND video_id = v.id)`).run(ch.id, ch.id, ch.id);
}
