/** Strip tool leakage and code-syntax artifacts from voice replies before TTS / client display. */

const TOOL_NAMES =
  /\b(?:write_inbox|dispatch_analyst|search_context|web_lookup|check_email|dispatch_worker)\b/gi;

const ACTION_CALL_LINE = /^\s*Action:\s*Call\b.*$/gim;
const ACTION_CALL_INLINE = /\bAction:\s*Call\s+\w+[^\n]*/gi;
const FILE_PATH =
  /(?:\/Users\/[^\s]+|\/[^\s]*\/inbox\/[^\s]*)\.md\b/gi;
const BACKTICKS = /`([^`]*)`/g;
const CONFIRMED_PARAM = /\bconfirmed\s*=\s*(?:true|false)\b/gi;

export function sanitizeVoiceReply(text: string): string {
  const original = text.trim();
  if (!original) return original;

  let out = original;
  out = out.replace(ACTION_CALL_LINE, "");
  out = out.replace(ACTION_CALL_INLINE, "");
  out = out.replace(BACKTICKS, "$1");
  out = out.replace(/`/g, "");
  out = out.replace(FILE_PATH, "");
  out = out.replace(TOOL_NAMES, "");
  out = out.replace(CONFIRMED_PARAM, "");
  out = out.replace(/\bCall\s+(?:write_inbox|dispatch_analyst|search_context|web_lookup)\b[^\n]*/gi, "");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/  +/g, " ");
  out = out.trim();

  return out || original;
}
