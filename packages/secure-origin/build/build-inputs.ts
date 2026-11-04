// What a build was made from: every file the bundle read, and the files that
// configure the build, each with a hash of its content. The build writes
// them to `inputs.json` beside its manifest. The realm server never serves
// that file; it serves only what the manifest lists.
//
// `staleInput` compares a build's record against the files on disk, so a
// process about to serve the build can tell whether it still matches its
// sources and rebuild only when it does not (`build/ensure-build.ts`). The
// files the bundle read include every module it compiled from another
// package, so a change to one of those packages' sources counts as a change
// to the build.
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

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

// The record of the inputs, for module ids as the bundler names them. A
// virtual module (`\0…`) or one with a query has its file, if any, among
// the ids too, so only ids that are files on disk are recorded.
export function describeInputs(
  moduleIds: Iterable<string>,
  root: string = PACKAGE_ROOT,
): InputsRecord {
  let paths = new Set<string>();
  for (let id of moduleIds) {
    let file = id.split('?')[0];
    if (isAbsolute(file) && isFile(file)) {
      paths.add(relative(root, file));
    }
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

// Why the build in `distDir` doesn't match the files on disk, or undefined
// when it does: no build, no record of its inputs, or the first input that
// is missing or has changed.
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
  return undefined;
}

export function buildInputs(): Plugin {
  let outDir: string;
  let moduleIds: string[] = [];
  return {
    name: 'secure-origin-build-inputs',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      moduleIds = [...this.getModuleIds()];
    },
    // Written to disk once the bundle is, rather than emitted into it: the
    // build record drops every file of the bundle no entry document loads.
    writeBundle() {
      writeFileSync(
        join(outDir, INPUTS_FILE),
        `${JSON.stringify(describeInputs(moduleIds), null, 2)}\n`,
      );
    },
  };
}
