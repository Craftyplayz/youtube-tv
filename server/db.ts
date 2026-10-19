import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      ordering TEXT NOT NULL DEFAULT 'shuffle',   -- shuffle | new_first | fixed
      recent_ratio INTEGER NOT NULL DEFAULT 3,    -- recent videos per Back catalog video
      recent_days INTEGER NOT NULL DEFAULT 180,
      skip_shorts INTEGER NOT NULL DEFAULT 1,
      max_minutes INTEGER,
      max_age_days INTEGER,
      blocked_words TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                         -- youtube_channel | playlist | list
      ref TEXT NOT NULL,                          -- YouTube channel id, playlist id, or newline-separated video ids
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      refreshed_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel_title TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      duration INTEGER NOT NULL,                  -- seconds; 0 while live or upcoming
      is_short INTEGER NOT NULL DEFAULT 0,
      playable INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS source_videos (
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (source_id, video_id)
    );
    CREATE TABLE IF NOT EXISTS slots (
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, start_at)
    );
    CREATE TABLE IF NOT EXISTS queue (
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, video_id)
    );
  `);
  return db;
}
