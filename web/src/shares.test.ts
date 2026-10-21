import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rebalance } from './shares.ts';

const shares = (sources: { share: number }[]) => sources.map(s => s.share);

test('moving one slider fills the rest from the others, in proportion', () => {
  assert.deepEqual(shares(rebalance([{ id: 1, share: 5 }, { id: 2, share: 50 }], 1, 30)), [30, 70]);
  assert.deepEqual(shares(rebalance([{ id: 1, share: 50 }, { id: 2, share: 20 }, { id: 3, share: 60 }], 1, 40)), [40, 15, 45]);
});

test('no Source drops below 1', () => {
  assert.deepEqual(shares(rebalance([{ id: 1, share: 50 }, { id: 2, share: 50 }, { id: 3, share: 50 }], 1, 100)), [98, 1, 1]);
});
