import { chatCompletion } from "../xai/client.js";
import { AtlasModels } from "../models/router.js";

/**
 * Refine casual user speech into a precise analyst focus prompt.
 * Chief also does this in instructions; this is a server-side backup at tool time.
 */
export async function refineAnalystFocus(
  userIntent: string,
  projectName: string,
): Promise<string> {
  const intent = userIntent.trim();
  if (!intent) return "General project status, architecture, and top risks";

  if (!process.env.XAI_API_KEY) {
    return intent;
  }

  try {
    const refined = await chatCompletion(
      [
        {
          role: "system",
          content:
            "You translate casual spoken requests into one precise analyst focus sentence for a read-only code review. Output only the focus sentence — no preamble.",
        },
        {
          role: "user",
          content: `Project: ${projectName}\nUser said: ${intent}\n\nAnalyst focus:`,
        },
      ],
      { model: AtlasModels.fast(), temperature: 0.2, maxTokens: 120 },
    );
    return refined.trim() || intent;
  } catch {
    return intent;
  }
}

/** Plain-English digest of analyst markdown for chief to read aloud. */
export async function simplifyAnalystBrief(markdown: string): Promise<string> {
  const text = markdown.trim();
  if (!text) return "";
  if (!process.env.XAI_API_KEY) return text.slice(0, 1200);

  try {
    const simple = await chatCompletion(
      [
        {
          role: "system",
          content:
            "Rewrite technical analyst notes into plain English for voice. Keep all facts. Use short sentences. No markdown. 4-8 sentences max.",
        },
        { role: "user", content: text },
      ],
      { model: AtlasModels.fast(), temperature: 0.2, maxTokens: 400 },
    );
    return simple.trim() || text.slice(0, 1200);
  } catch {
    return text.slice(0, 1200);
  }
}
