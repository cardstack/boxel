#!/usr/bin/env node

// Regenerates memory-baseline.json from per-shard memory reports.
// Used by CI on main merge (auto-update) or locally by developers.
//
// Usage: node update-memory-baseline.mjs <reports-dir> <baseline-json>
//
// Missing-shard policy: modules present in the current reports are updated
// from those readings. Modules absent from the current reports (because a
// shard failed to upload, or was renamed/removed) retain their prior baseline
// entries. CI runs this job even when host-test reports partial failure, so
// retaining prior values avoids silently dropping baseline coverage for a
// module the run simply didn't observe.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [reportsDir, baselinePath] = process.argv.slice(2);

if (!reportsDir || !baselinePath) {
  console.error(
    'Usage: node update-memory-baseline.mjs <reports-dir> <baseline-json>',
  );
  process.exit(1);
}

// Load prior baseline, if any — we merge its entries with the current run.
let prior = {};
if (existsSync(baselinePath)) {
  try {
    prior = JSON.parse(readFileSync(baselinePath, 'utf8')).modules ?? {};
  } catch (e) {
    console.error(
      `update-memory-baseline: failed to parse existing baseline at ${baselinePath}, starting fresh. ${e.message}`,
    );
    prior = {};
  }
}

// Merge all shard reports
const merged = {};
for (const file of readdirSync(reportsDir)) {
  if (!file.endsWith('.json')) continue;
  const shard = JSON.parse(readFileSync(join(reportsDir, file), 'utf8'));
  Object.assign(merged, shard);
}

// Start from the prior baseline, then overlay current readings. Warmup is
// excluded from both sources since it varies by environment.
const modules = { ...prior };
delete modules.__shard_warmup__;

let updated = 0;
let added = 0;
for (const [mod, data] of Object.entries(merged)) {
  if (mod === '__shard_warmup__') continue;
  if (data.delta_mb == null) continue;
  const next = { delta_mb: Math.round(data.delta_mb * 10) / 10 };
  if (mod in modules) updated++;
  else added++;
  modules[mod] = next;
}

const retained =
  Object.keys(modules).length -
  Object.keys(merged).filter(
    (m) => m !== '__shard_warmup__' && merged[m].delta_mb != null,
  ).length;

// Sort modules alphabetically for stable diffs.
const sortedModules = Object.fromEntries(
  Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)),
);

const baseline = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  threshold: { relative: 0.1, absolute_mb: 5 },
  modules: sortedModules,
};

writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
console.log(
  `update-memory-baseline: wrote ${Object.keys(sortedModules).length} modules to ${baselinePath} (${added} added, ${updated} updated, ${retained} retained from prior baseline)`,
);
