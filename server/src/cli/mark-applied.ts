#!/usr/bin/env tsx
/**
 * Mark a job application so Career manager stops prioritizing it.
 * Usage: npm run mark-applied -- "Two Barrels" --role "Junior Software Engineer"
 *        npm run mark-applied -- "Compass" --closed --role "Junior Frontend" --notes "not accepting"
 */
import "../load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  markRoleApplied,
  markListingClosed,
  listAppliedRoles,
  listClosedListings,
} from "../career/applied-roles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(
    JSON.stringify(
      { applied: listAppliedRoles(dataDir), closed: listClosedListings(dataDir) },
      null,
      2,
    ),
  );
  process.exit(0);
}

const company = args.find((a) => !a.startsWith("--"));
if (!company) {
  console.error('Usage: npm run mark-applied -- "Company" [--role "Title"] [--notes "..."]');
  process.exit(1);
}

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (args.includes("--closed")) {
  const entry = markListingClosed(dataDir, {
    company,
    role: flag("--role"),
    reason: flag("--notes") ?? "no longer accepting applications",
    url: flag("--url"),
    closedAt: flag("--date"),
    source: "cli",
  });
  console.log(`Marked closed: ${entry.company} — ${entry.role} (${entry.reason})`);
  console.log(`Total closed: ${listClosedListings(dataDir).length}`);
  process.exit(0);
}

const date = flag("--date");
const entry = markRoleApplied(dataDir, {
  company,
  role: flag("--role"),
  notes: flag("--notes"),
  source: "cli",
  appliedAt: date
    ? date.length === 10
      ? `${date}T12:00:00.000Z`
      : date
    : undefined,
});

console.log(`Marked applied: ${entry.company} — ${entry.role} (${entry.appliedAt.slice(0, 10)})`);
console.log(`Total applied: ${listAppliedRoles(dataDir).length}`);
