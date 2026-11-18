import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GeneratePacketResult {
  ok: boolean;
  dir?: string;
  folder?: string;
  applyUrl?: string | null;
  files?: string[];
  error?: string;
  raw?: string;
}

/** Wrap career-dashboard `npm run packet:generate`. */
export function generateCareerPacket(input: {
  careerPath: string;
  company: string;
  role: string;
  url?: string;
  packet?: string;
}): GeneratePacketResult {
  if (!input.company.trim() || !input.role.trim()) {
    return { ok: false, error: "company_and_role_required" };
  }
  if (!fs.existsSync(input.careerPath)) {
    return { ok: false, error: `career path missing: ${input.careerPath}` };
  }

  const args = [
    "run",
    "packet:generate",
    "--",
    "--company",
    input.company.trim(),
    "--role",
    input.role.trim(),
  ];
  if (input.url?.trim()) {
    args.push("--url", input.url.trim());
  }
  if (input.packet?.trim()) {
    args.push("--packet", input.packet.trim());
  }

  try {
    const raw = execFileSync("npm", args, {
      cwd: input.careerPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      maxBuffer: 4_000_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const jsonStart = raw.lastIndexOf("{");
    const parsed = jsonStart >= 0 ? (JSON.parse(raw.slice(jsonStart)) as GeneratePacketResult) : null;
    if (parsed?.ok && parsed.dir) {
      return { ...parsed, raw };
    }
    return {
      ok: false,
      error: "packet generate returned unexpected output",
      raw,
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      error: err.message ?? String(error),
      raw: `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim(),
    };
  }
}

export function packetDirExists(careerPath: string, folder: string): boolean {
  return fs.existsSync(
    path.join(careerPath, "public", "resume-exports", "applications", folder),
  );
}
