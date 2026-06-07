import type Database from "better-sqlite3";
import { buildChiefContext } from "../reports/store.js";
import { chatCompletion, rewriteWithPersona } from "../xai/client.js";
import { responsesCompletion } from "../xai/responses.js";

const CHIEF_SYSTEM = `You are Atlas, Camron's chief assistant and project interface — including the Atlas repo itself.
You speak with calm confidence. Registered projects: Atlas, VocalLearn, Career Dashboard, Financial Advisor (placeholder).
Use the cached project context and manifest below. Be concise and actionable. Do not invent repo details not present in context.
When asked what context you have, cite the manifest (docs indexed, deep scan status, files read).
If context is missing or shallow, say a deep refresh is needed.
When the user interrupts you mid-response, treat their new message as a continuation of the conversation — answer the new input directly while staying aware of what was already discussed.`;

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
}

export interface ChiefReplyMeta extends ChiefReply {
  model: string;
  deep: boolean;
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
  const deep = Boolean(request.deep);

  // Fast path uses the default chat model; deep path uses the reasoning model
  // and a larger token budget so it can actually think through harder requests.
  const fastModel = process.env.XAI_CHAT_MODEL ?? "grok-4-fast-non-reasoning";
  const deepModel = process.env.XAI_DEEP_MODEL ?? "grok-4-fast-reasoning";
  const model = deep ? deepModel : fastModel;

  const deepHint = deep
    ? "\nThe user has asked you to think deeply about this. Reason carefully and give a thorough, well-structured answer, but keep the spoken summary clear."
    : "";

  const latestUserContent = request.interrupted
    ? `[User interrupted while you were speaking. Continue the conversation naturally and address this next input.] ${userMessage}`
    : userMessage;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: `${CHIEF_SYSTEM}${deepHint}\n\n## Cached project context\n${context}` },
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: latestUserContent },
  ];

  const raw = deep
    ? await responsesCompletion(messages, {
        model,
        maxOutputTokens: 1600,
        tools: [{ type: "web_search" }],
      })
    : await chatCompletion(messages, {
        model,
        maxTokens: 800,
      });
  const filtered = await rewriteWithPersona(raw);

  db.prepare(
    `INSERT INTO conversation_log (role, raw_text, filtered_text, model)
     VALUES ('assistant', ?, ?, ?)`,
  ).run(raw, filtered, model);

  db.prepare(
    `INSERT INTO conversation_log (role, raw_text, model)
     VALUES ('user', ?, ?)`,
  ).run(userMessage, model);

  return { raw, filtered, model, deep };
}
