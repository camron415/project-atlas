/** Realtime function tools for Phase 1.75 chief ↔ analyst workflow. */

export const ANALYST_REALTIME_TOOLS: Array<Record<string, unknown>> = [
  {
    type: "function",
    name: "request_analyst_review",
    description:
      "Enqueue a read-only analyst review of a project repo. ONLY call after Camron explicitly confirms (yes/proceed/go ahead). Never call on first mention — confirm first like Jarvis.",
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          enum: ["atlas", "vocallearn", "career"],
          description: "Project to review",
        },
        focus: {
          type: "string",
          description:
            "Refined technical focus for the analyst (translate casual user words into a precise review question)",
        },
        user_intent_summary: {
          type: "string",
          description: "Plain English restatement of what Camron asked, for confirmation",
        },
        deep: {
          type: "boolean",
          description: "True only if user asked for fresh/latest/deep scan (slower, 30-90s)",
        },
        confirmed: {
          type: "boolean",
          description: "Must be true — only after explicit user confirmation",
        },
      },
      required: ["project", "focus", "user_intent_summary", "confirmed"],
    },
  },
  {
    type: "function",
    name: "get_analyst_status",
    description: "Poll status of a running or completed analyst job. Call after request_analyst_review returns a job_id.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Analyst job id from request_analyst_review" },
      },
      required: ["job_id"],
    },
  },
  {
    type: "function",
    name: "write_inbox_summary",
    description:
      "Save session close artifact to project inbox markdown. Use when Camron asks to save/summarize the session to inbox.",
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          enum: ["atlas", "vocallearn", "career"],
        },
        title: { type: "string", description: "Short session title" },
        summary: {
          type: "string",
          description: "Chief narrative summary of the conversation and decisions",
        },
        action_items: {
          type: "array",
          items: { type: "string" },
          description: "Agreed next steps",
        },
        analyst_job_id: {
          type: "string",
          description: "Optional analyst job id to include findings",
        },
        session_id: {
          type: "string",
          description: "Optional chat session id",
        },
      },
      required: ["project", "title", "summary"],
    },
  },
];
