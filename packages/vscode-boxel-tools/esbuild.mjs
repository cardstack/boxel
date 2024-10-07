import { context } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const sharedConfig = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    external: ['vscode'],
    logLevel: 'silent',
  };

  const nodeCtx = await context({
    ...sharedConfig,
    format: 'cjs',
    platform: 'node',
    outfile: 'dist/extension.js',
    plugins: [esbuildProblemMatcherPlugin],
  });

  const browserCtx = await context({
    ...sharedConfig,
    format: 'cjs',
    platform: 'browser',
    outfile: 'dist/browser.js',
    plugins: [polyfillNode({}), esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await Promise.all([nodeCtx.watch(), browserCtx.watch()]);
  } else {
    await Promise.all([nodeCtx.rebuild(), browserCtx.rebuild()]);
    await Promise.all([nodeCtx.dispose(), browserCtx.dispose()]);
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log(`[watch] build started for ${build.initialOptions.outfile}`);
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log(`[watch] build finished for ${build.initialOptions.outfile}`);
    });
  },
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
