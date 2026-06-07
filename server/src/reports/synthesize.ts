import { chatCompletion } from "../xai/client.js";
import { AtlasModels } from "../models/router.js";
import type { ProjectSnapshot } from "../projects/scanner.js";
import { formatInventoryForPrompt } from "../projects/code-inventory.js";

export async function synthesizeProjectReport(
  snapshot: ProjectSnapshot,
): Promise<string | null> {
  if (!process.env.XAI_API_KEY || !snapshot.codeInventory) {
    return null;
  }

  const inventoryBlock = formatInventoryForPrompt(snapshot.codeInventory);

  const prompt = `Summarize this software project for a voice chief-of-staff briefing.

Project: ${snapshot.name}
Path: ${snapshot.path}
Git HEAD: ${snapshot.gitHead ?? "unknown"}

Output plain text (no markdown headers). Include:
1. Current state — 2-3 sentences on what the project is and where it stands
2. Architecture — key folders, stack, and how pieces connect
3. Next steps — 3-5 prioritized, actionable items grounded in the code/docs
4. Practical notes — feasibility risks or dependencies you can infer

Only state facts supported by the excerpts below. If uncertain, say what would need a deeper look.

## Roadmap / docs excerpt
${snapshot.roadmapExcerpt.slice(0, 8000)}

${inventoryBlock}`;

  try {
    return await chatCompletion(
      [
        {
          role: "system",
          content:
            "You are a concise technical analyst. Be specific and actionable. No fluff.",
        },
        { role: "user", content: prompt },
      ],
      { model: AtlasModels.scan(), maxTokens: 1400, temperature: 0.3 },
    );
  } catch {
    return null;
  }
}
