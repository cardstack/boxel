/**
 * Build glimmer-motion and @cardstack/choreo as one hashed realm module and
 * publish it with boxel-cli. The module exports both packages' roots, plus
 * `Film`, so cards import the motion layer and Choreo from the same place.
 * Pattern taken from @cardstack/bxl's realm bundle, plus a content-hash so a
 * bad build is one import change from rolling back.
 *
 * Layout in the target realm:
 *
 *   choreo.ts                      ← one-line re-export (the import cards use)
 *   builds/choreo-<hash>.ts        ← immutable artifact; never overwritten
 *
 * Cards always import from '../choreo'. Switching versions is changing
 * that one re-export. Old hashes stay on the realm until you delete them.
 *
 * What stays external — host-provided at load time:
 *   @ember/*, @glimmer/*, ember-modifier
 * Output is `.ts` so the realm babel-compiles `precompileTemplate`.
 *
 * Usage (from packages/glimmer-motion, after `pnpm build` here and in
 * packages/choreo):
 *   node scripts/build-realm-bundle.mjs                  # build + mirror + push
 *   node scripts/build-realm-bundle.mjs --no-sync        # build + mirror only
 *   node scripts/build-realm-bundle.mjs --no-mirror      # stage only
 *   node scripts/build-realm-bundle.mjs --workspace PATH
 *   node scripts/build-realm-bundle.mjs --minify
 *
 * Config: .choreo-realm-sync.json (gitignored) at the monorepo root:
 *   {
 *     "workspace": "/absolute/path/to/a/boxel/workspace",
 *     "realmUrl":  "https://example.com/my-realm/"
 *   }
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const choreoRoot = resolve(pkgRoot, '../choreo');
const entries = [
  join(pkgRoot, 'dist/index.js'),
  join(choreoRoot, 'dist/index.js'),
];
const filmEntry = join(choreoRoot, 'dist/film.js');
const EXTERNAL = [/^@ember\//, /^@glimmer\//, /^ember-modifier$/];

const argv = process.argv.slice(2);
const args = new Set(argv);
const minify = args.has('--minify');
const wsFlag = argv.indexOf('--workspace');
const workspace =
  wsFlag !== -1
    ? resolve(argv[wsFlag + 1])
    : args.has('--no-mirror')
      ? null
      : loadConfig().workspace;

for (const entry of [...entries, filmEntry]) {
  if (!existsSync(entry)) {
    throw new Error(
      `Missing ${entry}. Run the addon builds first: pnpm --filter glimmer-motion build && pnpm --filter @cardstack/choreo build`,
    );
  }
}

const stagingRoot = join(pkgRoot, 'dist-realm');
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
const stagedPlain = join(stagingRoot, 'choreo.ts');

await esbuild.build({
  stdin: {
    contents: [
      ...entries.map((entry) => `export * from ${JSON.stringify(entry)};`),
      `export { Film } from ${JSON.stringify(filmEntry)};`,
    ].join('\n'),
    resolveDir: pkgRoot,
    sourcefile: 'realm-entry.js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['import', 'module', 'default'],
  // choreo's tsconfig.json resolves glimmer-motion to its source for
  // type-checking. The realm bundles the built output, so skip it, and leave
  // the `developing:choreo` condition out of `conditions`.
  tsconfigRaw: {},
  // Syntax minification rewrites `strictMode: true` to `!0` inside the
  // precompileTemplate options, which the realm's template-compilation
  // plugin rejects ("can only accept static options"). Whitespace and
  // identifier minification carry almost all of the size win.
  minifyWhitespace: minify,
  minifyIdentifiers: minify,
  minifySyntax: false,
  // keepNames wraps `scope: () => ({…})` as `__name(() => ({…}), "scope")`,
  // which the realm's precompileTemplate plugin rejects.
  keepNames: false,
  sourcemap: false,
  outfile: stagedPlain,
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
      `/* eslint-disable */\n` +
      `// glimmer-motion + @cardstack/choreo — realm bundle (ESM, single file)\n` +
      `// Contains: glimmer-motion + @cardstack/choreo + framer-motion/dom + motion-dom + motion-utils, inlined.\n` +
      `// External: @ember/*, @glimmer/*, ember-modifier (host-provided).\n` +
      `// Regenerate: pnpm realm (from the monorepo root)\n`,
  },
});

const code = readFileSync(stagedPlain, 'utf8');
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

const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
const artifactName = `choreo-${hash}.ts`;
const artifactRel = `builds/${artifactName}`;
const stagingBuildsDir = join(stagingRoot, 'builds');
mkdirSync(stagingBuildsDir, { recursive: true });
writeFileSync(join(stagingBuildsDir, artifactName), code);
writeFileSync(join(stagingRoot, 'choreo.ts'), shimSource(hash));

console.log(
  `✓ staged ${artifactRel}  (${(code.length / 1024).toFixed(1)} KB, ` +
    `hash ${hash}, ${minify ? 'minified' : 'readable'})`,
);

if (args.has('--no-mirror')) {
  console.log('(skipping mirror + push — --no-mirror)');
} else {
  mirrorAndPush(hash, code);
}

function shimSource(contentHash) {
  return (
    `/* eslint-disable */\n` +
    `// Choreo realm entry. Cards import from this file — never from a hashed build.\n` +
    `// To roll back, point the export at an older builds/choreo-<hash>.ts.\n` +
    `export * from './builds/choreo-${contentHash}';\n`
  );
}

function mirrorAndPush(contentHash, bundle) {
  if (!workspace) {
    throw new Error(
      'Missing workspace path. Pass --workspace <path> or configure ' +
        '.choreo-realm-sync.json. (Use --no-mirror to stop after staging.)',
    );
  }

  const config = loadConfigOrEmpty();
  const buildsDir = join(workspace, 'builds');
  mkdirSync(buildsDir, { recursive: true });

  const artifactPath = join(buildsDir, `choreo-${contentHash}.ts`);
  const shimPath = join(workspace, 'choreo.ts');
  const artifactExisted = existsSync(artifactPath);
  writeFileSync(artifactPath, bundle);
  writeFileSync(shimPath, shimSource(contentHash));
  console.log(
    artifactExisted
      ? `✓ hash ${contentHash} already in workspace (shim refreshed)`
      : `✓ mirrored → ${artifactPath}`,
  );
  console.log(`✓ shim     → ${shimPath}`);

  if (args.has('--no-sync')) {
    console.log('(skipping push — --no-sync)');
    return;
  }

  const realmUrl = resolveRealmUrl(config, workspace);
  console.log(`  realm    → ${realmUrl}`);
  const boxel = boxelBin(config);
  const uploads = [
    [artifactRel, artifactPath],
    ['choreo.ts', shimPath],
  ];
  for (const [rel, abs] of uploads) {
    console.log(`→ boxel file write ${rel}`);
    const result = spawnSync(
      boxel.command,
      [
        ...boxel.prefix,
        'file',
        'write',
        rel,
        '--realm',
        realmUrl,
        '--file',
        abs,
      ],
      { stdio: 'inherit' },
    );
    if (result.error) {
      throw new Error(
        `Failed to run ${boxel.command}: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `boxel file write ${rel} exited with status ${result.status ?? 'unknown'}`,
      );
    }
  }
  console.log(`✓ published hash ${contentHash} to ${realmUrl}`);
}

function resolveRealmUrl(config, workspaceDir) {
  if (typeof config.realmUrl === 'string' && config.realmUrl) {
    return config.realmUrl;
  }
  const syncPath = join(workspaceDir, '.boxel-sync.json');
  if (existsSync(syncPath)) {
    const sync = JSON.parse(readFileSync(syncPath, 'utf8'));
    if (typeof sync.realmUrl === 'string' && sync.realmUrl) {
      return sync.realmUrl;
    }
  }
  throw new Error(
    'Missing realmUrl. Set it in .choreo-realm-sync.json or keep a ' +
      '.boxel-sync.json in the workspace.',
  );
}

function boxelBin(config) {
  if (typeof config.boxelCliDir === 'string' && config.boxelCliDir) {
    return {
      command: 'npx',
      prefix: ['--yes', '--prefix', config.boxelCliDir, 'boxel'],
    };
  }
  return { command: 'boxel', prefix: [] };
}

function loadConfig() {
  const configPath = join(repoRoot, '.choreo-realm-sync.json');
  if (!existsSync(configPath)) {
    throw new Error(
      'Missing .choreo-realm-sync.json at the monorepo root. Create it with:\n\n' +
        '  {\n' +
        '    "workspace": "/absolute/path/to/a/boxel/workspace",\n' +
        '    "realmUrl":  "https://example.com/my-realm/"\n' +
        '  }\n',
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
