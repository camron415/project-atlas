import type Database from "better-sqlite3";
import { buildChiefContext } from "../reports/store.js";
import { chatCompletion, rewriteWithPersona } from "../xai/client.js";
import { responsesCompletion } from "../xai/responses.js";
import { AtlasModels } from "../models/router.js";
import {
  looksDeep as detectDeep,
  looksPlanning as detectPlanning,
  looksResearch as detectResearch,
} from "./intents.js";

const CHIEF_SYSTEM = `You are Atlas, Camron's chief assistant and project interface — including the Atlas repo itself.
Registered projects: Atlas, VocalLearn, Career Dashboard, Financial Advisor (placeholder).
Use the cached project context and manifest below. Do not invent repo details not present in context.
When asked what context you have, cite the manifest (docs indexed, deep scan status, files read).
If context is missing or shallow, say a deep refresh is needed.
For weather, news, and other live facts: use web search. Never invent temperatures, forecasts, or headlines — if search returns nothing, say you could not verify.
When the user interrupts you mid-response, treat their new message as a continuation of the conversation — answer the new input directly while staying aware of what was already discussed.

## Atlas system actions (voice economy)
- **Inbox** saves conversation transcripts to {project}/inbox/*.md — NOT analyst. Say "save this conversation to atlas inbox", "inbox report", or "summarize this conversation" then yes.
- **Analyst** is a read-only codebase review (architecture, roadmap, risks) — say "review atlas" or "run analyst now" then yes. Inbox and analyst are different tools.
- Dedicated server tools handle inbox and analyst — do NOT narrate fake queues or promise push alerts.
- NEVER say an analyst is "queued" or that you will "notify when ready" unless you literally received a completed analyst brief in this turn.
- There is NO background push notification system yet — be honest if asked.`;

const VOICE_CONVERSATIONAL = `## Voice style (economy mode)
Speak like capable Grok in voice: direct, substantive, ~4-6 sentences (up to ~10 only when deep mode is on).
Use "sir" at most once per reply, only when natural. Skip robotic openers ("Acknowledged", "Understood") unless truly fitting.
Give real answers — explain reasoning when helpful. Do not end every reply with "Shall I…?"`;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChiefReply {
  raw: string;
  filtered: string;
}

export interface ChiefRequest {
  message: string;
  history?: ChatTurn[];
  interrupted?: boolean;
  /** Route this turn through the reasoning model (slower, more capable). */
  deep?: boolean;
  /** Live lookup (weather, news, web). Uses fast model + web_search — cheaper than deep. */
  research?: boolean;
  /** Skip second persona rewrite pass (voice economy). */
  skipPersona?: boolean;
  /** Conversational voice instructions. */
  voice?: boolean;
}

export interface ChiefReplyMeta extends ChiefReply {
  model: string;
  deep: boolean;
  research: boolean;
}

function normalizeHistory(history: ChatTurn[] = []): ChatTurn[] {
  return history
    .filter((turn) => turn.content?.trim())
    .slice(-12)
    .map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.trim(),
    }));
}

export async function answerChiefMessage(
  db: Database.Database,
  request: ChiefRequest,
): Promise<ChiefReplyMeta> {
  const userMessage = request.message.trim();
  const history = normalizeHistory(request.history);
  const context = buildChiefContext(db);
  const deep = request.voice
    ? Boolean(request.deep) || detectDeep(userMessage)
    : Boolean(request.deep) ||
      detectDeep(userMessage) ||
      detectPlanning(userMessage);
  const research = request.voice
    ? Boolean(request.research) || detectResearch(userMessage)
    : !deep && (Boolean(request.research) || detectResearch(userMessage));

  const fastModel = AtlasModels.fast();
  const deepModel = AtlasModels.deep();
  const model = deep ? deepModel : fastModel;

  const deepHint = deep
    ? "\nThe user has asked you to think deeply about this. Reason carefully and give a thorough, well-structured answer, but keep the spoken summary clear."
    : "";
  const researchHint = research
    ? "\nThe user needs current/live information. Use web search before answering. Cite what you found; do not guess numbers."
    : "";

  const latestUserContent = request.interrupted
    ? `[User interrupted while you were speaking. Continue the conversation naturally and address this next input.] ${userMessage}`
    : userMessage;

  const voiceHint = request.voice ? `\n${VOICE_CONVERSATIONAL}` : "";

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `${CHIEF_SYSTEM}${voiceHint}${deepHint}${researchHint}\n\n## Cached project context\n${context}`,
    },
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: latestUserContent },
  ];

  const voiceMaxTokens = deep ? 800 : 400;
  const textMaxTokens = deep ? 1200 : 1000;

  const raw =
    deep || research
      ? await responsesCompletion(messages, {
          model: deep ? deepModel : fastModel,
          maxOutputTokens: request.voice ? (deep ? 800 : 600) : deep ? 1600 : 1000,
          tools: [{ type: "web_search" }],
        })
      : await chatCompletion(messages, {
          model: fastModel,
          maxTokens: request.voice ? voiceMaxTokens : textMaxTokens,
        });
  const filtered = request.skipPersona ? raw.trim() : await rewriteWithPersona(raw);

  db.prepare(
    `INSERT INTO conversation_log (role, raw_text, filtered_text, model)
     VALUES ('assistant', ?, ?, ?)`,
  ).run(raw, filtered, model);

  db.prepare(
    `INSERT INTO conversation_log (role, raw_text, model)
     VALUES ('user', ?, ?)`,
  ).run(userMessage, model);

  return { raw, filtered, model, deep, research };
}
