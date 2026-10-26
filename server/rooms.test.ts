import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoom, rooms, update, type RoomState } from './rooms.ts';

const slot = (start: number) => ({ start, end: start + 60_000, videoId: 'aaaaaaaaaaa', title: 'A', by: 'Ann' });
const at = (s: number): RoomState => ({ channel: 1, slot: slot(s), time: 0, paused: false, at: 0 });

test('everyone controls until the host says only they do', () => {
  const room = rooms.get(createRoom('host', at(0)))!;
  assert.equal(update(room, 'guest', { ...at(0), paused: true }), true);
  room.hostOnly = true;
  assert.equal(update(room, 'guest', at(0)), null);
  assert.equal(room.state.paused, true);
  assert.equal(update(room, 'host', at(0)), true);
});

test('only the first Screen to move on from a Slot counts, whoever it is', () => {
  const room = rooms.get(createRoom('host', at(0)))!;
  room.hostOnly = true;
  assert.equal(update(room, 'guest', at(60_000), slot(0)), true);
  assert.equal(update(room, 'other', at(60_000), slot(0)), false);
  assert.deepEqual(room.state.slot, slot(60_000));
});
