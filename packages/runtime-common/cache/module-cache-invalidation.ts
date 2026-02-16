import type { LocalPath, RealmPaths } from '../paths';
import { executableExtensions } from '../index';
import { parse as babelParse } from '@babel/parser';
import { getBabelOptions } from '../babel-options';

export interface CachedModuleDependencyEntry {
  canonicalPath: LocalPath;
  dependencyKeys: Set<string>;
}

export function moduleDependencyKey(localPath: LocalPath): string {
  for (let extension of executableExtensions) {
    if (localPath.endsWith(extension)) {
      return localPath.slice(0, -extension.length);
    }
  }
  return localPath;
}

export function collectDependentModuleCacheInvalidations(
  changedDependencyKeys: Set<string>,
  cacheEntries: Iterable<CachedModuleDependencyEntry>,
): Set<LocalPath> {
  if (changedDependencyKeys.size === 0) {
    return new Set();
  }
  let depsByCanonicalPath = new Map<LocalPath, Set<string>>();
  for (let cachedEntry of cacheEntries) {
    if (!depsByCanonicalPath.has(cachedEntry.canonicalPath)) {
      depsByCanonicalPath.set(
        cachedEntry.canonicalPath,
        cachedEntry.dependencyKeys,
      );
    }
  }

  let invalidated = new Set<LocalPath>();
  let seenDependencyKeys = new Set(changedDependencyKeys);
  let pendingDependencyKeys = [...changedDependencyKeys];
  while (pendingDependencyKeys.length > 0) {
    let changedDependencyKey = pendingDependencyKeys.pop()!;
    for (let [modulePath, moduleDeps] of depsByCanonicalPath) {
      if (
        invalidated.has(modulePath) ||
        !moduleDeps.has(changedDependencyKey)
      ) {
        continue;
      }
      invalidated.add(modulePath);
      let dependencyKey = moduleDependencyKey(modulePath);
      if (!seenDependencyKeys.has(dependencyKey)) {
        seenDependencyKeys.add(dependencyKey);
        pendingDependencyKeys.push(dependencyKey);
      }
    }
  }
  return invalidated;
}

export function extractModuleDependencyKeys(
  source: string,
  canonicalPath: LocalPath,
  realmURL: string,
  paths: RealmPaths,
): Set<string> {
  let dependencies = new Set<string>();
  let moduleURL = paths.fileURL(canonicalPath).href;
  for (let specifier of extractImportSpecifiers(source, moduleURL)) {
    try {
      let resolvedURL = new URL(specifier, moduleURL);
      if (!resolvedURL.href.startsWith(realmURL)) {
        continue;
      }
      dependencies.add(moduleDependencyKey(paths.local(resolvedURL)));
    } catch (_err) {
      // ignore unresolvable import specifiers
    }
  }
  return dependencies;
}

function extractImportSpecifiers(
  source: string,
  sourceFilename: string,
): Set<string> {
  let specifiers = new Set<string>();
  let ast;
  try {
    ast = babelParse(source, getBabelOptions({ sourceFilename }));
  } catch (_err) {
    return specifiers;
  }

  visitNode(ast, (node) => {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        addStringLiteral(node.source, specifiers);
        break;
      case 'ImportExpression':
        addStringLiteral(node.source, specifiers);
        break;
      case 'CallExpression': {
        // Babel may represent dynamic import as CallExpression + Import callee.
        let callee = asNode(node.callee);
        if (callee?.type === 'Import') {
          let args = Array.isArray(node.arguments) ? node.arguments : [];
          addStringLiteral(args[0], specifiers);
        }
        break;
      }
    }
  });

  return specifiers;
}

function addStringLiteral(value: unknown, specifiers: Set<string>) {
  let node = asNode(value);
  if (node?.type === 'StringLiteral' && typeof node.value === 'string') {
    specifiers.add(node.value);
  }
}

function visitNode(
  value: unknown,
  visitor: (
    node: { type: string; [key: string]: unknown } & Record<string, unknown>,
  ) => void,
) {
  if (value == null) {
    return;
  }
  if (Array.isArray(value)) {
    for (let item of value) {
      visitNode(item, visitor);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  let node = asNode(value);
  if (!node) {
    for (let nested of Object.values(value)) {
      visitNode(nested, visitor);
    }
    return;
  }

  visitor(node);
  for (let nested of Object.values(value)) {
    visitNode(nested, visitor);
  }
}

function asNode(
  value: unknown,
): ({ type: string } & Record<string, unknown>) | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  return value as { type: string } & Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
