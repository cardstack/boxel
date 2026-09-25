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
// against old definitions.

// Written by packages/catalog/scripts/sync-test-subset.ts next to the files.
const MARKER_FILE = 'catalog-test-subset.txt';

interface Manifest {
  revision: string;
  files: { path: string }[];
}

interface Marker {
  source: 'pin' | 'local';
  revision: string;
  files: string[];
  divergent: string[];
}

let verified: Promise<void> | undefined;

export function setupCatalogTestSubset(hooks: NestedHooks) {
  hooks.beforeEach(async function () {
    verified ??= verifyServedSubset();
    await verified;
  });
}

async function verifyServedSubset() {
  let manifest = JSON.parse(
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
  ) as Manifest;
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
  if (marker.source === 'local') {
    console.warn(
      `The catalog test subset is served from a local catalog checkout (CATALOG_TEST_SUBSET_SOURCE), not the pinned ${manifest.revision}.`,
    );
    return;
  }
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
  if (marker.divergent.length > 0) {
    throw new Error(
      `The catalog clone the stack serves differs from the pinned ${manifest.revision} for ${marker.divergent.join(', ')}. ` +
        `Bump the pin in packages/catalog/test-subset.json, reset those files in packages/catalog/contents, ` +
        `or restart the stack with CATALOG_TEST_SUBSET_SOURCE=packages/catalog/contents to test against the clone.`,
    );
  }
}
