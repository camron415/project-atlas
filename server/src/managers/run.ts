import type { InboxProjectSlug } from "../inbox/types.js";
import type { ManagerRunDeps, ManagerRunResult } from "./types.js";
import { runVocalLearnManager } from "./vocalllearn/run.js";
import { runCareerManager } from "./career/run.js";
import { parseManagerProjects } from "./projects.js";

export async function runManagerForProject(
  deps: ManagerRunDeps,
  project: InboxProjectSlug,
  options?: { force?: boolean },
): Promise<ManagerRunResult> {
  switch (project) {
    case "vocallearn":
      return runVocalLearnManager(deps, options);
    case "career":
      return runCareerManager(deps, options);
    case "atlas":
      return {
        project,
        ok: false,
        error: `Manager not implemented for ${project} yet`,
      };
    default:
      return { project, ok: false, error: `Unknown manager project: ${project}` };
  }
}

export async function runManagers(
  deps: ManagerRunDeps,
  projects = parseManagerProjects(),
  options?: { force?: boolean },
): Promise<ManagerRunResult[]> {
  const results: ManagerRunResult[] = [];
  for (const project of projects) {
    results.push(await runManagerForProject(deps, project, options));
  }
  return results;
}

export { parseManagerProjects };
