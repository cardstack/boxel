import { logger, trimExecutableExtension } from './index';

export type ModuleLike = Record<string, any>;
export type ModuleDescriptor =
  | { prefix: `${string}/`; resolve: (rest: string) => Promise<ModuleLike> }
  | { id: string; resolve: () => Promise<ModuleLike> };

function trimModuleIdentifier(moduleIdentifier: string): string {
  return trimExecutableExtension(new URL(moduleIdentifier)).href;
}

export const PACKAGES_FAKE_ORIGIN = 'https://packages/';

// Marker key the strict-namespace Proxy honors — modules tagged with
// this opt out of the missing-export check. Useful for modules whose
// exports are intentionally dynamic (e.g. test-only scaffolding) or
// for explicit interop with code that probes for optional keys.
//
// Specifically: when the namespace has the property
// `ALLOW_MISSING_NAMED_EXPORTS` set to the literal value `true`, the
// strict wrapper is skipped and the namespace is returned verbatim.
// Missing-key access then returns `undefined`, matching pre-Proxy
// behavior. The `=== true` check (rather than truthy/`Reflect.has`)
// avoids stray inherited properties or sentinel-shaped values from
// accidentally opting a module out.
export const ALLOW_MISSING_NAMED_EXPORTS = Symbol.for(
  'shim-handler.allowMissingNamedExports',
);

// Helper for shims that are intentional fallbacks — empty-or-stub
// namespaces that exist only to keep import resolution from
// crashing when the real module isn't present in the build (e.g.
// the live-test scaffolding shims in `host/app/lib/externals.ts`).
// Marks the returned object with `ALLOW_MISSING_NAMED_EXPORTS` so
// the strict-namespace Proxy won't throw on names that the
// fallback doesn't actually expose.
export function fallbackShim(extras?: ModuleLike): ModuleLike {
  let stub: ModuleLike = { ...(extras ?? {}) };
  (stub as any)[ALLOW_MISSING_NAMED_EXPORTS] = true;
  return stub;
}

// Names the JS runtime and common library code probe on arbitrary
// objects, NOT real named imports. Critical inclusions:
//
//   • `then` — `await ns` and `Promise.resolve(ns).then(...)` both
//     call `Reflect.get(value, 'then')` to detect thenables. If the
//     strict Proxy throws on this lookup, every awaited shimmed
//     module breaks (we observed exactly this in CI: cascading
//     `ReferenceError: Module '...' has no exported member 'then'`
//     across host / matrix / realm-server suites).
//   • `__esModule` — bundler CJS/ESM interop probes this to decide
//     how to bridge default exports.
//   • `toJSON` — `JSON.stringify(ns)` probes for it.
//   • Object.prototype method names (`toString`, `valueOf`, etc.) —
//     runtime + library code commonly probes these. They aren't
//     real exports either.
//
// All of these pass through unchanged; missing ones return whatever
// the underlying namespace would have returned (typically `undefined`
// for `then`/`__esModule`, the inherited Object.prototype method for
// the others).
const RUNTIME_PROBE_NAMES = new Set<string>([
  'then',
  '__esModule',
  'toJSON',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'constructor',
]);

// Wraps a shimmed module with a Proxy that throws a clear,
// actionable error when an importer reads a name that doesn't
// exist on the namespace. Plain JavaScript silently produces
// `undefined` for missing named imports, which then surfaces as a
// confusing "Cannot convert undefined or null to object" deep in
// Glimmer's helper-encoder (or wherever the importer eventually
// uses the binding) — the deterministic whitepaper render bug is
// exactly this footgun.
//
// Scope: every property *get* with a string key that isn't on the
// namespace AND isn't a runtime-probe name throws. Symbol gets,
// `has`, `ownKeys`, and `getOwnPropertyDescriptor` traps pass
// through unchanged so runtime introspection (`'foo' in ns`,
// `Object.keys(ns)`, `Reflect.has(...)`) keeps working.
//
// Escape hatch: if the namespace exposes
// `ALLOW_MISSING_NAMED_EXPORTS`, the Proxy returns `undefined` for
// missing string keys (pre-Proxy behavior). Modules that
// intentionally expose a dynamic shape can opt out this way.
export function wrapWithStrictNamespace(
  moduleIdentifier: string,
  namespace: ModuleLike,
): ModuleLike {
  if (
    namespace == null ||
    typeof namespace !== 'object' ||
    (namespace as any)[ALLOW_MISSING_NAMED_EXPORTS] === true
  ) {
    return namespace;
  }
  return new Proxy(namespace, {
    get(target, prop, receiver) {
      // Symbol properties (Symbol.toPrimitive, Symbol.iterator,
      // etc.) pass through — they're never the "I imported a name
      // that doesn't exist" pattern.
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      // Own-property check, NOT `prop in target`. An "exported
      // member" of a namespace is an own property; inherited names
      // like `toString`, `hasOwnProperty`, `constructor` from
      // `Object.prototype` aren't exports. Treating them as exports
      // (via `prop in target`) would silently let a card read those
      // values and bypass the missing-import check.
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      // Runtime probe — let it through to whatever the underlying
      // object would return. NOT a missing-import case.
      if (RUNTIME_PROBE_NAMES.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      throw new ReferenceError(
        `Module '${moduleIdentifier}' has no exported member '${prop}'. ` +
          `If this is a card, check the import statement that names '${prop}' — ` +
          `you may be importing from the wrong module ID. ` +
          `(JavaScript silently produces \`undefined\` for missing named imports, ` +
          `which then surfaces as confusing downstream errors. This Proxy ` +
          `surfaces the missing import directly.)`,
      );
    },
  });
}

export class PackageShimHandler {
  private resolveImport: (moduleIdentifier: string) => string;
  private moduleIds = new Map<string, () => Promise<ModuleLike>>();
  private modulePrefixes = new Map<
    string,
    (rest: string) => Promise<ModuleLike>
  >();
  private log = logger('shim-handler');

  constructor(resolveImport: (moduleIdentifier: string) => string) {
    this.resolveImport = resolveImport;
  }

  handle = async (request: Request): Promise<Response | null> => {
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      try {
        let shimmedModule =
          (await this.getModule(request.url)) ||
          (await this.getModuleByPrefix(request.url));
        if (shimmedModule) {
          let response = new Response();
          // Wrap with the strict-namespace Proxy so importers that
          // name a non-existent export get a clear ReferenceError at
          // the access site instead of silently consuming `undefined`
          // and surfacing a confusing downstream error. The wrapped
          // namespace preserves the underlying module's shape for all
          // existing keys; only missing-key string reads change
          // behavior.
          (response as any)[Symbol.for('shimmed-module')] =
            wrapWithStrictNamespace(request.url, shimmedModule);
          return response;
        }
        return null;
      } catch (err: any) {
        this.log.error(
          `PackageShimHandler#handle threw an error handling ${request.url}`,
          err,
        );
        return null;
      }
    }
    return null;
  };

  shimModule(moduleIdentifier: string, module: ModuleLike) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    this.moduleIds.set(
      trimModuleIdentifier(moduleIdentifier),
      async () => module,
    );
  }

  shimAsyncModule(descriptor: ModuleDescriptor) {
    if ('prefix' in descriptor) {
      this.modulePrefixes.set(
        this.resolveImport(descriptor.prefix),
        descriptor.resolve,
      );
    } else {
      let moduleIdentifier = this.resolveImport(descriptor.id);
      this.moduleIds.set(
        trimModuleIdentifier(moduleIdentifier),
        descriptor.resolve,
      );
    }
  }

  private async getModule(url: string): Promise<ModuleLike | undefined> {
    let resolver = this.moduleIds.get(trimModuleIdentifier(url));
    if (resolver) {
      return await resolver();
    }
    return undefined;
  }

  private async getModuleByPrefix(
    url: string,
  ): Promise<ModuleLike | undefined> {
    for (const [modulePrefix, resolveModule] of this.modulePrefixes) {
      if (url.startsWith(modulePrefix)) {
        let rest = url.slice(modulePrefix.length);
        return await resolveModule(rest);
        break;
      }
    }
    return undefined;
  }
}
