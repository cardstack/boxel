#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');

const ROOT = process.argv[2] || '.';
const MODE = process.argv[3] || 'dry-run'; // "apply" to write changes
const BACKUP = (process.argv[4] || 'yes') === 'yes';

const renameMap = {
  title: 'cardTitle',
  description: 'cardDescription',
  thumbnailURL: 'cardThumbnailURL',
};

const cardInfoMap = {
  title: 'name',
  description: 'summary',
  thumbnailURL: 'cardThumbnailURL',
};

function renameKeys(obj) {
  if (Array.isArray(obj)) return obj.map(renameKeys);

  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v0] of Object.entries(obj)) {
      let v = v0;

      // If this is cardInfo and it's an object, rename fields using cardInfoMap
      if (k === 'cardInfo' && v && typeof v === 'object' && !Array.isArray(v)) {
        v = renameCardInfo(v);
      }

      // Rename top-level CardDef fields (and any other objects where these keys appear)
      const nk = renameMap[k] ?? k;
      out[nk] = renameKeys(v);
    }
    return out;
  }

  return obj;
}

function renameCardInfo(info) {
  const out = {};
  for (const [k, v] of Object.entries(info)) {
    const nk = cardInfoMap[k] ?? k;
    out[nk] = renameKeys(v);
  }
  return out;
}

function stableStringify(value) {
  // Match python json.dumps(..., indent=2) style reasonably
  return JSON.stringify(value, null, 2) + '\n';
}

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
      // Skip common noisy dirs (optional; remove if you want everything)
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      yield* walk(full);
    } else if (ent.isFile() && ent.name.endsWith('.json')) {
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

  const updated = renameKeys(data);

  // Quick deep-compare by JSON form (good enough for deterministic objects)
  const before = JSON.stringify(data);
  const after = JSON.stringify(updated);
  if (before === after) return { changed: false };

  if (MODE === 'apply') {
    if (BACKUP) {
      await fs.writeFile(filePath + '.bak', raw, 'utf8');
    }
    await fs.writeFile(filePath, stableStringify(updated), 'utf8');
  }

  return { changed: true };
}

(async function main() {
  const changedFiles = [];

  for await (const file of walk(ROOT)) {
    const res = await processFile(file);
    if (res.changed) changedFiles.push(file);
  }

  console.log(`Scanned: ${ROOT}`);
  console.log(`Changed: ${changedFiles.length}`);
  if (changedFiles.length) {
    for (const p of changedFiles.slice(0, 200)) console.log(p);
    if (changedFiles.length > 200) {
      console.log(`... and ${changedFiles.length - 200} more`);
    }
  }
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
