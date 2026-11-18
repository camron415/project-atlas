import fs from "node:fs";
import path from "node:path";

export interface AppliedRole {
  id: string;
  company: string;
  role: string;
  appliedAt: string;
  notes?: string;
  source?: string;
}

export interface ClosedListing {
  id: string;
  company: string;
  role: string;
  reason: string;
  closedAt: string;
  url?: string;
  source?: string;
}

export interface CurrentFocusTarget {
  company: string;
  role: string;
  url?: string;
  notes?: string;
}

export interface CurrentFocus {
  updatedAt: string;
  note?: string;
  targets: CurrentFocusTarget[];
}

function appliedPath(dataDir: string): string {
  return path.join(dataDir, "career", "applied-roles.json");
}

function closedPath(dataDir: string): string {
  return path.join(dataDir, "career", "closed-listings.json");
}

function focusPath(dataDir: string): string {
  return path.join(dataDir, "career", "current-focus.json");
}

function ensureDir(dataDir: string): void {
  fs.mkdirSync(path.join(dataDir, "career"), { recursive: true });
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function listAppliedRoles(dataDir: string): AppliedRole[] {
  try {
    const raw = JSON.parse(fs.readFileSync(appliedPath(dataDir), "utf8")) as {
      roles?: AppliedRole[];
    };
    return Array.isArray(raw.roles) ? raw.roles : [];
  } catch {
    return [];
  }
}

export function listClosedListings(dataDir: string): ClosedListing[] {
  try {
    const raw = JSON.parse(fs.readFileSync(closedPath(dataDir), "utf8")) as {
      listings?: ClosedListing[];
    };
    return Array.isArray(raw.listings) ? raw.listings : [];
  } catch {
    return [];
  }
}

export function getCurrentFocus(dataDir: string): CurrentFocus {
  try {
    const raw = JSON.parse(fs.readFileSync(focusPath(dataDir), "utf8")) as CurrentFocus;
    return {
      updatedAt: raw.updatedAt ?? "",
      note: raw.note,
      targets: Array.isArray(raw.targets) ? raw.targets : [],
    };
  } catch {
    return { updatedAt: "", targets: [] };
  }
}

export function setCurrentFocus(
  dataDir: string,
  input: { note?: string; targets: CurrentFocusTarget[] },
): CurrentFocus {
  ensureDir(dataDir);
  const focus: CurrentFocus = {
    updatedAt: new Date().toISOString(),
    note: input.note?.trim() || undefined,
    targets: input.targets.map((t) => ({
      company: t.company.trim(),
      role: t.role.trim(),
      url: t.url?.trim() || undefined,
      notes: t.notes?.trim() || undefined,
    })),
  };
  writeJson(focusPath(dataDir), focus);
  writeEllisBoardSnapshot(dataDir);
  return focus;
}

function persistApplied(dataDir: string, roles: AppliedRole[]): void {
  ensureDir(dataDir);
  writeJson(appliedPath(dataDir), {
    updatedAt: new Date().toISOString(),
    roles,
  });
  writeEllisBoardSnapshot(dataDir);
}

function persistClosed(dataDir: string, listings: ClosedListing[]): void {
  ensureDir(dataDir);
  writeJson(closedPath(dataDir), {
    updatedAt: new Date().toISOString(),
    listings,
  });
  writeEllisBoardSnapshot(dataDir);
}

export function resolveCareerDashboardPath(dataDir: string): string | null {
  const fromEnv = process.env.ATLAS_CAREER_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    const registryPath = path.resolve(dataDir, "../../projects.registry.json");
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      projects?: Array<{ slug?: string; path?: string | null }>;
    };
    const entry = raw.projects?.find((p) => p.slug === "career-dashboard");
    if (entry?.path && fs.existsSync(entry.path)) return entry.path;
  } catch {
    /* skip */
  }
  return null;
}

/** Copy Ellis applied + closed lists into career-dashboard so apply:report can filter. */
export function writeEllisBoardSnapshot(dataDir: string, careerPath?: string): void {
  const destRoot = careerPath ?? resolveCareerDashboardPath(dataDir);
  if (!destRoot) return;
  const destDir = path.join(destRoot, "data");
  fs.mkdirSync(destDir, { recursive: true });
  writeJson(path.join(destDir, "ellis-board.json"), {
    updatedAt: new Date().toISOString(),
    applied: listAppliedRoles(dataDir),
    closed: listClosedListings(dataDir),
    focus: getCurrentFocus(dataDir),
  });
}

export function markRoleApplied(
  dataDir: string,
  input: {
    company: string;
    role?: string;
    notes?: string;
    source?: string;
    appliedAt?: string;
  },
): AppliedRole {
  const company = input.company.trim();
  if (!company) throw new Error("company required");
  const role = (input.role ?? "role TBD").trim();
  const roles = listAppliedRoles(dataDir);

  const existing = roles.find(
    (r) =>
      r.company.toLowerCase() === company.toLowerCase() &&
      r.role.toLowerCase() === role.toLowerCase(),
  );
  if (existing) {
    if (input.notes && !existing.notes) existing.notes = input.notes.trim();
    if (input.appliedAt) existing.appliedAt = input.appliedAt;
    persistApplied(dataDir, roles);
    return existing;
  }

  const entry: AppliedRole = {
    id: `applied-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    company,
    role,
    appliedAt: input.appliedAt ?? new Date().toISOString(),
    notes: input.notes?.trim() || undefined,
    source: input.source ?? "manual",
  };
  roles.unshift(entry);
  persistApplied(dataDir, roles);
  return entry;
}

export function markListingClosed(
  dataDir: string,
  input: {
    company: string;
    role?: string;
    reason?: string;
    url?: string;
    source?: string;
    closedAt?: string;
  },
): ClosedListing {
  const company = input.company.trim();
  if (!company) throw new Error("company required");
  const role = (input.role ?? "role TBD").trim();
  const listings = listClosedListings(dataDir);
  const existing = listings.find(
    (r) =>
      r.company.toLowerCase() === company.toLowerCase() &&
      r.role.toLowerCase() === role.toLowerCase(),
  );
  if (existing) {
    existing.reason = input.reason?.trim() || existing.reason;
    if (input.url) existing.url = input.url.trim();
    persistClosed(dataDir, listings);
    return existing;
  }

  const entry: ClosedListing = {
    id: `closed-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    company,
    role,
    reason: input.reason?.trim() || "no longer accepting applications",
    closedAt: input.closedAt ?? new Date().toISOString().slice(0, 10),
    url: input.url?.trim() || undefined,
    source: input.source ?? "manual",
  };
  listings.unshift(entry);
  persistClosed(dataDir, listings);
  return entry;
}

export function formatAppliedBlock(dataDir: string): string {
  const roles = listAppliedRoles(dataDir);
  if (!roles.length) return "_No applications marked yet._";
  return roles
    .slice(0, 40)
    .map((r) => `- **${r.company}** — ${r.role} (${r.appliedAt.slice(0, 10)})`)
    .join("\n");
}

export function formatClosedBlock(dataDir: string): string {
  const listings = listClosedListings(dataDir);
  if (!listings.length) return "_No closed listings recorded._";
  return listings
    .slice(0, 20)
    .map((r) => `- **${r.company}** — ${r.role} (${r.reason}, ${r.closedAt.slice(0, 10)})`)
    .join("\n");
}

export function formatFocusBlock(dataDir: string): string {
  const focus = getCurrentFocus(dataDir);
  if (!focus.targets.length) return "_No current apply queue — use the live-checked report._";
  const lines = focus.targets.map(
    (t, i) =>
      `- ${i + 1}. **${t.company}** — ${t.role}${t.notes ? ` (${t.notes})` : ""}${t.url ? `\n  ${t.url}` : ""}`,
  );
  if (focus.note) lines.unshift(`_${focus.note}_`);
  if (focus.updatedAt) lines.push(`_Queue updated ${focus.updatedAt.slice(0, 10)}_`);
  return lines.join("\n");
}

export function appliedCompanySet(dataDir: string): Set<string> {
  return new Set(listAppliedRoles(dataDir).map((r) => r.company.toLowerCase()));
}
