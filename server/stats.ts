import type { Db } from './db.ts';
import { linkViewers } from './viewers.ts';

export const PAGE = 50; // videos per page of a most-viewed list

// Every device of the Viewer a device belongs to; the device itself even if it has never been seen
export function viewerDevices(db: Db, device: string) {
  const sightings = db.prepare('SELECT device, ip FROM sightings').all() as { device: string; ip: string }[];
  const viewerOf = linkViewers(sightings);
  const me = viewerOf(device);
  return [...new Set([device, ...sightings.map(s => s.device).filter(d => viewerOf(d) === me)])];
}

const marks = (list: unknown[]) => list.map(() => '?').join(', ');

// Viewing time and views on one Channel, or every Channel with no channel given, for some devices or everyone
export function totals(db: Db, devices: string[] | null, channel: number | null) {
  if (devices?.length === 0) return { seconds: 0, views: 0 };
  const where = (table: string) => [
    channel === null ? '' : `${table}.channel_id = ?`,
    devices === null ? '' : `${table}.device IN (${marks(devices)})`,
  ].filter(Boolean).join(' AND ') || '1';
  const args = [...channel === null ? [] : [channel], ...devices ?? []];
  return {
    seconds: (db.prepare(`SELECT COALESCE(SUM(seconds), 0) AS n FROM views WHERE ${where('views')}`).get(...args) as { n: number }).n,
    views: (db.prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM plays WHERE ${where('plays')}`).get(...args) as { n: number }).n,
  };
}

export type VideoViews = { videoId: string; title: string; by: string; views: number; everyone: number; last_at: number };

// One page of videos, most viewed first, for some devices (or everyone) on one Channel (or all of them, a video aired on
// several counting once); everyone is the whole household's views of the same video in the same scope
export function topVideos(db: Db, devices: string[] | null, channel: number | null, offset: number): VideoViews[] {
  if (devices?.length === 0) return [];
  const inChannel = (t: string) => channel === null ? '' : ` AND ${t}.channel_id = ${Number(channel)}`;
  return db.prepare(`
    SELECT p.video_id AS videoId, COALESCE(v.title, p.video_id) AS title, COALESCE(v.channel_title, '') AS by,
      SUM(p.count) AS views, MAX(p.last_at) AS last_at,
      (SELECT SUM(q.count) FROM plays q WHERE q.video_id = p.video_id${inChannel('q')}) AS everyone
    FROM plays p LEFT JOIN videos v ON v.id = p.video_id
    WHERE ${devices === null ? '1' : `p.device IN (${marks(devices)})`}${inChannel('p')}
    GROUP BY p.video_id ORDER BY views DESC, last_at DESC, p.video_id LIMIT ${PAGE} OFFSET ?`)
    .all(...devices ?? [], Math.max(0, Math.floor(offset) || 0)) as VideoViews[];
}
