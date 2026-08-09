import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { isValidTreePath } from './tree-hash.ts';
import { moduleSpecifiers } from './es-lexer.ts';

// Vendoring: pull a library's whole module graph from a public CDN
// (esm.sh, unpkg, jsdelivr…) ONCE, rewrite its cross-module references to
// stay inside the pack, and seal it. From then on the app imports only
// from your own Deck server — the supply chain narrows to bytes a human
// approved, each verifiable by treeHash and Content-Digest.
//
// This is the PDF-font-embedding model from the equivalence design: the
// bytes travel, and the canonical identity travels with them
// (`vendoredFrom`), so a consumer can always answer "what IS this?" —
// dedupe it, upgrade it, or check it against upstream.
//
// Hermetic by default: every specifier the graph reaches must be fetched
// into the pack. A reference the walker will not follow (another host) is
// an error unless the caller explicitly allows it, because a pack with a
// live CDN reference inside it is not vendored at all.

export interface VendorOptions {
  // Entry module URL, e.g. https://esm.sh/three@0.160.0
  entryUrl: string;
  // Injected for tests and for proxy/offline setups.
  fetchImpl?: typeof fetch;
  maxModules?: number;
  maxBytes?: number;
  // Hosts other than the entry's own that may be followed.
  allowHosts?: string[];
  // Leave un-followed specifiers in place instead of failing.
  allowExternal?: boolean;
}

export interface VendoredModule {
  url: string;
  path: string;
  size: number;
}

export interface VendorResult {
  files: { path: string; bytes: Buffer }[];
  entryPath: string;
  modules: VendoredModule[];
  externals: string[];
}

// What a module imports is answered by a real tokenizer, not by pattern
// matching: see es-lexer.ts for the five real packages that proved regexes
// cannot do this job.
export function extractSpecifiers(source: string): string[] {
  return moduleSpecifiers(source);
}

// Extensions that already say what a file is. Anything else gets `.mjs`:
// a CDN entry URL like `https://esm.sh/three@0.160.0` has no extension (and
// its dots belong to the VERSION, not a suffix), so without this the file
// would serve as application/octet-stream — which browsers refuse to
// execute as a module.
const KNOWN_EXTENSIONS = [
  '.mjs',
  '.cjs',
  '.js',
  '.json',
  '.css',
  '.wasm',
  '.map',
  '.ts',
];

function knownExtension(segment: string): string | undefined {
  let lower = segment.toLowerCase();
  return KNOWN_EXTENSIONS.find((extension) => lower.endsWith(extension));
}

// A URL becomes a readable tree path: <host>/<pathname>, with any query
// folded into a short deterministic suffix so two option-variants of the
// same module cannot collide.
export function urlToTreePath(url: URL): string {
  let path = `${url.host}${url.pathname}`;
  if (path.endsWith('/')) {
    path += 'index.js';
  }
  let lastSlash = path.lastIndexOf('/');
  let extension = knownExtension(path.slice(lastSlash + 1));
  let base = extension ? path.slice(0, path.length - extension.length) : path;
  if (url.search) {
    base += `__${createHash('sha256')
      .update(url.search)
      .digest('hex')
      .slice(0, 8)}`;
  }
  path = `${base}${extension ?? '.mjs'}`;
  // `!` is reserved for pack mounts; segments must be plain.
  path = path
    .split('/')
    .map((segment) =>
      segment === '.' || segment === '..' || segment === ''
        ? `_${segment}`
        : segment.replace(/!/g, '_'),
    )
    .join('/');
  return path;
}

function relativeSpecifier(fromPath: string, toPath: string): string {
  let relative = posix.relative(posix.dirname(fromPath), toPath);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export async function vendorFromCdn(
  options: VendorOptions,
): Promise<VendorResult> {
  let {
    entryUrl,
    fetchImpl = fetch,
    maxModules = 500,
    maxBytes = 32 * 1024 * 1024,
    allowHosts = [],
    allowExternal = false,
  } = options;

  let entry = new URL(entryUrl);
  let hosts = new Set([entry.host, ...allowHosts]);
  let sources = new Map<string, { url: URL; source: string; path: string }>();
  let externals = new Set<string>();
  let totalBytes = 0;
  let queue: URL[] = [entry];
  let entryPath: string | undefined;

  while (queue.length > 0) {
    let current = queue.shift()!;
    let key = current.href;
    if (sources.has(key)) {
      continue;
    }
    if (sources.size >= maxModules) {
      throw new Error(`vendor: module cap exceeded (${maxModules})`);
    }
    let response = await fetchImpl(key, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`vendor: ${response.status} fetching ${key}`);
    }
    // A CDN resolves ranges/tags by redirecting; the final URL is the
    // pinned one, and that is what we record and address by.
    let resolved = new URL(response.url || key);
    let source = await response.text();
    totalBytes += Buffer.byteLength(source);
    if (totalBytes > maxBytes) {
      throw new Error(`vendor: byte cap exceeded (${maxBytes})`);
    }
    let path = urlToTreePath(resolved);
    if (!isValidTreePath(path)) {
      throw new Error(`vendor: ${resolved.href} maps to an invalid path`);
    }
    sources.set(key, { url: resolved, source, path });
    if (resolved.href !== key) {
      sources.set(resolved.href, { url: resolved, source, path });
    }
    if (entryPath === undefined) {
      entryPath = path;
    }
    for (let specifier of extractSpecifiers(source)) {
      let target: URL;
      try {
        target = new URL(specifier, resolved);
      } catch {
        externals.add(specifier); // bare specifier the CDN left in place
        continue;
      }
      if (!/^https?:$/.test(target.protocol) || !hosts.has(target.host)) {
        externals.add(target.href);
        continue;
      }
      queue.push(target);
    }
  }

  if (externals.size > 0 && !allowExternal) {
    throw new Error(
      `vendor: ${externals.size} reference(s) point outside the pack, so it would not be hermetic: ${[
        ...externals,
      ]
        .slice(0, 5)
        .join(
          ', ',
        )}${externals.size > 5 ? ', …' : ''} (pass allowExternal / --allow-external to keep them live)`,
    );
  }

  // Rewrite every followed reference to a path INSIDE the pack. What is
  // left absolute is exactly what the caller allowed to stay live.
  let files: { path: string; bytes: Buffer }[] = [];
  let modules: VendoredModule[] = [];
  let emitted = new Set<string>();
  for (let { url, source, path } of sources.values()) {
    if (emitted.has(path)) {
      continue;
    }
    emitted.add(path);
    let rewritten = source;
    for (let specifier of extractSpecifiers(source)) {
      let target: URL;
      try {
        target = new URL(specifier, url);
      } catch {
        continue;
      }
      let hit = sources.get(target.href);
      if (!hit) {
        continue;
      }
      let replacement = relativeSpecifier(path, hit.path);
      rewritten = rewritten.split(`'${specifier}'`).join(`'${replacement}'`);
      rewritten = rewritten.split(`"${specifier}"`).join(`"${replacement}"`);
    }
    let bytes = Buffer.from(rewritten, 'utf8');
    files.push({ path, bytes });
    modules.push({ url: url.href, path, size: bytes.length });
  }

  return {
    files,
    entryPath: entryPath!,
    modules: modules.sort((a, b) => a.path.localeCompare(b.path)),
    externals: [...externals],
  };
}

// The vendored pack declares itself like any deck: an import map naming
// the package, its version, and the entry — plus `vendoredFrom`, the
// canonical identity of what was pulled in.
export function vendorImportMap(
  name: string,
  version: string,
  entryPath: string,
  // A CDN vendor has one canonical URL to record. An npm source vendor has
  // a whole provenance chain — registry, integrity, repo, commit — so the
  // field carries an object there.
  vendoredFrom: string | Record<string, unknown>,
): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        imports: {},
        deck: {
          packages: {
            [name]: {
              version,
              entry: `$DECK/${entryPath}`,
              vendoredFrom,
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}
