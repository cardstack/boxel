#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const explicitMonorepoRoot = process.argv[2] || process.env.BOXEL_MONOREPO;
const monorepoCandidates = [
  explicitMonorepoRoot,
  path.resolve(workspaceRoot, '../boxel'),
  path.resolve(workspaceRoot, '../../boxel'),
].filter(Boolean);

const monorepoRoot = monorepoCandidates.find((candidate) =>
  existsSync(path.join(candidate, 'packages/host/app/tools/index.ts')),
);

if (!monorepoRoot) {
  console.error(
    [
      'Could not find the Boxel monorepo.',
      'Pass it explicitly:',
      '  node .claude/skills/boxel-patterns/scripts/audit-host-command-refs.mjs /path/to/boxel',
      'or set BOXEL_MONOREPO=/path/to/boxel.',
    ].join('\n'),
  );
  process.exit(2);
}

const commandIndexPath = path.join(
  monorepoRoot,
  'packages/host/app/tools/index.ts',
);

const scanRoots = [
  '.claude/skills',
  '.claude/extensions',
  '.claude/commands',
].map((root) => path.join(workspaceRoot, root));

const scannedExtensions = new Set(['.md', '.gts', '.ts', '.json']);
const commandSpecifierPattern =
  /@cardstack\/boxel-host\/commands\/([A-Za-z0-9_./-]+)/g;

let commandIndex = await readFile(commandIndexPath, 'utf8');
let liveCommands = new Set();
for (let match of commandIndex.matchAll(commandSpecifierPattern)) {
  liveCommands.add(normalizeCommandName(match[1]));
}

let references = [];
for (let root of scanRoots) {
  if (!existsSync(root)) {
    continue;
  }
  references.push(...(await collectCommandRefs(root)));
}

let missing = references.filter((ref) => !liveCommands.has(ref.command));

if (missing.length === 0) {
  console.log(
    `OK: ${references.length} host-command reference(s) all exist in ${relative(commandIndexPath)}.`,
  );
  process.exit(0);
}

console.error(
  `Missing host-command reference(s): ${missing.length} of ${references.length} reference(s) are not shimmable in ${relative(commandIndexPath)}.\n`,
);

let byCommand = new Map();
for (let ref of missing) {
  if (!byCommand.has(ref.command)) {
    byCommand.set(ref.command, []);
  }
  byCommand.get(ref.command).push(ref);
}
for (let [command, refs] of byCommand) {
  console.error(`@cardstack/boxel-host/tools/${command}`);
  for (let ref of refs) {
    console.error(`  ${relative(ref.file)}:${ref.line}: ${ref.preview}`);
  }
  console.error('');
}

console.error('Live host commands:');
console.error(
  [...liveCommands].sort().map((command) => `  ${command}`).join('\n'),
);

process.exit(1);

async function collectCommandRefs(root) {
  let entries = await readdir(root, { withFileTypes: true });
  let refs = [];

  for (let entry of entries) {
    let fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      refs.push(...(await collectCommandRefs(fullPath)));
      continue;
    }

    if (!entry.isFile() || !scannedExtensions.has(path.extname(entry.name))) {
      continue;
    }

    let text = await readFile(fullPath, 'utf8');
    let lineStarts = computeLineStarts(text);
    for (let match of text.matchAll(commandSpecifierPattern)) {
      let line = lineNumberForIndex(lineStarts, match.index ?? 0);
      refs.push({
        command: normalizeCommandName(match[1]),
        file: fullPath,
        line,
        preview: lineAt(text, line).trim(),
      });
    }
  }

  return refs;
}

function normalizeCommandName(specifier) {
  return specifier.replace(/\/default$/, '');
}

function computeLineStarts(text) {
  let starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineNumberForIndex(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high + 1;
}

function lineAt(text, lineNumber) {
  return text.split(/\r?\n/)[lineNumber - 1] ?? '';
}

function relative(filePath) {
  let relativePath = path.relative(workspaceRoot, filePath);
  return relativePath.startsWith('..') ? filePath : relativePath;
}
