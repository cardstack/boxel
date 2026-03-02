import type { ResolvedCodeRef } from './code-ref';
import { ensureTrailingSlash } from './paths';

export function parseBoxelHostCommandSpecifier(
  commandRef: string,
): ResolvedCodeRef | undefined {
  let match = commandRef.match(
    /^@cardstack\/boxel-host\/commands\/([^/?#\s]+)\/([^/?#\s]+)$/,
  );
  if (!match) {
    return undefined;
  }
  return {
    module: `@cardstack/boxel-host/commands/${match[1]}`,
    name: match[2],
  };
}

export function commandUrlToCodeRef(
  commandUrl: string,
  realmURL: string | undefined,
): ResolvedCodeRef | undefined {
  if (!commandUrl) {
    return undefined;
  }

  let commandRef = commandUrl.trim();
  if (!commandRef) {
    return undefined;
  }

  let fromSpecifier = parseBoxelHostCommandSpecifier(commandRef);
  if (fromSpecifier) {
    return fromSpecifier;
  }

  let path = toCommandPath(commandRef);
  if (!path || !realmURL) {
    return undefined;
  }

  let parsedPath = parseCommandPath(path);
  if (!parsedPath) {
    return undefined;
  }

  return {
    module: `${ensureTrailingSlash(realmURL)}commands/${parsedPath.commandName}`,
    name: parsedPath.exportName,
  };
}

function toCommandPath(commandRef: string): string | undefined {
  try {
    return new URL(commandRef).pathname;
  } catch {
    // Accept absolute URL command references only.
  }
  return undefined;
}

type ParsedCommandPath = {
  commandName: string;
  exportName: string;
};

function parseCommandPath(pathname: string): ParsedCommandPath | undefined {
  if (!pathname.startsWith('/commands/')) {
    return undefined;
  }

  // Accept only /commands/<name> or /commands/<name>/<export>. This avoids
  // matching nested /commands/ paths and traversal-like payloads.
  let segments = pathname.split('/').filter(Boolean);
  if (
    segments[0] !== 'commands' ||
    segments.length < 2 ||
    segments.length > 3
  ) {
    return undefined;
  }

  let [_, rawCommandName, rawExportName] = segments;
  let commandName = decodePathSegment(rawCommandName);
  if (!commandName || isUnsafeCommandSegment(commandName)) {
    return undefined;
  }

  let exportName = rawExportName ? decodePathSegment(rawExportName) : 'default';
  if (!exportName || isUnsafeCommandSegment(exportName)) {
    return undefined;
  }

  return { commandName, exportName };
}

function decodePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function isUnsafeCommandSegment(segment: string): boolean {
  return (
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    /\s/.test(segment)
  );
}
