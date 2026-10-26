import type { ServerResponse } from 'node:http';
import type { Slot } from './schedule.ts';

// What every Screen in a Room plays: `time` seconds into `slot` at server time `at`, moving on from there unless paused
export type RoomState = { channel: number; slot: Slot | null; time: number; paused: boolean; at: number };
export type Room = { host: string; hostOnly: boolean; state: RoomState; screens: Map<ServerResponse, string> };

// shortcut: Rooms live in memory, so a restart ends them all; store them in the db if Rooms should survive redeploys
export const rooms = new Map<string, Room>();

export function createRoom(host: string, state: RoomState) {
  let id;
  do id = Math.random().toString(36).slice(2, 8); while (rooms.has(id));
  rooms.set(id, { host, hostOnly: false, state, screens: new Map() });
  return id;
}

const sameSlot = (a: Slot | null, b: Slot | null) => a?.videoId === b?.videoId && a?.start === b?.start;

// A Screen moving on by itself (its video ended) names the Slot it moved on from, and anyone may report that, but only
// the first report counts; anything else is someone pressing a control
export function update(room: Room, device: string, state: RoomState, after?: Slot | null) {
  if (after !== undefined) {
    if (!sameSlot(room.state.slot, after)) return false;
  } else if (room.hostOnly && device !== room.host) return null;
  room.state = state;
  return true;
}

export function broadcast(room: Room) {
  for (const [res, device] of room.screens) {
    const msg = { state: room.state, hostOnly: room.hostOnly, members: room.screens.size, host: device === room.host };
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
}
