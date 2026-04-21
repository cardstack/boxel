#!/usr/bin/env node

// Regenerates memory-baseline.json from per-shard memory reports.
// Used by CI on main merge (auto-update) or locally by developers.
//
// Usage: node update-memory-baseline.mjs <reports-dir> <baseline-json>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [reportsDir, baselinePath] = process.argv.slice(2);

if (!reportsDir || !baselinePath) {
  console.error(
    'Usage: node update-memory-baseline.mjs <reports-dir> <baseline-json>',
  );
  process.exit(1);
}

// Merge all shard reports
const merged = {};
for (const file of readdirSync(reportsDir)) {
  if (!file.endsWith('.json')) continue;
  const shard = JSON.parse(readFileSync(join(reportsDir, file), 'utf8'));
  Object.assign(merged, shard);
}

// Build baseline — exclude warmup since it varies by environment
const modules = {};
for (const [mod, data] of Object.entries(merged).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (mod === '__shard_warmup__') continue;
  if (data.delta_mb == null) continue;
  modules[mod] = { delta_mb: Math.round(data.delta_mb * 10) / 10 };
}

const baseline = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  threshold: { relative: 0.1, absolute_mb: 5 },
  modules,
};

writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
console.log(
  `update-memory-baseline: wrote ${Object.keys(modules).length} modules to ${baselinePath}`,
);
