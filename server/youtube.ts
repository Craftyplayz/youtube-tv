import { WITHIN, type Db } from './db.ts';

export type Source = { id: number; channel_id: number; kind: 'youtube_channel' | 'playlist' | 'list'; ref: string; label: string; added_at: number };

const API = 'https://www.googleapis.com/youtube/v3/';

async function yt(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set on the server');
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  url.searchParams.set('key', key);
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`YouTube API ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Newest-first playlists (uploads) stop paging at the first page holding a video we already know
async function playlistItems(playlistId: string, known?: Set<string>): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';
  do {
    const page = await yt('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', pageToken });
    if (!page) break; // no such playlist, e.g. a YouTube channel without Shorts
    const batch: string[] = page.items.map((i: any) => i.contentDetails.videoId);
    ids.push(...batch);
    if (known && batch.some(id => known.has(id))) break;
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return ids;
}

function seconds(iso: string) {
  const [, d = '0', h = '0', m = '0', s = '0'] = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/.exec(iso) ?? [];
  return ((+d * 24 + +h) * 60 + +m) * 60 + +s;
}

async function saveVideos(db: Db, ids: string[], shorts: Set<string> | null) {
  const save = db.prepare(`
    INSERT INTO videos (id, title, channel_title, published_at, duration, is_short, playable) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, published_at = excluded.published_at,
      duration = excluded.duration, playable = excluded.playable`);
  for (let i = 0; i < ids.length; i += 50) {
    const page = await yt('videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(',') });
    for (const v of page?.items ?? []) {
      const duration = seconds(v.contentDetails.duration);
      // shortcut: outside YouTube channel Sources, Shorts are guessed as 60s or shorter; upgrade by checking the uploader's Shorts playlist
      const isShort = shorts ? shorts.has(v.id) : duration <= 60;
      const playable = v.status.embeddable && v.status.privacyStatus !== 'private'
        && v.snippet.liveBroadcastContent === 'none' && v.contentDetails.contentRating?.ytRating !== 'ytAgeRestricted';
      save.run(v.id, v.snippet.title, v.snippet.channelTitle, Date.parse(v.snippet.publishedAt), duration, isShort ? 1 : 0, playable ? 1 : 0);
    }
  }
}

export async function refreshSource(db: Db, src: Source) {
  const linked = (flag?: 'is_short' | 'is_live') => new Set((db.prepare(`
    SELECT sv.video_id FROM source_videos sv JOIN videos v ON v.id = sv.video_id
    WHERE sv.source_id = ? ${flag ? `AND v.${flag} = 1` : ''}`).all(src.id) as { video_id: string }[]).map(r => r.video_id));
  let ids: string[];
  let shorts: Set<string> | null = null;
  let lives: string[] = [];
  if (src.kind === 'youtube_channel') {
    // A YouTube channel's uploads playlist is its id with UC swapped for UU; UUSH holds just its Shorts, UULV its livestreams
    const tail = src.ref.slice(2);
    ids = await playlistItems('UU' + tail, linked());
    shorts = new Set(await playlistItems('UUSH' + tail, linked('is_short')));
    lives = await playlistItems('UULV' + tail, linked('is_live'));
  } else {
    ids = src.kind === 'playlist' ? await playlistItems(src.ref) : src.ref.split('\n');
  }
  const stored = db.prepare('SELECT duration FROM videos WHERE id = ?');
  // Unknown videos, plus live/upcoming ones (duration 0) that may have finished since
  await saveVideos(db, ids.filter(id => !(stored.get(id) as { duration: number } | undefined)?.duration), shorts);

  db.exec('BEGIN');
  try {
    // Playlists and lists are re-read in full, so their old membership and order are replaced
    if (src.kind !== 'youtube_channel') db.prepare('DELETE FROM source_videos WHERE source_id = ?').run(src.id);
    const link = db.prepare('INSERT OR IGNORE INTO source_videos (source_id, video_id, position) VALUES (?, ?, ?)');
    ids.forEach((id, i) => link.run(src.id, id, i));
    // Marked separately from saveVideos so streams saved before is_live existed get flagged too
    const markLive = db.prepare('UPDATE videos SET is_live = 1 WHERE id = ?');
    for (const id of lives) markLive.run(id);
    db.prepare('UPDATE sources SET refreshed_at = ? WHERE id = ?').run(Date.now(), src.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function refreshChannel(db: Db, channelId: number, olderThanMs: number) {
  const due = db.prepare(`${WITHIN} SELECT * FROM sources WHERE channel_id IN within AND refreshed_at < ?`).all(channelId, Date.now() - olderThanMs) as Source[];
  for (const s of due) await refreshSource(db, s).catch(e => console.error(`Refreshing ${s.label} failed: ${e.message}`));
}

// Who uploaded a video, for a Channel page's tab icon and the link under the title; remembered until the server restarts
const uploaders = new Map<string, Promise<{ channelId: string; avatar: string | null } | null>>();
export function uploader(videoId: string) {
  if (!uploaders.has(videoId)) uploaders.set(videoId, (async () => {
    const v = await yt('videos', { part: 'snippet', id: videoId });
    const channelId = v?.items?.[0]?.snippet.channelId;
    if (!channelId) return null;
    const c = await yt('channels', { part: 'snippet', id: channelId });
    return { channelId, avatar: c?.items?.[0]?.snippet.thumbnails?.default?.url ?? null };
  })().catch(e => {
    uploaders.delete(videoId); // a failed lookup is retried next time
    throw e;
  }));
  return uploaders.get(videoId)!;
}

const comment = (id: string, s: any, replies = 0) =>
  ({ id, author: s.authorDisplayName, avatar: s.authorProfileImageUrl, text: s.textDisplay, likes: s.likeCount, at: Date.parse(s.publishedAt), replies });

// One page of a video's top or newest comments for the player's Comments panel, or null when its uploader turned comments off
export async function comments(videoId: string, pageToken: string, order: 'relevance' | 'time' = 'relevance', max = 20) {
  try {
    const r = await yt('commentThreads', { part: 'snippet', videoId, order, maxResults: String(max), textFormat: 'plainText', pageToken });
    return {
      comments: (r?.items ?? []).map((t: any) => comment(t.id, t.snippet.topLevelComment.snippet, t.snippet.totalReplyCount)),
      next: r?.nextPageToken ?? null,
    };
  } catch (e) {
    if ((e as Error).message.includes('commentsDisabled')) return null;
    throw e;
  }
}

// The seconds a comment points at, like 2:34 or 1:02:03, each once
export function timestamps(text: string) {
  return [...new Set([...text.matchAll(/\b(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)\b/g)].map(([, h = '0', m, s]) => (+h * 60 + +m) * 60 + +s))];
}

// Top comments that point at a moment in their video, soonest first, for Timed comments; remembered until the server restarts
const timed = new Map<string, Promise<{ second: number; comment: ReturnType<typeof comment> }[]>>();
export function timedComments(videoId: string) {
  if (!timed.has(videoId)) timed.set(videoId, (async () => {
    const found: { second: number; comment: ReturnType<typeof comment> }[] = [];
    let pageToken = '';
    // shortcut: reads only the top 300 comments (3 quota units per video); read more pages if good ones are missed
    for (let i = 0; i < 3; i++) {
      const page = await comments(videoId, pageToken, 'relevance', 100);
      for (const c of page?.comments ?? []) {
        const seconds = timestamps(c.text);
        if (seconds.length <= 3) for (const second of seconds) found.push({ second, comment: c }); // more is a chapter list, not a reaction
      }
      if (!page?.next) break;
      pageToken = page.next;
    }
    return found.sort((a, b) => a.second - b.second);
  })().catch(e => {
    timed.delete(videoId); // a failed lookup is retried next time
    throw e;
  }));
  return timed.get(videoId)!;
}

// One page of the replies under a comment
export async function replies(parentId: string, pageToken: string) {
  const r = await yt('comments', { part: 'snippet', parentId, maxResults: '20', textFormat: 'plainText', pageToken });
  return { comments: (r?.items ?? []).map((c: any) => comment(c.id, c.snippet)), next: r?.nextPageToken ?? null };
}

// A pasted block, one Source per line: each YouTube channel or playlist line stands alone, every other line joins one hand-picked list
export function splitSources(input: string): string[] {
  const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
  const own = (l: string) => /[?&]list=|\bUC[\w-]{22}\b|@[\w.-]/.test(l);
  const videos = lines.filter(l => !own(l));
  return [...lines.filter(own), ...(videos.length ? [videos.join('\n')] : [])];
}

// Turns whatever was pasted into the settings page into a Source
export async function resolveSource(input: string): Promise<Pick<Source, 'kind' | 'ref' | 'label'>> {
  const text = input.trim();
  const playlist = /[?&]list=([\w-]+)/.exec(text)?.[1];
  if (playlist) {
    const p = await yt('playlists', { part: 'snippet', id: playlist });
    if (!p?.items?.length) throw new Error('Playlist not found (private playlists cannot be used)');
    return { kind: 'playlist', ref: playlist, label: p.items[0].snippet.title };
  }
  const id = /\b(UC[\w-]{22})\b/.exec(text)?.[1];
  const handle = /@([\w.-]+)/.exec(text)?.[1];
  if (id || handle) {
    const c = await yt('channels', id ? { part: 'snippet', id } : { part: 'snippet', forHandle: '@' + handle });
    if (!c?.items?.length) throw new Error('YouTube channel not found');
    return { kind: 'youtube_channel', ref: c.items[0].id, label: c.items[0].snippet.title };
  }
  const videos = text.split(/[\s,]+/)
    .map(t => /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/.exec(t)?.[1] ?? (/^[\w-]{11}$/.test(t) ? t : ''))
    .filter(Boolean);
  if (!videos.length) throw new Error("Couldn't find a YouTube channel, playlist or video in that");
  const unique = [...new Set(videos)];
  return { kind: 'list', ref: unique.join('\n'), label: `${unique.length} hand-picked video${unique.length > 1 ? 's' : ''}` };
}
