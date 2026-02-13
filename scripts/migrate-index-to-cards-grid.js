#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');

const ROOT = process.argv[2] || '.';
const MODE = process.argv[3] || 'dry-run'; // "apply" to write changes
const BACKUP = (process.argv[4] || 'yes') === 'yes';
const EXCLUDE = new Set(
  (process.argv[5] || 'node_modules,.git')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE.has(ent.name)) continue;
      yield* walk(full);
    } else if (ent.isFile() && ent.name === 'index.json') {
      yield full;
    }
  }
}

async function processFile(filePath) {
  let raw;
  let data;
  try {
    raw = await fs.readFile(filePath, 'utf8');
    data = JSON.parse(raw);
  } catch {
    return { changed: false };
  }

  // Only process files that adopt from IndexCard
  const adoptsFrom = data?.data?.meta?.adoptsFrom;
  if (!adoptsFrom || adoptsFrom.name !== 'IndexCard') {
    return { changed: false };
  }

  // Replace with CardsGrid adoption, strip relationships and attributes
  const updated = {
    data: {
      type: 'card',
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/cards-grid',
          name: 'CardsGrid',
        },
      },
    },
  };

  if (MODE === 'apply') {
    if (BACKUP) {
      await fs.writeFile(filePath + '.bak', raw, 'utf8');
    }
    await fs.writeFile(
      filePath,
      JSON.stringify(updated, null, 2) + '\n',
      'utf8',
    );
  }

  return { changed: true };
}

(async function main() {
  const changedFiles = [];

  for await (const file of walk(ROOT)) {
    const res = await processFile(file);
    if (res.changed) changedFiles.push(file);
  }

  console.log(`Mode: ${MODE}`);
  console.log(`Scanned root: ${ROOT}`);
  console.log(`Files to migrate: ${changedFiles.length}`);
  if (changedFiles.length) {
    for (const p of changedFiles) console.log(`  ${p}`);
  }
  console.log(`Excluded dirs: ${[...EXCLUDE].join(', ')}`);
  if (MODE === 'dry-run' && changedFiles.length) {
    console.log('\nRe-run with "apply" to write changes:');
    console.log(`  node ${path.basename(__filename)} ${ROOT} apply`);
  }
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
