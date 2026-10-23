import * as QUnit from 'qunit';

import { exportIdentitySymbolKey } from '@cardstack/runtime-common/export-identity-plugin';

// A class a test defines and shims as a module stands in for one a realm
// compiles, which carries its identity as a static member (see
// export-identity-plugin.ts); that member is the only identity a class has.
// Test classes have no compile step, so the helpers that shim them tag them
// instead: with the module they are shimmed as and the first name that module
// exports them by.
//
// A test class can be shimmed by several tests, as a different module each
// time, and as several modules within one test. Within a test it keeps the
// first tag it gets, as a class keeps the identity of the one module that
// declares it; the next test starts over. A tag the class was compiled with,
// such as a base class a fixture re-exports, is left alone.
const identityTagKey = Symbol.for(exportIdentitySymbolKey);
const taggedByTest = new WeakSet<Function>();
let taggedInThisTest = new WeakSet<Function>();

// Starts each test with no class tagged in it yet.
export function setupTestIdentityTags() {
  QUnit.testStart(() => {
    taggedInThisTest = new WeakSet();
  });
}

// Tags the classes among a module's exports, and returns the exports, so a
// module a test shims lazily can tag them as it resolves.
export function tagTestModuleExports<T extends object>(
  moduleIdentifier: string,
  exports: T,
): T {
  let moduleName = moduleIdentifier.replace(/\.(gts|ts|gjs|js)$/, '');
  for (let [name, value] of Object.entries(exports)) {
    if (
      typeof value !== 'function' ||
      !Function.prototype.toString.call(value).startsWith('class') ||
      taggedInThisTest.has(value) ||
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
    taggedInThisTest.add(value);
  }
  return exports;
}

// `shimModule` on a loader or virtual network, with the module's classes
// tagged first.
export function shimTestModule(
  target: { shimModule(moduleIdentifier: string, module: any): void },
  moduleIdentifier: string,
  exports: Record<string, unknown>,
) {
  tagTestModuleExports(moduleIdentifier, exports);
  target.shimModule(moduleIdentifier, exports);
}
