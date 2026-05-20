/**
 * Populate `packages/boxel-cli/bundled-types/` from sibling monorepo
 * packages, so a published `@cardstack/boxel-cli` install can run glint
 * without the monorepo on disk (CS-11165).
 *
 * What lands in each subdirectory, and why:
 *
 * - `bundled-types/base/`        — auto-generated `.d.ts` for every
 *                                   module in `packages/base`. See
 *                                   `buildBaseDts()` below for the
 *                                   pipeline (content-tag preprocess →
 *                                   annotate static / get / template
 *                                   bindings as `any` → `tsc
 *                                   --declaration --emitDeclarationOnly`).
 *                                   Source `.d.ts` files in `base/types`
 *                                   are passed through as-is.
 * - `bundled-types/host-types/`  — `packages/host/types/*` ambient
 *                                   `.d.ts` files, referenced via the
 *                                   `'*': ['<host>/types/*']` fallback
 *                                   path in parse.ts's tsconfig.
 * - `bundled-types/host-app/`    — `packages/host/app/{commands,
 *                                   components, config, lib, services,
 *                                   utils}` source for `@cardstack/host/*`
 *                                   and `@cardstack/boxel-host/commands/*`
 *                                   paths. Subdirs that aren't transitively
 *                                   reached from `host/tests/helpers` are
 *                                   dropped. Source is shipped, not
 *                                   `.d.ts` — running the .gts→.d.ts
 *                                   pipeline on host/app would multiply
 *                                   the work and isn't needed for
 *                                   correctness.
 * - `bundled-types/host-tests/helpers/` — the host's `tests/helpers`
 *                                   only (not the unit/integration/
 *                                   acceptance suites). Used to back
 *                                   `@cardstack/host/tests/*` imports
 *                                   in agent `.test.gts` files.
 * - `bundled-types/boxel-ui/`    — `packages/boxel-ui/addon/src/*`
 *                                   minus `styles/` (1.5MB of fonts +
 *                                   CSS irrelevant to type-checking).
 * - `bundled-types/local-types/` — `packages/local-types/*.d.ts`
 *                                   ambient declarations. Fed via
 *                                   `include` in parse.ts's tsconfig
 *                                   (it's a workspace-only package, so
 *                                   it can't be a normal runtime dep).
 *
 * This script runs from the monorepo only. The resulting tree is
 * committed-via-publish (`files` in package.json includes
 * `bundled-types/`).
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { Preprocessor } from 'content-tag';
import * as ts from 'typescript';

const PACKAGE_ROOT = resolve(__dirname, '..');
const MONOREPO_PACKAGES = resolve(PACKAGE_ROOT, '..');

// ---------------------------------------------------------------------------
// `base/` — .d.ts pipeline
// ---------------------------------------------------------------------------

/**
 * Generate `.d.ts` files for every module in `packages/base/` and copy
 * them into the destination. Pipeline:
 *
 *   .gts → content-tag preprocess → .ts
 *        → regex annotation (`static x = expr` → `static x: any = expr`,
 *          `get x()` → `get x(): any`, `const Foo = template_xxx(...)`
 *          → `const Foo: any = template_xxx(...)`)
 *        → tsc --declaration --emitDeclarationOnly (extends host's
 *          tsconfig.json so all the right path mappings + types apply)
 *        → resulting .d.ts copied to dest
 *
 * The annotation step exists because TypeScript refuses to emit `.d.ts`
 * for declarations whose inferred type would need to reference private
 * glint internals (`Context`, `Invoke`, `fields` from
 * `@glint/template/-private/integration` and
 * `@glint/ember-tsc/types/-private/dsl/integration-declarations`).
 * Annotating with `: any` cuts the inference and lets TS emit the
 * `.d.ts`. Agent code never reaches into those types — it uses base's
 * `@field` decorators (which preserve types) and writes its own
 * templates (whose types are checked by glint against base's class
 * shapes, not against base's static / getter return types).
 */
function buildBaseDts(baseSrc: string, baseDst: string): void {
  let tmpDir = mkdtempSync(join(tmpdir(), 'boxel-cli-base-dts-'));
  try {
    let preprocessor = new Preprocessor();

    // Copy + transform every file under baseSrc into tmpDir
    let walked: string[] = [];
    let walk = (dir: string): void => {
      for (let entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        let full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          walked.push(full);
        }
      }
    };
    walk(baseSrc);

    let preexistingDts: string[] = [];
    for (let file of walked) {
      let rel = relative(baseSrc, file);
      let dst = join(tmpDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      if (file.endsWith('.gts')) {
        let src = readFileSync(file, 'utf8');
        let { code } = preprocessor.process(src, {
          filename: file.split('/').pop(),
        });
        writeFileSync(
          dst.replace(/\.gts$/, '.ts'),
          annotateInferredTypes(code),
          'utf8',
        );
      } else if (file.endsWith('.d.ts')) {
        // Pass-through; we'll copy these directly to baseDst at the end
        // (tsc doesn't re-emit existing .d.ts files).
        preexistingDts.push(rel);
        writeFileSync(dst, readFileSync(file, 'utf8'), 'utf8');
      } else if (file.endsWith('.ts')) {
        let src = readFileSync(file, 'utf8');
        writeFileSync(dst, annotateInferredTypes(src), 'utf8');
      }
      // Skip everything else (.json sample instances, etc.) — they
      // contribute nothing to type-checking.
    }

    // Link host's node_modules so glint/typescript can resolve
    // everything host/base imports.
    let nodeModulesLink = join(tmpDir, 'node_modules');
    if (!existsSync(nodeModulesLink)) {
      execFileSync(
        'ln',
        [
          '-sf',
          join(MONOREPO_PACKAGES, 'host', 'node_modules'),
          'node_modules',
        ],
        { cwd: tmpDir },
      );
    }

    // Derived tsconfig that extends host's (path mappings,
    // experimentalDecorators, strict, etc.) and overrides for emit.
    let tsconfig = {
      extends: join(MONOREPO_PACKAGES, 'host', 'tsconfig.json'),
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: join(tmpDir, '.dts-out'),
        inlineSourceMap: false,
        inlineSources: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
        rootDir: tmpDir,
        paths: {
          '@cardstack/host/tests/*': [
            join(MONOREPO_PACKAGES, 'host', 'tests') + '/*',
          ],
          '@cardstack/host/*': [join(MONOREPO_PACKAGES, 'host', 'app') + '/*'],
          '@cardstack/boxel-host/commands/*': [
            join(MONOREPO_PACKAGES, 'host', 'app', 'commands') + '/*',
          ],
          'https://cardstack.com/base/*': ['./*'],
          '@cardstack/catalog/*': [
            join(MONOREPO_PACKAGES, 'catalog-realm') + '/*',
          ],
          '@cardstack/openrouter/*': [
            join(MONOREPO_PACKAGES, 'openrouter-realm') + '/*',
          ],
          '*': [join(MONOREPO_PACKAGES, 'host', 'types') + '/*'],
        },
      },
      include: ['**/*.ts'],
    };
    let tsconfigPath = join(tmpDir, 'tsconfig.json');
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');

    // Use the TypeScript programmatic API with a writeFile that ONLY
    // accepts paths under `outDir`. This is the defense against the
    // previous bug where `tsc --declaration` emitted `.d.ts` next to
    // the original source files for any module outside `rootDir`
    // (e.g. transitively imported host/app files), polluting
    // `packages/host/` with leaked declaration files.
    let outDir = join(tmpDir, '.dts-out');
    runTscEmitOnly(tsconfigPath, outDir);

    // Copy resulting .d.ts files into the destination.
    rmSync(baseDst, { recursive: true, force: true });
    mkdirSync(baseDst, { recursive: true });
    if (existsSync(outDir)) {
      cpSync(outDir, baseDst, { recursive: true });
    }

    // Add the pre-existing `.d.ts` files we passed through (tsc doesn't
    // emit anything for files that already had `.d.ts` extension).
    for (let rel of preexistingDts) {
      let from = join(tmpDir, rel);
      let to = join(baseDst, rel);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Compile via the TS programmatic API, dropping any emit that lands
 * outside `outDir`. This is the critical sandbox: when TS chases a
 * transitive import from a source file in `rootDir` into a file
 * outside `rootDir` (e.g. host/app/* via the path mappings), its
 * default behavior writes the resulting `.d.ts` at the source's
 * absolute location — which pollutes the monorepo's other packages.
 * The custom `writeFile` makes the host immune to that.
 */
function runTscEmitOnly(tsconfigPath: string, outDir: string): void {
  let parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(tsconfigPath, ts.sys.readFile).config,
    ts.sys,
    dirname(tsconfigPath),
    {},
    tsconfigPath,
  );
  let host = ts.createCompilerHost(parsed.options);
  let originalWriteFile = host.writeFile.bind(host);
  let normalizedOut = ts.sys.resolvePath(outDir);
  host.writeFile = (
    fileName,
    contents,
    writeByteOrderMark,
    onError,
    sources,
  ) => {
    let normalized = ts.sys.resolvePath(fileName);
    if (!normalized.startsWith(normalizedOut)) {
      // Drop. Without this, TS would write to the source-file's
      // original location for any compiled file outside rootDir.
      return;
    }
    originalWriteFile(fileName, contents, writeByteOrderMark, onError, sources);
  };
  let program = ts.createProgram(parsed.fileNames, parsed.options, host);
  // We intentionally don't check `emit.emitSkipped` or surface
  // diagnostics — `--declaration` continues emitting valid `.d.ts`
  // for files that pass even when other files in the program fail.
  // Errors are expected (TS6059, TS2307 from imports that reach
  // outside rootDir).
  program.emit();
}

/**
 * Add `: any` annotations to declarations whose inferred type would
 * otherwise reference private glint / glimmer-template internals,
 * blocking `.d.ts` emission. Loses the precise type in base's
 * `.d.ts` for these declarations, but agent code never reaches them.
 */
function annotateInferredTypes(code: string): string {
  return code
    .replace(
      /^(\s*)(static\s+([A-Za-z_$][A-Za-z0-9_$]*))(\s*=\s*)/gm,
      (m, lead, decl, _name, eq) =>
        m.includes(':') ? m : `${lead}${decl}: any${eq}`,
    )
    .replace(
      /^(\s*(?:public|private|protected)?\s*get\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(\s*\))(\s*\{)/gm,
      '$1: any$2',
    )
    .replace(
      /\b((?:export\s+)?const\s+[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(template_[a-f0-9]+\()/g,
      '$1: any = $2',
    );
}

// ---------------------------------------------------------------------------
// Simple-copy vendors (everything except `base/`)
// ---------------------------------------------------------------------------

interface Vendor {
  name: string;
  from: string;
  to: string;
  filter?: (src: string) => boolean;
}

const VENDORS: Vendor[] = [
  {
    name: 'host-types',
    from: join(MONOREPO_PACKAGES, 'host', 'types'),
    to: join(PACKAGE_ROOT, 'bundled-types', 'host-types'),
    filter: skipMonorepoArtifacts,
  },
  {
    // Only the host-app subdirs that `host/tests/helpers/*` reaches
    // (transitively). Other host/app subdirs (resources, routes,
    // templates, modifiers, helpers, instance-initializers,
    // controllers, styles, models) are never imported by the agent's
    // `.gts` / `.test.gts` and add ~0.5MB.
    name: 'host-app',
    from: join(MONOREPO_PACKAGES, 'host', 'app'),
    to: join(PACKAGE_ROOT, 'bundled-types', 'host-app'),
    filter: hostAppFilter,
  },
  {
    // Just `helpers/` — the agent's `.test.gts` imports
    // `@cardstack/host/tests/helpers` and `…/helpers/render-component`,
    // never the unit/integration/acceptance test suites.
    name: 'host-tests',
    from: join(MONOREPO_PACKAGES, 'host', 'tests', 'helpers'),
    to: join(PACKAGE_ROOT, 'bundled-types', 'host-tests', 'helpers'),
    filter: skipMonorepoArtifacts,
  },
  {
    // Drop `addon/src/styles/` (1.5MB of `.woff2` + CSS).
    name: 'boxel-ui',
    from: join(MONOREPO_PACKAGES, 'boxel-ui', 'addon', 'src'),
    to: join(PACKAGE_ROOT, 'bundled-types', 'boxel-ui'),
    filter: boxelUiFilter,
  },
  {
    // `@cardstack/local-types` is workspace-only; published boxel-cli
    // can't depend on it, so vendor and feed via `include` in
    // parse.ts's tsconfig.
    name: 'local-types',
    from: join(MONOREPO_PACKAGES, 'local-types'),
    to: join(PACKAGE_ROOT, 'bundled-types', 'local-types'),
    filter: skipMonorepoArtifacts,
  },
];

function skipMonorepoArtifacts(src: string): boolean {
  let basename = src.split('/').pop() ?? '';
  if (basename === 'node_modules') return false;
  if (basename === 'dist') return false;
  if (basename === 'tmp') return false;
  if (basename.startsWith('.cache')) return false;
  return true;
}

const HOST_APP_REACHABLE_SUBDIRS = new Set([
  'commands',
  'components',
  'config',
  'lib',
  'services',
  'utils',
]);

function hostAppFilter(src: string): boolean {
  if (!skipMonorepoArtifacts(src)) return false;
  let hostAppRoot = join(MONOREPO_PACKAGES, 'host', 'app');
  let rel = src.slice(hostAppRoot.length + 1);
  if (rel === '') return true;
  let first = rel.split('/')[0];
  if (first.includes('.')) return true;
  return HOST_APP_REACHABLE_SUBDIRS.has(first);
}

function boxelUiFilter(src: string): boolean {
  if (!skipMonorepoArtifacts(src)) return false;
  let uiRoot = join(MONOREPO_PACKAGES, 'boxel-ui', 'addon', 'src');
  let rel = src.slice(uiRoot.length + 1);
  if (rel === '') return true;
  if (rel.startsWith('styles/') || rel === 'styles') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function dirSize(dir: string): number {
  let total = 0;
  let walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (let entry of entries) {
      let full = join(current, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else {
        total += st.size;
      }
    }
  };
  walk(dir);
  return total;
}

function writeShims(outRoot: string): number {
  let shimsDir = join(outRoot, 'shims');
  mkdirSync(shimsDir, { recursive: true });

  // `@cardstack/boxel-icons/*` is a 130MB icons package whose
  // declarations (alone 50MB) would dominate the bundle if shipped
  // verbatim. The agent imports specific icons (e.g.
  // `@cardstack/boxel-icons/sticky-note`) for their SVG component
  // type only — `any` is fine for type-checking the agent's own
  // code.
  let shim = `// Auto-generated by scripts/build-types.ts (CS-11165).
// Ambient module declarations for paths the agent imports but we
// don't ship full types for. Type-as-any is sufficient — the
// agent's own .gts/.test.gts code doesn't depend on these types'
// internal structure, only on the fact that the import resolves.

declare module '@cardstack/boxel-icons/*' {
  const value: any;
  export default value;
}
`;
  writeFileSync(join(shimsDir, 'boxel-cli-shims.d.ts'), shim, 'utf8');
  return statSync(join(shimsDir, 'boxel-cli-shims.d.ts')).size;
}

function main(): void {
  console.log('Building bundled-types for boxel-cli (CS-11165)...');

  let outRoot = join(PACKAGE_ROOT, 'bundled-types');
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });

  let shimSize = writeShims(outRoot);
  console.log(
    `  shims       ${(shimSize / 1024 / 1024).toFixed(2)} MB (ambient module decls for unshipped paths)`,
  );

  let total = 0;

  // `base/` runs through the .d.ts pipeline (slowest step — ~30s).
  let baseSrc = join(MONOREPO_PACKAGES, 'base');
  let baseDst = join(outRoot, 'base');
  if (!safeIsDirectory(baseSrc)) {
    console.error(`Missing packages/base at ${baseSrc}`);
    process.exit(1);
  }
  process.stdout.write('  base       … (running tsc --declaration) ');
  buildBaseDts(baseSrc, baseDst);
  let baseSize = dirSize(baseDst);
  total += baseSize;
  console.log(`${(baseSize / 1024 / 1024).toFixed(2)} MB`);

  // Other vendors are simple copies with filters.
  for (let vendor of VENDORS) {
    if (!safeIsDirectory(vendor.from)) {
      console.error(
        `Missing source for vendor "${vendor.name}": ${vendor.from}`,
      );
      process.exit(1);
    }
    mkdirSync(vendor.to, { recursive: true });
    cpSync(vendor.from, vendor.to, {
      recursive: true,
      filter: vendor.filter ? (src: string) => vendor.filter!(src) : undefined,
    });
    let size = dirSize(vendor.to);
    total += size;
    console.log(
      `  ${vendor.name.padEnd(11)} ${(size / 1024 / 1024).toFixed(2)} MB`,
    );
  }
  console.log(`Total bundled-types: ${(total / 1024 / 1024).toFixed(2)} MB`);
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

main();
