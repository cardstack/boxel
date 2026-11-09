// What a build was made from and what it wrote, each file with a hash of its
// content. The inputs are every file the bundle read, the `package.json` of
// each package those files belong to (its `exports` and `ember-addon` fields
// decide what an import resolves to), the `tsconfig.json` nearest each of
// those files and every config it extends (the TypeScript transform reads
// `target`, `verbatimModuleSyntax` and the decorator options from there), and
// the files that configure the build. The outputs are every file the build wrote. The build writes the
// record to `inputs.json` beside its manifest. The realm server never serves
// that file; it serves only what the manifest lists.
//
// `staleInput` compares a build's record against the files on disk, so a
// process about to serve the build can tell whether it still matches its
// sources, and is whole, and rebuild only when it is not
// (`build/ensure-build.ts`). The files the bundle read include every module
// it compiled from another package, so a change to one of those packages'
// sources counts as a change to the build.
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Plugin } from 'vite';

import { PACKAGE_ROOT } from './module-package.ts';

export const INPUTS_FILE = 'inputs.json';

// Files that shape the build without being modules in it, relative to the
// package. The lockfile is among them: it decides which version of a
// dependency a bare import resolves to.
function configFiles(root: string): string[] {
  let buildDir = join(root, 'build');
  return [
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    join('..', '..', 'pnpm-lock.yaml'),
    ...(existsSync(buildDir)
      ? readdirSync(buildDir)
          .filter((name) => name.endsWith('.ts'))
          .map((name) => join('build', name))
      : []),
  ];
}

interface InputsRecord {
  files: Record<string, string>;
  outputs?: Record<string, string>;
}

function hashFile(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// The `package.json` files from `dir` up to the first that names a package:
// the one that owns a module, and any nearer one that only sets `type`.
const manifestsByDir = new Map<string, string[]>();
function packageManifests(dir: string): string[] {
  let found = manifestsByDir.get(dir);
  if (found) {
    return found;
  }
  let file = join(dir, 'package.json');
  let parent = dirname(dir);
  if (isFile(file)) {
    let named = false;
    try {
      named = typeof JSON.parse(readFileSync(file, 'utf8')).name === 'string';
    } catch {
      // An unreadable manifest is still an input; keep walking up.
    }
    found =
      named || parent === dir ? [file] : [file, ...packageManifests(parent)];
  } else {
    found = parent === dir ? [] : packageManifests(parent);
  }
  manifestsByDir.set(dir, found);
  return found;
}

// The `tsconfig.json` nearest `dir`, looking up to the filesystem's root as
// the TypeScript transform does, or undefined when there is none.
const tsconfigByDir = new Map<string, string | undefined>();
function nearestTsconfig(dir: string): string | undefined {
  if (tsconfigByDir.has(dir)) {
    return tsconfigByDir.get(dir);
  }
  let file = join(dir, 'tsconfig.json');
  let parent = dirname(dir);
  let found = isFile(file)
    ? file
    : parent === dir
      ? undefined
      : nearestTsconfig(parent);
  tsconfigByDir.set(dir, found);
  return found;
}

// `tsconfig` and every config its `extends` names, transitively. A config is
// JSON with comments, so `extends` is read by pattern rather than parsed; a
// name that doesn't resolve to a file is left out, as the transform would
// fail to read it too.
function tsconfigChain(tsconfig: string, seen = new Set<string>()): string[] {
  if (seen.has(tsconfig)) {
    return [];
  }
  seen.add(tsconfig);
  let source = readFileSync(tsconfig, 'utf8');
  let match = /"extends"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\])/.exec(source);
  let names: string[] = [];
  if (match) {
    try {
      let value = JSON.parse(match[1]) as string | string[];
      names = Array.isArray(value) ? value : [value];
    } catch {
      // An `extends` that isn't plain JSON names nothing this can follow.
    }
  }
  let dir = dirname(tsconfig);
  let require = createRequire(tsconfig);
  let chain = [tsconfig];
  for (let name of names) {
    let candidates = name.startsWith('.')
      ? [resolve(dir, name), resolve(dir, `${name}.json`)]
      : [];
    if (!name.startsWith('.')) {
      for (let specifier of [name, `${name}.json`, `${name}/tsconfig.json`]) {
        try {
          candidates.push(require.resolve(specifier));
        } catch {
          // Not this spelling of the package's config.
        }
      }
    }
    let file = candidates.find(isFile);
    if (file) {
      chain.push(...tsconfigChain(file, seen));
    }
  }
  return chain;
}

// The record of the inputs, for module ids as the bundler names them. A
// virtual module (`\0…`) or one with a query has its file, if any, among
// the ids too, so only ids that are files on disk are recorded.
export function describeInputs(
  moduleIds: Iterable<string>,
  root: string = PACKAGE_ROOT,
): InputsRecord {
  let paths = new Set<string>();
  // Each package's manifest and the TypeScript configs its modules compile
  // under.
  let manifests = new Set<string>();
  for (let id of moduleIds) {
    let file = id.split('?')[0];
    if (isAbsolute(file) && isFile(file)) {
      paths.add(relative(root, file));
      for (let manifest of packageManifests(dirname(file))) {
        manifests.add(manifest);
      }
      let tsconfig = nearestTsconfig(dirname(file));
      if (tsconfig) {
        for (let config of tsconfigChain(tsconfig)) {
          manifests.add(config);
        }
      }
    }
  }
  for (let manifest of manifests) {
    paths.add(relative(root, manifest));
  }
  for (let path of configFiles(root)) {
    if (isFile(join(root, path))) {
      paths.add(path);
    }
  }
  let files: Record<string, string> = {};
  for (let path of [...paths].sort()) {
    files[path] = hashFile(join(root, path));
  }
  return { files };
}

// The record of what a build wrote: each of `names`, a path inside `distDir`.
export function describeOutputs(
  distDir: string,
  names: Iterable<string>,
): Record<string, string> {
  let outputs: Record<string, string> = {};
  for (let name of [...names].sort()) {
    outputs[name] = hashFile(join(distDir, name));
  }
  return outputs;
}

// Why the build in `distDir` doesn't match the files on disk, or undefined
// when it does: no build, no record of its inputs, or the first input or
// output that is missing or has changed.
export function staleInput(
  distDir: string,
  root: string = PACKAGE_ROOT,
): string | undefined {
  if (!existsSync(join(distDir, 'manifest.json'))) {
    return `${distDir} holds no build`;
  }
  let recordFile = join(distDir, INPUTS_FILE);
  if (!existsSync(recordFile)) {
    return `${distDir} holds no record of its inputs`;
  }
  let record: InputsRecord;
  try {
    record = JSON.parse(readFileSync(recordFile, 'utf8'));
  } catch {
    return `${recordFile} can't be read`;
  }
  for (let path of configFiles(root)) {
    if (!(path in record.files) && isFile(join(root, path))) {
      return `${path} is not among the build's inputs`;
    }
  }
  for (let [path, hash] of Object.entries(record.files)) {
    let file = resolve(root, path);
    if (!isFile(file)) {
      return `${path} is gone`;
    }
    if (hashFile(file) !== hash) {
      return `${path} has changed`;
    }
  }
  if (!record.outputs) {
    return `${recordFile} records no outputs`;
  }
  for (let [name, hash] of Object.entries(record.outputs)) {
    let file = join(distDir, name);
    if (!isFile(file)) {
      return `the build's ${name} is gone`;
    }
    if (hashFile(file) !== hash) {
      return `the build's ${name} has changed`;
    }
  }
  return undefined;
}

// Each environment of the build (`vite.config.ts`) writes its own record,
// beside its own manifest.
export function buildInputs(): Plugin {
  let moduleIds = new Map<string, string[]>();
  return {
    name: 'secure-origin-build-inputs',
    apply: 'build',
    generateBundle() {
      moduleIds.set(this.environment.name, [...this.getModuleIds()]);
    },
    // Written to disk once the bundle is, rather than emitted into it: the
    // build record drops every file of the bundle no entry document loads.
    writeBundle(_options, bundle) {
      let { config } = this.environment;
      let outDir = resolve(config.root, config.build.outDir);
      let outputs = describeOutputs(outDir, Object.keys(bundle));
      writeFileSync(
        join(outDir, INPUTS_FILE),
        `${JSON.stringify(
          {
            ...describeInputs(moduleIds.get(this.environment.name) ?? []),
            outputs,
          },
          null,
          2,
        )}\n`,
      );
    },
  };
}
