#!/usr/bin/env node
// One-shot migration: a server-wide package store becomes one store per realm.
//
// WHY. The old layout put every publisher at the store root, so the realm
// server was implicitly the arbiter of a global publisher namespace — whoever
// published `cardstack/contracts` first owned that name for everyone on the
// box. `lib/package-store.ts` has the full argument. The address is now
// `<realm>/_packages/<publisher>/<name>@<version>/…` and the store is rooted
// per realm, which makes collision structurally impossible instead of policed.
//
// MOVED RATHER THAN REBUILT, deliberately. Republishing from the plan would
// produce identical bytes — the pack is deterministic — but every
// `publishedAt` would become today, and the corpus's whole point is that pins
// record real history. A move keeps the timestamps that make the ordering
// story true.
//
// THE OBJECT DIRS ARE COPIED INTO BOTH ROOTS, not split. They are
// content-addressed, so a blob referenced by two realms is the same blob and
// copying it is correct if wasteful; splitting them correctly would mean
// walking every tree to work out who references what, to save disk on a
// fixture. Deck's own gc prunes whatever ends up unreferenced.
//
// Usage:
//   node scripts/migrate-package-store-to-realms.mjs [--dry-run]

import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE =
  process.env.PACKAGE_STORE_PATH ??
  join(HERE, '..', 'realms', 'deck-at-rest-poc', '.package-store');

const HOST =
  process.env.ATLAS_STORE_HOST ?? 'realm-server.deck-at-rest-poc.localhost';

// Which realm governs which publisher. Hand-written because it is a fact about
// this fixture's history that nothing on disk records — which is precisely the
// gap the new layout closes, so it never has to be written down again.
const OWNERS = {
  atlas: ['acme', 'cardstack', 'iso', 'ledgerworks', 'northwind', 'openkit'],
  experiments: ['experiments', 'lib'],
};

// Deck's own directories, shared by every package in a store.
const SHARED = ['_objects', '_trees', '_proposals'];

let dryRun = process.argv.includes('--dry-run');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(STORE))) {
    console.error(`no store at ${STORE}`);
    process.exit(1);
  }

  let present = new Set(await readdir(STORE));
  // Already migrated? The host segment at the root is the tell.
  if (present.has(HOST)) {
    console.log(`${STORE} already has a ${HOST}/ root — nothing to do`);
    return;
  }

  for (let [realm, publishers] of Object.entries(OWNERS)) {
    let root = join(STORE, HOST, realm);
    let moving = publishers.filter((p) => present.has(p));
    if (!moving.length) {
      console.log(` --  ${realm}: no publishers to move`);
      continue;
    }
    console.log(`  ${realm}/  <-  ${moving.join(', ')}`);
    if (dryRun) {
      continue;
    }
    await mkdir(root, { recursive: true });
    for (let publisher of moving) {
      await rename(join(STORE, publisher), join(root, publisher));
    }
    for (let shared of SHARED) {
      let from = join(STORE, shared);
      if (await exists(from)) {
        // Copied, not moved: every realm root needs its own object dir, and
        // the second realm would find nothing left if the first took them.
        await cp(from, join(root, shared), { recursive: true });
      }
    }
  }

  // The shared dirs stay at the old root as well. Left rather than deleted:
  // this is a one-shot migration on a dev fixture, and a leftover directory is
  // cheap next to discovering mid-restore that the originals are gone.
  console.log(
    dryRun
      ? '\ndry run — nothing written'
      : `\nmigrated. Old ${SHARED.join(', ')} left at the store root; ` +
          'delete them once the new layout is verified.',
  );
}

await main();
