import type {
  BaseDefConstructor,
  BaseInstanceType,
} from '@cardstack/base/card-api';
import {
  type ResolvedCodeRef,
  isUrlLike,
  isResolvedCodeRef,
  executableExtensions,
} from '../index';
import { resolveCardReference, cardIdToURL } from '../card-reference-resolver';
// We only use a subset of SerializeOpts here; accept any to align with the
// serializer interface without surfacing unused properties.
import type { SerializeOpts } from '@cardstack/base/card-api';

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
  opts?: SerializeOpts & {
    relativeTo?: URL;
    trimExecutableExtension?: true;
    maybeRelativeURL?: (url: string) => string;
    allowRelative?: true;
  },
): ResolvedCodeRef | {} {
  let baseURL =
    opts?.relativeTo instanceof URL
      ? opts.relativeTo
      : doc?.data?.id && typeof doc.data.id === 'string'
        ? cardIdToURL(doc.data.id)
        : undefined;
  return {
    ...codeRef,
    ...codeRefAdjustments(codeRef, baseURL, opts),
  };
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  codeRef: ResolvedCodeRef | {},
  _relativeTo: URL | undefined,
): Promise<BaseInstanceType<T>> {
  return { ...codeRef } as BaseInstanceType<T>; // return a new object so that the model cannot be mutated from the outside
}

export function formatQuery(codeRef: ResolvedCodeRef | {}): string | undefined {
  return maybeSerializeCodeRef(codeRef);
}

export async function deserializeAbsolute<T extends BaseDefConstructor>(
  this: T,
  codeRef: ResolvedCodeRef | {},
  relativeTo: URL | undefined,
): Promise<BaseInstanceType<T>> {
  return {
    ...codeRef,
    ...codeRefAdjustments(codeRef, relativeTo),
  } as BaseInstanceType<T>;
}

function codeRefAdjustments(
  codeRef: any,
  relativeTo?: URL,
  opts?: SerializeOpts & {
    trimExecutableExtension?: true;
    maybeRelativeURL?: (url: string) => string;
    allowRelative?: true;
  },
) {
  if (!codeRef) {
    return {};
  }
  if (!isResolvedCodeRef(codeRef)) {
    return {};
  }
  if (!isUrlLike(codeRef.module)) {
    // Try resolving via registered prefix mappings (e.g., @cardstack/catalog/)
    try {
      let resolved = resolveCardReference(codeRef.module, relativeTo);
      if (resolved !== codeRef.module) {
        let module = resolved;
        if (opts?.trimExecutableExtension) {
          module = trimExecutableExtension(module);
        }
        if (opts?.allowRelative && opts?.maybeRelativeURL) {
          module = opts.maybeRelativeURL(module);
        }
        return { module };
      }
    } catch {
      // not resolvable, skip
    }
    return {};
  }
  if (relativeTo) {
    let module = resolveCardReference(codeRef.module, relativeTo);
    if (opts?.trimExecutableExtension) {
      module = trimExecutableExtension(module);
    }
    if (opts?.allowRelative && opts?.maybeRelativeURL) {
      module = opts.maybeRelativeURL(module);
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
    try {
      let moduleHref = resolveCardReference(
        codeRef.module,
        base && typeof base === 'string' ? base : undefined,
      );
      return `${moduleHref}/${codeRef.name}`;
    } catch {
      return `${codeRef.module}/${codeRef.name}`;
    }
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
