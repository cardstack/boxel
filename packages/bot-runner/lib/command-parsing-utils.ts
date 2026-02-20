import {
  ensureTrailingSlash,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

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
  if (!path) {
    return undefined;
  }

  let commandsPrefix = '/commands/';
  if (path.includes(commandsPrefix)) {
    if (!realmURL) {
      return undefined;
    }
    let rest = path.split(commandsPrefix)[1] ?? '';
    let [commandName, exportName = 'default'] = rest.split('/');
    if (!commandName) {
      return undefined;
    }
    return {
      module: `${ensureTrailingSlash(realmURL)}commands/${commandName}`,
      name: exportName || 'default',
    };
  }

  return undefined;
}

function parseBoxelHostCommandSpecifier(
  commandRef: string,
): ResolvedCodeRef | undefined {
  let match = commandRef.match(
    /^@?cardstack\/boxel-host\/commands\/([^/?#\s]+)(?:\/([^/?#\s]+))?$/,
  );
  if (!match) {
    return undefined;
  }
  let commandName = match[1];
  let exportName = match[2] ?? 'default';
  return {
    module: `@cardstack/boxel-host/commands/${commandName}`,
    name: exportName || 'default',
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
