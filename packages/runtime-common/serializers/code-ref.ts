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
  let baseURL: URL | undefined;
  if (opts.relativeTo instanceof URL) {
    baseURL = opts.relativeTo;
  } else if (
    typeof opts.relativeTo === 'string' &&
    (opts.relativeTo.startsWith('http://') ||
      opts.relativeTo.startsWith('https://'))
  ) {
    baseURL = new URL(opts.relativeTo);
  } else if (
    doc?.data?.id &&
    typeof doc.data.id === 'string' &&
    (doc.data.id.startsWith('http://') || doc.data.id.startsWith('https://'))
  ) {
    baseURL = new URL(doc.data.id);
  }
  return {
    ...codeRef,
    ...codeRefAdjustments(codeRef, baseURL, opts),
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
  // Identifiers are canonical RRI here, so resolution is plain URL math —
  // no VirtualNetwork. A URL-form module joins against a URL-form base; a
  // scoped RRI / bare specifier is already portable and is preserved.
  let urlBase: URL | string | undefined =
    relativeTo instanceof URL
      ? relativeTo
      : typeof relativeTo === 'string' &&
          (relativeTo.startsWith('http://') ||
            relativeTo.startsWith('https://'))
        ? relativeTo
        : undefined;
  let resolve = (ref: string) => {
    if (!isUrlLike(ref)) {
      throw new Error(
        `Cannot resolve bare package specifier "${ref}" — not a URL`,
      );
    }
    return new URL(ref, urlBase).href;
  };
  if (!isUrlLike(codeRef.module)) {
    // A scoped RRI (e.g. `@cardstack/base/card-api`) is already the canonical,
    // deployment-independent portable form. Preserve it verbatim rather than
    // resolving it to a concrete realm URL: resolution would bake an
    // environment-specific (and possibly cross-origin) URL into the stored
    // card and defeat the portability the RRI exists to provide.
    if (codeRef.module.startsWith('@')) {
      let module: string = codeRef.module;
      if (opts?.trimExecutableExtension) {
        module = trimExecutableExtension(rri(module));
      }
      return { module };
    }
    // Otherwise it is a non-scoped bare specifier. Try plain URL resolution,
    // and if unresolvable leave it for the loader's importMap shim via the
    // surrounding try/catch.
    try {
      let resolved = resolve(codeRef.module);
      if (resolved !== codeRef.module) {
        let module: string = resolved;
        if (opts?.trimExecutableExtension) {
          module = trimExecutableExtension(rri(module));
        }
        if (opts?.allowRelative && opts?.maybeRelativeReference) {
          module = opts.maybeRelativeReference(module);
        }
        return { module };
      }
    } catch {
      // not resolvable, skip
    }
    return {};
  }
  if (relativeTo) {
    let module: string = resolve(codeRef.module);
    if (opts?.trimExecutableExtension) {
      module = trimExecutableExtension(rri(module));
    }
    if (opts?.allowRelative && opts?.maybeRelativeReference) {
      module = opts.maybeRelativeReference(module);
    }
    return { module };
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
