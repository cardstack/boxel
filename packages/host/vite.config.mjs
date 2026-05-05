import { defineConfig } from 'vite';
import {
  extensions as _extensions,
  classicEmberSupport,
  ember,
} from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { scopedCSS } from 'glimmer-scoped-css/rollup';

const require = createRequire(import.meta.url);

// TODO: working around possible upstream problem. The app blueprint uses this
// for guiding babel, but it includes '.json' which doesn't work in babel.
const extensions = _extensions.filter((e) => e !== '.json');

// Workaround for embroider-build/embroider#2703: the embroider resolver that
// @embroider/vite pushes into optimizeDeps.rolldownOptions.plugins does not
// do extension resolution for relative requires, so postcss's
// `require('./terminal-highlight')` fails to load during dep optimization.
// This plugin runs first and adds the `.js` extension for that specific case.
const postcssTerminalHighlightResolver = {
  name: 'postcss-terminal-highlight-resolver',
  resolveId(id, importer) {
    if (
      id === './terminal-highlight' &&
      importer &&
      importer.includes('/postcss/lib/')
    ) {
      return importer.replace(/[^/]+$/, 'terminal-highlight.js');
    }
    return null;
  },
};

// resolve.alias does not apply during optimizeDeps pre-bundling, so we
// stub out Node built-ins here too. recast eagerly requires 'fs' (for a
// CLI helper we never call) and ast-types-browser's package.json has a
// "browser" field for fs that Rolldown doesn't honor. postcss requires
// 'url' for optional fileURLToPath/pathToFileURL helpers and guards
// their usage with truthy checks, so an empty module is safe.
const emptyFsPath = require.resolve('./lib/empty-fs.js');
const nodeBuiltinStubResolver = {
  name: 'node-builtin-stub-resolver',
  resolveId(id) {
    if (
      id === 'fs' ||
      id === 'node:fs' ||
      id === 'url' ||
      id === 'node:url'
    ) {
      return emptyFsPath;
    }
    return null;
  },
};

// pnpm keeps source-map-js nested under postcss's own node_modules, so
// bare `require('source-map-js')` from postcss can't resolve from the
// host package root during optimizeDeps pre-bundling. Point rolldown at
// the actual install so it inlines the module instead of emitting a
// runtime __require that throws in the browser.
const sourceMapJsPath = require.resolve('source-map-js', {
  paths: [require.resolve('postcss/package.json')],
});
const sourceMapJsResolver = {
  name: 'source-map-js-resolver',
  resolveId(id) {
    if (id === 'source-map-js') {
      return sourceMapJsPath;
    }
    return null;
  },
};

const optimizedDepRE = /[/\\]node_modules[/\\]\.vite[/\\]deps[/\\].+\.js$/;
const optimizedDepUrlRE = /^\/node_modules\/\.vite\/deps\/.+\.js$/;

// Per-process cache so we touch each map file at most once per dev server.
const paddedMapPaths = new Set();

async function padOptimizedDepSourcemap(file) {
  if (!optimizedDepRE.test(file)) {
    return;
  }

  let mapPath = `${file}.map`;
  if (paddedMapPaths.has(mapPath)) {
    return;
  }
  paddedMapPaths.add(mapPath);

  let map;
  try {
    map = JSON.parse(await readFile(mapPath, 'utf8'));
  } catch {
    return;
  }

  if (!Array.isArray(map.sources) || map.sources.length === 0) {
    return;
  }

  let mapDir = path.dirname(mapPath);
  let sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
  let sourcesContent = Array.isArray(map.sourcesContent)
    ? [...map.sourcesContent]
    : [];
  let changed = false;
  for (let i = 0; i < map.sources.length; i++) {
    if (sourcesContent[i] != null) {
      continue;
    }
    // Vite refuses to hydrate sourcesContent from paths that escape the
    // optimized-dep package boundary, which is why these slots come back
    // null. We can read the file ourselves to preserve DevTools source
    // viewing for vendor code; if the read fails, fall back to an empty
    // string so the slot is at least populated and the warning stays quiet.
    let srcPath = map.sources[i];
    let resolved =
      typeof srcPath === 'string'
        ? path.resolve(mapDir, sourceRoot, srcPath)
        : null;
    let content = '';
    if (resolved) {
      try {
        content = await readFile(resolved, 'utf8');
      } catch {
        content = '';
      }
    }
    sourcesContent[i] = content;
    changed = true;
  }

  if (!changed) {
    return;
  }

  map.sourcesContent = sourcesContent;
  await writeFile(mapPath, JSON.stringify(map));
}

function quietOptimizedDepSourcemapWarnings() {
  return {
    name: 'boxel-quiet-optimized-dep-sourcemap-warnings',
    apply: 'serve',
    configureServer(server) {
      let depsDir = path.resolve(server.config.root, 'node_modules/.vite/deps');
      server.middlewares.use(async (req, _res, next) => {
        try {
          let pathname = decodeURI((req.url ?? '').split('?')[0]);
          if (optimizedDepUrlRE.test(pathname)) {
            let file = path.resolve(server.config.root, pathname.slice(1));
            if (file.startsWith(`${depsDir}${path.sep}`)) {
              await padOptimizedDepSourcemap(file);
            }
          }
        } catch {
          // This only quiets optional sourcemap hydration; never block requests.
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Preserve function/class names. Boxel's card runtime introspects
  // `Class.name` in user-visible places — validation errors ("references
  // unknown path X on Person"), displayName fallbacks, the
  // query-field-schema checks — so mangled names break both tests and
  // production error messages. The rolldown output option preserves names
  // through Vite 8's production minifier (oxc-minifier), including classes
  // declared inside function bodies.
  //
  // We DO NOT enable esbuild here. With `esbuild: { keepNames: true }`,
  // vite routes .ts files through esbuild before rollup's babel plugin,
  // and esbuild converts class fields (`x = foo()`) into constructor
  // `__publicField(this, "x", foo())` calls. That breaks ember-concurrency's
  // async-arrow-task-transform, which only matches ClassProperty nodes.
  // Letting babel do all TypeScript handling keeps class fields intact
  // through the async-arrow transform.
  //
  // For production mode, disable Vite's built-in minifier (defaults to
  // terser, which fails to parse matrix-js-sdk's indexeddb-crypto-store
  // chunk because of Unicode identifiers like `ࢶ`) and instead use
  // rolldown's native oxc minifier via `rolldownOptions.output.minify`.
  // oxc handles the full Unicode identifier range and respects the
  // sibling `keepNames: true` so the card runtime's `Class.name`
  // introspection keeps working in production. Dev-mode builds (used by
  // test-web-assets, host tests, matrix tests, and software-factory
  // tests) skip minification entirely.
  build: {
    minify: false,
    rolldownOptions: {
      output: {
        keepNames: true,
        ...(mode === 'production' ? { minify: true } : {}),
      },
    },
  },
  // The built host is served from one origin (the configured assetsURL /
  // distURL, e.g. http://localhost:4200) while the HTML that boots it is
  // served from another origin (realm-server, e.g. http://localhost:4205).
  // Static <script>/<link> tags in index.html are rewritten to absolute
  // assetsURL by realm-server (see packages/realm-server/server.ts). But
  // Vite's runtime preload helper resolves dynamic-import chunk hrefs
  // against the document origin, so they 404 on the realm-server origin.
  // Emit a runtime expression for JS asset references so they resolve
  // against a globally-configured assets URL set by the inline bootstrap
  // script in index.html. When the global is unset (testem test runner,
  // vite dev server, any host that doesn't inject the bootstrap), fall
  // back to `/` so URLs stay root-absolute and resolve against the
  // document origin as Vite would by default.
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === 'js') {
        return {
          runtime: `(globalThis.__boxelAssetsURL||"/")+${JSON.stringify(filename)}`,
        };
      }
      // Leave HTML/CSS references alone (root-absolute `/assets/...`) so
      // realm-server's absolute-URL rewrite regex can prepend assetsURL.
      return undefined;
    },
  },
  resolve: {
    alias: {
      path: require.resolve('path-browserify'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      // recast's main.js eagerly requires 'fs'; we stub it for the browser.
      fs: require.resolve('./lib/empty-fs.js'),
    },
  },
  plugins: [
    scopedCSS(),
    classicEmberSupport(),
    ember(),
    quietOptimizedDepSourcemapWarnings(),
    // extra plugins here
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm', 'content-tag'],
    rolldownOptions: {
      plugins: [
        postcssTerminalHighlightResolver,
        nodeBuiltinStubResolver,
        sourceMapJsResolver,
      ],
    },
  },
  preview: {
    cors: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
}));
