import { Loader } from '@cardstack/runtime-common';
import { exportIdentitySymbolKey } from '@cardstack/runtime-common/export-identity-plugin';
import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

// A class a test defines and shims as a module stands in for one a realm
// compiles, which carries its identity as a static member (see
// export-identity-plugin.ts). Test classes have no compile step, so they are
// tagged here instead, as a loader records the exports of a module that
// carries them, with the module it records them under and the first name that
// module exports them by — which is what `identify()` answers for them.
//
// A test class can be shimmed by several tests, as a different module each
// time, and by several modules within one test. A loader credits a class to
// the first module it records it under, so the tag follows the same rule: a
// class this loader has already recorded keeps its tag, and one it has not
// recorded is re-tagged.
//
// Left alone:
// - A tag the class was compiled with, such as a base class a fixture
//   re-exports. Those are what the tags are validated against.
// - Modules under the packages origin: the host's package shims (boxel-ui,
//   glimmer, host tools), whose classes must be tagged at build time.
const identityTagKey = Symbol.for(exportIdentitySymbolKey);
const taggedByTest = new WeakSet<Function>();

type CaptureIdentities = (
  this: Loader,
  module: Record<string, unknown>,
  moduleIdentifier: string,
) => void;

export function setupTestIdentityTags() {
  let prototype = Loader.prototype as unknown as {
    captureIdentitiesOfModuleExports: CaptureIdentities;
  };
  let capture = prototype.captureIdentitiesOfModuleExports;
  prototype.captureIdentitiesOfModuleExports = function (
    module,
    moduleIdentifier,
  ) {
    if (!moduleIdentifier.startsWith(PACKAGES_FAKE_ORIGIN)) {
      tagTestClasses(this, module, moduleIdentifier);
    }
    capture.call(this, module, moduleIdentifier);
  };
}

function tagTestClasses(
  loader: Loader,
  module: Record<string, unknown>,
  moduleIdentifier: string,
) {
  let recorded = (
    loader as unknown as { identities: WeakMap<Function, unknown> }
  ).identities;
  let moduleName = moduleIdentifier.replace(/\.(gts|ts|gjs|js)$/, '');
  // A class the module exports under several names takes the first.
  let tagged = new Set<Function>();
  for (let name of Object.keys(module)) {
    let value = module[name];
    if (
      typeof value !== 'function' ||
      !Function.prototype.toString.call(value).startsWith('class') ||
      tagged.has(value) ||
      recorded.has(value) ||
      (Object.hasOwn(value, identityTagKey) && !taggedByTest.has(value))
    ) {
      continue;
    }
    Object.defineProperty(value, identityTagKey, {
      value: [moduleName, name],
      configurable: true,
      writable: true,
    });
    taggedByTest.add(value);
    tagged.add(value);
  }
}
