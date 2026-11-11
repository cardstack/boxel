// Grants on the lines of a realm's logs (ADR 006, "Log lines").
//
// A log is a file, and a policy grants a file one behavior on the file
// lane, the read of its stored bytes. A log's lines are different: each is a
// row of `boxel_log_lines` with the realm-stamped `actor` who wrote it, and a
// grant on them is judged per line, on that actor and nothing else:
//
//   { targetType: JSONLFile, grants: [{ operation: 'query', where: '.actor == actor()' }] }
//
// admits every signed-in caller to a search over the lines they wrote of
// every `.jsonl` log in the realm (LogFile, the `.log` lines). The search
// ANDs `actor = <caller>` into its one WHERE, so its rows, totals, groups and
// facets all cover only those lines (`log-query.ts`). A `where` of any other
// shape names something a line does not carry a trustworthy value for, and
// is recorded `policy-not-filterable`: it admits nothing. A caller who isn't
// signed in has no lines of their own and is never admitted.
//
// Only the realm-stamped `actor` is trustworthy: `record` stamps it, and
// under a policy `record` is the only write a log grants (the gate refuses
// the base `appendLine`, `update`, `delete` and the raw `readSource` on a
// log, `logFileGrantable`), so no admitted caller can write a line as
// someone else.

import { baseRealm } from '../constants.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import type { LogAccess } from '../log-query.ts';
import type { CompiledOperationGrant, CompiledRealmPolicy } from './policy.ts';

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

const OWN_LINE = String.raw`(?:\.actor\s*==\s*actor\(\)|actor\(\)\s*==\s*\.actor)`;
const SIGNED_IN = String.raw`(?:actor\(\)\s*!=\s*"anonymous"|"anonymous"\s*!=\s*actor\(\))`;
const AND = String.raw`\s+(?:and|AND)\s+|\s*&&\s*`;
const OWN_LINES_PREDICATE = new RegExp(
  `^\\(?\\s*(?:${OWN_LINE}|${OWN_LINE}(?:${AND})${SIGNED_IN}|${SIGNED_IN}(?:${AND})${OWN_LINE})\\s*\\)?$`,
);

// Whether a grant's `where`, as the policy profile canonicalized it, is one
// a log-line grant compiles: the line's realm-stamped actor is the caller,
// optionally beside `actor() != "anonymous"`.
export function isOwnLinesPredicate(canonical: string): boolean {
  return OWN_LINES_PREDICATE.test(canonical.trim());
}

export const LOG_LINE_GRANT_SHAPE =
  'a grant on a log\'s lines admits a caller to the lines they wrote, so its `where` is `.actor == actor()` (optionally with `and actor() != "anonymous"`), which compares the actor the realm stamped on each line; a line carries no other value a grant could trust';

// The log-line grants of a compiled policy, by the extension of the logs
// each covers.
export function logLineGrants(
  policy: CompiledRealmPolicy | undefined,
): Map<string, CompiledOperationGrant[]> {
  let found = new Map<string, CompiledOperationGrant[]>();
  for (let rule of policy?.rules ?? []) {
    let extension = logLineTypeOf(rule.targetType);
    if (!extension) continue;
    for (let grant of rule.grants) {
      if (grant.operation === 'query' && grant.logLines === 'own') {
        found.set(extension, [...(found.get(extension) ?? []), grant]);
      }
    }
  }
  return found;
}

// What `user` may read of each of the realm's logs under its policy: their
// own lines of a log a log-line grant covers, and nothing of any other. With
// no signed-in user, or no log-line grant, nothing at all (undefined).
export function logLineAccessFor(
  policy: CompiledRealmPolicy | undefined,
  user: string | undefined,
): ((url: string) => LogAccess) | undefined {
  if (!user || user === 'anonymous') {
    return undefined;
  }
  let grants = logLineGrants(policy);
  if (grants.size === 0) {
    return undefined;
  }
  return (url: string) => {
    let path = new URL(url).pathname;
    for (let extension of grants.keys()) {
      if (path.endsWith(extension) && !path.endsWith('.vectors.jsonl')) {
        return { actor: user };
      }
    }
    return 'none';
  };
}
