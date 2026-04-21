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

const SOFT_RELATIVE = baseline.threshold?.relative ?? 0.10;
const SOFT_ABSOLUTE_MB = baseline.threshold?.absolute_mb ?? 5;
const HARD_RELATIVE = 1.0; // 2x = 100% increase
const HARD_ABSOLUTE_MB = 50;

const escapeMd = (s) => String(s).replace(/\|/g, '\\|');

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

  const baseDelta = base.delta_mb;
  if (baseDelta == null) continue;

  const diff = data.delta_mb - baseDelta;
  const absDiff = Math.abs(diff);
  // Only flag increases
  if (diff <= 0) continue;

  const softThreshold = Math.max(SOFT_ABSOLUTE_MB, Math.abs(baseDelta) * SOFT_RELATIVE);
  const hardThreshold = Math.max(HARD_ABSOLUTE_MB, Math.abs(baseDelta) * HARD_RELATIVE);

  if (absDiff >= hardThreshold) {
    failures.push({
      mod,
      baseline: baseDelta,
      current: data.delta_mb,
      diff,
      pct: baseDelta !== 0 ? ((diff / Math.abs(baseDelta)) * 100).toFixed(0) : 'inf',
    });
  } else if (absDiff >= softThreshold) {
    warnings.push({
      mod,
      baseline: baseDelta,
      current: data.delta_mb,
      diff,
      pct: baseDelta !== 0 ? ((diff / Math.abs(baseDelta)) * 100).toFixed(0) : 'inf',
    });
  }
}

// Build summary
const lines = [];
lines.push('## Memory Baseline Check\n');

const totalModules = Object.keys(current).filter((m) => m !== '__shard_warmup__').length;
const baselineModules = Object.keys(baseline.modules || {}).length;
lines.push(
  `Checked **${totalModules}** modules against baseline (${baselineModules} baselined).\n`,
);

if (failures.length === 0 && warnings.length === 0) {
  lines.push('All modules within threshold. No memory regressions detected.\n');
}

if (failures.length > 0) {
  lines.push(`### Failures (>${HARD_RELATIVE * 100}% increase or +${HARD_ABSOLUTE_MB}MB)\n`);
  lines.push('| Module | Baseline | Current | Change |');
  lines.push('|--------|----------|---------|--------|');
  for (const f of failures.sort((a, b) => b.diff - a.diff)) {
    lines.push(
      `| ${escapeMd(f.mod)} | ${f.baseline.toFixed(1)} MB | ${f.current.toFixed(1)} MB | +${f.diff.toFixed(1)} MB (+${f.pct}%) |`,
    );
  }
  lines.push('');
}

if (warnings.length > 0) {
  lines.push(`### Warnings (>${SOFT_RELATIVE * 100}% + ${SOFT_ABSOLUTE_MB}MB increase)\n`);
  lines.push('| Module | Baseline | Current | Change |');
  lines.push('|--------|----------|---------|--------|');
  for (const w of warnings.sort((a, b) => b.diff - a.diff)) {
    lines.push(
      `| ${escapeMd(w.mod)} | ${w.baseline.toFixed(1)} MB | ${w.current.toFixed(1)} MB | +${w.diff.toFixed(1)} MB (+${w.pct}%) |`,
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
