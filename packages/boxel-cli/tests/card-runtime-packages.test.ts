import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';

/**
 * The host makes a fixed set of packages importable from card code by
 * shimming them onto the virtual network (`shimExternals` in
 * `packages/host/app/lib/externals.ts`). A card that imports any of them
 * loads and runs.
 *
 * `boxel parse` type-checks that same card code, so every one of those
 * specifiers has to resolve inside the parse workspace too, carrying
 * real declarations. `linkResolvedDeps` builds that workspace from
 * boxel-cli's own declared `dependencies`, so a shimmed package the CLI
 * doesn't declare becomes a "Cannot find module" against card code that
 * is perfectly correct — and one it declares without types becomes an
 * "implicitly has an 'any' type" under the workspace's `strict`.
 *
 * The failure is invisible in monorepo dev, where the other branch
 * symlinks host's whole `node_modules`, and silent until someone runs
 * the published CLI. Hence a test rather than trusting review.
 *
 * These assertions resolve each specifier through TypeScript itself
 * rather than checking it appears in `package.json`: appearing there is
 * the weaker property, and satisfies a package that ships no
 * declarations at all.
 */

const BOXEL_CLI_ROOT = resolve(import.meta.dirname, '..');
const MONOREPO_PACKAGES = resolve(BOXEL_CLI_ROOT, '..');
const EXTERNALS_PATH = join(
  MONOREPO_PACKAGES,
  'host',
  'app',
  'lib',
  'externals.ts',
);

/**
 * Specifier prefixes parse resolves through a tsconfig `paths` alias
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
 * Virtual modules of the Ember build, supplied by glint's environment
 * rather than resolved from disk. An allowlist rather than an `@ember/`
 * prefix rule: `@ember/test-helpers`, `@ember/string` and
 * `@ember/test-waiters` are ordinary packages that share the scope and
 * do not resolve without being declared, so a prefix rule would wave
 * through exactly the mistake this file exists to catch.
 */
const RESOLVED_BY_GLINT_ENVIRONMENT = [
  '@ember/component',
  '@ember/component/template-only',
  '@ember/destroyable',
  '@ember/helper',
  '@ember/modifier',
  '@ember/object',
  '@ember/object/internals',
  '@ember/owner',
  '@ember/runloop',
  '@ember/service',
  '@ember/template',
  '@ember/template-factory',
];

/**
 * Specifiers no installed package can satisfy, covered instead by an
 * ambient declaration in the generated shims — which parse feeds to
 * glint through `include`, not through module resolution, so the
 * resolver check below cannot see them. See `writeShims()` in
 * `scripts/build-types.ts`.
 */
const RESOLVED_BY_AMBIENT_SHIM = [
  'ember-source/types',
  'ember-source/types/preview',
];

/**
 * Aliases parse carries that no literal in `shimExternals` accounts for,
 * so the staleness check can't expect to find them in the shim list.
 * `@cardstack/base` is reached by its realm URL rather than a shim at
 * all; `@cardstack/boxel-host` covers the host tools, which
 * `shimHostTools` registers from a table instead of writing each
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
  let specifiers = new Set(extractSpecifiers());
  return [...specifiers].sort();
}

/**
 * Specifiers in source order, duplicates kept, so the count can be
 * compared against the call sites they were read from.
 */
function extractSpecifiers(): string[] {
  let source = readFileSync(EXTERNALS_PATH, 'utf8');
  let specifiers: string[] = [];
  let patterns = [
    /\.shimModule\(\s*['"]([^'"]+)['"]/g,
    /\.shimAsyncModule\(\s*\{\s*id:\s*['"]([^'"]+)['"]/g,
  ];
  for (let pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** Every shim call site, however its specifier is written. */
function countShimCallSites(): number {
  let source = readFileSync(EXTERNALS_PATH, 'utf8');
  return (source.match(/\.shim(?:Async)?Module\(/g) ?? []).length;
}

/**
 * Ambient declarations for packages that ship none, vendored from
 * `packages/host/types` and reached through parse's `'*'` fallback path.
 * Resolving the specifier can't see these, so check the directory that
 * backs them.
 */
function hasVendoredAmbientDeclarations(specifier: string): boolean {
  return existsSync(
    join(MONOREPO_PACKAGES, 'host', 'types', packageNameOf(specifier)),
  );
}

/** `ember-animated/motions/move` → `ember-animated`. */
function packageNameOf(specifier: string): string {
  let segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

function isCoveredWithoutResolution(specifier: string): boolean {
  return (
    RESOLVED_BY_GLINT_ENVIRONMENT.includes(specifier) ||
    RESOLVED_BY_AMBIENT_SHIM.includes(specifier) ||
    RESOLVED_BY_PATH_ALIAS.some(
      (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
    ) ||
    hasVendoredAmbientDeclarations(specifier)
  );
}

/**
 * Ask TypeScript whether the specifier yields declarations when resolved
 * from boxel-cli, under the same `bundler` resolution the parse
 * workspace uses. pnpm gives boxel-cli a `node_modules` holding exactly
 * its declared dependencies, which is the layout `linkResolvedDeps`
 * reproduces — so a specifier that fails here is one a published install
 * cannot type-check either.
 */
function resolvesToDeclarations(specifier: string): boolean {
  let resolved = ts.resolveModuleName(
    specifier,
    join(BOXEL_CLI_ROOT, 'index.ts'),
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      allowJs: true,
    },
    ts.sys,
  ).resolvedModule;
  if (!resolved) return false;
  return (
    resolved.extension === ts.Extension.Dts ||
    resolved.extension === ts.Extension.Dmts ||
    resolved.extension === ts.Extension.Dcts
  );
}

describe('card-facing packages the host shims', () => {
  it('parses a specifier out of every shim call site', () => {
    // The specifier patterns only read string literals. A shim written
    // any other way — an identifier, a template literal, a `{ prefix }`
    // descriptor, a loop — would otherwise go unseen, and this suite
    // would keep passing while checking less than it claims.
    expect(extractSpecifiers().length).toBe(countShimCallSites());
  });

  it('finds the shims it is meant to be checking', () => {
    let specifiers = readShimmedSpecifiers();
    expect(specifiers).toContain('ember-modifier');
    expect(specifiers).toContain('@ember/test-helpers');
    expect(specifiers).toContain('@cardstack/runtime-common');
  });

  it('resolve to real declarations from a boxel-cli install', () => {
    let unresolvable = readShimmedSpecifiers().filter(
      (specifier) =>
        !isCoveredWithoutResolution(specifier) &&
        !resolvesToDeclarations(specifier),
    );

    expect(
      unresolvable,
      `The host shims these for card code, but TypeScript cannot resolve ` +
        `declarations for them from boxel-cli, so \`boxel parse\` reports ` +
        `"Cannot find module" or "implicitly has an 'any' type" against ` +
        `valid card code. Declare each as a boxel-cli dependency at the ` +
        `version host pins — plus its \`@types/*\` package when it ships no ` +
        `declarations of its own — or, for a workspace package or a ` +
        `specifier no package can satisfy, bundle it and record the ` +
        `mechanism in the lists at the top of this file.`,
    ).toEqual([]);
  });

  it('do not carry a stale allowance for a package no longer shimmed', () => {
    // An allowance outliving its specifier is how the next reader learns
    // the wrong rule, and how a package quietly stops being checked.
    let shimmed = new Set(readShimmedSpecifiers());
    let stale = [
      ...RESOLVED_BY_PATH_ALIAS,
      ...RESOLVED_BY_GLINT_ENVIRONMENT,
      ...RESOLVED_BY_AMBIENT_SHIM,
    ].filter(
      (entry) =>
        !shimmed.has(entry) &&
        !ALIASED_WITHOUT_A_LITERAL_SHIM.includes(entry) &&
        ![...shimmed].some((specifier) => specifier.startsWith(`${entry}/`)),
    );
    expect(stale).toEqual([]);
  });
});
