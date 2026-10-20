import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSources, timestamps } from './youtube.ts';

test('timestamps: the seconds a comment points at, each once', () => {
  assert.deepEqual(timestamps('0:45 lol\nand at 1:02:03, then 0:45 again'), [45, 3723]);
  assert.deepEqual(timestamps('not 12:345, 3:60 or 10:30pm'), []);
});

test('pasted lines: each YouTube channel and playlist stands alone, videos share one list', () => {
  assert.deepEqual(splitSources(`
    @LinusTechTips
    https://youtu.be/dQw4w9WgXcQ
    https://www.youtube.com/playlist?list=PL123
    https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw

    https://www.youtube.com/watch?v=9bZkp7q19f0
  `), [
    '@LinusTechTips',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw',
    'https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/watch?v=9bZkp7q19f0',
  ]);
  assert.deepEqual(splitSources(' \n '), []);
});
