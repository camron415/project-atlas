import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function getDb(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "atlas.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 99,
      status TEXT NOT NULL,
      path TEXT,
      target_path TEXT,
      report_cadence TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_scanned_at TEXT,
      last_git_head TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_slug TEXT NOT NULL,
      summary TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'scanner',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_slug) REFERENCES projects(slug)
    );

    CREATE INDEX IF NOT EXISTS idx_project_reports_slug_created
      ON project_reports(project_slug, created_at DESC);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_slug TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      raw_text TEXT,
      filtered_text TEXT,
      model TEXT,
      project_slug TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS speaker_profiles (
      slug TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'guest')),
      memory_summary TEXT NOT NULL DEFAULT '',
      greeting_style TEXT NOT NULL DEFAULT 'name',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS speaker_session_maps (
      session_key TEXT NOT NULL,
      stt_speaker_id INTEGER NOT NULL,
      profile_slug TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_key, stt_speaker_id),
      FOREIGN KEY (profile_slug) REFERENCES speaker_profiles(slug)
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      client_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('user', 'atlas')),
      text TEXT NOT NULL,
      error INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, id ASC);
  `);
}
