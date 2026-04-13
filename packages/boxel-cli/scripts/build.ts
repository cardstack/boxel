import { build } from 'esbuild';
import { mkdirSync, chmodSync } from 'fs';
import { builtinModules } from 'module';
import { execSync } from 'child_process';

// Node.js built-in modules (bare and node:-prefixed) that should remain external
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

const commonConfig = {
  bundle: true,
  platform: 'node' as const,
  target: 'node18',
  format: 'cjs' as const,
  external: nodeBuiltins,
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
    // Build CLI entry point (bundled, with shebang)
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

    // Build library entry point (deps left external for consumers to resolve)
    console.log('Building library...');
    const libResult = await build({
      ...commonConfig,
      entryPoints: ['src/api.ts'],
      outfile: 'dist/api.js',
      packages: 'external',
    });

    // Emit type declarations alongside the library entry
    console.log('Emitting type declarations...');
    execSync('tsc -p tsconfig.build.json', { stdio: 'inherit' });

    console.log('Build complete!');

    for (const [label, result] of [
      ['CLI', cliResult],
      ['Library', libResult],
    ] as const) {
      if (result.metafile) {
        const outputs = Object.values(result.metafile.outputs);
        const totalSize = outputs.reduce((sum, o) => sum + o.bytes, 0);
        console.log(
          `${label} bundle size: ${(totalSize / 1024).toFixed(1)} KB`,
        );
      }
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildCLI();
