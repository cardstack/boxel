// Turning a url or a code ref into the low-cardinality label a dashboard can group
// by. Both are pure and both are load-bearing for cardinality: a label carrying a
// per-instance id would give Loki a new series per card.

import { hasExecutableExtension } from '@cardstack/runtime-common';

// Normalize a realm-server URL to a low-cardinality endpoint label: bare
// underscore-endpoints (`_search`, `_catalog-realms`) collapse to the endpoint
// name; everything else (card / source / file requests) collapses to
// `<METHOD> <kind>` (e.g. "GET card").
export function normalizeEndpoint(rawUrl: string, method: string): string {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  let segments = pathname.split('/').filter(Boolean);
  let endpointSegment = segments.find((s) => s.startsWith('_'));
  if (endpointSegment) {
    return endpointSegment;
  }
  let last = segments[segments.length - 1] ?? '';
  let kind: string;
  if (last.endsWith('.json')) {
    kind = 'file-meta';
  } else if (hasExecutableExtension(last)) {
    kind = 'source';
  } else if (last.includes('.')) {
    kind = 'file';
  } else {
    kind = 'card';
  }
  return `${method} ${kind}`;
}

// A CodeRef is usually `{ module, name }`; other shapes (fieldOf / ancestorOf)
// have no direct name, so we surface null there.
// A card type as an address, not a bare class name: the module the type lives
// in with the export name as the final segment (<moduleURL>/<ExportName>), so
// a dashboard row says where the code is. A relative module specifier is
// resolved against the instance's own id; a scoped one (@cardstack/base/...)
// is already canonical and passes through.
export function codeRefURL(
  adoptsFrom: unknown,
  instanceId: string | undefined,
): string | null {
  if (
    !adoptsFrom ||
    typeof adoptsFrom !== 'object' ||
    typeof (adoptsFrom as { name?: unknown }).name !== 'string' ||
    typeof (adoptsFrom as { module?: unknown }).module !== 'string'
  ) {
    return null;
  }
  let { module, name } = adoptsFrom as { module: string; name: string };
  if (module.startsWith('.') && instanceId) {
    try {
      module = new URL(module, instanceId).href;
    } catch {
      // keep the relative spelling rather than dropping the event
    }
  }
  return `${module}/${name}`;
}
