/**
 * Persistent chat sessions — local file (survives app kill) + Mac server sync.
 */
import { Paths } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import {
  appendSessionMessage,
  createChatSession,
  deleteChatSession as deleteChatSessionRemote,
  fetchChatSession,
  fetchChatSessions,
  type ChatSessionMeta,
} from "./api";

export interface StoredMessage {
  id: string;
  role: "user" | "atlas";
  text: string;
  error?: boolean;
}

export interface StoredSession extends ChatSessionMeta {
  messages: StoredMessage[];
}

interface SessionIndex {
  activeSessionId: string | null;
  sessions: ChatSessionMeta[];
}

const INDEX_URI = `${Paths.document.uri}atlas-chat-index.json`;

function sessionFileUri(sessionId: string): string {
  return `${Paths.document.uri}atlas-chat-${sessionId}.json`;
}

export function makeSessionId(): string {
  return `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readIndex(): Promise<SessionIndex> {
  try {
    const info = await LegacyFS.getInfoAsync(INDEX_URI);
    if (!info.exists) return { activeSessionId: null, sessions: [] };
    const raw = await LegacyFS.readAsStringAsync(INDEX_URI);
    const parsed = JSON.parse(raw) as Partial<SessionIndex>;
    return {
      activeSessionId: parsed.activeSessionId ?? null,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { activeSessionId: null, sessions: [] };
  }
}

async function writeIndex(index: SessionIndex): Promise<void> {
  await LegacyFS.writeAsStringAsync(INDEX_URI, JSON.stringify(index), {
    encoding: LegacyFS.EncodingType.UTF8,
  });
}

async function readLocalSession(sessionId: string): Promise<StoredSession | null> {
  try {
    const uri = sessionFileUri(sessionId);
    const info = await LegacyFS.getInfoAsync(uri);
    if (!info.exists) return null;
    const raw = await LegacyFS.readAsStringAsync(uri);
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

async function writeLocalSession(session: StoredSession): Promise<void> {
  await LegacyFS.writeAsStringAsync(
    sessionFileUri(session.id),
    JSON.stringify(session),
    { encoding: LegacyFS.EncodingType.UTF8 },
  );
}

function titleFromFirstUserMessage(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim());
  if (!first) return "New chat";
  const t = first.text.trim();
  return t.length > 56 ? `${t.slice(0, 53)}…` : t;
}

export async function listLocalSessions(): Promise<ChatSessionMeta[]> {
  const index = await readIndex();
  return [...index.sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export async function loadSession(sessionId: string): Promise<StoredSession | null> {
  const local = await readLocalSession(sessionId);
  if (local) return local;

  try {
    const remote = await fetchChatSession(sessionId);
    const session: StoredSession = {
      ...remote.session,
      messages: remote.messages.map((m) => ({
        id: m.client_id ?? `srv-${m.id}`,
        role: m.role,
        text: m.text,
        error: m.error === 1,
      })),
    };
    await writeLocalSession(session);
    return session;
  } catch {
    return null;
  }
}

export async function ensureActiveSession(
  preferredId?: string | null,
): Promise<StoredSession> {
  const index = await readIndex();
  const sessionId = preferredId ?? index.activeSessionId ?? makeSessionId();

  let session = await loadSession(sessionId);
  if (session) {
    index.activeSessionId = sessionId;
    if (!index.sessions.some((s) => s.id === sessionId)) {
      index.sessions.unshift({
        id: session.id,
        title: session.title,
        created_at: session.created_at,
        updated_at: session.updated_at,
      });
    }
    await writeIndex(index);
    return session;
  }

  const now = new Date().toISOString();
  session = {
    id: sessionId,
    title: "New chat",
    created_at: now,
    updated_at: now,
    messages: [],
  };

  index.activeSessionId = sessionId;
  index.sessions = [
    { id: session.id, title: session.title, created_at: now, updated_at: now },
    ...index.sessions.filter((s) => s.id !== sessionId),
  ];
  await writeLocalSession(session);
  await writeIndex(index);

  void createChatSession(session.id, session.title).catch(() => {});
  return session;
}

export async function createNewSession(): Promise<StoredSession> {
  const sessionId = makeSessionId();
  const now = new Date().toISOString();
  const session: StoredSession = {
    id: sessionId,
    title: "New chat",
    created_at: now,
    updated_at: now,
    messages: [],
  };

  const index = await readIndex();
  index.activeSessionId = sessionId;
  index.sessions = [
    { id: session.id, title: session.title, created_at: now, updated_at: now },
    ...index.sessions,
  ];
  await writeLocalSession(session);
  await writeIndex(index);
  void createChatSession(session.id, session.title).catch(() => {});
  return session;
}

export async function persistMessage(
  sessionId: string,
  message: StoredMessage,
): Promise<void> {
  const session = (await loadSession(sessionId)) ?? (await ensureActiveSession(sessionId));
  if (session.messages.some((m) => m.id === message.id)) return;
  const tail = session.messages[session.messages.length - 1];
  if (
    tail &&
    tail.role === message.role &&
    tail.text.trim() === message.text.trim() &&
    !message.error
  ) {
    return;
  }

  session.messages.push(message);
  session.updated_at = new Date().toISOString();
  if (message.role === "user" && session.title === "New chat") {
    session.title = titleFromFirstUserMessage(session.messages);
  }

  await writeLocalSession(session);

  const index = await readIndex();
  index.activeSessionId = sessionId;
  const meta = {
    id: session.id,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
  index.sessions = [meta, ...index.sessions.filter((s) => s.id !== sessionId)];
  await writeIndex(index);

  void appendSessionMessage(sessionId, {
    clientId: message.id,
    role: message.role,
    text: message.text,
    error: message.error,
  }).catch(() => {});
}

export async function deleteSession(sessionId: string): Promise<{
  wasActive: boolean;
  nextActiveId: string | null;
}> {
  const index = await readIndex();
  const wasActive = index.activeSessionId === sessionId;
  index.sessions = index.sessions.filter((s) => s.id !== sessionId);

  if (wasActive) {
    index.activeSessionId = index.sessions[0]?.id ?? null;
  }

  await writeIndex(index);

  try {
    await LegacyFS.deleteAsync(sessionFileUri(sessionId), { idempotent: true });
  } catch {
    // local file may already be missing
  }

  void deleteChatSessionRemote(sessionId).catch(() => {});

  return { wasActive, nextActiveId: index.activeSessionId };
}

export async function syncSessionsFromServer(): Promise<ChatSessionMeta[]> {
  try {
    const remote = await fetchChatSessions();
    const index = await readIndex();
    const merged = new Map<string, ChatSessionMeta>();
    for (const s of index.sessions) merged.set(s.id, s);
    for (const s of remote) {
      const existing = merged.get(s.id);
      if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
        merged.set(s.id, s);
      }
    }
    index.sessions = [...merged.values()].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    await writeIndex(index);
    return index.sessions;
  } catch {
    return listLocalSessions();
  }
}

export function storedToUiMessages(
  messages: StoredMessage[],
): Array<{ id: string; role: "user" | "atlas"; text: string; error?: boolean }> {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    error: m.error,
  }));
}
