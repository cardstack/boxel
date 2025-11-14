import camelCase from 'camelcase';

import type { CodeRef, ResolvedCodeRef } from '../code-ref';
import { trimExecutableExtension } from '../index';
import type { RealmPaths } from '../paths';

export function getCardDirectoryName(
  adoptsFrom: CodeRef | undefined,
  paths: RealmPaths,
): string {
  return (
    directoryNameFromResolvedRef(resolveToResolvedCodeRef(adoptsFrom), paths) ??
    'cards'
  );
}

function resolveToResolvedCodeRef(
  ref: CodeRef | undefined,
): ResolvedCodeRef | undefined {
  if (!ref) {
    return undefined;
  }
  if ('type' in ref) {
    return resolveToResolvedCodeRef(ref.card);
  }
  return ref;
}

function directoryNameFromResolvedRef(
  ref: ResolvedCodeRef | undefined,
  paths: RealmPaths,
): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.name && ref.name !== 'default') {
    return ref.name;
  }
  return directoryNameFromModule(ref.module, paths);
}

function directoryNameFromModule(
  moduleIdentifier: string,
  paths: RealmPaths,
): string | undefined {
  let segment: string | undefined;
  try {
    segment = lastMeaningfulSegment(
      trimExecutableExtension(new URL(moduleIdentifier)).pathname,
    );
  } catch {
    try {
      segment = lastMeaningfulSegment(
        trimExecutableExtension(new URL(moduleIdentifier, paths.url)).pathname,
      );
    } catch {
      segment = undefined;
    }
  }
  if (!segment) {
    segment = lastMeaningfulSegment(moduleIdentifier);
  }
  return directoryNameFromSegment(segment);
}

function lastMeaningfulSegment(pathname: string): string | undefined {
  let normalized = pathname.replace(/\\/g, '/').replace(/\/+$/, '');
  let segments = normalized.split('/').filter(Boolean);
  if (!segments.length) {
    return undefined;
  }
  let candidate = segments.pop()!;
  if (candidate === 'index' && segments.length) {
    candidate = segments.pop()!;
  }
  candidate = candidate.replace(/\.[^/.]+$/, '');
  candidate = candidate.trim();
  if (!candidate) {
    return undefined;
  }
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // ignore decode errors, fall back to raw segment
  }
  return candidate;
}

function directoryNameFromSegment(
  segment: string | undefined,
): string | undefined {
  if (!segment) {
    return undefined;
  }

  let candidate = segment.replace(/^[^\p{L}_$]+/u, '');

  if (!candidate) {
    candidate = `Card${segment}`.replace(/^[^\p{L}_$]+/u, '');
  }

  let pascal = camelCase(candidate, { pascalCase: true }).replace(
    /[^\p{L}\p{N}_$]+/gu,
    '',
  );

  if (!pascal) {
    return undefined;
  }

  return pascal;
}
