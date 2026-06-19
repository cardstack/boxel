import { build } from 'esbuild';
import { mkdirSync, chmodSync, copyFileSync } from 'fs';
import { builtinModules } from 'module';
import { join } from 'path';

// Node.js built-in modules (bare and node:-prefixed) that should remain external
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

const commonConfig = {
  bundle: true,
  platform: 'node' as const,
  target: 'node18',
  format: 'cjs' as const,
  external: [
    ...nodeBuiltins,
    // Playwright (drives `boxel test`) and its native-module transitive
    // deps (fsevents on macOS, etc.) can't be bundled by esbuild — they
    // contain `.node` files and runtime `require.resolve` calls. boxel-cli
    // keeps them as runtime `require`s and ships `@playwright/test` as a
    // runtime dependency, so node resolves them from node_modules when
    // `boxel test` runs on a published install.
    '@playwright/test',
    'playwright',
    'playwright-core',
    'fsevents',
  ],
  sourcemap: false,
  minify: true,
  metafile: true,
  logLevel: 'info' as const,
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  mainFields: ['module', 'main'],
  conditions: ['import', 'require'],
};

async function buildCLI() {
  mkdirSync('dist', { recursive: true });

  console.log('Building CLI executables...');

  try {
    // Build CLI entry point
    console.log('Building boxel...');
    const cliResult = await build({
      ...commonConfig,
      entryPoints: ['src/index.ts'],
      outfile: 'dist/index.js',
      banner: {
        js: '#!/usr/bin/env node',
      },
    });

    // Make CLI file executable
    console.log('Making CLI file executable...');
    chmodSync('dist/index.js', 0o755);

    console.log('Build complete!');

    // Log bundle size
    if (cliResult.metafile) {
      const outputs = Object.values(cliResult.metafile.outputs);
      const totalSize = outputs.reduce((sum, output) => sum + output.bytes, 0);
      console.log(`\nBundle size: ${(totalSize / 1024).toFixed(1)} KB`);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// The public `@cardstack/boxel-cli/api` surface, bundled to a single CJS file
// so cross-package consumers (software-factory) load a normal built module
// rather than raw `.ts` source — the latter resolves under some loaders
// (vitest, plain node) but not others (Playwright's worker loader), which
// failed with "does not provide an export named 'BoxelCLIClient'". esbuild's
// CJS output keeps named exports detectable by Node's cjs-module-lexer, so ESM
// consumers can still `import { BoxelCLIClient }`.
async function buildAPI() {
  mkdirSync('dist', { recursive: true });
  console.log('Building api...');
  try {
    await build({
      ...commonConfig,
      entryPoints: ['api.ts'],
      outfile: 'dist/api.js',
    });
    console.log('Built dist/api.js');
  } catch (error) {
    console.error('API build failed:', error);
    process.exit(1);
  }
}

// content-tag (pulled in via runtime-common's transpile pipeline) loads its
// wasm with `readFileSync(`${import.meta.dirname}/content_tag_bg.wasm`)` from
// `pkg/node/`. After esbuild bundles content-tag into `dist/index.js` or
// `dist/api.js`, `import.meta.dirname` becomes the boxel-cli `dist/` dir, so
// the wasm has to live next to whichever entry was built — otherwise the first
// transpile hits ENOENT. Both `build` and `build:api` consumers need it.
function copyContentTagWasm() {
  let wasmSrc = join(
    import.meta.dirname,
    '..',
    'node_modules',
    'content-tag',
    'pkg',
    'node',
    'content_tag_bg.wasm',
  );
  copyFileSync(wasmSrc, 'dist/content_tag_bg.wasm');
  console.log('Copied content_tag_bg.wasm into dist/');
}

async function main() {
  // `build:api` passes --api-only to rebuild just the API surface quickly
  // (consumers' test pipelines do this); a full `build` produces both.
  if (!process.argv.includes('--api-only')) {
    await buildCLI();
  }
  await buildAPI();
  copyContentTagWasm();
}

main();
