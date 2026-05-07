#!/usr/bin/env ts-node
/**
 * factory-stats — summarise instrumentation JSONL produced by the
 * realm-server's openrouter-passthrough.
 *
 * Usage:
 *   pnpm factory:stats <path-to-jsonl>
 *   pnpm factory:stats   # uses $FACTORY_INSTRUMENT_PATH
 *
 * Aggregates the answers to the four hypotheses in
 * packages/software-factory/OPENCODE_PERFORMANCE.md:
 *   H1 — tool_calls per assistant response (distribution + average)
 *   H2 — per-step prompt overhead (system / tools / messages / total)
 *   H3 — wall-clock per step (TTFB + duration)
 *   H4 — model identity (set of distinct model names)
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

interface RequestStats {
  model: string | null;
  parallelToolCalls: boolean | null;
  toolChoice: unknown;
  systemChars: number;
  systemTokensEst: number;
  toolsCount: number;
  toolsChars: number;
  toolsTokensEst: number;
  messagesCount: number;
  messagesChars: number;
  messagesTokensEst: number;
  totalInputChars: number;
  totalInputTokensEst: number;
}

interface ResponseStats {
  toolCallsCount: number;
  toolCallNames: string[];
  assistantTextChars: number;
  finishReason: string | null;
  usagePromptTokens: number | null;
  usageCompletionTokens: number | null;
  usageTotalTokens: number | null;
  ttfbMs: number | null;
  durationMs: number;
}

interface Record {
  ts: string;
  user: string;
  endpoint: string;
  request: RequestStats;
  response: ResponseStats;
}

const args = process.argv.slice(2);
const pathArg = args[0] ?? process.env.FACTORY_INSTRUMENT_PATH;
if (!pathArg) {
  console.error(
    'usage: factory-stats <path-to-jsonl>  (or set FACTORY_INSTRUMENT_PATH)',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const resolved = path.resolve(pathArg!);
  const text = await fs.readFile(resolved, 'utf8');
  const records: Record[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line) as Record);
    } catch {
      // skip malformed lines
    }
  }
  if (records.length === 0) {
    console.error(`No records in ${resolved}`);
    process.exit(1);
  }

  console.log(`# Factory instrumentation summary`);
  console.log(`source: ${resolved}`);
  console.log(`records: ${records.length}`);
  const start = records[0].ts;
  const end = records[records.length - 1].ts;
  console.log(`first:   ${start}`);
  console.log(`last:    ${end}`);
  const wallSpanMs = new Date(end).getTime() - new Date(start).getTime();
  console.log(`span:    ${formatDuration(wallSpanMs)}`);
  console.log();

  // H4: model identity
  console.log(`## H4 — Models seen`);
  const modelCounts = countBy(records, (r) => r.request.model ?? '<none>');
  for (const [model, n] of sortByCountDesc(modelCounts)) {
    console.log(`  ${model.padEnd(40)} ${n} requests`);
  }
  console.log();

  // H1: tool_calls per response
  console.log(`## H1 — Tool calls per assistant response`);
  const tcCounts = records.map((r) => r.response.toolCallsCount);
  console.log(`  total responses:       ${tcCounts.length}`);
  console.log(`  total tool_calls:      ${sum(tcCounts)}`);
  console.log(`  avg tool_calls/resp:   ${avg(tcCounts).toFixed(2)}`);
  console.log(`  median:                ${median(tcCounts)}`);
  console.log(`  max:                   ${Math.max(...tcCounts)}`);
  const tcDist = distribution(tcCounts);
  console.log(`  distribution:`);
  for (const [bucket, n] of [...tcDist.entries()].sort((a, b) => a[0] - b[0])) {
    const pct = ((n / tcCounts.length) * 100).toFixed(1);
    console.log(
      `    ${String(bucket).padStart(3)} tool_calls: ${String(n).padStart(4)} responses (${pct}%)`,
    );
  }
  const toolNameCounts = countBy(
    records.flatMap((r) => r.response.toolCallNames),
    (n) => n,
  );
  console.log(`  tool name frequency:`);
  for (const [name, n] of sortByCountDesc(toolNameCounts).slice(0, 12)) {
    console.log(`    ${name.padEnd(28)} ${n}`);
  }
  console.log();

  // H2: per-step prompt overhead
  console.log(`## H2 — Per-step prompt overhead (estimated)`);
  console.log(
    `  (token counts are chars/4 estimates; for ground truth see usage.prompt_tokens below)`,
  );
  console.log();
  reportField(
    '  system_tokens_est        ',
    records,
    (r) => r.request.systemTokensEst,
  );
  reportField(
    '  tools_tokens_est         ',
    records,
    (r) => r.request.toolsTokensEst,
  );
  reportField(
    '  messages_tokens_est      ',
    records,
    (r) => r.request.messagesTokensEst,
  );
  reportField(
    '  total_input_tokens_est   ',
    records,
    (r) => r.request.totalInputTokensEst,
  );
  console.log();
  console.log(`  Distinct tool counts:`);
  const toolCountCounts = countBy(records, (r) => String(r.request.toolsCount));
  for (const [count, n] of sortByCountDesc(toolCountCounts)) {
    console.log(`    tools=${count.padStart(3)}: ${n} requests`);
  }
  const ptcSeen = new Set(
    records.map((r) => String(r.request.parallelToolCalls)),
  );
  console.log(`  parallel_tool_calls values seen: ${[...ptcSeen].join(', ')}`);
  console.log();

  // Ground truth usage
  console.log(`## Usage tokens (ground truth from provider)`);
  const promptTokens = records
    .map((r) => r.response.usagePromptTokens)
    .filter((v): v is number => typeof v === 'number');
  const completionTokens = records
    .map((r) => r.response.usageCompletionTokens)
    .filter((v): v is number => typeof v === 'number');
  if (promptTokens.length === 0 && completionTokens.length === 0) {
    console.log(
      `  (no usage tokens reported by provider — common for streaming on some providers)`,
    );
  } else {
    reportField(
      '  usage_prompt_tokens      ',
      records.filter((r) => typeof r.response.usagePromptTokens === 'number'),
      (r) => r.response.usagePromptTokens as number,
    );
    reportField(
      '  usage_completion_tokens  ',
      records.filter(
        (r) => typeof r.response.usageCompletionTokens === 'number',
      ),
      (r) => r.response.usageCompletionTokens as number,
    );
    console.log(
      `  total prompt tokens (sum):     ${sum(promptTokens).toLocaleString()}`,
    );
    console.log(
      `  total completion tokens (sum): ${sum(completionTokens).toLocaleString()}`,
    );
  }
  console.log();

  // H3: wall-clock per step
  console.log(`## H3 — Wall-clock per request`);
  const ttfb = records
    .map((r) => r.response.ttfbMs)
    .filter((v): v is number => typeof v === 'number');
  const dur = records.map((r) => r.response.durationMs);
  if (ttfb.length > 0) {
    reportField(
      '  ttfb_ms                  ',
      ttfb.map((v) => ({ value: v })),
      (r) => r.value,
    );
  }
  reportField(
    '  duration_ms              ',
    dur.map((v) => ({ value: v })),
    (r) => r.value,
  );
  const totalSec = sum(dur) / 1000;
  console.log(
    `  sum of all request durations:  ${formatDuration(sum(dur))}  (${totalSec.toFixed(0)}s)`,
  );
  console.log(`  wall-clock span first..last:   ${formatDuration(wallSpanMs)}`);
  console.log(
    `  idle time between requests:    ${formatDuration(Math.max(0, wallSpanMs - sum(dur)))}`,
  );
  console.log();

  // Finish reasons
  console.log(`## Finish reasons`);
  const finishCounts = countBy(
    records,
    (r) => r.response.finishReason ?? '<none>',
  );
  for (const [reason, n] of sortByCountDesc(finishCounts)) {
    console.log(`  ${reason.padEnd(20)} ${n}`);
  }
}

function countBy<T>(items: T[], keyFn: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = keyFn(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function sortByCountDesc(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function distribution(xs: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function reportField<T>(
  label: string,
  records: T[],
  pick: (r: T) => number,
): void {
  if (records.length === 0) {
    console.log(`${label} (no data)`);
    return;
  }
  const xs = records.map(pick);
  const sorted = [...xs].sort((a, b) => a - b);
  const p50 = median(xs);
  const p90 =
    sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))];
  console.log(
    `${label} avg=${avg(xs).toFixed(0).padStart(8)}  p50=${String(p50).padStart(8)}  p90=${String(p90).padStart(8)}  min=${String(sorted[0]).padStart(7)}  max=${String(sorted[sorted.length - 1]).padStart(8)}  n=${xs.length}`,
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m === 0) return `${rs}s`;
  return `${m}m${String(rs).padStart(2, '0')}s`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
