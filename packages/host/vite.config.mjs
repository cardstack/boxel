import { defineConfig } from 'vite';
import {
  extensions as _extensions,
  classicEmberSupport,
  ember,
} from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopedCSS } from 'glimmer-scoped-css/rollup';
import { boxelUIChecksumPlugin } from './lib/build/boxel-ui-checksum-plugin.mjs';

// Local HTTPS dev access: the realm-server speaks HTTPS+HTTP/2 in local
// dev (see `infra:ensure-dev-cert`), and the browser hits both Vite and
// the realm-server in the same page. Mixing schemes triggers CORS
// preflight failures ("Redirect is not allowed for a preflight
// request" when the http→https redirect runs) and mixed-content
// blocking. When the same TLS cert/key the realm-server reads via
// REALM_SERVER_TLS_CERT_FILE / _KEY_FILE is available, terminate TLS
// in Vite too so http://localhost:4200 becomes https://localhost:4200
// and both origins share the scheme. `env-vars.sh` exports those env
// vars whenever the cert exists; absent the cert, the dev stack stays
// on HTTP end-to-end and this falls through to Vite's default.
function devHttpsConfig() {
  // Env mode: Traefik terminates TLS in front of a plain-HTTP vite, so
  // we must NOT enable HTTPS here even if the TLS env vars are still
  // set (e.g. inherited from a previous standard-mode shell session,
  // or from a parent zsh that ran env-vars.sh before BOXEL_ENVIRONMENT
  // was exported). Without this guard, vite expects a TLS handshake on
  // its upstream port and Traefik's plain-HTTP proxy hits
  // "HTTP/0.9 when not allowed" → 502 Bad Gateway in the browser.
  if (process.env.BOXEL_ENVIRONMENT) return undefined;
  let certPath = process.env.REALM_SERVER_TLS_CERT_FILE;
  let keyPath = process.env.REALM_SERVER_TLS_KEY_FILE;
  if (!certPath || !keyPath) return undefined;
  try {
    return {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    };
  } catch {
    return undefined;
  }
}
const _devHttps = devHttpsConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    if (id === 'fs' || id === 'node:fs' || id === 'url' || id === 'node:url') {
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

// In environment mode (BOXEL_ENVIRONMENT set), scripts/vite-with-traefik.js
// exposes the public Traefik hostname via BOXEL_HOST_HOSTNAME so we can let it
// through Vite's host check (for both `vite` and `vite preview`) and tell the
// HMR client where to reconnect (dev only).
const envHostname = process.env.BOXEL_HOST_HOSTNAME;

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
    alias: [
      { find: 'path', replacement: require.resolve('path-browserify') },
      { find: 'stream', replacement: require.resolve('stream-browserify') },
      { find: /^util$/, replacement: require.resolve('util/') },
      // recast's main.js eagerly requires 'fs'; we stub it for the browser.
      { find: 'fs', replacement: require.resolve('./lib/empty-fs.js') },
    ],
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
    boxelUIChecksumPlugin(__dirname),
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
      'Document-Policy': 'js-profiling',
    },
    ...(envHostname ? { allowedHosts: [envHostname] } : {}),
    ...(_devHttps ? { https: _devHttps } : {}),
  },
  server: {
    ...(_devHttps ? { https: _devHttps } : {}),
    // Permit the JS Self-Profiling API in dev so client-telemetry's Tier-2
    // wedge stack sampling works when running the host from Vite locally.
    headers: {
      'Document-Policy': 'js-profiling',
    },
    // Pre-warm the dep optimizer at server boot so the prerender's first
    // `/_standby` navigation doesn't race a cold Vite optimize. The host
    // transitive graph is ~1000 packages, and a cold optimize routinely
    // exceeds the prerender's standby-load retry window (see
    // `STANDBY_TIMEOUT_MS` and `STANDBY_CREATION_RETRIES` in
    // packages/realm-server/prerender/page-pool.ts). HTTP readiness probes
    // against `/` only fetch the HTML shell — they never request modules,
    // so they don't kick the optimizer; only a browser-shaped navigation
    // does. Warming `./app/app.ts` here surfaces the full app graph
    // (Ember runtime, boxel-ui, plus `@embroider/virtual/compat-modules`
    // which fans out to every route, component, and template) at boot,
    // so optimization is already in flight by the time Puppeteer
    // connects. Async by design: server-ready isn't blocked, so devs
    // who don't run the prerender don't pay the cost upfront.
    warmup: {
      clientFiles: ['./app/app.ts'],
    },
    ...(envHostname && {
      allowedHosts: [envHostname],
      hmr: {
        host: envHostname,
        // The page is served by Traefik over https on :443, so the
        // HMR client must connect via wss:// on the same port. With
        // clientPort: 80, the browser opens `wss://host.<slug>.localhost:80/`
        // which Traefik's :80 entrypoint returns a 404 for — the HMR
        // WebSocket handshake fails, the prerender's standby load
        // never finishes initializing, and realm-server boot stalls
        // waiting on the prerender.
        clientPort: 443,
        protocol: 'wss',
      },
    }),
  },
}));
