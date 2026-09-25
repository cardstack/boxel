import { getService } from '@universal-ember/test-support';

import { SupportedMimeType } from '@cardstack/runtime-common';

import manifest from '../../../catalog/test-subset.json';

// The catalog test subset: system-level definitions that live in the catalog
// realm, pinned in packages/catalog/test-subset.json and served by the test
// stack as the catalog realm. A test reaches them the way card code does in a
// deployment, through `@cardstack/catalog/`.
//
// A test module that uses them calls `setupCatalogTestSubset(hooks)`, which
// fails every test in the module when the catalog realm the stack serves is
// not the pinned subset — a stale subset would otherwise run the assertions
// against old definitions, and a copy edited in place would run them against
// definitions neither CI nor a deployment has.

const CATALOG_PREFIX = '@cardstack/catalog/';
// Written by packages/catalog/scripts/sync-test-subset.ts next to the files.
const MARKER_FILE = 'catalog-test-subset.txt';

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

async function verifyServedSubset() {
  let network = getService('network');
  let markerURL = network.resolveImport(`${CATALOG_PREFIX}${MARKER_FILE}`);
  if (markerURL.startsWith(CATALOG_PREFIX)) {
    throw new Error(
      `${CATALOG_PREFIX} is not registered in this host build. Build the host without SKIP_CATALOG=true so the prefix resolves to the stack's catalog realm.`,
    );
  }
  let response = await network.fetch(markerURL, {
    headers: { Accept: SupportedMimeType.CardSource },
  });
  if (!response.ok) {
    throw new Error(
      `The catalog realm does not serve the catalog test subset (GET ${markerURL} answered ${response.status}). ` +
        `Start the stack with the catalog enabled — CATALOG_SOURCE=test-subset serves only the subset — ` +
        `or run \`pnpm --dir packages/catalog catalog:test-subset --into-clone\` against a running stack.`,
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
    // The manifest is read when the host is built, so either side can be the
    // stale one.
    throw new Error(
      `The catalog test subset is stale: the stack serves ${marker.revision}, this host build pins ${manifest.revision}. ` +
        `If packages/catalog/test-subset.json changed since the host was built, rebuild the host. ` +
        `Otherwise run \`pnpm --dir packages/catalog catalog:test-subset\` (add --into-clone when the stack serves the full catalog clone); the running realm picks the files up without a restart.`,
    );
  }
  if (marker.divergent.length > 0) {
    throw new Error(
      `The catalog clone the stack serves differs from the pinned ${manifest.revision} for ${marker.divergent.join(', ')}. ` +
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
    let url = network.resolveImport(`${CATALOG_PREFIX}${path}`);
    let fileResponse = await network.fetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!fileResponse.ok) {
      throw new Error(`GET ${url} answered ${fileResponse.status}`);
    }
    if ((await sha256(await fileResponse.text())) !== marker.hashes[path]) {
      edited.push(path);
    }
  }
  if (edited.length > 0) {
    throw new Error(
      `The catalog realm serves an edited copy of ${edited.join(', ')}: it differs from what the sync wrote from the pinned ${manifest.revision}. ` +
        `A subset definition is changed in ${manifest.repository}, never in packages/catalog/test-subset or the catalog clone. ` +
        `To test a change, serve a catalog checkout with CATALOG_TEST_SUBSET_SOURCE=<dir> (see .claude/skills/catalog-test-subset). ` +
        `To restore the pinned files, delete packages/catalog/test-subset and re-run \`pnpm --dir packages/catalog catalog:test-subset\`, or reset the file in packages/catalog/contents when the stack serves the clone.`,
    );
  }
}

async function sha256(text: string) {
  let digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
