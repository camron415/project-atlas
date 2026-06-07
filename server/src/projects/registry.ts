import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProjectWorker {
  id: string;
  description: string;
  cadence?: string;
  modelTier?: string;
  enabled?: boolean;
}

export interface RegistryProject {
  slug: string;
  name: string;
  priority: number;
  status: "active" | "placeholder" | "archived";
  path: string | null;
  targetPath?: string;
  roadmapFiles?: string[];
  reportCadence?: string;
  workers?: ProjectWorker[];
}

export interface ProjectRegistry {
  version: number;
  projectsRoot: string;
  projects: RegistryProject[];
}

export function loadRegistry(registryPath?: string): ProjectRegistry {
  const resolved =
    registryPath ??
    process.env.ATLAS_REGISTRY_PATH ??
    path.resolve(__dirname, "../../../projects.registry.json");

  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw) as ProjectRegistry;
}

export function getActiveProjects(registry: ProjectRegistry): RegistryProject[] {
  return registry.projects
    .filter((p) => p.status === "active" && p.path)
    .sort((a, b) => a.priority - b.priority);
}
