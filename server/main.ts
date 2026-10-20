import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { openDb } from './db.ts';
import { queueNewUploads, schedule, type Channel } from './schedule.ts';
import { comments, refreshChannel, refreshSource, replies, resolveSource, splitSources, timedComments, uploader, type Source } from './youtube.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? 'data';
const WEB = join(import.meta.dirname, '..', 'web', 'dist');
const HOUR = 3_600_000;
const WATCH_EVERY = 30; // seconds of playing each Screen reports at a time; matches the Player
const ORDERINGS =['shuffle', 'new_first', 'fixed'];
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(join(DATA_DIR, 'youtube-tv.db'));
if (!process.env.YOUTUBE_API_KEY) console.warn('YOUTUBE_API_KEY is not set: Sources cannot be added or refreshed');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set: Admin, and so Channel editing, is locked');

class BadRequest extends Error {}
class Unauthorized extends Error {}

// The page sends the password URI-encoded, since headers can't carry every character
const digest = (s: string) => createHash('sha256').update(s).digest();
function admin(handler: Route[2]): Route[2] {
  return (params, body, url, req) => {
    if (!ADMIN_PASSWORD) throw new Unauthorized('Set ADMIN_PASSWORD on the server to use Admin');
    // shortcut: no lockout after wrong guesses, add one if Admin is ever reachable from outside the home network
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${encodeURIComponent(ADMIN_PASSWORD)}`))) throw new Unauthorized('Wrong password');
    return handler(params, body, url, req);
  };
}

// The first X-Forwarded-For address when behind a reverse proxy; anyone can fake that header, which only skews Viewers
const clientIp = (req: IncomingMessage) =>
  (String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// Rough location per IP from ip-api.com (free, no key, up to 100 per call), kept until restart
const places = new Map<string, string>();
async function locate(ips: string[]) {
  const todo = ips.filter(ip => !places.has(ip)).slice(0, 100);
  if (todo.length) {
    const found = await fetch('http://ip-api.com/batch?fields=status,message,country,regionName,city,query', { method: 'POST', body: JSON.stringify(todo) })
      .then(r => r.json() as Promise<{ status: string; message?: string; country?: string; regionName?: string; city?: string; query: string }[]>)
      .catch(() => []);
    for (const f of found) places.set(f.query, f.status === 'success'
      ? [f.city, f.regionName, f.country].filter(Boolean).join(', ')
      : /private|reserved/.test(f.message ?? '') ? 'Home network' : 'Unknown');
  }
  return places;
}

const channels = () => db.prepare('SELECT * FROM channels ORDER BY position, id').all() as Channel[];
function channel(id: string) {
  const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(id)) as Channel | undefined;
  if (!c) throw new BadRequest('No such Channel');
  return c;
}
function name(v: unknown) {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest('Channel name is required');
  return v.trim().slice(0, 100);
}
// Each Channel's page address, e.g. "Tech" → tech-tv; the -tv ending keeps it clear of /settings and /api
function slug(channelName: string, id: number) {
  const base = channelName.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `channel-${id}`;
  return /(^|-)tv$/.test(base) ? base : `${base}-tv`;
}
function freeSlug(channelName: string, id: number) {
  const s = slug(channelName, id);
  if (channels().some(c => c.id !== id && slug(c.name, c.id) === s)) throw new BadRequest(`Another Channel already uses /${s}`);
  return channelName;
}
function num(v: unknown, min: number) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new BadRequest(`Expected a whole number of at least ${min}`);
  return n;
}

type Route = [method: string, path: RegExp, handler: (params: string[], body: any, url: URL, req: IncomingMessage) => unknown];
const routes: Route[] = [
  ['GET', /^\/api\/channels$/, admin(() => channels().map(c => ({
    ...c,
    slug: slug(c.name, c.id),
    sources: db.prepare(`
      SELECT id, kind, label, share, (SELECT COUNT(*) FROM source_videos WHERE source_id = sources.id) AS videos
      FROM sources WHERE channel_id = ? ORDER BY position, id`).all(c.id),
  })))],

  ['POST', /^\/api\/channels$/, admin((_, b) => db.prepare(
    'INSERT INTO channels (name, position) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM channels)) RETURNING id',
  ).get(freeSlug(name(b.name), 0)))],

  ['PUT', /^\/api\/channels\/(\d+)$/, admin(([id], b) => {
    const c = { ...channel(id), ...b };
    if (!ORDERINGS.includes(c.ordering)) throw new BadRequest('Unknown Ordering');
    db.prepare(`
      UPDATE channels SET name = ?, position = ?, ordering = ?, recent_ratio = ?, recent_days = ?,
        skip_shorts = ?, skip_live = ?, by_share = ?, max_minutes = ?, max_age_days = ?, blocked_words = ? WHERE id = ?`).run(
      freeSlug(name(c.name), Number(id)), num(c.position, 0) ?? 0, c.ordering, num(c.recent_ratio, 0) ?? 3, num(c.recent_days, 1) ?? 180,
      c.skip_shorts ? 1 : 0, c.skip_live ? 1 : 0, c.by_share ? 1 : 0, num(c.max_minutes, 1), num(c.max_age_days, 1), String(c.blocked_words ?? '').slice(0, 1000), Number(id));
    return null;
  })],

  ['DELETE', /^\/api\/channels\/(\d+)$/, admin(([id]) => {
    db.prepare('DELETE FROM channels WHERE id = ?').run(Number(id));
    return null;
  })],

  ['POST', /^\/api\/channels\/(\d+)\/sources$/, admin(async ([id], b) => {
    const c = channel(id);
    const inputs = splitSources(String(b.input ?? ''));
    if (!inputs.length) throw new BadRequest('Paste a YouTube channel, playlist or video');
    // Lines that can't be resolved come back so the page can leave them in the box to fix
    const failed: string[] = [], errors: string[] = [];
    for (const input of inputs) {
      let s;
      try {
        s = await resolveSource(input);
      } catch (e) {
        failed.push(input);
        errors.push(`${input.split('\n')[0]}: ${(e as Error).message}`);
        continue;
      }
      const src = db.prepare(`
        INSERT INTO sources (channel_id, kind, ref, label, position, added_at)
        VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM sources WHERE channel_id = ?), ?) RETURNING *`)
        .get(c.id, s.kind, s.ref, s.label, c.id, Date.now()) as Source;
      await refreshSource(db, src).catch(e => errors.push(`${s.label}: ${e.message}`));
    }
    return { failed: failed.join('\n'), error: errors.join('\n') };
  })],

  ['PUT', /^\/api\/sources\/(\d+)$/, admin(([id], b) => {
    db.prepare('UPDATE sources SET share = ? WHERE id = ?').run(Math.min(100, num(b.share, 1) ?? 50), Number(id));
    return null;
  })],

  ['DELETE', /^\/api\/sources\/(\d+)$/, admin(([id]) => {
    db.prepare('DELETE FROM sources WHERE id = ?').run(Number(id));
    return null;
  })],

  ['GET', /^\/api\/admin$/, admin(() => null)],

  ['GET', /^\/api\/admin\/viewers$/, admin(async () => {
    const rows = db.prepare(`
      SELECT w.ip, c.name AS channel, w.seconds, w.last_at FROM watch w JOIN channels c ON c.id = w.channel_id
      ORDER BY w.seconds DESC`).all() as { ip: string }[];
    const where = await locate([...new Set(rows.map(r => r.ip))]);
    return rows.map(r => ({ ...r, location: where.get(r.ip) ?? 'Unknown' }));
  })],

  ['POST', /^\/api\/channels\/(\d+)\/tune$/, ([id]) => {
    const c = channel(id);
    // Tuning in is what lets New uploads get queued, so check the Sources first (at most every 5 minutes)
    refreshChannel(db, c.id, 5 * 60_000).then(() => queueNewUploads(db, c)).catch(console.error);
    return null;
  }],

  // A playing Screen calls this every WATCH_EVERY seconds; calls sooner from the same IP and Channel don't add more
  ['POST', /^\/api\/channels\/(\d+)\/watch$/, ([id], _, __, req) => {
    db.prepare(`
      INSERT INTO watch (channel_id, ip, seconds, last_at) VALUES (?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET seconds = seconds + excluded.seconds, last_at = excluded.last_at
      WHERE excluded.last_at - last_at >= ?`).run(channel(id).id, clientIp(req), WATCH_EVERY, Date.now(), (WATCH_EVERY - 5) * 1000);
    return null;
  }],

  ['GET', /^\/api\/schedule$/, (_, __, url) => {
    const now = Date.now();
    const from = Number(url.searchParams.get('from') ?? now);
    const to = Number(url.searchParams.get('to') ?? now + 1);
    if (!(to > from) || to - from > 7 * 24 * HOUR) throw new BadRequest('Bad time range');
    const only = url.searchParams.get('channel');
    return {
      now,
      channels: channels().filter(c => !only || c.id === Number(only))
        .map(c => ({
          id: c.id, name: c.name, slug: slug(c.name, c.id), slots: schedule(db, c, from, to, now),
          watched: (db.prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM watch WHERE channel_id = ?').get(c.id) as { s: number }).s,
        })),
    };
  }],

  ['POST', /^\/api\/channels\/(\d+)\/exclusions$/, ([id], b) => {
    const c = channel(id);
    if (typeof b.videoId !== 'string' || !/^[\w-]{11}$/.test(b.videoId)) throw new BadRequest('Bad video id');
    db.prepare('INSERT OR IGNORE INTO exclusions (channel_id, video_id) VALUES (?, ?)').run(c.id, b.videoId);
    return null;
  }],

  ['GET', /^\/api\/videos\/([\w-]{11})\/uploader$/, ([id]) => uploader(id)],

  ['GET', /^\/api\/videos\/([\w-]{11})\/comments$/, ([id], _, url) =>
    comments(id, url.searchParams.get('page') ?? '', url.searchParams.get('order') === 'time' ? 'time' : 'relevance')],

  ['GET', /^\/api\/videos\/([\w-]{11})\/timed-comments$/, ([id]) => timedComments(id)],

  ['GET', /^\/api\/comments\/([\w-]+)\/replies$/, ([id], _, url) => replies(id, url.searchParams.get('page') ?? '')],

  ['POST', /^\/api\/videos\/([\w-]{11})\/broken$/, ([id]) => {
    db.prepare('UPDATE videos SET playable = 0 WHERE id = ?').run(id);
    return null;
  }],
];

async function readBody(req: IncomingMessage) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new BadRequest('Request too large');
  }
  try {
    return raw ? JSON.parse(raw) ?? {} : {};
  } catch {
    throw new BadRequest('Invalid JSON');
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
}

async function serveWeb(path: string, res: ServerResponse) {
  let file = join(WEB, path);
  let data = file.startsWith(WEB) ? await readFile(file).catch(() => null) : null;
  if (!data) data = await readFile((file = join(WEB, 'index.html'))); // the page handles its own routes
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) return await serveWeb(url.pathname, res);
    const route = routes.find(([method, path]) => method === req.method && path.test(url.pathname));
    if (!route) return send(res, 404, { error: 'Not found' });
    send(res, 200, await route[2](route[1].exec(url.pathname)!.slice(1), await readBody(req), url, req));
  } catch (e) {
    send(res, e instanceof BadRequest ? 400 : e instanceof Unauthorized ? 401 : 500, { error: (e as Error).message });
  }
}).listen(PORT, () => console.log(`Youtube TV on http://localhost:${PORT}`));

// Shuffle and Fixed order Channels pick up new videos from this; every Channel also refreshes on Tune in
setInterval(() => {
  for (const c of channels()) refreshChannel(db, c.id, HOUR - 60_000).catch(console.error);
}, HOUR);
