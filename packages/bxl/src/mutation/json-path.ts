import type { BxlMutationJson, BxlMutationPath } from './types.ts';

export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function pathKey(path: BxlMutationPath): string {
  return JSON.stringify(path);
}

export function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasAt(root: BxlMutationJson, path: BxlMutationPath): boolean {
  if (path.length === 0) return true;
  let current: unknown = root;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return false;
    if (Array.isArray(current)) {
      if (typeof part !== 'number' || part < 0 || part >= current.length)
        return false;
      current = current[part];
    } else {
      if (
        typeof part !== 'string' ||
        !Object.prototype.hasOwnProperty.call(current, part)
      )
        return false;
      current = (current as Record<string, unknown>)[part];
    }
  }
  return true;
}

export function valueAt(
  root: BxlMutationJson,
  path: BxlMutationPath,
): BxlMutationJson | undefined {
  let current: unknown = root;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current)
      ? current[part as number]
      : (current as Record<string, unknown>)[part as string];
  }
  return current as BxlMutationJson | undefined;
}

export function setAt(
  root: BxlMutationJson,
  path: BxlMutationPath,
  value: BxlMutationJson,
): BxlMutationJson {
  if (path.length === 0) return clone(value);
  let current = root as BxlMutationJson[] | Record<string, BxlMutationJson>;
  for (let index = 0; index < path.length - 1; index++) {
    const part = path[index]!;
    const nextPart = path[index + 1]!;
    const next = Array.isArray(current)
      ? current[part as number]
      : current[part as string];
    if (next === null || typeof next !== 'object') {
      const replacement: BxlMutationJson =
        typeof nextPart === 'number' ? [] : {};
      if (Array.isArray(current)) current[part as number] = replacement;
      else current[part as string] = replacement;
      current = replacement as
        | BxlMutationJson[]
        | Record<string, BxlMutationJson>;
    } else {
      current = next as BxlMutationJson[] | Record<string, BxlMutationJson>;
    }
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(current)) current[last as number] = clone(value);
  else current[last as string] = clone(value);
  return root;
}

export function deleteAt(
  root: BxlMutationJson,
  path: BxlMutationPath,
): BxlMutationJson {
  if (path.length === 0) {
    throw new Error('The planner cannot delete its root value.');
  }
  const parent = valueAt(root, path.slice(0, -1));
  const key = path[path.length - 1]!;
  if (Array.isArray(parent)) parent.splice(key as number, 1);
  else if (parent && typeof parent === 'object') delete parent[key as string];
  return root;
}
