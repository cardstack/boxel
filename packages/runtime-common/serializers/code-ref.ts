import type {
  BaseDefConstructor,
  BaseInstanceType,
  CardStore,
} from 'https://cardstack.com/base/card-api';
import {
  type ResolvedCodeRef,
  isUrlLike,
  isResolvedCodeRef,
  executableExtensions,
  resolveRRIReference,
} from '../index.ts';
import { rri, type RealmResourceIdentifier } from '../realm-identifiers.ts';
// We only use a subset of SerializeOpts here; accept any to align with the
// serializer interface without surfacing unused properties.
import type { SerializeOpts } from 'https://cardstack.com/base/card-api';

export function queryableValue(
  codeRef: ResolvedCodeRef | {} | undefined,
  stack: any[] = [],
): string | undefined {
  return maybeSerializeCodeRef(codeRef, stack);
}

export function serialize(
  codeRef: ResolvedCodeRef | {},
  doc: any,
  _visited?: Set<string>,
  opts?: Omit<SerializeOpts, 'virtualNetwork'> & {
    relativeTo?: RealmResourceIdentifier | URL;
    trimExecutableExtension?: true;
    maybeRelativeReference?: (reference: string) => string;
    allowRelative?: true;
  },
): ResolvedCodeRef | {} {
  // The recursive serialize path through a non-primitive `Contains` field
  // intentionally isolates the inner card's serialization from the outer
  // card's opts (see `Contains.serialize` in card-api.gts), so opts can
  // arrive here as `undefined` or as a synthesized `{ overrides }` object.
  // Identifiers are canonical RRI, so this is pure URL/path math: URL-form
  // refs resolve against a URL base; prefix-form refs are already portable
  // and are preserved by `codeRefAdjustments`.
  if (!opts) {
    return { ...codeRef };
  }
  // Preserve the base's form: a prefix-form RRI base stays prefix-form so a
  // relative module resolves against it in RRI space (`codeRefAdjustments`
  // handles both forms). Falls back to the doc's own (canonical) id.
  let base: RealmResourceIdentifier | URL | undefined;
  if (opts.relativeTo instanceof URL) {
    base = opts.relativeTo;
  } else if (
    typeof opts.relativeTo === 'string' &&
    (opts.relativeTo.startsWith('http://') ||
      opts.relativeTo.startsWith('https://') ||
      opts.relativeTo.startsWith('@'))
  ) {
    base = rri(opts.relativeTo);
  } else if (
    doc?.data?.id &&
    typeof doc.data.id === 'string' &&
    (doc.data.id.startsWith('http://') ||
      doc.data.id.startsWith('https://') ||
      doc.data.id.startsWith('@'))
  ) {
    base = rri(doc.data.id);
  }
  return {
    ...codeRef,
    ...codeRefAdjustments(codeRef, base, opts),
  };
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  codeRef: ResolvedCodeRef | {},
  _relativeTo: RealmResourceIdentifier | URL | undefined,
): Promise<BaseInstanceType<T>> {
  return { ...codeRef } as BaseInstanceType<T>; // return a new object so that the model cannot be mutated from the outside
}

export function formatQuery(codeRef: ResolvedCodeRef | {}): string | undefined {
  return maybeSerializeCodeRef(codeRef);
}

export async function deserializeAbsolute<T extends BaseDefConstructor>(
  this: T,
  codeRef: ResolvedCodeRef | {},
  relativeTo: RealmResourceIdentifier | URL | undefined,
  _doc?: unknown,
  store?: CardStore,
): Promise<BaseInstanceType<T>> {
  if (!store) {
    // Reached only by direct test callers that bypass the framework
    // protocol; the framework's field-deserialize path always supplies a
    // store. Preserve the historical "leave the codeRef untouched" behavior
    // for that path.
    return { ...codeRef } as BaseInstanceType<T>;
  }
  return {
    ...codeRef,
    ...codeRefAdjustments(codeRef, relativeTo, {}),
  } as BaseInstanceType<T>;
}

function codeRefAdjustments(
  codeRef: any,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  opts?: Omit<SerializeOpts, 'virtualNetwork'> & {
    trimExecutableExtension?: true;
    maybeRelativeReference?: (reference: string) => string;
    allowRelative?: true;
  },
) {
  if (!codeRef) {
    return {};
  }
  if (!isResolvedCodeRef(codeRef)) {
    return {};
  }
  // Identifiers are canonical RRI here, so resolution is RRI-space reference
  // math — no VirtualNetwork. `resolveRRIReference` joins a relative module
  // against either a URL-form base or a prefix-form RRI base, and returns
  // absolute (URL- or prefix-form) references unchanged.
  let finalize = (module: string) => {
    if (opts?.trimExecutableExtension) {
      module = trimExecutableExtension(rri(module));
    }
    if (opts?.allowRelative && opts?.maybeRelativeReference) {
      module = opts.maybeRelativeReference(module);
    }
    return { module };
  };
  if (!isUrlLike(codeRef.module)) {
    // A scoped RRI (e.g. `@cardstack/base/card-api`) is already the canonical,
    // deployment-independent portable form. Preserve it verbatim rather than
    // resolving it to a concrete realm URL: resolution would bake an
    // environment-specific (and possibly cross-origin) URL into the stored
    // card and defeat the portability the RRI exists to provide. (No
    // `maybeRelativeReference` — a scoped RRI is already portable.)
    if (codeRef.module.startsWith('@')) {
      let module: string = codeRef.module;
      if (opts?.trimExecutableExtension) {
        module = trimExecutableExtension(rri(module));
      }
      return { module };
    }
    // Otherwise it is a non-scoped bare specifier (e.g. an npm package import).
    // Leave it for the loader's importMap shim.
    return {};
  }
  if (relativeTo) {
    // URL-form or `./`/`../`/`/`-relative module. Resolve in RRI space so a
    // relative module resolves against a prefix-form RRI base (e.g. `./person`
    // relative to `@cardstack/catalog/specs/foo`) as well as a URL base.
    return finalize(resolveRRIReference(codeRef.module, relativeTo));
  }
  return {};
}

function maybeSerializeCodeRef(
  codeRef: ResolvedCodeRef | {} | undefined,
  stack: any[] = [],
): string | undefined {
  if (codeRef && isResolvedCodeRef(codeRef)) {
    let base =
      stack.length > 0 ? stack.find((i) => (i as any).id)?.id : undefined;
    // `queryableValue` / `formatQuery` don't receive a VirtualNetwork, so
    // we can't resolve registered prefixes here. URL-like refs join
    // against the base; bare specifiers and absolute URLs pass through.
    if (isUrlLike(codeRef.module) && typeof base === 'string') {
      try {
        return `${new URL(codeRef.module, base).href}/${codeRef.name}`;
      } catch {
        // fall through to the as-is shape below
      }
    }
    return `${codeRef.module}/${codeRef.name}`;
  }
  return undefined;
}

// this has been modified from runtime-common/trimExecutableExtension to work
// for non URL's too...
export function trimExecutableExtension(path: string): string {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension)) {
      return path.replace(new RegExp(`\\${extension}$`), '');
    }
  }
  return path;
}
