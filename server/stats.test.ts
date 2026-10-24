import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from './db.ts';
import { topVideos, totals, viewerDevices } from './stats.ts';

function household() {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO channels (id, name) VALUES (1, 'Tech'), (2, 'Cooking');
    INSERT INTO videos (id, title, channel_title, published_at, duration) VALUES ('aaaaaaaaaaa', 'A', 'Ann', 0, 60), ('bbbbbbbbbbb', 'B', 'Bob', 0, 60);
    INSERT INTO sightings VALUES ('pc', 'home'), ('phone', 'home'), ('tv', 'neighbour');
    INSERT INTO views VALUES (1, 'pc', '', 600, 1), (1, 'tv', '', 60, 1), (2, 'phone', '', 120, 1);
    INSERT INTO plays VALUES
      (1, 'pc', 'aaaaaaaaaaa', 1, 1), (1, 'pc', 'bbbbbbbbbbb', 3, 1), (1, 'tv', 'aaaaaaaaaaa', 5, 1),
      (2, 'phone', 'aaaaaaaaaaa', 2, 1);`);
  return db;
}

test('a Viewer is every device linked to theirs', () => {
  assert.deepEqual(viewerDevices(household(), 'phone').sort(), ['pc', 'phone']);
  assert.deepEqual(viewerDevices(household(), 'unseen'), ['unseen']);
});

test('totals count one Viewer or everyone, on one Channel or all', () => {
  const db = household();
  assert.deepEqual(totals(db, null, 1), { seconds: 660, views: 9 });
  assert.deepEqual(totals(db, ['pc', 'phone'], 1), { seconds: 600, views: 4 });
  assert.deepEqual(totals(db, ['pc', 'phone'], null), { seconds: 720, views: 6 });
  assert.deepEqual(totals(db, [], null), { seconds: 0, views: 0 });
});

test('most viewed first, with the whole Household alongside, a video on several Channels counting once', () => {
  const db = household();
  const tech = topVideos(db, ['pc', 'phone'], 1, 0).map(v => [v.videoId, v.views, v.everyone]);
  assert.deepEqual(tech, [['bbbbbbbbbbb', 3, 3], ['aaaaaaaaaaa', 1, 6]]);
  const all = topVideos(db, ['pc', 'phone'], null, 0).map(v => [v.title, v.views, v.everyone]);
  assert.deepEqual(all, [['A', 3, 8], ['B', 3, 3]]);
  assert.deepEqual(topVideos(db, null, null, 0).map(v => [v.title, v.views]), [['A', 8], ['B', 3]]);
  assert.deepEqual(topVideos(db, null, null, 50), []);
});
