import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';
import {
  type ResolvedCodeRef,
  isUrlLike,
  isResolvedCodeRef,
  executableExtensions,
} from '../index';
import { resolveModuleHref } from '../code-ref';
import { rri, type RealmResourceIdentifier } from '../realm-identifiers';
import type { VirtualNetwork } from '../virtual-network';
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
    virtualNetwork?: VirtualNetwork;
  },
): ResolvedCodeRef | {} {
  let vn = opts?.virtualNetwork;
  let baseURL: URL | undefined;
  if (opts?.relativeTo instanceof URL) {
    baseURL = opts.relativeTo;
  } else if (typeof opts?.relativeTo === 'string') {
    baseURL = vn ? vn.toURL(opts.relativeTo) : undefined;
  } else if (doc?.data?.id && typeof doc.data.id === 'string') {
    baseURL = vn ? vn.toURL(doc.data.id) : undefined;
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
): Promise<BaseInstanceType<T>> {
  return {
    ...codeRef,
    ...codeRefAdjustments(codeRef, relativeTo),
  } as BaseInstanceType<T>;
}

function codeRefAdjustments(
  codeRef: any,
  relativeTo?: RealmResourceIdentifier | URL,
  opts?: Omit<SerializeOpts, 'virtualNetwork'> & {
    trimExecutableExtension?: true;
    maybeRelativeReference?: (reference: string) => string;
    allowRelative?: true;
    virtualNetwork?: VirtualNetwork;
  },
) {
  if (!codeRef) {
    return {};
  }
  if (!isResolvedCodeRef(codeRef)) {
    return {};
  }
  // The `deserializeAbsolute` field-deserialize path reaches this without
  // opts (no VN, no `allowRelative`, no `maybeRelativeReference`). For
  // URL-like refs we can still do a plain URL-join against `relativeTo`
  // and apply `trimExecutableExtension`. Bare specifiers (e.g.
  // `@cardstack/boxel-host/…`) throw — `resolve` is wrapped in try/catch
  // below, so the original ref stays intact for the loader's importMap
  // shim.
  let vn = opts?.virtualNetwork;
  let resolve = (ref: string) => {
    if (vn) {
      return resolveModuleHref(ref, relativeTo, vn);
    }
    if (!isUrlLike(ref)) {
      throw new Error(
        `Cannot resolve bare package specifier "${ref}" — no matching prefix mapping registered`,
      );
    }
    return new URL(ref, relativeTo).href;
  };
  if (!isUrlLike(codeRef.module)) {
    // Try resolving via registered prefix mappings (e.g., @cardstack/catalog/)
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
