#!/usr/bin/env node
/**
 * Verify `@cardstack/bxl` the way an npm consumer gets it, rather than the way
 * this repo gets it.
 *
 * Everything else that exercises BXL — the package's own suites, the host
 * integration tests, the realm-server smoke — reads `src/`. None of that says
 * anything about the published tarball: the exports map a consumer resolves is
 * `publishConfig.exports`, the files a consumer has are whatever `files`
 * shipped, and the directory a consumer loads from is inside `node_modules`,
 * where Node refuses to strip types. A green suite is entirely compatible with
 * a package that is dead on arrival.
 *
 * So: pack (or download) the artifact, `npm install` it into a throwaway
 * project outside the monorepo, and check it from there.
 *
 *   node scripts/verify-package.ts
 *   node scripts/verify-package.ts --source published --version 0.6.0-unstable.0
 *
 * Sources:
 *   --source tarball    (default) `pnpm pack` the working tree — `prepack`
 *                       builds `dist/` first — then `npm install` the tarball.
 *                       pnpm packs rather than npm because pnpm rewrites the
 *                       `catalog:` dependency specifiers to real ranges, which
 *                       is what `pnpm publish` ships; npm would leave them
 *                       literal and the install would fail.
 *   --source published  `npm install @cardstack/bxl@<version>` from the
 *                       registry, polling for propagation first. Checks the
 *                       artifact that actually shipped.
 *
 * `npm install` — not pnpm — so dependencies land in the hoisted layout a
 * real consumer has.
 *
 * Two checks run against the install:
 *
 *   Runtime, under plain Node: every subpath in the published exports map
 *   resolves and loads, a formula evaluates end to end, a lazy formula chunk
 *   loads (its dynamic import is a separate resolution path, and the one most
 *   likely to break in a packed layout), the TextMate grammar is readable as
 *   JSON, and the build's self-reported version matches the package's.
 *
 *   Types, under `nodenext` with `skipLibCheck` off: a consumer's compiler
 *   resolves declarations for every subpath through the exports map and walks
 *   the whole declaration graph. This is what catches a subpath that resolves
 *   at runtime but has no declarations, and a declaration reaching a file the
 *   `files` list never shipped — both of which leave a consumer's imports
 *   silently typed `any` or outright failing to compile.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import ts from 'typescript';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_NAME = '@cardstack/bxl';

// A concrete semver, as opposed to a dist-tag like `unstable` or `latest`.
const CONCRETE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

interface Args {
  source: 'published' | 'tarball';
  version: string;
}

function parseArgs(argv: string[]): Args {
  let source = 'tarball';
  let version = 'latest';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') {
      source = argv[++i];
    } else if (argv[i] === '--version') {
      version = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (source !== 'tarball' && source !== 'published') {
    throw new Error(
      `--source must be 'tarball' or 'published' (got ${source})`,
    );
  }
  return { source, version };
}

function packTarball(destDir: string): string {
  execFileSync('pnpm', ['pack', '--pack-destination', destDir], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
  });
  const tarball = readdirSync(destDir).find((f) => f.endsWith('.tgz'));
  if (!tarball) {
    throw new Error(`pnpm pack produced no .tgz in ${destDir}`);
  }
  return join(destDir, tarball);
}

/**
 * Poll `npm view` until `version` resolves, absorbing the registry's
 * post-publish propagation delay.
 *
 * Only a concrete version makes this meaningful: `npm view pkg@1.2.3` errors
 * until that exact version exists, so the poll waits for it. A dist-tag
 * already resolves to some earlier release, so the poll would return
 * immediately and the checks could run against the *previous* artifact.
 */
function waitForPublishedVersion(version: string): void {
  if (!CONCRETE_VERSION.test(version)) {
    console.warn(
      `WARNING: "${version}" is a dist-tag, not a concrete version. This ` +
        `cannot confirm a freshly published version has propagated — npm may ` +
        `resolve it to an older release. Pass the exact version for a ` +
        `trustworthy post-publish check.`,
    );
  }
  const deadline = Date.now() + 180_000;
  let attempt = 0;
  for (;;) {
    const result = spawnSync(
      'npm',
      ['view', `${PACKAGE_NAME}@${version}`, 'version'],
      { encoding: 'utf8' },
    );
    if (result.status === 0 && result.stdout.trim()) {
      console.log(
        `resolved ${PACKAGE_NAME}@${version} → ${result.stdout.trim()}`,
      );
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${PACKAGE_NAME}@${version} not resolvable after 180s. Last npm error:\n${result.stderr}`,
      );
    }
    const delay = Math.min(15_000, 2_000 * ++attempt);
    console.log(`waiting for ${PACKAGE_NAME}@${version} to propagate…`);
    execFileSync('sleep', [String(delay / 1000)]);
  }
}

/**
 * A throwaway consumer project outside the monorepo — outside so no ambient
 * workspace `node_modules`, tsconfig, or pnpm link can stand in for something
 * the tarball was supposed to provide.
 */
function installConsumer(spec: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bxl-consumer-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'bxl-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    ) + '\n',
  );
  execFileSync(
    'npm',
    ['install', spec, '--no-audit', '--no-fund', '--loglevel', 'error'],
    { cwd: dir, stdio: 'inherit' },
  );
  return dir;
}

interface Subpath {
  // JSON is served as data, so it needs an import attribute at every reference
  // — including the generated checks.
  json: boolean;
  specifier: string;
}

/**
 * Every non-pattern subpath of the published exports map, so the checks below
 * cover the surface the package promises rather than a hand-picked few.
 */
function publishedSubpaths(): Subpath[] {
  const pkg = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  );
  const map: Record<string, string> = pkg.publishConfig?.exports ?? {};
  return Object.entries(map)
    .filter(
      ([subpath]) => !subpath.includes('*') && subpath !== './package.json',
    )
    .map(([subpath, target]) => ({
      json: target.endsWith('.json'),
      specifier:
        subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`,
    }))
    .sort((a, b) => a.specifier.localeCompare(b.specifier));
}

const RUNTIME_CHECK = (subpaths: Subpath[]) => `
import { createRequire } from 'node:module';
import { strictEqual, ok } from 'node:assert';

import { BXL_BUILD_INFO, VERSION, evaluateBxl } from '${PACKAGE_NAME}';
import { runNativeJqAsync } from '${PACKAGE_NAME}/runtime';
import grammar from '${PACKAGE_NAME}/syntax/textmate' with { type: 'json' };

// Every subpath the published exports map serves, loaded through the map the
// way a consumer reaches it. A subpath whose target the tarball never shipped
// fails here with ERR_MODULE_NOT_FOUND.
for (const { specifier, json } of ${JSON.stringify(subpaths)}) {
  const loaded = json
    ? await import(specifier, { with: { type: 'json' } })
    : await import(specifier);
  ok(
    Object.keys(loaded).length > 0,
    \`\${specifier} resolved but exported nothing\`,
  );
}

// A formula end to end: readable syntax → jq → evaluated result.
const evaluated = evaluateBxl('ROUND(Subtotal * TaxRate / 100, 2)', {
  subtotal: 50,
  taxRate: 8.25,
});
strictEqual(evaluated.value, 4.13, 'formula evaluated to the expected value');

// A lazy formula chunk. These load by dynamic import at call time, which
// resolves separately from the static import graph above — and is the part a
// packed layout is most likely to break.
const lazy = await runNativeJqAsync('NORM.DIST(42, 40, 1.5, true)', {});
ok(
  Math.abs(lazy.outputs[0] - 0.9087887802741321) < 1e-12,
  \`statistical chunk returned \${lazy.outputs[0]}\`,
);

// The TextMate grammar is a data file, not a module — it only reaches the
// tarball if the build copies it. Imported statically here, the way a consumer
// writes it, and checked for real content rather than mere resolvability.
ok(grammar.scopeName, 'TextMate grammar has a scopeName');

// The version the build reports about itself is the version that was
// published. These live in two files and drift silently otherwise.
const require = createRequire(import.meta.url);
const installed = require('${PACKAGE_NAME}/package.json');
strictEqual(VERSION, installed.version, 'VERSION matches package.json');
strictEqual(BXL_BUILD_INFO.version, installed.version, 'build info matches');

console.log(
  \`runtime OK: ${subpaths.length} subpaths, version \${installed.version}\`,
);
`;

const TYPE_CHECK = (subpaths: Subpath[]) => `
${subpaths
  .map(({ specifier, json }, index) =>
    json
      ? `import m${index} from '${specifier}' with { type: 'json' };`
      : `import * as m${index} from '${specifier}';`,
  )
  .join('\n')}
import { evaluateBxl, type BxlEvaluation } from '${PACKAGE_NAME}';
import { compileReadableSyntax } from '${PACKAGE_NAME}/compiler';
import { lintBxlExpression } from '${PACKAGE_NAME}/linter';

// Annotated deliberately: an inferred type would let a broken declaration
// degrade to \`any\` and still compile.
const evaluation: BxlEvaluation = evaluateBxl('1 + 1', {});
const compiled: string = compileReadableSyntax('Subtotal * 2').source;
const issues: number = lintBxlExpression('Subtotal *').issues.length;

export const surface = [
${subpaths.map((_, index) => `  m${index},`).join('\n')}
  evaluation.value,
  compiled,
  issues,
];
`;

function runNodeCheck(consumerDir: string, subpaths: Subpath[]): void {
  const file = join(consumerDir, 'runtime-check.mjs');
  writeFileSync(file, RUNTIME_CHECK(subpaths), 'utf8');
  const result = spawnSync(process.execPath, [file], {
    cwd: consumerDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('runtime check failed');
  }
}

/**
 * Type-check a consumer module against the installed declarations, with the
 * settings a consumer plausibly has: `nodenext` resolution (so the exports map
 * governs), `strict`, and `skipLibCheck` off so errors inside the package's own
 * declarations are reported rather than swallowed.
 */
function runTypeCheck(consumerDir: string, subpaths: Subpath[]): void {
  const file = join(consumerDir, 'type-check.ts');
  writeFileSync(file, TYPE_CHECK(subpaths), 'utf8');

  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    resolveJsonModule: true,
    skipLibCheck: false,
    strict: true,
    types: [],
  };
  const program = ts.createProgram([file], options);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => consumerDir,
        getNewLine: () => '\n',
      }),
    );
    throw new Error(`type check failed with ${diagnostics.length} error(s)`);
  }
  console.log(`types OK: ${subpaths.length} subpaths resolve declarations`);
}

function main(): void {
  const { source, version } = parseArgs(process.argv.slice(2));
  const subpaths = publishedSubpaths();

  const workDir = mkdtempSync(join(tmpdir(), 'bxl-pack-'));
  const cleanup = [workDir];
  try {
    let spec: string;
    if (source === 'tarball') {
      spec = packTarball(workDir);
    } else {
      waitForPublishedVersion(version);
      spec = `${PACKAGE_NAME}@${version}`;
    }

    const consumerDir = installConsumer(spec);
    cleanup.push(consumerDir);

    runNodeCheck(consumerDir, subpaths);
    runTypeCheck(consumerDir, subpaths);
    console.log(`${PACKAGE_NAME} verified from ${source}`);
  } finally {
    for (const dir of cleanup) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
}

main();
