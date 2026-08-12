/**
 * Regression test: every ```bxl fenced block in README.md must parse
 * through the BXL→jq compiler. Keeps documentation honest.
 *
 * Block extraction handles the README's display convention:
 *   ```bxl
 *   BXL:     <expression>         ← single-line, with display prefix
 *   ```
 *   ```bxl
 *   BXL:                           ← prefix on own line
 *   <multi-line expression>
 *   ```
 * Blocks that contain several independent one-liners (separated by newlines
 * with no pipe/continuation) are tried whole first, then line-by-line as a
 * fallback.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bxlToJqExpression } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readmePath = join(__dirname, '../../README.md');
const readme = readFileSync(readmePath, 'utf8');

// Strips leading display labels like `BXL:`, `BXL (jq, plus SUM from the Excel layer):`,
// `jq:`, etc. The language token is followed by optional parenthesised qualifier and `:`.
const DISPLAY_PREFIX = /^(BXL|jq|XQuery|Schematron|JSONata|CEL|JS|XPath|CSS)(\s*\([^)]*\))?\s*:\s*/;

function extractBxlBlocks(md: string): { index: number; body: string; firstLine: number }[] {
  const lines = md.split('\n');
  const blocks: { index: number; body: string; firstLine: number }[] = [];
  let inBlock = false;
  let start = 0;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && line === '```bxl') {
      inBlock = true;
      start = i + 1;
      buf = [];
      continue;
    }
    if (inBlock && line === '```') {
      blocks.push({ index: blocks.length, body: buf.join('\n'), firstLine: start + 1 });
      inBlock = false;
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

function stripDisplayPrefix(body: string): string {
  const lines = body.split('\n');
  if (lines.length === 0) return body;
  const first = lines[0];
  const m = first.match(DISPLAY_PREFIX);
  if (!m) return body;
  const rest = first.slice(m[0].length);
  if (rest.trim() === '') return lines.slice(1).join('\n');
  return [rest, ...lines.slice(1)].join('\n');
}

const blocks = extractBxlBlocks(readme);
if (blocks.length === 0) {
  console.log('FAIL: no ```bxl blocks found in README.md');
  process.exit(1);
}

let failed = 0;
let checked = 0;

for (const b of blocks) {
  const cleaned = stripDisplayPrefix(b.body);
  const label = `block ${b.index + 1} (README.md:${b.firstLine})`;

  let ok = false;
  try {
    bxlToJqExpression(cleaned);
    ok = true;
    checked++;
  } catch (wholeErr) {
    // Fallback: try line-by-line, skipping blank lines. Useful for blocks
    // that display several independent one-liners.
    const lines = cleaned.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      console.log(`FAIL ${label}: ${(wholeErr as Error).message}`);
      failed++;
      continue;
    }
    let anyFail = false;
    for (const line of lines) {
      try {
        bxlToJqExpression(line);
      } catch (lineErr) {
        anyFail = true;
        console.log(`FAIL ${label} line "${line.slice(0, 60)}": ${(lineErr as Error).message}`);
      }
    }
    if (!anyFail) {
      ok = true;
      checked += lines.length;
    }
  }

  if (ok) console.log(`OK   ${label}`);
  else failed++;
}

console.log(`README BXL snippets: ${blocks.length} blocks, ${checked} expressions parsed, ${failed} failing`);
process.exit(failed > 0 ? 1 : 0);
