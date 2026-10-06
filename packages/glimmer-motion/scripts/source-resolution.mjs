/**
 * How glimmer-motion's source reaches framer-motion's internals, shared by its
 * own rollup build and by the workspace apps that compile glimmer-motion from
 * source through the `developing:choreo` export condition.
 *
 * src/framer-motion-internals.ts imports modules from framer-motion's
 * `dist/es` that its exports map doesn't expose, so every bundler that reads
 * that file has to resolve those paths on disk, past the exports map. One of
 * the modules they reach (`utils/use-constant.mjs`, beside `DragControls`)
 * imports `react` for a hook glimmer-motion never calls. rollup tree-shakes it
 * away; a dev server compiling the source serves the whole module, so
 * `glimmerMotionSource()` answers that import with a stub.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

export const framerMotionDir = dirname(
  createRequire(import.meta.url).resolve('framer-motion/package.json'),
);

const internalPrefix = 'framer-motion/dist/es/';

/** The file on disk for a `framer-motion/dist/es/…` specifier, else null. */
export function framerMotionInternalPath(id) {
  return id.startsWith(internalPrefix)
    ? join(framerMotionDir, id.slice('framer-motion/'.length))
    : null;
}

export const isFramerMotionModule = (id) =>
  typeof id === 'string' && id.startsWith(framerMotionDir + sep);

export const isReact = (id) =>
  id === 'react' ||
  id.startsWith('react/') ||
  id === 'react-dom' ||
  id.startsWith('react-dom/');

const reactStubId = '\0glimmer-motion:react-stub';

/**
 * A Vite plugin for apps that compile glimmer-motion from source, alongside
 * `resolve.conditions: ['developing:choreo', ...defaultClientConditions]`.
 */
export function glimmerMotionSource() {
  return {
    name: 'glimmer-motion-source',
    enforce: 'pre',
    resolveId(id, importer) {
      const internal = framerMotionInternalPath(id);
      if (internal) {
        return internal;
      }
      if (isFramerMotionModule(importer) && isReact(id)) {
        return reactStubId;
      }
      return null;
    },
    load(id) {
      if (id !== reactStubId) {
        return null;
      }
      return `export function useRef() {
  throw new Error('glimmer-motion does not run framer-motion\\'s React hooks');
}
`;
    },
    // framer-motion's React hook modules open with a "use client" directive,
    // which bundlers warn about and drop. Blank it out (same length, so
    // source maps still line up) to keep that warning out of every build.
    transform(code, id) {
      if (!isFramerMotionModule(id) || !code.startsWith('"use client";')) {
        return null;
      }
      return {
        code: ' '.repeat('"use client";'.length) + code.slice(13),
        map: null,
      };
    },
  };
}

/** The `developing:choreo` target an exports map gives a subpath, else null. */
function sourceExport(exports, subpath) {
  const target = (entry, star) => {
    const path = entry?.['developing:choreo'];
    return path && star !== undefined
      ? path.replace('*', star)
      : (path ?? null);
  };
  if (subpath in exports) {
    return target(exports[subpath]);
  }
  for (const [key, entry] of Object.entries(exports)) {
    const star = key.indexOf('*');
    if (star < 0) {
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix)
    ) {
      return target(
        entry,
        subpath.slice(prefix.length, subpath.length - suffix.length),
      );
    }
  }
  return null;
}

/**
 * A Vite plugin that resolves a package's imports of itself (its test suite
 * importing it by name) through its `developing:choreo` exports, for a
 * harness that compiles the package from source.
 *
 * Embroider's resolver answers a v2 addon's self-references from the
 * addon's own package.json and does not apply `resolve.conditions`: it
 * serves `dist/` whenever a build exists, and the suite would silently test
 * that instead of the source. A harness running against the built output
 * leaves this plugin out.
 */
export function selfReferenceSource(packageDir) {
  const pkg = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  );
  return {
    name: `${pkg.name}-self-reference-source`,
    enforce: 'pre',
    resolveId(id) {
      if (id !== pkg.name && !id.startsWith(`${pkg.name}/`)) {
        return null;
      }
      const target = sourceExport(pkg.exports, `.${id.slice(pkg.name.length)}`);
      return target ? join(packageDir, target) : null;
    },
  };
}
