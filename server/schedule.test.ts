import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb, type Db } from './db.ts';
import { queueNewUploads, schedule, type Channel } from './schedule.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 19, 20);

type V = [id: string, publishedAt: number, minutes: number, isShort?: number];

function setup(ordering: string) {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO channels (id, name, ordering) VALUES (1, 'Tech', ?)").run(ordering);
  return db;
}
function addSource(db: Db, kind: string, addedAt: number, videos: V[]) {
  const { id } = db.prepare("INSERT INTO sources (channel_id, kind, ref, label, added_at) VALUES (1, ?, '', '', ?) RETURNING id").get(kind, addedAt) as { id: number };
  videos.forEach(([v, published, minutes, short = 0], i) => {
    db.prepare("INSERT OR IGNORE INTO videos (id, title, channel_title, published_at, duration, is_short) VALUES (?, ?, 'LTT', ?, ?, ?)")
      .run(v, v, published, minutes * 60, short);
    db.prepare('INSERT INTO source_videos (source_id, video_id, position) VALUES (?, ?, ?)').run(id, v, i);
  });
}
const channel = (db: Db) => db.prepare('SELECT * FROM channels WHERE id = 1').get() as Channel;
const ids = (db: Db, to: number, now = NOW) => schedule(db, channel(db), NOW, to, now).map(s => s.videoId);
const recent = (...names: string[]): V[] => names.map(n => [n, NOW - DAY, 10]);

test('Shuffle airs every video once before any repeats', () => {
  const db = setup('shuffle');
  addSource(db, 'list', NOW - DAY, recent('a', 'b', 'c', 'd', 'e'));
  const first = ids(db, NOW + 50 * MIN);
  assert.equal(first.length, 5);
  assert.equal(new Set(first).size, 5);
});

test('Shuffle mixes recent videos and Back catalog at the set ratio', () => {
  const db = setup('shuffle');
  addSource(db, 'list', NOW - DAY, [...recent('r1', 'r2', 'r3', 'r4', 'r5', 'r6'), ['o1', NOW - 400 * DAY, 10], ['o2', NOW - 400 * DAY, 10]]);
  const blocks = ids(db, NOW + 400 * MIN).map(id => id[0]).join('').match(/.{4}/g)!;
  assert.equal(blocks.length, 10);
  for (const b of blocks) assert.equal(b.replace(/r/g, ''), 'o'); // one Back catalog video per 4
  assert.ok(new Set(blocks).size > 1, 'its spot in the block varies');
});

test('past and current Slots never change', () => {
  const db = setup('shuffle');
  addSource(db, 'list', NOW - DAY, recent('a', 'b', 'c'));
  ids(db, NOW + MIN);
  const before = ids(db, NOW + 30 * MIN, NOW + 15 * MIN); // Slots 1 and 2 are now stored
  addSource(db, 'list', NOW, recent('d', 'e', 'f'));
  assert.deepEqual(ids(db, NOW + 30 * MIN, NOW + 16 * MIN).slice(0, 2), before.slice(0, 2));
});

test('Fixed order plays Source by Source, YouTube channels oldest first, then loops', () => {
  const db = setup('fixed');
  addSource(db, 'youtube_channel', NOW - DAY, [['new', NOW - DAY, 10], ['old', NOW - 9 * DAY, 10]]);
  addSource(db, 'list', NOW - DAY, [['x', NOW - 5 * DAY, 10], ['y', NOW - 50 * DAY, 10]]);
  assert.deepEqual(ids(db, NOW + 50 * MIN), ['old', 'new', 'x', 'y', 'old']);
});

test('New uploads wait for Tune in, then air after the current Slot, oldest first', () => {
  const db = setup('new_first');
  addSource(db, 'youtube_channel', NOW - DAY, [
    ['old1', NOW - 9 * DAY, 10], ['old2', NOW - 8 * DAY, 10], ['new2', NOW - 6 * 60 * MIN, 10], ['new1', NOW - 12 * 60 * MIN, 10],
  ]);
  const before = ids(db, NOW + 40 * MIN);
  assert.ok(!before.some(id => id.startsWith('new')));
  queueNewUploads(db, channel(db));
  assert.deepEqual(ids(db, NOW + 40 * MIN).slice(0, 3), [before[0], 'new1', 'new2']);
});

test('Excluded videos never air on that Channel again', () => {
  const db = setup('shuffle');
  addSource(db, 'list', NOW - DAY, recent('a', 'b'));
  db.exec("INSERT INTO exclusions (channel_id, video_id) VALUES (1, 'a')");
  assert.deepEqual(ids(db, NOW + 30 * MIN), ['b', 'b', 'b']);
});

test('Filters keep Shorts, long videos and blocked words off a Channel', () => {
  const db = setup('shuffle');
  db.exec("UPDATE channels SET max_minutes = 60, blocked_words = 'Sponsor, q&a'");
  addSource(db, 'list', NOW - DAY, [['ok', NOW - DAY, 10], ['long', NOW - DAY, 90], ['short', NOW - DAY, 1, 1], ['my sponsor', NOW - DAY, 10]]);
  assert.deepEqual(ids(db, NOW + 30 * MIN), ['ok', 'ok', 'ok']);
});

test('Skip livestreams drops them from YouTube channel Sources but playlists keep theirs', () => {
  const db = setup('fixed');
  db.exec('UPDATE channels SET skip_live = 1');
  addSource(db, 'youtube_channel', NOW - DAY, [['vod', NOW - DAY, 10], ['stream', NOW - 2 * DAY, 10], ['both', NOW - 3 * DAY, 10]]);
  addSource(db, 'playlist', NOW - DAY, [['both', NOW - 3 * DAY, 10]]);
  db.exec("UPDATE videos SET is_live = 1 WHERE id IN ('stream', 'both')");
  assert.deepEqual(ids(db, NOW + 30 * MIN), ['vod', 'both', 'vod']);
});
