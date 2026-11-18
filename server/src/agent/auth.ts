import type { Request, Response, NextFunction } from "express";

/** Shared-secret auth for phone / external voice-agent tools. */
export function requireAgentToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ATLAS_AGENT_TOKEN?.trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: "agent_token_not_configured",
      message: "Set ATLAS_AGENT_TOKEN in server/.env to enable phone-agent tools.",
    });
    return;
  }

  const header = req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";
  const provided = bearer || queryToken;

  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  next();
}
