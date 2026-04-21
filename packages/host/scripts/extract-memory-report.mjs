#!/usr/bin/env node

// Extracts MEMPROBE_FILE lines from a host test log and writes a JSON report.
// Handles both raw console.log format and testem's JSON-wrapped format.
//
// Usage: node extract-memory-report.mjs <input-log> <output-json>

import { readFileSync, writeFileSync } from 'node:fs';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error(
    'Usage: node extract-memory-report.mjs <input-log> <output-json>',
  );
  process.exit(1);
}

const PROBE_RE =
  /MEMPROBE_FILE module=("(?:[^"\\]|\\.)*"|\S+) tests=(\d+) used=([\d.]+)MB total=([\d.]+)MB delta=([\d.\-]+|na)MB/;
const JSON_ENVELOPE_RE = /\{"type":"log","text":"(.*?)"\}\s*$/;

const log = readFileSync(inputPath, 'utf8');
const report = {};

for (const rawLine of log.split('\n')) {
  if (!rawLine.includes('MEMPROBE_FILE')) continue;

  let line = rawLine;

  // Unwrap testem JSON envelope if present
  const envMatch = line.match(JSON_ENVELOPE_RE);
  if (envMatch) {
    try {
      line = JSON.parse(`"${envMatch[1]}"`);
    } catch {
      // fall through to raw parse
    }
  }

  const m = line.match(PROBE_RE);
  if (!m) continue;

  const mod = m[1].startsWith('"') ? JSON.parse(m[1]) : m[1];
  const deltaMb = m[5] === 'na' ? null : parseFloat(m[5]);
  const usedMb = parseFloat(m[3]);
  const totalMb = parseFloat(m[4]);
  const tests = parseInt(m[2], 10);

  report[mod] = { delta_mb: deltaMb, used_mb: usedMb, total_mb: totalMb, tests };
}

writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');

const count = Object.keys(report).length;
if (count === 0) {
  console.log('extract-memory-report: no MEMPROBE_FILE lines found');
} else {
  console.log(`extract-memory-report: wrote ${count} modules to ${outputPath}`);
}
