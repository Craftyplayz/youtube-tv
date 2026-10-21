import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkViewers } from './viewers.ts';

test('a device on two IPs, and an IP on two devices, make one Viewer', () => {
  const viewerOf = linkViewers([
    { device: 'pc', ip: 'vpn' },      // PC on the VPN
    { device: 'phone', ip: 'home' },  // phone at home: a new Viewer so far
    { device: 'pc', ip: 'home' },     // PC without the VPN joins them all
    { device: 'tv', ip: 'neighbour' },
  ]);
  assert.equal(viewerOf('pc'), viewerOf('phone'));
  assert.notEqual(viewerOf('pc'), viewerOf('tv'));
  assert.notEqual(viewerOf('unseen'), viewerOf('pc'));
});
