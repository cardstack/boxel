import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { SupportedMimeType } from '@cardstack/runtime-common';

import { localCatalogRealm } from './index.ts';

// The catalog test subset: system-level definitions that live in the catalog
// realm, pinned in packages/catalog/test-subset.json and served by the test
// stack as the catalog realm, which tests reach through `@cardstack/catalog/`.
//
// A test module that uses them calls `setupCatalogTestSubset(hooks)`, which
// fails every test in the module when the catalog realm the stack serves is
// not the pinned subset — a stale subset would otherwise run the assertions
// against old definitions, and a copy edited in place would run them against
// definitions neither CI nor a deployment has.

// Written by packages/catalog/scripts/sync-test-subset.ts next to the files.
const MARKER_FILE = 'catalog-test-subset.txt';

interface Manifest {
  repository: string;
  revision: string;
  files: { path: string }[];
}

interface Marker {
  source: 'pin' | 'local';
  revision: string;
  files: string[];
  divergent: string[];
  hashes?: Record<string, string>;
}

let verified: Promise<void> | undefined;

export function setupCatalogTestSubset(hooks: NestedHooks) {
  hooks.beforeEach(async function () {
    verified ??= verifyServedSubset();
    await verified;
  });
}

function readManifest(): Manifest {
  return JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'catalog',
        'test-subset.json',
      ),
      'utf8',
    ),
  );
}

// A subset file's source as the stack's catalog realm serves it.
async function servedFile(path: string): Promise<string> {
  let url = `${localCatalogRealm}${path}`;
  let response = await fetch(url, {
    headers: { Accept: SupportedMimeType.CardSource },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`);
  }
  return await response.text();
}

async function verifyServedSubset() {
  let manifest = readManifest();
  let markerURL = `${localCatalogRealm}${MARKER_FILE}`;
  let response = await fetch(markerURL, {
    headers: { Accept: SupportedMimeType.CardSource },
  });
  if (!response.ok) {
    throw new Error(
      `The catalog realm does not serve the catalog test subset (GET ${markerURL} answered ${response.status}). ` +
        `Start the stack with \`mise run test-services:realm-server\`, which serves the subset, ` +
        `or run \`pnpm --dir packages/catalog catalog:test-subset --into-clone\` against a stack serving the full catalog clone.`,
    );
  }
  let marker = (await response.json()) as Marker;
  // A marker from a local checkout names no pin to compare with, but what it
  // served can still diverge or be edited, so only the pin checks are skipped.
  if (marker.source === 'local') {
    console.warn(
      `The catalog test subset is served from a local catalog checkout (CATALOG_TEST_SUBSET_SOURCE), not the pinned ${manifest.revision}.`,
    );
  } else {
    let expectedFiles = manifest.files.map((f) => f.path).sort();
    if (
      marker.revision !== manifest.revision ||
      JSON.stringify([...marker.files].sort()) !== JSON.stringify(expectedFiles)
    ) {
      throw new Error(
        `The catalog test subset is stale: the stack serves ${marker.revision}, the manifest pins ${manifest.revision}. ` +
          `Run \`pnpm --dir packages/catalog catalog:test-subset\` (add --into-clone when the stack serves the full catalog clone); the running realm picks the files up without a restart.`,
      );
    }
  }
  if (marker.divergent.length > 0) {
    throw new Error(
      marker.source === 'local'
        ? `The catalog clone the stack serves has its own copy of ${marker.divergent.join(', ')}, which differs from the local checkout the sync read (CATALOG_TEST_SUBSET_SOURCE). ` +
            `The stack serves the clone's copy, so these tests would not see your change. ` +
            `Serve the checkout on a stack that serves only the subset (CATALOG_SOURCE=test-subset, as \`mise run test-services:realm-server\` does), or make the change in packages/catalog/contents itself.`
        : `The catalog clone the stack serves differs from the pinned ${manifest.revision} for ${marker.divergent.join(', ')}. ` +
            `Bump the pin in packages/catalog/test-subset.json, reset those files in packages/catalog/contents, ` +
            `or restart the stack with CATALOG_TEST_SUBSET_SOURCE=packages/catalog/contents to test against the clone.`,
    );
  }
  // A stack started from a checkout whose sync predates the hashes serves a
  // marker without them; it is otherwise current, so it only goes unchecked.
  if (!marker.hashes) {
    console.warn(
      `The catalog test subset the stack serves was written by a sync that records no file hashes, so an edited copy of a subset file can't be detected. ` +
        `Re-run \`pnpm --dir packages/catalog catalog:test-subset\` from the checkout the stack serves to enable the check.`,
    );
    return;
  }
  let edited: string[] = [];
  for (let { path } of manifest.files) {
    let served = createHash('sha256')
      .update(await servedFile(path))
      .digest('hex');
    if (served !== marker.hashes[path]) {
      edited.push(path);
    }
  }
  if (edited.length > 0) {
    throw new Error(
      marker.source === 'local'
        ? `The catalog realm serves ${edited.join(', ')}, which differs from what the sync copied from the local checkout (CATALOG_TEST_SUBSET_SOURCE). ` +
            `Re-run \`pnpm --dir packages/catalog catalog:test-subset\` after each edit to the checkout, and never edit packages/catalog/test-subset, which the sync overwrites.`
        : `The catalog realm serves an edited copy of ${edited.join(', ')}: it differs from what the sync wrote from the pinned ${manifest.revision}. ` +
            `A subset definition is changed in ${manifest.repository}, never in packages/catalog/test-subset or the catalog clone. ` +
            `To test a change, serve a catalog checkout with CATALOG_TEST_SUBSET_SOURCE=<dir> (see .claude/skills/catalog-test-subset). ` +
            `To restore the pinned files, delete packages/catalog/test-subset and re-run \`pnpm --dir packages/catalog catalog:test-subset\`, or reset the file in packages/catalog/contents when the stack serves the clone.`,
    );
  }
}
