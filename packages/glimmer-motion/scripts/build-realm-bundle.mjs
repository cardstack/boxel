/**
 * Build glimmer-motion as a single-file realm module and (optionally)
 * sync it to a Boxel workspace. Pattern borrowed from @cardstack/bxl's
 * scripts/build-realm-bundle.mjs.
 *
 * The realm artifact is ONE file — `dist-realm/choreo.ts` — containing
 * the whole public surface (`<Choreo>`, the timeline steps, `{{motion}}`,
 * presence, layout, gestures, scroll…) with the motion.dev engine
 * (motion-dom + motion-utils) and every other npm dependency inlined.
 * A realm card imports it with a single relative import:
 *
 *   import { Choreo, motion, spring } from '../choreo';
 *
 * What stays external — and why it works in a realm:
 *
 *   - `@ember/*`, `@glimmer/*`, `ember-modifier`: framework virtual
 *     modules the Boxel host resolves at load time, exactly as it does
 *     for card modules.
 *   - `@ember/template-compilation`: the bundle keeps the addon's
 *     `precompileTemplate(...)` calls intact. The realm server's babel
 *     pass (the same plugin that compiles `<template>` tags in .gts
 *     cards) compiles them when the module is served — which is why the
 *     output must be named `.ts`, so the realm treats it as source.
 *
 * Because the realm compiles the file, it is NOT minified by default:
 * `precompileTemplate` resolves template identifiers through scope-object
 * keys, and a readable bundle keeps that path easy to debug. Pass
 *  `--minify` if you want a smaller artifact (scope keys survive
 * minification — esbuild rewrites shorthand `{ Move }` to
 * `{ Move: Move2 }` — but readable is the default on purpose).
 *
 * Three-phase pipeline, so a stale realm can never inherit orphans:
 *
 *   1. Build local  — rollup output (`dist/`) is flattened by esbuild
 *                     into a clean `<pkg>/dist-realm/` stage.
 *   2. Mirror       — the workspace's `choreo.ts` is replaced with the
 *                     freshly staged file.
 *   3. Sync         — `boxel sync --prefer-local` pushes it to the realm.
 *
 * Usage (from packages/glimmer-motion, after `pnpm build`):
 *   node scripts/build-realm-bundle.mjs                  # build + mirror + sync
 *   node scripts/build-realm-bundle.mjs --no-sync        # build + mirror only
 *   node scripts/build-realm-bundle.mjs --no-mirror      # stage only
 *   node scripts/build-realm-bundle.mjs --workspace PATH # override target
 *   node scripts/build-realm-bundle.mjs --minify         # smaller artifact
 *
 * Config: .choreo-realm-sync.json (gitignored) at the monorepo root:
 *   {
 *     "workspace":   "/absolute/path/to/your/boxel/workspace",
 *     "boxelCliDir": "/absolute/path/to/boxel-cli"   // optional
 *   }
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '../..');

// Entry is the compiled addon, not src/: rollup + babel have already
// turned .gts template tags into precompileTemplate calls and stripped
// decorators, which esbuild alone could not do. dist/index.js is the
// full public surface and reaches nothing from test-support/.
const entry = join(pkgRoot, 'dist/index.js');

// Framework modules the Boxel host provides. Everything NOT matching
// these (motion-dom, motion-utils, decorator-transforms/runtime, …) is
// inlined into the bundle.
const EXTERNAL = [/^@ember\//, /^@glimmer\//, /^ember-modifier$/];

const argv = process.argv.slice(2);
const args = new Set(argv);
const minify = args.has('--minify');
const wsFlag = argv.indexOf('--workspace');
const workspace =
  wsFlag !== -1
    ? resolve(argv[wsFlag + 1])
    : args.has('--no-mirror')
      ? null // stage only; workspace not required
      : loadConfig().workspace;

if (!existsSync(entry)) {
  throw new Error(
    `Missing ${entry}. Run the addon build first: pnpm --filter glimmer-motion build`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// PHASE 1 — Build into a clean local staging directory.
// ─────────────────────────────────────────────────────────────────────

const stagingRoot = join(pkgRoot, 'dist-realm');
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
const outfile = join(stagingRoot, 'choreo.ts');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['import', 'module', 'default'],
  minify,
  keepNames: true,
  sourcemap: false,
  outfile,
  plugins: [
    {
      name: 'host-provided-externals',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (resolveArgs) => {
          if (EXTERNAL.some((rx) => rx.test(resolveArgs.path))) {
            return { path: resolveArgs.path, external: true };
          }
          return null;
        });
      },
    },
  ],
  banner: {
    js:
      `// glimmer-motion — realm bundle (ESM, single file)\n` +
      `// Built: ${new Date().toISOString()}\n` +
      `// Contains: glimmer-motion + motion-dom + motion-utils, inlined.\n` +
      `// External: @ember/*, @glimmer/*, ember-modifier (host-provided).\n` +
      `// Regenerate: pnpm realm (from the monorepo root)\n`,
  },
});

const code = readFileSync(outfile, 'utf8');

// The realm serves this file as TypeScript source, so it must survive
// the realm's own babel pass. Two things would break it silently later;
// fail loudly here instead:
//  1. an import we forgot to inline or externalize,
//  2. a require() left behind by a CJS-only dependency.
const foreignImports = [
  ...code.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm),
  ...code.matchAll(/^export[^'"]*from\s*['"]([^'"]+)['"]/gm),
]
  .map((m) => m[1])
  .filter(
    (spec) =>
      spec !== '@ember/template-compilation' &&
      !EXTERNAL.some((rx) => rx.test(spec)),
  );
if (foreignImports.length || /\brequire\(/.test(code)) {
  throw new Error(
    `Bundle is not realm-clean:\n` +
      (foreignImports.length
        ? `  unexpected imports: ${[...new Set(foreignImports)].join(', ')}\n`
        : '') +
      (/\brequire\(/.test(code) ? `  contains require() calls\n` : ''),
  );
}

console.log(
  `✓ staged ${outfile}  (${(code.length / 1024).toFixed(1)} KB, ` +
    `${minify ? 'minified' : 'readable'})`,
);

if (args.has('--no-mirror')) {
  console.log('(skipping mirror + sync — --no-mirror)');
} else {
  mirrorAndSync();
}

function mirrorAndSync() {
  // ─────────────────────────────────────────────────────────────────────
  // PHASE 2 — Mirror staged artifact to the workspace.
  // ─────────────────────────────────────────────────────────────────────

  if (!workspace) {
    throw new Error(
      'Missing workspace path. Pass --workspace <path> or configure ' +
        '.choreo-realm-sync.json. (Use --no-mirror to stop after staging.)',
    );
  }

  writeFileSync(join(workspace, 'choreo.ts'), code);
  console.log(`✓ mirrored → ${join(workspace, 'choreo.ts')}`);

  // ─────────────────────────────────────────────────────────────────────
  // PHASE 3 — Sync workspace to remote realm.
  // ─────────────────────────────────────────────────────────────────────

  if (args.has('--no-sync')) {
    console.log('(skipping sync — --no-sync)');
    return;
  }

  const boxelCliDir = loadConfigOrEmpty().boxelCliDir;
  let sync;
  if (boxelCliDir) {
    sync = spawnSync(
      'npm',
      ['run', 'dev', '--silent', '--', 'sync', workspace, '--prefer-local'],
      { cwd: boxelCliDir, stdio: 'inherit' },
    );
  } else {
    sync = spawnSync('boxel', ['sync', workspace, '--prefer-local'], {
      stdio: 'inherit',
    });
  }
  if (sync.status) {
    throw new Error(`boxel sync exited with status ${sync.status}`);
  }
}

function loadConfig() {
  const configPath = join(repoRoot, '.choreo-realm-sync.json');
  if (!existsSync(configPath)) {
    throw new Error(
      'Missing .choreo-realm-sync.json at the monorepo root. Create it with:\n\n' +
        '  {\n' +
        '    "workspace":   "/absolute/path/to/your/boxel/workspace",\n' +
        '    "boxelCliDir": "/absolute/path/to/boxel-cli"    // optional\n' +
        '  }\n\n' +
        'Or pass --workspace <path>. Use --no-mirror to stop after staging.',
    );
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function loadConfigOrEmpty() {
  const configPath = join(repoRoot, '.choreo-realm-sync.json');
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}
