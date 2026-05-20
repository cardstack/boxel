import { build } from 'esbuild';
import { mkdirSync, chmodSync } from 'fs';
import { builtinModules } from 'module';

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
    // keeps them as runtime requires; they're picked up from node_modules
    // when `boxel test` actually runs. Monorepo-only by consequence —
    // matches `boxel test`'s existing monorepo-only constraint.
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

buildCLI();
