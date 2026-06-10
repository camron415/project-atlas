import { execSync } from "node:child_process";

export function getGitRecentContext(projectPath: string): string {
  const blocks: string[] = [];

  try {
    const head = execSync("git rev-parse --short HEAD", {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    blocks.push(`HEAD: ${head}`);
  } catch {
    blocks.push("HEAD: unavailable");
  }

  try {
    const log = execSync("git log -10 --oneline --no-decorate", {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (log) blocks.push("", "## Recent commits", log);
  } catch {
    // no git log
  }

  try {
    const changed = execSync("git diff --stat HEAD~8..HEAD 2>/dev/null || git diff --stat", {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (changed) blocks.push("", "## Files changed recently", changed.slice(0, 4000));
  } catch {
    // no diff stat
  }

  try {
    const status = execSync("git status -sb", {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (status) blocks.push("", "## Working tree", status.slice(0, 1500));
  } catch {
    // no status
  }

  return blocks.join("\n");
}
