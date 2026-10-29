import camelCase from 'camelcase';

import type { CodeRef, ResolvedCodeRef } from '../code-ref.ts';
import {
  isAbsoluteIdentifier,
  type RealmResourceIdentifier,
} from '../realm-identifiers.ts';
import { trimExecutableExtension } from '../index.ts';

export function getCardDirectoryName(adoptsFrom: CodeRef | undefined): string {
  return (
    directoryNameFromResolvedRef(resolveToResolvedCodeRef(adoptsFrom)) ??
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
): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.name && ref.name !== 'default') {
    return ref.name;
  }
  return directoryNameFromModule(ref.module);
}

function directoryNameFromModule(
  moduleIdentifier: RealmResourceIdentifier,
): string | undefined {
  // Every identifier form (URL, `@scope/name/…` prefix, relative) ends with
  // the module's path, so the last meaningful path segment is read straight
  // from the string once the query and fragment are gone.
  let withoutSuffix = moduleIdentifier.split(/[?#]/)[0];
  return directoryNameFromSegment(
    lastMeaningfulSegment(trimExecutableExtension(withoutSuffix)),
  );
}

function lastMeaningfulSegment(pathname: string): string | undefined {
  let normalized = pathname.replace(/\\/g, '/').replace(/\/+$/, '');
  // An absolute identifier's root (`scheme://host` or `@scope/name`) is not
  // part of its path, so `..` stops there rather than climbing into it.
  let rootLength = isAbsoluteIdentifier(normalized) ? 2 : 0;
  // A relative module's `.` and `..` name no directory of their own: `..`
  // removes the segment before it.
  let segments: string[] = [];
  for (let segment of normalized.split('/')) {
    if (segment === '..') {
      if (segments.length > rootLength) {
        segments.pop();
      }
    } else if (segment && segment !== '.') {
      segments.push(segment);
    }
  }
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
