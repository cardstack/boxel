import type { CredentialScrubber } from './scrubber.ts';

// Node quotes its input in many error messages — `new Headers` the offending
// value, `new URL` the whole URL (and keeps it again on the error's `input`),
// `JSON.parse` a slice of the text — so an error raised while a credential is
// attached can carry it in its message, its stack, its `cause`, or any other
// property a logger or Sentry prints.
//
// `scrubError` rewrites all of these in place, so the error keeps its class
// and identity: `instanceof` checks and an abort-reason identity check still
// recognize it afterwards.

const MAX_DEPTH = 6;

function scrubValue(
  value: unknown,
  scrubber: CredentialScrubber,
  seen: Set<object>,
  depth: number,
): unknown {
  if (typeof value === 'string') {
    return scrubber.scrubText(value);
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    depth >= MAX_DEPTH ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubValue(value[i], scrubber, seen, depth + 1);
    }
    return value;
  }
  let names = new Set<string>(Object.keys(value));
  if (value instanceof Error) {
    for (let name of ['message', 'stack', 'cause', 'errors']) {
      if (name in value) {
        names.add(name);
      }
    }
  }
  for (let name of names) {
    let current: unknown;
    try {
      current = (value as Record<string, unknown>)[name];
    } catch {
      continue;
    }
    let scrubbed = scrubValue(current, scrubber, seen, depth + 1);
    if (scrubbed !== current) {
      try {
        Object.defineProperty(value, name, {
          value: scrubbed,
          writable: true,
          configurable: true,
          enumerable: Object.prototype.propertyIsEnumerable.call(value, name),
        });
      } catch {
        // A frozen or non-configurable property is left as it is.
      }
    }
  }
  return value;
}

export function scrubError<T>(error: T, scrubber: CredentialScrubber): T {
  if (scrubber.isEmpty) {
    return error;
  }
  return scrubValue(error, scrubber, new Set(), 0) as T;
}
