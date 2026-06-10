import type { InboxProjectSlug } from "../inbox/types.js";

/** Inbox/analyst slug → projects.registry.json slug. */
export const ANALYST_REGISTRY_SLUG: Record<InboxProjectSlug, string> = {
  atlas: "atlas",
  vocallearn: "vocalllearn",
  career: "career-dashboard",
};

export function resolveAnalystProject(input: string): InboxProjectSlug | null {
  const key = input.trim().toLowerCase().replace(/\s+/g, "");
  if (key === "atlas") return "atlas";
  if (key === "vocallearn" || key === "vocalllearn") return "vocallearn";
  if (key === "career" || key === "careerdashboard" || key === "career-dashboard") {
    return "career";
  }
  return null;
}

export function registrySlugForAnalyst(project: InboxProjectSlug): string {
  return ANALYST_REGISTRY_SLUG[project];
}
