#!/usr/bin/env node
// Rewrites every file's mtime under the given realm directories to a value
// derived from the file's own content, so that two checkouts of the same
// content agree on mtime even though nothing else about them does.
//
// Why: the indexer decides what a from-scratch pass has to revisit by
// comparing each file's filesystem mtime against the mtime recorded on its
// `boxel_index` row (see `discoverInvalidations`), and it skips the files
// where the two are equal. That comparison is what lets a realm boot on an
// imported index snapshot and re-render only what actually changed. But
// `git clone` stamps every file with the checkout time, so a snapshot taken
// on one runner and imported on another has no matching mtime anywhere and
// the pass re-renders the whole realm — the cache buys nothing.
//
// Content-derived mtimes give the comparison the signal it actually wants:
// same bytes → same mtime → skipped; different bytes → different mtime →
// revisited, along with everything the invalidation fan-out reaches from it.
// A file's history doesn't enter into it, so this works on the shallow
// clones CI uses and on the separately-cloned skills realm, neither of
// which carries the history a commit-time scheme would need.
//
// Run this identically on the exporting side (before indexing, so the
// snapshot records these mtimes) and on the importing side (before the
// realm server boots). It is idempotent: a second run over unchanged
// content recomputes the same timestamps.
//
// The timestamps are stable but not meaningful as dates — a file's mtime is
// a fingerprint of its content, not when anyone touched it. Keep the two
// sides in agreement about which directories get normalized, and expect
// `last-modified` on these realms' source files (and any UI derived from
// it) to read as a fixed date rather than "just now".
//
// Usage: normalize-realm-mtimes.mjs <dir> [<dir> ...]

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

// Directories that are never part of a realm's indexed surface. `.git`
// matters most: the skills realm is a clone, so its `.git` holds far more
// bytes than the realm itself and hashing it would dominate the run.
const SKIP_DIRS = new Set(['.git', 'node_modules']);

// The window derived timestamps land in: a twelve-hour span ending six hours
// below the instant the host suite pins its clock to
// (`packages/host/tests/helpers/test-clock.ts`). Every normalized file is
// therefore between six and eighteen hours old as the suite measures age.
//
// Narrow on purpose. These timestamps are hashes, not dates — same content,
// same number, and nothing more — but a file card renders `lastModified` as an
// age, so whatever bucket the hash lands in is displayed as though it meant
// something. Across a wide window an ordinary content edit moves a file's hash
// from one bucket to another and a visual snapshot of it changes, reporting a
// rendering difference where only the bytes differ. Inside a span shorter than
// a day every file reads `today`, and there is no boundary left to cross.
//
// Below the pin because a timestamp above it is in the future, which renders
// as an absolute date rather than an age. Six hours of margin, rather than
// ending exactly at the pin, so the arithmetic does not depend on the two
// constants staying in lockstep.
//
// Collisions are expected at this width — a few hundred files in 43,200
// seconds — and are harmless. What reads these values compares a file against
// its own index row (`discover-invalidations.ts`), so two files sharing a
// timestamp never meet. Nothing orders normalized realms by mtime.
const WINDOW_END = 1_789_452_000; // 2026-09-15T06:00:00Z
const WINDOW_SIZE = 12 * 60 * 60;
const WINDOW_START = WINDOW_END - WINDOW_SIZE;

// Whole seconds, because that is all the realm's reader preserves:
// `NodeAdapter` reports mtimes through `unixTime()`, which floors to
// seconds. Sub-second precision here would be truncated on the way into
// the index and every comparison would miss by the remainder.
function deriveMtime(contents) {
  let digest = createHash('sha256').update(contents).digest();
  return WINDOW_START + (digest.readUInt32BE(0) % WINDOW_SIZE);
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return;
    }
    throw err;
  }
  for (let entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
    // Symlinks and other non-regular entries are skipped: there is no
    // content of their own to hash, and following them risks wandering
    // outside the realm directory.
  }
}

let dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: normalize-realm-mtimes.mjs <dir> [<dir> ...]');
  process.exit(1);
}

let exitCode = 0;
for (let dir of dirs) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }
  if (!stat?.isDirectory()) {
    // A missing directory is not fatal, but it does mean this realm's files
    // keep their checkout mtimes and will be re-indexed wholesale on the
    // importing side. That is a silent loss of the entire point, so say so
    // loudly rather than exiting clean.
    console.error(
      `::warning::normalize-realm-mtimes: ${dir} is not a directory — its files keep their checkout mtimes and will not match a cached index`,
    );
    exitCode = 1;
    continue;
  }

  let count = 0;
  for (let file of walk(dir)) {
    let mtime = deriveMtime(readFileSync(file));
    // atime is set to the same value only because utimesSync requires it;
    // nothing in the indexer reads it.
    utimesSync(file, mtime, mtime);
    count++;
  }
  console.log(`normalized mtimes for ${count} files under ${dir}`);
}

process.exit(exitCode);
