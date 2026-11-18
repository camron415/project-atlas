import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry } from "../projects/registry.js";
import { findRegistryProject } from "../managers/projects.js";
import { standupPrepFilenameForToday } from "../standup/filenames.js";
import { formatAppliedBlock, formatFocusBlock } from "../career/applied-roles.js";
import { todayDatePrefix } from "../standup/filenames.js";
import { buildLatestStatusMarkdown } from "../agent/latest-status.js";

export interface PhoneBriefResult {
  ok: boolean;
  path?: string;
  error?: string;
}

function readIfExists(filePath: string, maxChars = 20_000): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
  } catch {
    return null;
  }
}

function prepPath(
  registry: ProjectRegistry,
  project: "vocallearn" | "career" | "atlas",
): string | null {
  const entry = findRegistryProject(registry, project);
  if (!entry?.path) return null;
  return path.join(entry.path, "inbox", standupPrepFilenameForToday());
}

function atlasMorningPath(registry: ProjectRegistry): string | null {
  const entry = findRegistryProject(registry, "atlas");
  if (!entry?.path) return null;
  return path.join(entry.path, "inbox", `${todayDatePrefix()}-morning.md`);
}

/** Pull one ## section body (until next ##). */
function sectionBody(md: string, heading: string): string {
  const re = new RegExp(
    `##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  return md.match(re)?.[1]?.trim() ?? "";
}

/** Soften leftover path/hash noise from older manager preps. */
function speakableLines(text: string, maxLines = 6): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^HEAD:|^```|npm run |git |diff --/i.test(line)) continue;
    let s = line
      .replace(/`[^`]+`/g, "");
    if (!/^https?:\/\//i.test(line) && !/https?:\/\//i.test(line)) {
      s = s.replace(/\b[a-f0-9]{7,40}\b/gi, "");
    }
    s = s
      .replace(/\b[\w.-]+\.(ts|tsx|js|md|json)\b/gi, "")
      .replace(/\b(src|docs|lib|app|scripts|inbox)\/[\w./-]*/gi, "")
      .replace(/\bHEAD advanced to\b\s*:?/gi, "Shipped")
      .replace(/\bWorking tree clean except\.?/gi, "Repo was otherwise clean")
      .replace(/\bCreated multiple new docs:[^.]*\.?/gi, "Added several new career docs")
      // Env-style tokens only (ATLAS_FOO, PHASE_1_75) — never strip NEVER / company names
      .replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\bper\s+reference\.?/gi, "")
      .replace(/\bin\s*[—-]\s*/gi, "— ")
      .replace(/:\s*:/g, ":")
      .replace(/\s*[—-]\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
      .replace(/\.\s*\./g, ".")
      .replace(/^[-*]\s*:\s*/g, "- ")
      .trim();
    // Second pass for emptied parens after other cleans
    s = s.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
    if (!s || s === "-" || /^\d+\.$/.test(s)) continue;
    // Drop lines that were basically "open this file / tag that file"
    if (/\b(open|tag)\b/i.test(line) && /\/|\.ts|\.tsx|\.md|\.js\b/i.test(line)) {
      continue;
    }
    // Drop file-path leftovers, not "ConsultNet / TEKsystems" or spoken URLs
    if (/\/[\w.-]+\.(ts|tsx|js|md|json)\b/i.test(s) || /\b(?:src|docs|lib|scripts)\/[\w./-]*/i.test(s)) {
      continue;
    }
    // If sanitizing gutted the action, skip rather than speak nonsense
    if (/^(?:\d+\.|-)\s*(?:and\s*)?[—-]?\s*P[0-3]/i.test(s)) continue;
    if (/^(?:\d+\.|-)\s*$/.test(s)) continue;
    if (s.length < 12 && !/none today/i.test(s)) continue;
    out.push(s);
    if (out.length >= maxLines) break;
  }
  return out.join("\n") || "_Nothing speakable — skip this block._";
}

function applyCandidateSpeak(section: string): string {
  const keep: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/cover letter/i.test(line)) break;
    if (/^[-*]\s*(Company|Role|Why fit|Ask Camron|Status|Apply URL)\b/i.test(line) || /^(Company|Role|Why fit|Ask Camron|Status|Apply URL)\b/i.test(line)) {
      keep.push(line);
    }
  }
  return keep.join("\n") || speakableLines(section, 5);
}

/**
 * Phone layer only — strip git dumps, analyst walls, file trees.
 * Keeps decisions / proposals / apply candidate in speakable form.
 */
export function extractPhoneSpeakLayer(
  prepMd: string,
  kind: "vocallearn" | "career",
): string {
  const mode = /standup:\s*(active|skip)/i.exec(prepMd)?.[1]?.toLowerCase() ?? "active";

  if (kind === "career") {
    const board =
      sectionBody(prepMd, "Board pulse (speak)") ||
      sectionBody(prepMd, "Board pulse") ||
      "";
    const apply =
      sectionBody(prepMd, "Today's apply candidate") ||
      (prepMd.match(/##\s*Today's apply candidate[\s\S]*?(?=\n##\s+|$)/i)?.[0] ?? "");
    const applyClean = apply
      .replace(/^##\s*Today's apply candidate\s*/i, "")
      .trim();

    const decisions = speakableLines(
      sectionBody(prepMd, "Decisions for Camron") || "None today",
      3,
    );
    const since = speakableLines(sectionBody(prepMd, "Since yesterday"), 3);
    const proposedRaw =
      sectionBody(prepMd, "Proposed today (P / S)") || sectionBody(prepMd, "Proposed today");
    const proposedIsHousekeeping = /npm run|lib\/|ingest|resume-packets|discovery:report/i.test(
      proposedRaw,
    );

    const applySpeak = applyCandidateSpeak(applyClean);
    const boardSpeak = speakableLines(board, 8);
    const queueSpeak = speakableLines(
      sectionBody(prepMd, "Current apply queue (Camron — source of truth)") ||
        sectionBody(prepMd, "Current apply queue"),
      6,
    );

    const lines = [
      `standup: ${mode}`,
      "",
      ...(queueSpeak && !/_Nothing speakable/i.test(queueSpeak)
        ? ["## Current apply queue (speak first)", queueSpeak, ""]
        : []),
      "## Say this first (Career) — board pulse then one candidate",
      board
        ? [
            "Board pulse (speak in ≤20 seconds):",
            boardSpeak,
            "",
            "_Lead with gone/new/still-on-list. Then the one apply candidate._",
          ].join("\n")
        : "_No board pulse — say Packet A list is unchanged in the notes, then move to the candidate._",
      "",
      applyClean
        ? [
            "Today's apply candidate:",
            applySpeak,
            "",
            "_Name company + role + one why-fit sentence. Ask confirm / skip / different company._",
          ].join("\n")
        : "_No apply candidate — ask if he filed anything anyway._",
      "",
      "## Decisions for Camron",
      decisions,
    ];

    if (since && !/_Nothing speakable|_Quiet/i.test(since)) {
      lines.push("", "## Since yesterday (one breath)", since);
    }
    lines.push(
      "",
      "## Optional extras (only if he asks)",
      proposedIsHousekeeping || !proposedRaw
        ? "_Dashboard housekeeping only — skip unless Camron wants career-tooling talk._"
        : speakableLines(proposedRaw, 3),
    );

    return lines.join("\n");
  }

  // VocalLearn
  const decisions = speakableLines(
    sectionBody(prepMd, "Decisions for Camron") || "None today",
    4,
  );
  const proposed = speakableLines(
    sectionBody(prepMd, "Proposed today (P / S)") ||
      sectionBody(prepMd, "Proposed today") ||
      "",
    4,
  );
  const roadmap = speakableLines(sectionBody(prepMd, "Roadmap position"), 3);
  const since = speakableLines(sectionBody(prepMd, "Since yesterday"), 3);
  const auto = speakableLines(sectionBody(prepMd, "Auto queue (S0/S1)") || "None today", 3);

  const proposedFinal = /_Nothing speakable/i.test(proposed)
    ? "_No separate chore list — walk the decision questions above, then stop._"
    : proposed;

  return [
    `standup: ${mode}`,
    "",
    "## Say this first (Halo / VocalLearn)",
    `Where we are: ${roadmap}`,
    `Since yesterday: ${since}`,
    "",
    "## Decisions for Camron (ask one at a time)",
    decisions,
    "",
    "## Proposed today (after decisions — plain wording only)",
    proposedFinal,
    "",
    "## Auto queue",
    auto,
    "",
    "_Never read file paths, commit hashes, or analyst dumps aloud. Translate any leftover jargon into outcomes._",
  ].join("\n");
}

function atlasSpeakOneLiner(morningMd: string | null): string {
  if (!morningMd) return "_No Atlas overnight note._";
  const headline =
    morningMd.match(/##\s*Headline\s*\n+([^\n#]+)/i)?.[1]?.trim() ||
    morningMd.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##\s+|$)/i)?.[1]?.trim().split("\n")[0];
  if (!headline) return "_Atlas overnight scan present — mention only if relevant._";
  // Strip path-y noise
  if (/[`/\\]|HEAD |src\/|docs\//.test(headline)) {
    return "_Atlas overnight scan ran — no spoken headline needed unless Camron asks._";
  }
  return headline.slice(0, 280);
}

/** Single daily doc the phone agent should load on "morning brief". */
export function buildPhoneMorningBrief(input: {
  registry: ProjectRegistry;
  dataDir: string;
}): PhoneBriefResult {
  const date = todayDatePrefix();
  const vl = prepPath(input.registry, "vocallearn");
  const career = prepPath(input.registry, "career");
  const atlasMorning = atlasMorningPath(input.registry);

  const vlText = vl ? readIfExists(vl) : null;
  const careerText = career ? readIfExists(career) : null;
  const atlasText = atlasMorning ? readIfExists(atlasMorning, 8000) : null;
  let liveLatest = "";
  try {
    liveLatest = buildLatestStatusMarkdown({
      atlasRoot: findRegistryProject(input.registry, "atlas")?.path ?? "",
      dataDir: input.dataDir,
      registry: input.registry,
    }).slice(0, 3500);
  } catch {
    liveLatest = "";
  }

  const body = [
    `# PHONE MORNING BRIEF — ${date}`,
    "",
    "**Keyword:** when Camron says **morning brief**, **standup**, or **daily brief**, run this agenda.",
    "",
    "## Voice rules (mandatory)",
    "- This doc is already a **speak layer**. Do not dig for file names.",
    "- Translate everything into short spoken sentences. Never read paths, SHAs, npm commands, or code identifiers.",
    "- One question at a time. After a clear answer, move on.",
    "- If a section says skip / quiet / housekeeping only — say that in one sentence and move on.",
    "",
    "## Call flow (≤10 minutes)",
    "1. Open ≤10 sec: date + VocalLearn + Career.",
    "2. VocalLearn decisions → then proposed today (max 3). After each yes: one confirm, then next item — never write tools mid-call.",
    "3. Career: **current queue** → **board pulse** (gone/new/still-on-list) → **apply candidate** (confirm / skip / change).",
    "4. Closing: any applications filed?",
    "5. Summarize ≤3 bullets → save tools → goodbye.",
    "6. If Camron asks to simplify, use plain words; then continue the agenda (do not freeze).",
    "",
    "## Already applied (do not re-prioritize)",
    formatAppliedBlock(input.dataDir),
    "",
    "## Current apply queue (source of truth — speak this)",
    formatFocusBlock(input.dataDir),
    "",
    "## Live Halo / VocalLearn (beats standup-prep if they disagree)",
    liveLatest || "_No LATEST dump yet._",
    "",
    "## VocalLearn (speak)",
    vlText
      ? extractPhoneSpeakLayer(vlText, "vocallearn")
      : "_No VocalLearn standup-prep for today yet — say Sloane had nothing queued and ask if Camron has a VL focus anyway._",
    "",
    "## Career (speak)",
    careerText
      ? extractPhoneSpeakLayer(careerText, "career")
      : "_No Career standup-prep for today yet — ask if he wants to talk applications anyway._",
    "",
    "## Atlas overnight (optional, one line)",
    atlasSpeakOneLiner(atlasText),
    "",
  ].join("\n");

  const outDir = path.join(input.dataDir, "phone-agent-knowledge", "05-status");
  const outPath = path.join(outDir, `PHONE-MORNING-BRIEF-${date}.md`);
  const stablePath = path.join(outDir, "PHONE-MORNING-BRIEF-latest.md");
  const rootLatest = path.join(input.dataDir, "phone-agent-knowledge", "PHONE-MORNING-BRIEF.md");

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, body, "utf8");
    fs.writeFileSync(stablePath, body, "utf8");
    fs.writeFileSync(rootLatest, body, "utf8");
    return { ok: true, path: rootLatest };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
