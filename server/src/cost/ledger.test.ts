import assert from "node:assert/strict";
import { getDb } from "../db/schema.js";
import {
  initCostLedger,
  recordApiUsage,
  getCostMonthSummary,
  monthlyBudgetUsd,
} from "./ledger.js";
import { estimateTokenCostUsd } from "./pricing.js";

const db = getDb(":memory:");
initCostLedger(db);

recordApiUsage({
  task: "analyst",
  provider: "xai",
  model: "grok-4-fast-non-reasoning",
  inputTokens: 10_000,
  outputTokens: 2_000,
  estimatedUsd: 0,
});

recordApiUsage({
  task: "voice-chief",
  provider: "xai",
  model: "grok-4-fast-non-reasoning",
  inputTokens: 5_000,
  outputTokens: 500,
  estimatedUsd: 0,
});

const summary = getCostMonthSummary(db);
assert.ok(summary.totalUsd > 0, "expected positive MTD cost");
assert.equal(summary.budgetUsd, monthlyBudgetUsd());
assert.equal(summary.byTask.length, 2);
assert.ok(summary.byTask.some((t) => t.task === "analyst"), "expected analyst task");

const est = estimateTokenCostUsd("grok-4-fast-non-reasoning", 1_000_000, 1_000_000);
assert.ok(est > 0.5 && est < 1.0, `unexpected estimate: ${est}`);

console.log("cost/ledger.test.ts: ok");
