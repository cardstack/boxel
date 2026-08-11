// Searching for a type by RANGE, when the index stores it by VERSION.
//
// THE PROBLEM, STATED PRECISELY. `deck-the-range-is-on-disk.md` §0 says type
// identity is computed from the resolved module, so an instance's `types` row
// always holds an exact version:
//
//     .../_packages/experiments/greeter@2.2.0/index/Greeter
//
// That is the right thing to store — three instances spelled `^2.0.0`, `~2.2`
// and `2.2.0` collapse to one key, which is what makes "find every instance of
// this type" answerable at all. But it means the index holds POINTS, and a
// question like "every Greeter on `^2`" is an INTERVAL. Nothing in the stored
// key can be pattern-matched into an answer: `@2.2.0` and `@2.3.0` are not
// substrings of `@^2.0.0`, and no amount of SQL cleverness makes them so.
//
// SO EXPAND, DON'T PATTERN-MATCH. Ask which versions exist, keep the ones the
// range admits, and rewrite the filter into an `any` over exact keys:
//
//     { type: greeter@^2.0.0/index/Greeter }
//   → { any: [ { type: greeter@2.0.0/… }, { type: greeter@2.1.0/… },
//              { type: greeter@2.2.0/… }, { type: greeter@2.3.0/… } ] }
//
// Every branch is then an ordinary exact-key predicate, served by the GIN
// containment index (`boxel_index_types_containment_idx`) that already exists.
// The engine below this point learns nothing new; the whole feature is a
// filter-to-filter rewrite performed before the query is compiled.
//
// WHY THIS IS NOT A SECOND SEMVER ENGINE. `resolveVersionSpec` answers "which
// ONE Version does this spec mean" — the loader's question, max-satisfying,
// used by the serve door, the packer's lock and the publish invalidation. This
// asks "which versions does this range ADMIT", which is a genuinely different
// question with a genuinely different answer shape (a set, not a winner). Both
// are computed by the same `semver` library over the same version list, so
// they cannot disagree about what `^2.0.0` means; they only differ in what
// they do with the matches. Anything that reimplements range SEMANTICS —
// notably interpreting a range inside the database — would be the thing to
// refuse, because then a disagreement is expressible.
//
// A RANGE THAT MATCHES NOTHING NEEDS NO SPECIAL CASE. Left un-rewritten, the
// range-spelled key simply matches no stored row, which is the correct answer
// and requires no empty-`any` semantics from the engine.

import semver from 'semver';
import type { Filter } from './query.ts';
import type { CodeRef } from './code-ref.ts';

const PACKAGES_SEGMENT = '/_packages/';

export interface PackageModuleRef {
  // Everything up to and including `/_packages/`.
  prefix: string;
  // Store name, e.g. `experiments/greeter`.
  name: string;
  // Version, range or dist-tag, already percent-decoded.
  spec: string;
  // Everything after the spec's `/`, e.g. `index`.
  rest: string;
}

// A package address, split. Returns undefined for anything that is not one —
// a realm-hosted module, a base-realm RRI, a bare name.
export function parsePackageModule(
  module: string,
): PackageModuleRef | undefined {
  let at = module.indexOf(PACKAGES_SEGMENT);
  if (at === -1) {
    return undefined;
  }
  let prefix = module.slice(0, at + PACKAGES_SEGMENT.length);
  let remainder = module.slice(at + PACKAGES_SEGMENT.length);
  // The name may hold one `/` (publisher/key) but never an `@`, so the first
  // `@` ends the name wherever it falls.
  let atVersion = remainder.indexOf('@');
  if (atVersion <= 0) {
    return undefined;
  }
  let name = remainder.slice(0, atVersion);
  let afterAt = remainder.slice(atVersion + 1);
  let slash = afterAt.indexOf('/');
  if (slash <= 0) {
    return undefined;
  }
  let rawSpec = afterAt.slice(0, slash);
  let rest = afterAt.slice(slash + 1);
  let spec: string;
  try {
    spec = decodeURIComponent(rawSpec);
  } catch {
    spec = rawSpec;
  }
  return { prefix, name, spec, rest };
}

export function packageModuleURL(ref: PackageModuleRef, version: string) {
  return `${ref.prefix}${ref.name}@${version}/${ref.rest}`;
}

// True when the spec names exactly one Version and so needs no expansion.
// Everything else — a range, a dist-tag, a partial like `2.1` — does.
export function isExactVersion(spec: string): boolean {
  return semver.valid(spec) === spec;
}

export interface PackageSpecRequest {
  name: string;
  spec: string;
}

export function specKey({ name, spec }: PackageSpecRequest): string {
  return `${name}@${spec}`;
}

function refOf(filter: any): CodeRef | undefined {
  let ref = filter?.type ?? filter?.on;
  return ref && typeof ref === 'object' && 'module' in ref ? ref : undefined;
}

// Every distinct (name, spec) a filter tree asks about that is not already an
// exact version. Collected in one pass so the caller can fetch all the version
// lists it needs concurrently, rather than once per filter node.
export function collectPackageSpecs(
  filter: Filter | undefined,
): PackageSpecRequest[] {
  let found = new Map<string, PackageSpecRequest>();
  let walk = (f: any) => {
    if (!f || typeof f !== 'object') {
      return;
    }
    let ref = refOf(f);
    if (ref && 'module' in ref) {
      let parsed = parsePackageModule(ref.module);
      if (parsed && !isExactVersion(parsed.spec)) {
        found.set(specKey(parsed), { name: parsed.name, spec: parsed.spec });
      }
    }
    for (let child of f.any ?? []) {
      walk(child);
    }
    for (let child of f.every ?? []) {
      walk(child);
    }
    if (f.not) {
      walk(f.not);
    }
  };
  walk(filter);
  return [...found.values()];
}

// Which of `versions` the spec admits, newest first, plus dist-tag support.
// Newest-first matters only for readability of the rewritten filter; `any` is
// unordered.
export function versionsSatisfying(options: {
  spec: string;
  versions: string[];
  tags?: Record<string, string>;
}): string[] {
  let { spec, versions, tags } = options;
  if (isExactVersion(spec)) {
    return versions.includes(spec) ? [spec] : [];
  }
  let tagged = tags?.[spec];
  if (tagged) {
    // A dist-tag names one Version, the same way it does at the serve door.
    return versions.includes(tagged) ? [tagged] : [];
  }
  if (!semver.validRange(spec)) {
    return [];
  }
  return versions
    .filter((v) => semver.valid(v) && semver.satisfies(v, spec))
    .sort(semver.rcompare);
}

export type VersionLookup = (
  request: PackageSpecRequest,
) => string[] | undefined;

// Rewrite every range-spelled type reference into an `any` over the exact
// versions it admits. `lookup` returning undefined means "no answer for this
// package" — the node is left alone, which matches nothing, rather than
// silently widening to match everything.
export function expandPackageRanges(
  filter: Filter | undefined,
  lookup: VersionLookup,
): Filter | undefined {
  if (!filter) {
    return filter;
  }
  let expand = (f: any): any => {
    if (!f || typeof f !== 'object') {
      return f;
    }
    let node: any = { ...f };
    if (Array.isArray(node.any)) {
      node.any = node.any.map(expand);
    }
    if (Array.isArray(node.every)) {
      node.every = node.every.map(expand);
    }
    if (node.not) {
      node.not = expand(node.not);
    }

    let key = node.type ? 'type' : node.on ? 'on' : undefined;
    let ref = refOf(node);
    if (!key || !ref || !('module' in ref)) {
      return node;
    }
    let parsed = parsePackageModule(ref.module);
    if (!parsed || isExactVersion(parsed.spec)) {
      return node;
    }
    let versions = lookup({ name: parsed.name, spec: parsed.spec });
    if (!versions || versions.length === 0) {
      return node;
    }
    let withVersion = (version: string) => ({
      ...node,
      [key]: { ...ref, module: packageModuleURL(parsed, version) },
    });
    // One match needs no wrapper — substituting in place keeps the rewritten
    // filter readable, which matters because it is what shows up in logs.
    if (versions.length === 1) {
      return withVersion(versions[0]);
    }
    return { any: versions.map(withVersion) };
  };
  return expand(filter) as Filter;
}
