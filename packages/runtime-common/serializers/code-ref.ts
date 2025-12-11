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
        ? new URL(doc.data.id)
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
    return {};
  }
  if (relativeTo) {
    let module = new URL(codeRef.module, relativeTo).href;
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
    if (isUrlLike(codeRef.module)) {
      // if a stack is passed in, use the containing card to resolve relative references
      let base =
        stack.length > 0 ? stack.find((i) => (i as any).id)?.id : undefined;
      let moduleHref =
        base && typeof base === 'string'
          ? new URL(codeRef.module, base).href
          : codeRef.module;
      return `${moduleHref}/${codeRef.name}`;
    } else {
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
