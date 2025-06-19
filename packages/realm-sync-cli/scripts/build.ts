import { build } from 'esbuild';
import { readFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

// Node.js built-in modules that should remain external
const nodeBuiltins = [
  'fs',
  'path',
  'url',
  'crypto',
  'os',
  'stream',
  'util',
  'events',
  'buffer',
  'string_decoder',
  'querystring',
  'http',
  'https',
  'net',
  'tls',
  'zlib',
  'worker_threads',
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'domain',
  'readline',
  'repl',
  'tty',
  'v8',
  'vm',
  'assert',
  'constants',
  'module',
  'perf_hooks',
  'process',
  'punycode',
  'timers',
  'trace_events',
];

const commonConfig = {
  bundle: true,
  platform: 'node' as const,
  target: 'node18',
  format: 'cjs' as const,
  external: nodeBuiltins,
  sourcemap: false, // Disable source maps for production
  minify: true, // Enable minification to reduce size
  metafile: true, // For bundle analysis
  logLevel: 'info' as const,
  treeShaking: true, // Enable tree shaking
  define: {
    // Ensure NODE_ENV is defined
    'process.env.NODE_ENV': '"production"',
  },
  // More aggressive bundling optimizations
  mainFields: ['module', 'main'],
  conditions: ['import', 'require'],
};

async function buildCLI() {
  // Ensure dist directory exists
  mkdirSync('dist', { recursive: true });

  console.log('Building CLI executables...');

  try {
    // Build push command
    console.log('Building realm-push...');
    const pushResult = await build({
      ...commonConfig,
      entryPoints: ['src/push.ts'],
      outfile: 'dist/push.js',
      banner: {
        js: '#!/usr/bin/env node',
      },
    });

    // Build pull command
    console.log('Building realm-pull...');
    const pullResult = await build({
      ...commonConfig,
      entryPoints: ['src/pull.ts'],
      outfile: 'dist/pull.js',
      banner: {
        js: '#!/usr/bin/env node',
      },
    });

    // Build library entry point (for programmatic use)
    console.log('Building library...');
    const libResult = await build({
      ...commonConfig,
      entryPoints: ['src/index.ts'],
      outfile: 'dist/index.js',
    });

    // Make CLI files executable
    console.log('Making CLI files executable...');
    chmodSync('dist/push.js', 0o755);
    chmodSync('dist/pull.js', 0o755);

    console.log('✅ Build complete!');

    // Log bundle sizes
    const bundleInfo = [
      { name: 'realm-push', result: pushResult },
      { name: 'realm-pull', result: pullResult },
      { name: 'library', result: libResult },
    ];

    console.log('\n📦 Bundle sizes:');
    for (const { name, result } of bundleInfo) {
      if (result.metafile) {
        const outputs = Object.values(result.metafile.outputs);
        const totalSize = outputs.reduce(
          (sum, output) => sum + output.bytes,
          0,
        );
        console.log(`  ${name}: ${(totalSize / 1024).toFixed(1)} KB`);
      }
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

buildCLI();
