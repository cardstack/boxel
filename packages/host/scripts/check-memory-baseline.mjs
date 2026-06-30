#!/usr/bin/env node

// Compares per-module memory deltas from a CI run against a committed baseline.
// Exits 0 on pass/warn, exits 1 on hard failure (>2x baseline or +50MB absolute).
//
// Usage: node check-memory-baseline.mjs <reports-dir> <baseline-json>
//
// <reports-dir> contains per-shard memory-report.json files (merged into one dir).
// <baseline-json> is the committed packages/host/memory-baseline.json.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [reportsDir, baselinePath] = process.argv.slice(2);

if (!reportsDir || !baselinePath) {
  console.error(
    'Usage: node check-memory-baseline.mjs <reports-dir> <baseline-json>',
  );
  process.exit(1);
}

// Load and merge all shard reports
const current = {};
for (const file of readdirSync(reportsDir)) {
  if (!file.endsWith('.json')) continue;
  const shard = JSON.parse(readFileSync(join(reportsDir, file), 'utf8'));
  Object.assign(current, shard);
}

// Load baseline
let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (err) {
  console.log(`No baseline found at ${baselinePath} — skipping check.`);
  process.exit(0);
}

const SOFT_RELATIVE = baseline.threshold?.relative ?? 0.1;
const SOFT_ABSOLUTE_MB = baseline.threshold?.absolute_mb ?? 5;
const HARD_RELATIVE = 1.0; // 2x = 100% increase
const HARD_ABSOLUTE_MB = 50;

const escapeMd = (s) => String(s).replace(/\|/g, '\\|');

// Compare against the rolling-window mean of recent baseline samples so a
// single noisy build can't trip — or anchor — the budget. Fall back to the
// pre-rolling-window `delta_mb` shape so this script keeps working against
// older baseline files until the next main run upgrades them in place.
const baselineDelta = (entry) => {
  if (Array.isArray(entry?.samples) && entry.samples.length > 0) {
    const sum = entry.samples.reduce((a, b) => a + b, 0);
    return sum / entry.samples.length;
  }
  return entry?.delta_mb;
};

// The largest delta the module has produced in the recent window. The hard
// (build-blocking) gate measures the regression from this ceiling, not the
// mean: some modules legitimately swing run-to-run by >100MB because their
// post-GC boundary delta depends on whether the settle-GC fully drains a large
// transient before the measurement. Such a module must not hard-fail on a value
// it has already exhibited — only on one that clears its observed ceiling by the
// hard threshold. When a module's variance is low (ceiling ≈ mean) this is
// equivalent to the mean-based gate. Falls back to the pre-rolling-window
// `delta_mb` shape so older baseline files keep working until main upgrades them.
const baselineCeiling = (entry) => {
  if (Array.isArray(entry?.samples) && entry.samples.length > 0) {
    return Math.max(...entry.samples);
  }
  return entry?.delta_mb;
};

const fmtSamples = (entry) =>
  Array.isArray(entry?.samples) && entry.samples.length > 0
    ? `[${entry.samples.map((s) => s.toFixed(1)).join(', ')}]`
    : null;

const warnings = [];
const failures = [];
const newModules = [];

for (const [mod, data] of Object.entries(current)) {
  if (mod === '__shard_warmup__') continue;
  if (data.delta_mb == null) continue;

  const base = baseline.modules?.[mod];
  if (!base) {
    newModules.push({ mod, delta: data.delta_mb });
    continue;
  }

  const baseDelta = baselineDelta(base);
  if (baseDelta == null) continue;

  // A negative baseline delta means the prior module's garbage was reclaimed
  // partway through this module's window, not that this module actually freed
  // memory. Treat it as noise: floor at 0 so the comparison falls back to the
  // absolute thresholds rather than a bogus relative budget sized to |noise|.
  const effectiveBase = Math.max(baseDelta, 0);
  const diff = data.delta_mb - effectiveBase;
  // Only flag increases
  if (diff <= 0) continue;

  // The soft (warning, non-blocking) gate stays anchored to the mean so a module
  // trending upward still surfaces early. The hard (build-blocking) gate is
  // anchored to the recent ceiling: it fires only when the current run clears
  // the highest recent sample by the hard threshold, so a high-variance module
  // can't be blocked by a value inside its own observed range.
  const ceiling = Math.max(baselineCeiling(base) ?? baseDelta, 0);
  const hardDiff = data.delta_mb - ceiling;

  const softThreshold = Math.max(
    SOFT_ABSOLUTE_MB,
    effectiveBase * SOFT_RELATIVE,
  );
  const hardThreshold = Math.max(
    HARD_ABSOLUTE_MB,
    effectiveBase * HARD_RELATIVE,
  );

  const pct =
    effectiveBase > 0 ? ((diff / effectiveBase) * 100).toFixed(0) : null;
  const samples = fmtSamples(base);

  if (hardDiff >= hardThreshold) {
    failures.push({
      mod,
      baseline: effectiveBase,
      current: data.delta_mb,
      diff,
      pct,
      samples,
    });
  } else if (diff >= softThreshold) {
    warnings.push({
      mod,
      baseline: effectiveBase,
      current: data.delta_mb,
      diff,
      pct,
      samples,
    });
  }
}

// Build summary
const lines = [];
lines.push('## Memory Baseline Check\n');

const totalModules = Object.keys(current).filter(
  (m) => m !== '__shard_warmup__',
).length;
const baselineModules = Object.keys(baseline.modules || {}).length;
lines.push(
  `Checked **${totalModules}** modules against baseline (${baselineModules} baselined).\n`,
);

if (failures.length === 0 && warnings.length === 0) {
  lines.push('All modules within threshold. No memory regressions detected.\n');
}

const samplesWindow = baseline.samplesWindow ?? 1;
const baselineHeader =
  samplesWindow > 1 ? `Baseline (mean of last ${samplesWindow})` : 'Baseline';

if (failures.length > 0) {
  lines.push(
    `### Failures (>${HARD_RELATIVE * 100}% increase or +${HARD_ABSOLUTE_MB}MB)\n`,
  );
  lines.push(
    `| Module | ${baselineHeader} | Current | Change | Recent samples |`,
  );
  lines.push('|--------|----------|---------|--------|----------------|');
  for (const f of failures.sort((a, b) => b.diff - a.diff)) {
    const pctStr = f.pct != null ? ` (+${f.pct}%)` : '';
    lines.push(
      `| ${escapeMd(f.mod)} | ${f.baseline.toFixed(1)} MB | ${f.current.toFixed(1)} MB | +${f.diff.toFixed(1)} MB${pctStr} | ${f.samples ?? '—'} |`,
    );
  }
  lines.push('');
}

if (warnings.length > 0) {
  lines.push(
    `### Warnings (>${SOFT_RELATIVE * 100}% + ${SOFT_ABSOLUTE_MB}MB increase)\n`,
  );
  lines.push(
    `| Module | ${baselineHeader} | Current | Change | Recent samples |`,
  );
  lines.push('|--------|----------|---------|--------|----------------|');
  for (const w of warnings.sort((a, b) => b.diff - a.diff)) {
    const pctStr = w.pct != null ? ` (+${w.pct}%)` : '';
    lines.push(
      `| ${escapeMd(w.mod)} | ${w.baseline.toFixed(1)} MB | ${w.current.toFixed(1)} MB | +${w.diff.toFixed(1)} MB${pctStr} | ${w.samples ?? '—'} |`,
    );
  }
  lines.push('');
}

if (newModules.length > 0) {
  lines.push(
    `<details><summary>${newModules.length} new module(s) not in baseline</summary>\n`,
  );
  for (const n of newModules.sort((a, b) => b.delta - a.delta)) {
    lines.push(`- **${escapeMd(n.mod)}**: ${n.delta.toFixed(1)} MB`);
  }
  lines.push('</details>\n');
}

const summary = lines.join('\n');
console.log(summary);

// Write to GITHUB_STEP_SUMMARY if available
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n', {
    flag: 'a',
  });
}

if (failures.length > 0) {
  console.error(
    `\nFAILED: ${failures.length} module(s) exceeded hard memory threshold.`,
  );
  process.exit(1);
}

if (warnings.length > 0) {
  console.log(
    `\nWARN: ${warnings.length} module(s) exceeded soft memory threshold.`,
  );
}
