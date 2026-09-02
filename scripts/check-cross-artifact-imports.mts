#!/usr/bin/env -S node
// Guards against a commit that adds an export to `packages/boxel-ui` and, in
// the same change, imports it from `packages/base`.
//
// Those two packages look like neighbors in git and are not neighbors in
// deployment. `boxel-ui` is compiled into the host bundle; `base` ships as
// realm source, fetched at index time. They reach production by separate,
// non-atomic paths, and the deploy train brings the new source up while pages
// are still running the previous bundle — so for a few minutes a render of the
// new source resolves its imports against a bundle that has never heard of
// them, and throws `has no exported member '…'`.
//
// That failure is not confined to the render. The indexer stores it as the
// card's content, so a transient window becomes an error document served from
// cache to every anonymous reader until something reindexes the row. Twice in
// three days that turned a ~6-minute bundle overlap into a ~70-minute outage
// across every realm linking a base-realm card (see CS-12669, CS-12696).
//
// Nothing else can see this. Both halves type-check, both pass their tests,
// and the pair is only wrong in the interval between two deploys — so the
// signal has to come from the shape of the change itself.
//
// The rule: for every name this change newly exports from a `boxel-ui` barrel,
// no file under `packages/base` may import that name. Landing the export
// first, and the import in a later deploy, satisfies it.
//
// Type-only exports and imports are ignored, following the same reasoning as
// `check-protocol-import-closure.mts`: they are erased before anything can
// access a member, so they cannot throw.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The barrels realm source imports through: a name is only reachable from
// `packages/base` if one of these exports it. Located by pattern at each
// revision rather than by fixed path, because the package has been
// restructured before — and a barrel that simply moved would otherwise read as
// a barrel whose every name is new, which is the difference between a check
// that fires on a hazard and one that fires on a refactor.
const BARREL_PATTERN = /(^|\/)src\/(components|helpers|icons|modifiers)\.gts$/;

function barrelPaths(ref: string | undefined): string[] {
  let listing =
    ref === undefined
      ? git(['ls-tree', '-r', '--name-only', 'HEAD', 'packages/boxel-ui'])
      : git(['ls-tree', '-r', '--name-only', ref, 'packages/boxel-ui']);
  return listing.split('\n').filter((path) => BARREL_PATTERN.test(path));
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitOrEmpty(args: string[]): string {
  try {
    return git(args);
  } catch {
    // A path that does not exist at that revision, which reads as "nothing
    // exported there yet" — the correct answer for a newly added barrel.
    return '';
  }
}

// `--head` exists so the check can be pointed at a historical commit, which is
// how its own behavior is verified against the two commits that caused the
// outages. Unset means the working tree, which is what CI checks.
function arg(name: string): string | undefined {
  let flag = `--${name}`;
  let index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

let headRef = arg('head');
let baseRef =
  arg('base') ??
  process.env.CROSS_ARTIFACT_BASE ??
  (process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/main');

// The merge base, not the base tip: a branch that has not caught up with main
// must not be told that main's newer exports are its own.
let mergeBase: string;
try {
  mergeBase = git(['merge-base', baseRef, headRef ?? 'HEAD']).trim();
} catch {
  // Loudly, rather than passing: a check that cannot see the base has not
  // found the change clean, and a shallow clone is the likely reason.
  console.error(
    `Cannot resolve a merge base between ${baseRef} and ${headRef ?? 'HEAD'}.\n` +
      `This check diffs against the base branch, so it needs that history —\n` +
      `\`fetch-depth: 0\` on checkout, or \`--base <ref>\` locally.`,
  );
  process.exit(1);
}

function readAt(ref: string | undefined, path: string): string {
  return ref === undefined
    ? gitOrEmpty(['show', `HEAD:${path}`])
    : gitOrEmpty(['show', `${ref}:${path}`]);
}

// Names an `export { … }` block makes available at runtime. `type` entries are
// dropped; `x as y` exports `y`.
function exportedNames(source: string): Set<string> {
  let names = new Set<string>();
  for (let [, body] of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let entry of body.split(',')) {
      let specifier = entry.trim();
      if (!specifier || /^type\s/.test(specifier)) {
        continue;
      }
      let parts = specifier.split(/\s+as\s+/);
      let name = (parts[1] ?? parts[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default') {
        names.add(name);
      }
    }
  }
  for (let [, name] of source.matchAll(
    /export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(name);
  }
  return names;
}

// Names a file imports from `@cardstack/boxel-ui/*` at runtime. `import type`
// statements and `type` specifiers are dropped for the same reason.
function boxelUiImports(source: string): Map<string, string[]> {
  let byName = new Map<string, string[]>();
  let pattern =
    /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](@cardstack\/boxel-ui\/[^'"]+)['"]/g;
  for (let [, typeOnly, body, module] of source.matchAll(pattern)) {
    if (typeOnly) {
      continue;
    }
    for (let entry of body.split(',')) {
      let specifier = entry.trim();
      if (!specifier || /^type\s/.test(specifier)) {
        continue;
      }
      let name = specifier.split(/\s+as\s+/)[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        continue;
      }
      let modules = byName.get(name) ?? [];
      modules.push(module);
      byName.set(name, modules);
    }
  }
  return byName;
}

function baseFiles(ref: string | undefined): string[] {
  let listing =
    ref === undefined
      ? git(['ls-tree', '-r', '--name-only', 'HEAD', 'packages/base'])
      : git(['ls-tree', '-r', '--name-only', ref, 'packages/base']);
  return listing
    .split('\n')
    .filter((path) => /\.(gts|ts)$/.test(path) && !path.endsWith('.d.ts'));
}

// Compared as one set across every barrel, not barrel by barrel: a name moved
// between them is still a name the deployed bundle already provides.
function reachableNames(ref: string | undefined): Set<string> {
  let names = new Set<string>();
  for (let barrel of barrelPaths(ref)) {
    for (let name of exportedNames(readAt(ref, barrel))) {
      names.add(name);
    }
  }
  return names;
}

let before = reachableNames(mergeBase);
let newExports = new Set<string>();
for (let name of reachableNames(headRef)) {
  if (!before.has(name)) {
    newExports.add(name);
  }
}

type Offender = { name: string; file: string; module: string };
let offenders: Offender[] = [];
if (newExports.size > 0) {
  for (let file of baseFiles(headRef)) {
    let imports = boxelUiImports(readAt(headRef, file));
    for (let [name, modules] of imports) {
      if (newExports.has(name)) {
        offenders.push({ name, file, module: modules[0] });
      }
    }
  }
}

console.log(
  `cross-artifact imports: ${newExports.size} name(s) newly exported from boxel-ui since ${mergeBase.slice(0, 9)}` +
    (newExports.size > 0 ? ` — ${[...newExports].sort().join(', ')}` : ''),
);

if (offenders.length > 0) {
  console.error(
    `\nThese names are exported from boxel-ui for the first time in this change` +
      ` and imported from packages/base by it:\n` +
      offenders
        .map(({ name, file, module }) => `  ${name}  ${file} → ${module}`)
        .join('\n') +
      `\n\nboxel-ui ships in the host bundle and base ships as realm source, so` +
      `\nthis pair cannot be deployed atomically: for the length of the deploy` +
      `\nthe new source renders against a bundle without these names, throws` +
      `\n'has no exported member', and that failure is cached as the card's` +
      `\ncontent until something reindexes the row.` +
      `\n\nLand the boxel-ui export first and the base import in a later deploy.`,
  );
}

process.exit(offenders.length > 0 ? 1 : 0);
