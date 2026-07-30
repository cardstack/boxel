// Bundles the @cardstack/base realm's modules into the host build and
// registers them as loader shims, so importing a base module (whether as
// `@cardstack/base/card-api` or its resolved base-realm URL) resolves to
// the compiled-in module instead of a network fetch of realm-server-
// transpiled source. This trades two properties of the fetched path for
// speed:
//
// - Base modules become singletons shared by every loader generation.
//   A loader reset (test isolation, code-change flush) no longer
//   re-evaluates base module state; whatever module-level state card-api
//   and friends hold persists across resets.
// - The running base realm's *source* is no longer what executes in the
//   host: editing base code in a realm (or reindexing it) has no effect
//   on the host runtime until the host is rebuilt. Non-host consumers of
//   the base realm (indexing, prerender) are unaffected.
//
// The eager glob in bundled-base-modules.js compiles every base module
// into the host's initial bundle through the same vite/embroider pipeline
// as host app code.

import type { Loader } from '@cardstack/runtime-common/loader';

import BASE_MODULES from './bundled-base-modules';

const GLOB_PREFIX = '../../../base/';

export function shimBundledBase(loader: Loader) {
  for (let [path, module] of Object.entries(BASE_MODULES)) {
    let name = path.slice(GLOB_PREFIX.length).replace(/\.(gts|ts)$/, '');
    loader.shimModule(`@cardstack/base/${name}`, module);
  }
}
