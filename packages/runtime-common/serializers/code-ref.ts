import {
  type BaseDefConstructor,
  type BaseInstanceType,
} from 'https://cardstack.com/base/card-api';
import { type ResolvedCodeRef, isUrlLike, isResolvedCodeRef } from '../index';

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
    ...codeRefAdjustments(codeRef, doc.data.id, opts),
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
    ...codeRefAdjustments(codeRef, relativeTo?.toString(), {
      useAbsoluteURL: true,
    }),
  } as BaseInstanceType<T>;
}

function codeRefAdjustments(codeRef: any, relativeTo?: string, opts?: any) {
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
  return { module: opts.maybeRelativeURL(codeRef.module) };
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
          ? new URL(codeRef.module, (stack[0] as any).id).href
          : codeRef.module;
      return `${moduleHref}/${codeRef.name}`;
    } else {
      return `${codeRef.module}/${codeRef.name}`;
    }
  }
  return undefined;
}
