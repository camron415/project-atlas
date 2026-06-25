import type Database from "better-sqlite3";
import { estimateTokenCostUsd } from "./pricing.js";

export interface ApiUsageRecord {
  task: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}

export interface CostTaskSummary {
  task: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}

export interface CostMonthSummary {
  month: string;
  budgetUsd: number;
  totalUsd: number;
  percentUsed: number;
  overBudget: boolean;
  warnThreshold: boolean;
  byTask: CostTaskSummary[];
}

let ledgerDb: Database.Database | null = null;
let budgetWarnedThisMonth = false;

export function initCostLedger(db: Database.Database): void {
  ledgerDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'xai',
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_api_usage_created
      ON api_usage(created_at DESC);
  `);
}

function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function monthlyBudgetUsd(): number {
  const raw = Number(process.env.ATLAS_MONTHLY_BUDGET_USD ?? 50);
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
}

export function budgetWarnPercent(): number {
  const raw = Number(process.env.ATLAS_BUDGET_WARN_PERCENT ?? 80);
  return Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 80;
}

export function recordApiUsage(record: ApiUsageRecord): void {
  if (!ledgerDb) return;

  const estimatedUsd =
    record.estimatedUsd > 0
      ? record.estimatedUsd
      : estimateTokenCostUsd(record.model, record.inputTokens, record.outputTokens);

  ledgerDb
    .prepare(
      `INSERT INTO api_usage (task, provider, model, input_tokens, output_tokens, estimated_usd)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.task,
      record.provider,
      record.model,
      record.inputTokens,
      record.outputTokens,
      estimatedUsd,
    );

  maybeWarnBudget();
}

function maybeWarnBudget(): void {
  if (!ledgerDb || budgetWarnedThisMonth) return;
  const summary = getCostMonthSummary(ledgerDb);
  if (summary.percentUsed < budgetWarnPercent()) return;
  budgetWarnedThisMonth = true;
  console.warn(
    `[atlas:cost] Month-to-date $${summary.totalUsd.toFixed(2)} is ${summary.percentUsed.toFixed(0)}% of $${summary.budgetUsd} budget`,
  );
}

export function getCostMonthSummary(db: Database.Database, month = monthKey()): CostMonthSummary {
  const budgetUsd = monthlyBudgetUsd();
  const start = `${month}-01T00:00:00.000Z`;
  const endMonth = month.slice(0, 7);
  const nextMonth = (() => {
    const [y, m] = endMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    return d.toISOString().slice(0, 7);
  })();
  const end = `${nextMonth}-01T00:00:00.000Z`;

  const rows = db
    .prepare(
      `SELECT task, model,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(estimated_usd), 0) AS estimated_usd
       FROM api_usage
       WHERE created_at >= ? AND created_at < ?
       GROUP BY task, model
       ORDER BY estimated_usd DESC`,
    )
    .all(start, end) as Array<{
    task: string;
    model: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    estimated_usd: number;
  }>;

  const byTask: CostTaskSummary[] = rows.map((row) => ({
    task: row.task,
    model: row.model,
    calls: row.calls,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedUsd: Math.round(row.estimated_usd * 1_000_000) / 1_000_000,
  }));

  const totalUsd = byTask.reduce((sum, row) => sum + row.estimatedUsd, 0);
  const roundedTotal = Math.round(totalUsd * 1_000_000) / 1_000_000;
  const percentUsed = budgetUsd > 0 ? (roundedTotal / budgetUsd) * 100 : 0;

  return {
    month,
    budgetUsd,
    totalUsd: roundedTotal,
    percentUsed: Math.round(percentUsed * 10) / 10,
    overBudget: roundedTotal > budgetUsd,
    warnThreshold: percentUsed >= budgetWarnPercent(),
    byTask,
  };
}

export function getCostMtdSnapshot(db: Database.Database): {
  monthUsd: number;
  budgetUsd: number;
  percentUsed: number;
  overBudget: boolean;
  warnThreshold: boolean;
} {
  const s = getCostMonthSummary(db);
  return {
    monthUsd: s.totalUsd,
    budgetUsd: s.budgetUsd,
    percentUsed: s.percentUsed,
    overBudget: s.overBudget,
    warnThreshold: s.warnThreshold,
  };
}
