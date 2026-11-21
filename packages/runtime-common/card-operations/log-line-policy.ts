// What a policy may grant on a realm's logs.
//
// A log is a file, but its bytes are not one caller's: every line names the
// actor who wrote it, as the realm stamped it when `record` appended the
// line. That actor is what a grant on a log's lines can trust, and only while
// no caller may rewrite the log's bytes. So under a policy the base log
// types' `record` is the one operation a grant reaches on a log, and the
// rest — the base `appendLine`, `update`, `delete`, and the raw
// `readSource` — are refused at the gate on any `.jsonl` or `.log` file,
// whatever type a rule names. The policy compiler records a grant of one of
// them on a base log type as `grants-log-bytes`, so an author learns it
// admits no one.

import { baseRealm } from '../constants.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';

// The base log types a log-line rule names, and the files each types.
const LOG_LINE_TYPES: { module: string; name: string; extension: string }[] = [
  { module: 'jsonl-file-def', name: 'JSONLFile', extension: '.jsonl' },
  { module: 'log-file-def', name: 'LogFile', extension: '.log' },
];

const BASE_PREFIXES = [baseRealm.url, '@cardstack/base/'];

// The extension of the logs a rule's type is, or undefined for a type that
// is no base log type. A type based on one is not one: its rules are its
// own cards'.
export function logLineTypeOf(ref: ResolvedCodeRef): string | undefined {
  let module = ref.module.replace(/\.gts$/, '');
  for (let type of LOG_LINE_TYPES) {
    if (ref.name !== type.name) continue;
    // The base realm by its canonical prefix or alias, or by the URL a
    // server mounts it at (`…/base/`), which is how a policy card's
    // resolved type names it on a deployment.
    if (
      BASE_PREFIXES.some((prefix) => module === `${prefix}${type.module}`) ||
      (/^https?:\/\//.test(module) &&
        new URL(module).pathname.endsWith(`/base/${type.module}`))
    ) {
      return type.extension;
    }
  }
  return undefined;
}

// Whether a type key (`<module>/<name>`) names base JSONLFile or LogFile.
export function isBaseLogTypeKey(key: string | undefined): boolean {
  if (!key) return false;
  let at = key.lastIndexOf('/');
  return (
    at > 0 &&
    logLineTypeOf({
      module: key.slice(0, at) as ResolvedCodeRef['module'],
      name: key.slice(at + 1),
    }) !== undefined
  );
}

// Why a grant of `operation` on a rule whose type is base JSONLFile or
// LogFile admits no one, the gate refusing it on every log, or undefined
// where it may admit someone: the type's own `record`, and a `query`, which
// the search judges rather than the gate. A type based on a log type names
// its own files, which the gate refuses as logs only where their extension
// is a log's, so its grants are not judged here.
export function logBytesRefusal(
  ruleType: ResolvedCodeRef,
  operation: string,
): string | undefined {
  if (
    operation === 'record' ||
    operation === 'query' ||
    logLineTypeOf(ruleType) === undefined
  ) {
    return undefined;
  }
  return `\`${operation}\` on a log is granted to no one. A log's bytes hold every caller's lines, each stamped with the actor who wrote it, which means nothing if a caller may read or rewrite them, so only \`record\` is granted on a log, and only the realm's own permissions allow \`${operation}\``;
}
