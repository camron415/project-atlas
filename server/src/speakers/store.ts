import type Database from "better-sqlite3";
import type { SpeakerProfile, SpeakerResolveResult, SpeakerRole } from "./types.js";

const OWNER_SUMMARY =
  "Primary user Camron. Full project portfolio, career planning, and financial context when relevant. Address as sir when natural.";

const GUEST_SUMMARY =
  "Household guest. Share general project facts from cache only. Do not discuss Camron's personal finances, career plans, or private notes. Be polite and welcoming.";

const OWNER_ADDON = `## Active speaker: owner (Camron)
You are speaking with Camron, your principal. Use the full Jarvis persona and project context. "Sir" is appropriate when natural.`;

const GUEST_ADDON = `## Active speaker: guest
You are speaking with a guest, not Camron. Be courteous and helpful with general project information only.
Do NOT share financial details, private career notes, or Camron-specific personal context.
Use their name if known; do not use "sir" unless they clearly prefer it.
Keep replies shorter and less familiar than with Camron.`;

function rowToProfile(row: Record<string, unknown>): SpeakerProfile {
  return {
    slug: String(row.slug),
    displayName: String(row.display_name),
    role: row.role === "guest" ? "guest" : "owner",
    memorySummary: String(row.memory_summary ?? ""),
    greetingStyle: String(row.greeting_style ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function seedSpeakerProfiles(db: Database.Database): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM speaker_profiles").get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(`
    INSERT INTO speaker_profiles (slug, display_name, role, memory_summary, greeting_style)
    VALUES (@slug, @displayName, @role, @memorySummary, @greetingStyle)
  `);

  insert.run({
    slug: "camron",
    displayName: "Camron",
    role: "owner",
    memorySummary: OWNER_SUMMARY,
    greetingStyle: "sir",
  });
  insert.run({
    slug: "guest",
    displayName: "Guest",
    role: "guest",
    memorySummary: GUEST_SUMMARY,
    greetingStyle: "name",
  });
}

export function listSpeakerProfiles(db: Database.Database): SpeakerProfile[] {
  const rows = db
    .prepare(
      `SELECT slug, display_name, role, memory_summary, greeting_style, created_at, updated_at
       FROM speaker_profiles ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, display_name ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToProfile);
}

export function getSpeakerProfile(
  db: Database.Database,
  slug: string,
): SpeakerProfile | null {
  const row = db
    .prepare(
      `SELECT slug, display_name, role, memory_summary, greeting_style, created_at, updated_at
       FROM speaker_profiles WHERE slug = ?`,
    )
    .get(slug) as Record<string, unknown> | undefined;
  return row ? rowToProfile(row) : null;
}

export function upsertSpeakerProfile(
  db: Database.Database,
  input: {
    slug: string;
    displayName: string;
    role?: SpeakerRole;
    memorySummary?: string;
    greetingStyle?: string;
  },
): SpeakerProfile {
  const existing = getSpeakerProfile(db, input.slug);
  if (existing) {
    db.prepare(
      `UPDATE speaker_profiles
       SET display_name = @displayName,
           role = COALESCE(@role, role),
           memory_summary = COALESCE(@memorySummary, memory_summary),
           greeting_style = COALESCE(@greetingStyle, greeting_style),
           updated_at = datetime('now')
       WHERE slug = @slug`,
    ).run({
      slug: input.slug,
      displayName: input.displayName,
      role: input.role ?? null,
      memorySummary: input.memorySummary ?? null,
      greetingStyle: input.greetingStyle ?? null,
    });
    return getSpeakerProfile(db, input.slug)!;
  }

  db.prepare(
    `INSERT INTO speaker_profiles (slug, display_name, role, memory_summary, greeting_style)
     VALUES (@slug, @displayName, @role, @memorySummary, @greetingStyle)`,
  ).run({
    slug: input.slug,
    displayName: input.displayName,
    role: input.role ?? "guest",
    memorySummary: input.memorySummary ?? GUEST_SUMMARY,
    greetingStyle: input.greetingStyle ?? "name",
  });
  return getSpeakerProfile(db, input.slug)!;
}

function getMappedSlug(
  db: Database.Database,
  sessionKey: string,
  sttSpeakerId: number,
): string | null {
  const row = db
    .prepare(
      `SELECT profile_slug FROM speaker_session_maps
       WHERE session_key = ? AND stt_speaker_id = ?`,
    )
    .get(sessionKey, sttSpeakerId) as { profile_slug: string } | undefined;
  return row?.profile_slug ?? null;
}

function storeMap(
  db: Database.Database,
  sessionKey: string,
  sttSpeakerId: number,
  profileSlug: string,
): void {
  db.prepare(
    `INSERT INTO speaker_session_maps (session_key, stt_speaker_id, profile_slug)
     VALUES (?, ?, ?)
     ON CONFLICT(session_key, stt_speaker_id) DO UPDATE SET profile_slug = excluded.profile_slug`,
  ).run(sessionKey, sttSpeakerId, profileSlug);
}

function autoAssignSlug(db: Database.Database, sttSpeakerId: number): string {
  if (sttSpeakerId === 0) return "camron";
  if (sttSpeakerId === 1) return "guest";
  return "guest";
}

export function buildSpeakerPrefix(profile: SpeakerProfile): string {
  if (profile.role === "owner") {
    return `[Speaker: ${profile.displayName} (owner)]`;
  }
  return `[Speaker: ${profile.displayName} (guest — limited personal context)]`;
}

export function buildInstructionsAddon(profile: SpeakerProfile): string {
  if (profile.role === "owner") return OWNER_ADDON;
  return GUEST_ADDON;
}

export function resolveSpeaker(
  db: Database.Database,
  sessionKey: string,
  sttSpeakerId: number,
): SpeakerResolveResult {
  let slug = getMappedSlug(db, sessionKey, sttSpeakerId);
  let mapped = Boolean(slug);

  if (!slug) {
    slug = autoAssignSlug(db, sttSpeakerId);
    storeMap(db, sessionKey, sttSpeakerId, slug);
  }

  const profile = getSpeakerProfile(db, slug);
  if (!profile) {
    throw new Error(`Speaker profile not found: ${slug}`);
  }

  return {
    profile,
    messagePrefix: buildSpeakerPrefix(profile),
    instructionsAddon: buildInstructionsAddon(profile),
    mapped,
  };
}

export function remapSpeaker(
  db: Database.Database,
  sessionKey: string,
  sttSpeakerId: number,
  profileSlug: string,
): SpeakerResolveResult {
  const profile = getSpeakerProfile(db, profileSlug);
  if (!profile) {
    throw new Error(`Speaker profile not found: ${profileSlug}`);
  }
  storeMap(db, sessionKey, sttSpeakerId, profileSlug);
  return {
    profile,
    messagePrefix: buildSpeakerPrefix(profile),
    instructionsAddon: buildInstructionsAddon(profile),
    mapped: true,
  };
}

export function clearSessionMaps(db: Database.Database, sessionKey: string): number {
  const result = db
    .prepare(`DELETE FROM speaker_session_maps WHERE session_key = ?`)
    .run(sessionKey);
  return result.changes;
}
