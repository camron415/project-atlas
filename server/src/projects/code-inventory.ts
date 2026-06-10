import fs from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  "ios",
  "android",
  "Pods",
  "__pycache__",
  ".next",
  "coverage",
  ".cache",
  "DerivedData",
  ".turbo",
  "vendor",
  ".venv",
  "venv",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".swift",
  ".go",
  ".rs",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

const PRIORITY_FILENAMES = new Set([
  "README.md",
  "ROADMAP.md",
  "HANDOFF.md",
  "PERSONA.md",
  "PHASE_1_75.md",
  "PHASE_1_5_CLOSEOUT.md",
  "VOICE_PHASE4.md",
  "VOICE_BASELINE.md",
  "package.json",
  "tsconfig.json",
  "app.json",
  "pyproject.toml",
  "Cargo.toml",
]);

export interface SourceExcerpt {
  relativePath: string;
  bytes: number;
  excerpt: string;
}

export interface CodeInventory {
  totalFiles: number;
  sourceFilesMatched: number;
  treePreview: string[];
  sourceExcerpts: SourceExcerpt[];
  scannedAt: string;
}

export interface InventoryOptions {
  maxTreeEntries?: number;
  maxSourceFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  maxDepth?: number;
}

const DEFAULT_OPTIONS: Required<InventoryOptions> = {
  maxTreeEntries: 500,
  maxSourceFiles: 72,
  maxBytesPerFile: 6000,
  maxTotalBytes: 180_000,
  maxDepth: 10,
};

function shouldSkipDir(name: string): boolean {
  return IGNORE_DIRS.has(name) || name.startsWith(".");
}

function isSourceFile(relativePath: string): boolean {
  const base = path.basename(relativePath);
  if (PRIORITY_FILENAMES.has(base)) return true;
  const ext = path.extname(relativePath).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

function scoreSourceFile(relativePath: string): number {
  const lower = relativePath.toLowerCase();
  let score = 0;
  if (PRIORITY_FILENAMES.has(path.basename(relativePath))) score += 100;
  if (lower.includes("readme") || lower.includes("roadmap") || lower.includes("handoff")) score += 80;
  if (lower.includes("phase_1") || lower.includes("voice_phase") || lower.includes("voice_baseline")) {
    score += 95;
  }
  if (lower.includes("/inbox/") || lower.startsWith("inbox/")) score += 90;
  if (lower.includes("/analyst/") || lower.includes("realtime-proxy")) score += 85;
  if (lower.startsWith("docs/")) score += 60;
  if (lower.includes("/src/") || lower.startsWith("src/")) score += 40;
  if (lower.includes("server/") || lower.includes("apps/")) score += 30;
  if (lower.endsWith(".md")) score += 20;
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) score += 15;
  if (lower.includes("test") || lower.includes("__tests__")) score -= 10;
  if (lower.includes("package-lock") || lower.endsWith(".lock")) score -= 100;
  return score;
}

export function buildCodeInventory(
  projectRoot: string,
  options: InventoryOptions = {},
): CodeInventory {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const treePreview: string[] = [];
  const candidateSources: Array<{ relativePath: string; score: number }> = [];
  let totalFiles = 0;
  let sourceFilesMatched = 0;

  function walk(current: string, depth: number): void {
    if (depth > opts.maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        if (treePreview.length < opts.maxTreeEntries) {
          treePreview.push(`${relativePath}/`);
        }
        walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      totalFiles += 1;

      if (treePreview.length < opts.maxTreeEntries) {
        treePreview.push(relativePath);
      }

      if (isSourceFile(relativePath)) {
        sourceFilesMatched += 1;
        candidateSources.push({
          relativePath,
          score: scoreSourceFile(relativePath),
        });
      }
    }
  }

  walk(projectRoot, 0);

  candidateSources.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));

  const sourceExcerpts: SourceExcerpt[] = [];
  let totalBytes = 0;

  for (const candidate of candidateSources) {
    if (sourceExcerpts.length >= opts.maxSourceFiles) break;
    if (totalBytes >= opts.maxTotalBytes) break;

    const fullPath = path.join(projectRoot, candidate.relativePath);
    let raw: string;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > opts.maxBytesPerFile * 4) continue;
      raw = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    const excerpt = raw.slice(0, opts.maxBytesPerFile);
    totalBytes += excerpt.length;
    sourceExcerpts.push({
      relativePath: candidate.relativePath,
      bytes: excerpt.length,
      excerpt,
    });
  }

  return {
    totalFiles,
    sourceFilesMatched,
    treePreview: treePreview.slice(0, opts.maxTreeEntries),
    sourceExcerpts,
    scannedAt: new Date().toISOString(),
  };
}

export function formatInventoryForPrompt(inventory: CodeInventory): string {
  const lines = [
    `Total files indexed: ${inventory.totalFiles}`,
    `Source-like files matched: ${inventory.sourceFilesMatched}`,
    `Deep-read files: ${inventory.sourceExcerpts.length}`,
    "",
    "## Directory tree (preview)",
    inventory.treePreview.slice(0, 120).join("\n"),
  ];

  if (inventory.treePreview.length > 120) {
    lines.push(`… and ${inventory.treePreview.length - 120} more paths`);
  }

  lines.push("", "## Source excerpts");
  for (const file of inventory.sourceExcerpts) {
    lines.push(`### ${file.relativePath} (${file.bytes} chars)`);
    lines.push(file.excerpt);
    lines.push("");
  }

  return lines.join("\n").slice(0, 48_000);
}
