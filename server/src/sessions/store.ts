import type Database from "better-sqlite3";

export interface ChatSessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: number;
  session_id: string;
  client_id: string | null;
  role: string;
  text: string;
  error: number;
  created_at: string;
}

export interface ChatMessageInput {
  clientId?: string;
  role: "user" | "atlas";
  text: string;
  error?: boolean;
}

export function listChatSessions(db: Database.Database, limit = 50): ChatSessionRow[] {
  return db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as ChatSessionRow[];
}

export function getChatSession(
  db: Database.Database,
  sessionId: string,
): ChatSessionRow | null {
  return (
    (db
      .prepare(
        `SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?`,
      )
      .get(sessionId) as ChatSessionRow | undefined) ?? null
  );
}

export function createChatSession(
  db: Database.Database,
  id: string,
  title = "New chat",
): ChatSessionRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(id, title, now, now);
  return { id, title, created_at: now, updated_at: now };
}

export function touchChatSession(
  db: Database.Database,
  sessionId: string,
  title?: string,
): void {
  const now = new Date().toISOString();
  if (title?.trim()) {
    db.prepare(
      `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`,
    ).run(title.trim().slice(0, 120), now, sessionId);
    return;
  }
  db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);
}

export function listChatMessages(
  db: Database.Database,
  sessionId: string,
): ChatMessageRow[] {
  return db
    .prepare(
      `SELECT id, session_id, client_id, role, text, error, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY id ASC`,
    )
    .all(sessionId) as ChatMessageRow[];
}

export function appendChatMessage(
  db: Database.Database,
  sessionId: string,
  message: ChatMessageInput,
): ChatMessageRow {
  const session = getChatSession(db, sessionId);
  if (!session) {
    throw new Error(`session not found: ${sessionId}`);
  }

  const text = message.text.trim();
  if (!text) {
    throw new Error("message text is required");
  }

  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, client_id, role, text, error)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      message.clientId ?? null,
      message.role,
      text,
      message.error ? 1 : 0,
    );

  if (message.role === "user" && session.title === "New chat") {
    touchChatSession(db, sessionId, text);
  } else {
    touchChatSession(db, sessionId);
  }

  const row = db
    .prepare(
      `SELECT id, session_id, client_id, role, text, error, created_at
       FROM chat_messages WHERE id = ?`,
    )
    .get(result.lastInsertRowid) as ChatMessageRow;

  return row;
}

export function deleteChatSession(db: Database.Database, sessionId: string): boolean {
  const info = db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(sessionId);
  return info.changes > 0;
}
