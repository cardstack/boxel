import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The host makes a fixed set of packages importable from card code by
 * shimming them onto the virtual network (`shimExternals` in
 * `packages/host/app/lib/externals.ts`). A card that imports any of them
 * loads and runs.
 *
 * `boxel parse` type-checks that same card code, so every one of those
 * specifiers has to resolve inside the parse workspace too. In the
 * monorepo it does for free — that branch symlinks host's whole
 * `node_modules`, and host declares everything it shims. A published
 * install has no such directory: `linkResolvedDeps` links boxel-cli's
 * own declared `dependencies` and nothing else, so a shimmed package the
 * CLI doesn't declare becomes a "Cannot find module" against card code
 * that is perfectly correct.
 *
 * That divergence is invisible in monorepo dev and silent until someone
 * runs the published CLI, which is what makes it worth a unit test
 * rather than trusting review. Every card-facing specifier must be
 * accounted for here by exactly one mechanism.
 */

const MONOREPO_PACKAGES = resolve(import.meta.dirname, '../..');
const EXTERNALS_PATH = join(
  MONOREPO_PACKAGES,
  'host',
  'app',
  'lib',
  'externals.ts',
);

/**
 * Specifier families parse resolves through a tsconfig `paths` alias
 * onto bundled sources rather than through `node_modules`, so they are
 * deliberately not boxel-cli dependencies. Keep in step with the `paths`
 * map in `src/commands/parse.ts`.
 */
const RESOLVED_BY_PATH_ALIAS = [
  '@cardstack/base',
  '@cardstack/boxel-host',
  '@cardstack/boxel-ui',
  '@cardstack/bxl',
  '@cardstack/host',
  '@cardstack/runtime-common',
];

/**
 * `@ember/*` are virtual modules of the Ember build rather than packages
 * on disk; glint's environment supplies their types, so they resolve
 * without anything linked. `@ember/test-helpers` is a real package and
 * is excluded here on purpose — it is a declared dependency instead.
 */
const RESOLVED_BY_GLINT_ENVIRONMENT = (pkg: string): boolean =>
  pkg.startsWith('@ember/') && pkg !== '@ember/test-helpers';

/**
 * Specifiers no installed package can satisfy, covered instead by an
 * ambient declaration in the generated shims. `ember-source/types` is
 * the case: the package ships declarations but exposes no `./types`
 * entry through its `exports`, so the specifier resolves for card code
 * only because the host shims it as an empty stub. See `writeShims()` in
 * `scripts/build-types.ts`.
 */
const RESOLVED_BY_AMBIENT_SHIM = ['ember-source'];

/**
 * Aliases parse carries that no literal appearing in `shimExternals`
 * accounts for, so the staleness check below can't expect to find them
 * in the shim list. `@cardstack/base` is reached by its realm URL rather
 * than a shim at all; `@cardstack/boxel-host` covers the host tools,
 * which `shimHostTools` registers from a table instead of writing each
 * specifier out.
 */
const ALIASED_WITHOUT_A_LITERAL_SHIM = [
  '@cardstack/base',
  '@cardstack/boxel-host',
];

/**
 * Every module specifier `shimExternals` exposes to card code, whether
 * shimmed eagerly (`shimModule`) or lazily (`shimAsyncModule`). A card
 * can import either kind, so both bind parse.
 */
function readShimmedSpecifiers(): string[] {
  let source = readFileSync(EXTERNALS_PATH, 'utf8');
  let specifiers = new Set<string>();
  let patterns = [
    /\bshimModule\(\s*['"]([^'"]+)['"]/g,
    /\bshimAsyncModule\(\s*\{\s*id:\s*['"]([^'"]+)['"]/g,
  ];
  for (let pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers].sort();
}

/** `ember-animated/motions/move` → `ember-animated`. */
function packageNameOf(specifier: string): string {
  let segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

function cliDependencies(): Set<string> {
  let pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  return new Set(Object.keys(pkg.dependencies ?? {}));
}

describe('card-facing packages the host shims', () => {
  it('is a non-empty list parsed out of externals.ts', () => {
    // Guards the regexes above: a refactor that renames the shim calls
    // would otherwise leave this suite asserting over an empty set and
    // passing while checking nothing.
    let specifiers = readShimmedSpecifiers();
    expect(specifiers.length).toBeGreaterThan(30);
    expect(specifiers).toContain('ember-modifier');
    expect(specifiers).toContain('@cardstack/runtime-common');
  });

  it('are each resolvable from a published boxel-cli install', () => {
    let dependencies = cliDependencies();
    let unresolvable = [
      ...new Set(readShimmedSpecifiers().map(packageNameOf)),
    ].filter(
      (pkg) =>
        !dependencies.has(pkg) &&
        !RESOLVED_BY_PATH_ALIAS.includes(pkg) &&
        !RESOLVED_BY_GLINT_ENVIRONMENT(pkg) &&
        !RESOLVED_BY_AMBIENT_SHIM.includes(pkg),
    );

    expect(
      unresolvable,
      `The host shims these for card code, but a published boxel-cli ` +
        `install cannot resolve them, so \`boxel parse\` reports ` +
        `"Cannot find module" against valid card code. Add each as a ` +
        `boxel-cli dependency (the version host pins), or — if it is a ` +
        `workspace package or has no declarations at all — bundle it and ` +
        `record the mechanism in the lists at the top of this file.`,
    ).toEqual([]);
  });

  it('do not carry a stale allowance for a package no longer shimmed', () => {
    // An allowance outliving its specifier is how the next reader learns
    // the wrong rule, and how a package quietly stops being checked.
    let shimmed = new Set(readShimmedSpecifiers().map(packageNameOf));
    let stale = [...RESOLVED_BY_PATH_ALIAS, ...RESOLVED_BY_AMBIENT_SHIM].filter(
      (pkg) =>
        !shimmed.has(pkg) && !ALIASED_WITHOUT_A_LITERAL_SHIM.includes(pkg),
    );
    expect(stale).toEqual([]);
  });
});
