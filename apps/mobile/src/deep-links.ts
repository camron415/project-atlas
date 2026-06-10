/** Deep links for Shortcuts / Siri — atlas://listen, atlas://ask?text=… */

export type AtlasDeepLink =
  | { action: "listen" }
  | { action: "ask"; text: string };

export function parseAtlasDeepLink(raw: string): AtlasDeepLink | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "atlas:") return null;

    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/^\//, "").toLowerCase();

    if (
      host === "listen" ||
      path === "listen" ||
      (host === "voice" && (path === "start" || path === "listen"))
    ) {
      return { action: "listen" };
    }

    if (host === "ask" || path === "ask") {
      const text = url.searchParams.get("text")?.trim() ?? url.searchParams.get("q")?.trim() ?? "";
      if (!text) return null;
      return { action: "ask", text };
    }

    return null;
  } catch {
    return null;
  }
}

export const SHORTCUT_LISTEN_URL = "atlas://listen";
export const SHORTCUT_ASK_URL = "atlas://ask?text=What%20should%20I%20work%20on%20today%3F";
