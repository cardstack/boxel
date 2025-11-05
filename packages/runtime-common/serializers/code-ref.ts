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
  opts?: any,
): ResolvedCodeRef | {} {
  return {
    ...codeRef,
    ...codeRefAdjustments(
      codeRef,
      (doc.data.id ?? (opts?.relativeTo && opts.relativeTo instanceof URL))
        ? opts.relativeTo
        : undefined,
      opts,
    ),
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
    ...codeRefAdjustments(codeRef, relativeTo, {
      useAbsoluteURL: true,
    }),
  } as BaseInstanceType<T>;
}

function codeRefAdjustments(codeRef: any, relativeTo?: URL, opts?: any) {
  if (!codeRef) {
    return {};
  }
  if (!isResolvedCodeRef(codeRef)) {
    return {};
  }
  if (!isUrlLike(codeRef.module)) {
    return {};
  }
  if (opts?.useAbsoluteURL && relativeTo) {
    return { module: new URL(codeRef.module, relativeTo).href };
  }
  if (!opts?.maybeRelativeURL) {
    return {};
  }
  if (!codeRef.module.startsWith('http') && opts.maybeRelativeURL) {
    // it's already relative
    return {
      module: opts?.trimExecutableExtension
        ? trimExecutableExtension(codeRef.module)
        : codeRef.module,
    };
  }
  let module = opts.maybeRelativeURL(codeRef.module);
  return {
    module: opts?.trimExecutableExtension
      ? trimExecutableExtension(module)
      : module,
  };
}

function maybeSerializeCodeRef(
  codeRef: ResolvedCodeRef | {} | undefined,
  stack: any[] = [],
): string | undefined {
  if (codeRef && isResolvedCodeRef(codeRef)) {
    if (isUrlLike(codeRef.module)) {
      // if a stack is passed in, use the containing card to resolve relative references
      let moduleHref =
        stack.length > 0
          ? new URL(codeRef.module, stack.find((i) => i.id).id).href
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
