import type Database from "better-sqlite3";
import type { AnalystRunDeps } from "../analyst/run.js";
import type { ProjectRegistry } from "../projects/registry.js";
import { buildContextManifest } from "../reports/store.js";
import { chatCompletionWithTools, synthesizeSpeech, type ChatMessage } from "../xai/client.js";
import { AtlasModels } from "../models/router.js";
import type { ChatTurn } from "../chief/respond.js";
import { isCancel, stripMessageForRouting } from "./routing.js";
import { executeVoiceTool, VOICE_CHIEF_TOOLS } from "./tools.js";
import { sanitizeVoiceReply } from "./voice-sanitize.js";
import { buildStandupMemoryBlock } from "../standup/context.js";
import { STANDUP_MODERATOR_ADDON } from "../standup/instructions.js";
import { isStandupActive } from "../standup/session-state.js";

export interface PlanVoiceTurnRequest {
  message: string;
  chatSessionId?: string;
  history?: ChatTurn[];
  interrupted?: boolean;
  deep?: boolean;
  research?: boolean;
  /** Client speaks via per-turn Realtime — skip server TTS. */
  skipTts?: boolean;
  /** Daily standup moderator mode (app-initiated). */
  standupMode?: boolean;
}

export interface PlanVoiceTurnReply {
  raw: string;
  filtered: string;
  model: string;
  deep: boolean;
  audio?: string | null;
  audioFormat?: string;
  audioError?: string;
  analystStatus?: "running" | "done" | "error";
  analystProject?: string;
}

const VOICE_CHIEF_SYSTEM = `You are Atlas, Camron's chief assistant in voice economy mode (field test 3).
Registered projects: Atlas, VocalLearn, Career Dashboard.

## Tool routing (no regex — use judgment)
1. Project/repo/code questions → search_context first.
2. If search_context has no hits OR the question is about the real world (sports, news, weather, prices, people, events, winners, schedules, "today", "tonight", current facts) → call web_lookup immediately. Never ask permission to search.
3. Include today's date and Camron's location in web_lookup queries when it helps disambiguate.

## Tools
- search_context — cached reports, inbox files, key docs.
- web_lookup — live web search for anything not in cached context.
- dispatch_analyst — LIVE. Read-only codebase review. Ask for confirmation first; only call with confirmed=true after yes/proceed.
- write_inbox — LIVE. Save session to inbox markdown. Confirm first; confirmed=true only after yes.
- check_email, dispatch_worker — NOT wired in FT3. If asked, say honestly they are not available yet.

## Voice output (critical — spoken aloud)
NEVER speak tool names, parameter names, underscores, file paths, JSON, or code syntax.
NEVER say "Call write_inbox with..." or include Action: lines in your reply.
Use plain-English confirmations only (e.g. "I can save this to the Atlas inbox — say yes to confirm").

## Voice style
Direct, substantive Grok-style voice. ~4-6 sentences unless deep mode (then up to ~10).
Use "sir" at most once per reply. No robotic openers. Real answers — no fake queues or push alerts.
There is NO background notification system — be honest.

## Confirmations
When dispatching analyst or saving inbox, restate the action in plain English and wait for explicit yes before calling the tool with confirmed=true.
If Camron says no/cancel, acknowledge and do not call the tool.`;

const VOICE_BREVITY = `Keep the spoken reply concise: about 4-6 sentences. Do not list every tool result — synthesize. Never leak internal tool names or syntax in spoken text.`;

function normalizeHistory(history: ChatTurn[] = []): ChatTurn[] {
  return history
    .filter((turn) => turn.content?.trim())
    .slice(-10)
    .map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.trim(),
    }));
}

async function attachTts(filtered: string): Promise<{
  audio: string | null;
  audioFormat: string;
  audioError?: string;
}> {
  if (!process.env.XAI_API_KEY) {
    return { audio: null, audioFormat: "mp3", audioError: "XAI_API_KEY not configured" };
  }
  try {
    const audio = await synthesizeSpeech(filtered);
    return { audio: audio.toString("base64"), audioFormat: "mp3" };
  } catch (error) {
    return {
      audio: null,
      audioFormat: "mp3",
      audioError: error instanceof Error ? error.message : "TTS failed",
    };
  }
}

async function replyLocal(
  filtered: string,
  extra: Partial<PlanVoiceTurnReply> = {},
  skipTts = false,
): Promise<PlanVoiceTurnReply> {
  if (skipTts) {
    return {
      raw: filtered,
      filtered,
      model: "local",
      deep: false,
      audio: null,
      audioFormat: "mp3",
      ...extra,
    };
  }
  const tts = await attachTts(filtered);
  return { raw: filtered, filtered, model: "local", deep: false, ...extra, ...tts };
}

function buildManifestBlock(db: Database.Database): string {
  const manifest = buildContextManifest(db);
  if (!manifest.length) return "No projects indexed yet.";
  return manifest
    .map(
      (m) =>
        `- ${m.name} (${m.projectSlug}): docs=[${m.docsFound.join(", ") || "none"}]; deepScan=${m.deepScan}`,
    )
    .join("\n");
}

async function runVoiceChiefLoop(
  deps: AnalystRunDeps & { registry: ProjectRegistry },
  req: PlanVoiceTurnRequest,
): Promise<{ text: string; model: string; deep: boolean; analystMeta?: Partial<PlanVoiceTurnReply> }> {
  const userMessage = req.message.trim();
  const history = normalizeHistory(req.history);
  const deep = Boolean(req.deep);
  const latestUser = req.interrupted
    ? `[User interrupted while you were speaking. Address this next input naturally.] ${userMessage}`
    : userMessage;

  const maxTokens = deep ? 800 : 400;
  const model = deep ? AtlasModels.deep() : AtlasModels.fast();

  const standupOn =
    Boolean(req.standupMode) || isStandupActive(req.chatSessionId ?? null);
  const standupBlock = standupOn
    ? `${STANDUP_MODERATOR_ADDON}\n\n${buildStandupMemoryBlock(deps.db, deps.registry)}`
    : buildStandupMemoryBlock(deps.db, deps.registry);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${VOICE_CHIEF_SYSTEM}\n\n${standupBlock}\n\n## Context manifest\n${buildManifestBlock(deps.db)}\n\n${VOICE_BREVITY}`,
    },
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: latestUser },
  ];

  let analystMeta: Partial<PlanVoiceTurnReply> | undefined;
  const toolCtx = {
    db: deps.db,
    registry: deps.registry,
    dataDir: deps.dataDir,
    chatSessionId: req.chatSessionId,
    onAnalyst: (payload: Record<string, unknown>) => {
      const status = payload.status as string | undefined;
      if (status === "running") {
        analystMeta = {
          analystStatus: "running",
          analystProject: String(payload.project ?? "project"),
        };
      } else if (status === "done") {
        analystMeta = {
          analystStatus: "done",
          analystProject: String(payload.project ?? "project"),
        };
      } else if (status === "error") {
        analystMeta = {
          analystStatus: "error",
          analystProject: String(payload.project ?? "project"),
        };
      }
    },
  };

  const maxRounds = 6;
  let finalText = "";

  for (let round = 0; round < maxRounds; round++) {
    const result = await chatCompletionWithTools(messages, {
      model,
      maxTokens,
      tools: VOICE_CHIEF_TOOLS,
      temperature: 0.45,
      task: "voice-chief",
    });

    if (!result.toolCalls.length) {
      finalText = result.content;
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const output = await executeVoiceTool(
        call.function.name,
        call.function.arguments,
        toolCtx,
      );
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }

    if (round === maxRounds - 1 && !finalText) {
      const last = await chatCompletionWithTools(messages, {
        model,
        maxTokens,
        temperature: 0.45,
        task: "voice-chief",
      });
      finalText = last.content;
    }
  }

  if (!finalText.trim()) {
    finalText = "I could not form a reply — try again, sir.";
  }

  return { text: finalText.trim(), model, deep, analystMeta };
}

export async function handlePlanVoiceTurn(
  deps: AnalystRunDeps & { registry: ProjectRegistry },
  req: PlanVoiceTurnRequest,
): Promise<PlanVoiceTurnReply> {
  const message = req.message.trim();
  const routed = stripMessageForRouting(message);

  if (isCancel(routed)) {
    return replyLocal("Understood — cancelled.");
  }

  const skipTts = Boolean(req.skipTts);
  const { text, model, deep, analystMeta } = await runVoiceChiefLoop(deps, req);
  const filtered = sanitizeVoiceReply(text);
  const tts = skipTts
    ? { audio: null as string | null, audioFormat: "mp3" }
    : await attachTts(filtered);

  deps.db.prepare(
    `INSERT INTO conversation_log (role, raw_text, filtered_text, model)
     VALUES ('assistant', ?, ?, ?)`,
  ).run(text, filtered, model);

  deps.db.prepare(
    `INSERT INTO conversation_log (role, raw_text, model)
     VALUES ('user', ?, ?)`,
  ).run(message, model);

  return {
    raw: text,
    filtered,
    model,
    deep,
    ...analystMeta,
    ...tts,
  };
}

/** Test helper — FT3 uses tool confirmations; kept for test compatibility. */
export function clearPendingAnalyst(_sessionKey = "default"): void {
  // no-op — pending state removed in FT3 tools_only routing
}
