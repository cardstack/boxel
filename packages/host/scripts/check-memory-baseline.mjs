#!/usr/bin/env node

// Compares per-module memory readings from a CI run against a committed baseline.
// Each module reports two readings (see the MEMPROBE_FILE probe in
// tests/helpers/setup-qunit.js):
//
// - `delta_mb`, the whole module's boundary delta. It includes the one-time cost
//   of every app surface the module is the first in its shard to render, so it
//   depends on which modules ran before it — every re-split of the shards moves
//   it. It only ever warns.
// - `steady_mb`, the growth from the end of the module's first test to the
//   module's end, which leaves those one-time costs out. This is the reading
//   that blocks: exit 1 when it clears the module's recent steady ceiling by
//   more than the larger of +50MB, 100% of the steady baseline, or the steady
//   window's own demonstrated run-to-run noise band.
//
// A module without a steady window yet (newly baselined, or a one-test module
// with no steady reading) only warns. Exits 0 on pass/warn.
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

// A module's recent sample window for one reading. The boundary-delta window
// falls back to the pre-rolling-window `delta_mb` shape as a one-sample window,
// so this script keeps working against older baseline files.
const windowFor = (entry, reading) => {
  if (reading === 'steady') {
    return Array.isArray(entry?.steady_samples) ? entry.steady_samples : [];
  }
  if (Array.isArray(entry?.samples) && entry.samples.length > 0) {
    return entry.samples;
  }
  return entry?.delta_mb != null ? [entry.delta_mb] : [];
};

// Compare against the rolling-window mean of recent baseline samples so a
// single noisy build can't trip — or anchor — the budget.
const baselineMean = (samples) =>
  samples.length > 0
    ? samples.reduce((a, b) => a + b, 0) / samples.length
    : undefined;

// The largest delta the module has produced in the recent window. The hard
// (build-blocking) gate measures the regression from this ceiling, not the
// mean: some modules legitimately swing run-to-run by >100MB because their
// post-GC boundary delta depends on whether the settle-GC fully drains a large
// transient before the measurement. Such a module must not hard-fail on a value
// it has already exhibited — only on one that clears its observed ceiling by the
// hard threshold. When a module's variance is low (ceiling ≈ mean) this is
// equivalent to the mean-based gate.
const baselineCeiling = (samples) =>
  samples.length > 0 ? Math.max(...samples) : undefined;

// The module's demonstrated run-to-run noise band: the span from the lowest
// recent sample up to the recent ceiling, with the ceiling floored at zero the
// same way the hard gate floors it. This is the swing the module has already
// exhibited with no code change — the post-GC boundary delta moves run-to-run
// because the settle-GC drains large transients on one side of the module
// boundary on some runs and the other side on others.
//
// A negative sample is pure drain-timing noise (a module cannot net-free
// memory it never retained), and the slosh it measures is directionally
// symmetric: garbage that drained 90MB late into this module's window (a -90
// reading) can just as easily linger past the module's end boundary and land
// as a comparable positive reading. So an all-negative window like
// [-50.7, -58.6, -90.9, -69.8, -69.8] demonstrates a ~91MB noise band, and a
// +72.8 reading is inside the module's own swing, not a regression — even
// though it clears the floored-at-zero ceiling by more than the absolute
// threshold and the window's raw peak-to-peak spread is small.
//
// For a window containing positive samples the floor is a no-op and this
// reduces to the plain peak-to-peak spread. Modules with a tight window are
// unaffected — the absolute/relative terms govern. Zero until the window
// holds at least two samples: a single reading demonstrates no run-to-run
// swing, so a newly baselined module stays behind the absolute threshold
// until it has real history. Also zero for a legacy single-value baseline
// that carries no sample window at all.
const baselineNoiseBand = (samples) =>
  samples.length > 1
    ? Math.max(Math.max(...samples), 0) - Math.min(...samples)
    : 0;

const fmtSamples = (samples) =>
  samples.length > 0
    ? `[${samples.map((s) => s.toFixed(1)).join(', ')}]`
    : null;

// Compares one reading against its window. `hard` is true when the reading
// clears the hard threshold, `soft` when it clears only the soft one.
const assess = (current, samples) => {
  const baseMean = baselineMean(samples);
  if (current == null || baseMean == null) return null;

  // A negative baseline means the prior module's garbage was reclaimed
  // partway through this module's window, not that this module actually freed
  // memory. Treat it as noise: floor at 0 so the comparison falls back to the
  // absolute thresholds rather than a bogus relative budget sized to |noise|.
  const effectiveBase = Math.max(baseMean, 0);
  const diff = current - effectiveBase;
  // Only flag increases
  if (diff <= 0) return null;

  // The soft (warning) gate stays anchored to the mean so a module trending
  // upward still surfaces early. The hard gate is anchored to the recent
  // ceiling: it fires only when the current run clears the highest recent
  // sample by the hard threshold, so a high-variance module can't be blocked
  // by a value inside its own observed range.
  const ceiling = Math.max(baselineCeiling(samples) ?? baseMean, 0);
  const hardDiff = current - ceiling;

  const softThreshold = Math.max(
    SOFT_ABSOLUTE_MB,
    effectiveBase * SOFT_RELATIVE,
  );
  // The hard threshold also absorbs the module's demonstrated noise band.
  // When a module's recent window is entirely negative, its mean baseline and
  // its ceiling both floor to zero, so the +50MB absolute term alone would
  // block any single reading over 50MB — even from a module that routinely
  // swings by >100MB and merely landed positive this run. Sizing the threshold
  // to the noise band means a run has to clear the recent ceiling by more than
  // the module's own run-to-run range before it blocks; tighter-window modules
  // fall back to the absolute/relative terms.
  const hardThreshold = Math.max(
    HARD_ABSOLUTE_MB,
    effectiveBase * HARD_RELATIVE,
    baselineNoiseBand(samples),
  );

  const pct =
    effectiveBase > 0 ? ((diff / effectiveBase) * 100).toFixed(0) : null;
  return {
    hard: hardDiff >= hardThreshold,
    soft: diff >= softThreshold,
    baseline: effectiveBase,
    current,
    diff,
    pct,
    samples: fmtSamples(samples),
  };
};

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

  // Only the steady reading can block; its soft threshold still warns.
  const steady = assess(data.steady_mb, windowFor(base, 'steady'));
  if (steady?.hard) {
    failures.push({ mod, reading: 'steady', ...steady });
  } else if (steady?.soft) {
    warnings.push({ mod, reading: 'steady', ...steady });
  }

  // The boundary delta warns at either threshold, never blocks.
  const delta = assess(data.delta_mb, windowFor(base, 'delta'));
  if (delta?.hard || delta?.soft) {
    warnings.push({ mod, reading: 'delta', ...delta });
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
// "up to": modules newer than the window cap carry fewer samples, as does
// every module while an existing baseline grows toward a raised cap.
const baselineHeader =
  samplesWindow > 1
    ? `Baseline (mean of up to ${samplesWindow} samples)`
    : 'Baseline';

if (failures.length > 0) {
  lines.push(
    `### Failures (steady reading over recent ceiling by >${HARD_ABSOLUTE_MB}MB, >${HARD_RELATIVE * 100}%, or the demonstrated noise band)\n`,
  );
  lines.push(
    `| Module | Reading | ${baselineHeader} | Current | Change | Recent samples |`,
  );
  lines.push(
    '|--------|---------|----------|---------|--------|----------------|',
  );
  for (const f of failures.sort((a, b) => b.diff - a.diff)) {
    const pctStr = f.pct != null ? ` (+${f.pct}%)` : '';
    lines.push(
      `| ${escapeMd(f.mod)} | ${f.reading} | ${f.baseline.toFixed(1)} MB | ${f.current.toFixed(1)} MB | +${f.diff.toFixed(1)} MB${pctStr} | ${f.samples ?? '—'} |`,
    );
  }
  lines.push('');
}

if (warnings.length > 0) {
  lines.push(
    `### Warnings (>${SOFT_RELATIVE * 100}% + ${SOFT_ABSOLUTE_MB}MB increase; a \`delta\` reading depends on shard order and never blocks)\n`,
  );
  lines.push(
    `| Module | Reading | ${baselineHeader} | Current | Change | Recent samples |`,
  );
  lines.push(
    '|--------|---------|----------|---------|--------|----------------|',
  );
  for (const w of warnings.sort((a, b) => b.diff - a.diff)) {
    const pctStr = w.pct != null ? ` (+${w.pct}%)` : '';
    lines.push(
      `| ${escapeMd(w.mod)} | ${w.reading} | ${w.baseline.toFixed(1)} MB | ${w.current.toFixed(1)} MB | +${w.diff.toFixed(1)} MB${pctStr} | ${w.samples ?? '—'} |`,
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
