#!/usr/bin/env tsx
/**
 * Generate a career apply packet (resume + cover letter PDFs).
 *
 * Usage:
 *   npm run generate-packet -- --company "Compass" --role "Junior Frontend" --url "https://..."
 */
import "../load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../projects/registry.js";
import { findRegistryProject } from "../managers/projects.js";
import { generateCareerPacket } from "../career/generate-packet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const company = arg("--company") ?? process.argv[2];
const role = arg("--role") ?? process.argv[3];
const url = arg("--url");
const packet = arg("--packet");

if (!company || !role) {
  console.error(
    'Usage: npm run generate-packet -- --company "Name" --role "Title" [--url "https://..."]',
  );
  process.exit(1);
}

const registry = loadRegistry();
const entry = findRegistryProject(registry, "career");
if (!entry?.path) {
  console.error("career-dashboard path missing in projects.registry.json");
  process.exit(1);
}

const result = generateCareerPacket({
  careerPath: entry.path,
  company,
  role,
  url,
  packet,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
