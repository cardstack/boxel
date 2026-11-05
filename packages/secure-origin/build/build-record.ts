// The build's output, recorded: each file the entry documents load, its size,
// and each module in it by package, version and rendered size. The record is
// committed (`build-record.json`), so a change to what the secure origin
// serves — a bump to Ember or to any allowed package included — shows in the
// pull request that makes it.
//
// A module from another package in this repository (Pret UI, boxel-ui,
// boxel-icons) is also recorded with a hash of the file the build reads for
// it: the `.gts` or `.ts` source for a package compiled here, the built file
// for one read from its own build. Such a package's version doesn't change
// when its code does, so the hash is what shows that a change to it changes
// the origin (ADR 019 §1.8).
//
// A build writes the record. With SECURE_ORIGIN_BUILD_RECORD=check it instead
// fails when the output differs from the committed record, which is how CI
// keeps the two in step. When a hash moved, the failure names those modules
// first.
//
// The production build is two environments (`vite.config.ts`): the pages
// the origin serves, and the build probe, written to `probe/`. The record
// covers both, naming the probe's files by their path in the output, and is
// written or checked once both are built.
//
// The plugin also writes `manifest.json` into each environment's output: the
// placeholder base asset URLs are written under, and each entry document and
// the files it loads, which is all the realm server serves. The record covers
// those files alone, and a file no entry loads is dropped from the output
// where the bundle still holds it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Plugin, Rollup } from 'vite';

import { modulePackage, PACKAGE_ROOT } from './module-package.ts';
import { outputPrefix } from './probe.ts';
import { portableSource } from './relative-module-names.ts';

type Bundle = Rollup.OutputBundle;

interface ModuleName {
  package: string;
  module: string;
  // For a module from another package in this repository.
  sha256?: string;
}

interface FileRecord {
  bytes: number;
  modules?: (ModuleName & { size: number })[];
  sources?: ModuleName[];
}

interface BuildRecord {
  entries: Record<string, string[]>;
  files: Record<string, FileRecord>;
}

const ADR = 'ADR 019 §1.8';

// Each environment's part of the record, named by path in the output. Each
// environment's build loads the config, and so this module, afresh, with
// plugins of its own, so the parts are kept on the global object, under a
// key every copy of this module names alike, where the plugin that writes the
// record once both are built finds them.
const RECORDS = Symbol.for('@cardstack/secure-origin build record');
const records: Map<string, BuildRecord> = ((
  globalThis as { [RECORDS]?: Map<string, BuildRecord> }
)[RECORDS] ??= new Map());

export const RECORD_FILE = join(PACKAGE_ROOT, 'build-record.json');
export const MANIFEST_FILE = 'manifest.json';

export function buildRecord({
  mode = 'write',
}: { mode?: 'write' | 'check' } = {}): Plugin {
  let base: string;
  // Each chunk's stylesheets, by the name of the stylesheet the chunk's CSS
  // is written to, per environment. Read as chunks render: a chunk holding
  // only CSS, like `layers`, is gone from the bundle by the time it is
  // written, and its stylesheet is listed among its importers'.
  let stylesheetModules = new Map<string, Map<string, string[]>>();
  let stylesheets = (environment: string) => {
    let found = stylesheetModules.get(environment);
    if (!found) {
      found = new Map();
      stylesheetModules.set(environment, found);
    }
    return found;
  };
  return {
    name: 'secure-origin-build-record',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base;
    },
    buildStart() {
      stylesheets(this.environment.name).clear();
      records.delete(this.environment.name);
    },
    renderChunk(_code, chunk) {
      stylesheets(this.environment.name).set(
        `${chunk.name}.css`,
        chunk.moduleIds.filter(isCss),
      );
      return null;
    },
    generateBundle(_options, bundle) {
      let environment = this.environment.name;
      let entries = entryDocuments(bundle);
      let loaded = new Set(Object.values(entries).flat());
      for (let fileName of Object.keys(bundle)) {
        if (!loaded.has(fileName)) {
          delete bundle[fileName];
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE,
        source: `${JSON.stringify({ base, entries }, null, 2)}\n`,
      });
      let prefix = outputPrefix(environment);
      records.set(environment, {
        entries: Object.fromEntries(
          Object.entries(entries).map(([document, files]) => [
            `${prefix}${document}`,
            files.map((name) => `${prefix}${name}`),
          ]),
        ),
        files: Object.fromEntries(
          Object.entries(
            describeFiles(bundle, loaded, stylesheets(environment)),
          ).map(([name, file]) => [`${prefix}${name}`, file]),
        ),
      });
    },
    // Once every environment is built.
    buildApp: {
      order: 'post',
      async handler() {
        let record = `${JSON.stringify(combine([...records.values()]), null, 2)}\n`;
        records.clear();
        let committed = existsSync(RECORD_FILE)
          ? readFileSync(RECORD_FILE, 'utf8')
          : '';
        if (committed === record) {
          return;
        }
        if (mode === 'write') {
          writeFileSync(RECORD_FILE, record);
          return;
        }
        let moved = movedModules(committed, record);
        throw new Error(
          [
            ...(moved.length > 0
              ? [
                  `These modules from other packages in this repository change what the secure origin ships, so this is a change to the origin's trusted code (${ADR}):`,
                  ...moved.map((line) => `  ${line}`),
                  '',
                ]
              : []),
            "The secure origin's build output differs from build-record.json:",
            lineDiff(committed, record),
            'Run `pnpm build` in packages/secure-origin and commit build-record.json.',
          ].join('\n'),
        );
      },
    },
  };
}

function combine(parts: BuildRecord[]): BuildRecord {
  let sorted = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
    );
  return {
    entries: sorted(Object.assign({}, ...parts.map((part) => part.entries))),
    files: sorted(Object.assign({}, ...parts.map((part) => part.files))),
  };
}

// Each module from another package in this repository whose hash differs
// between two records, or that only one of them ships.
export function movedModules(before: string, after: string): string[] {
  let hashes = (source: string) => {
    let found = new Map<string, string>();
    let record: Partial<BuildRecord>;
    try {
      record = JSON.parse(source);
    } catch {
      return found;
    }
    for (let file of Object.values(record.files ?? {})) {
      for (let name of [...(file.modules ?? []), ...(file.sources ?? [])]) {
        if (name.sha256) {
          found.set(`${name.package} ${name.module}`, name.sha256);
        }
      }
    }
    return found;
  };
  let was = hashes(before);
  let is = hashes(after);
  let moved: string[] = [];
  for (let name of [...new Set([...was.keys(), ...is.keys()])].sort()) {
    if (!was.has(name)) {
      moved.push(`${name} (added)`);
    } else if (!is.has(name)) {
      moved.push(`${name} (removed)`);
    } else if (was.get(name) !== is.get(name)) {
      moved.push(`${name} (changed)`);
    }
  }
  return moved;
}

// Each entry document, by its path in the output, and every file it loads:
// itself, its script, the chunks that script imports, and their stylesheets.
function entryDocuments(bundle: Bundle): Record<string, string[]> {
  let entries: Record<string, string[]> = {};
  for (let chunk of Object.values(bundle)) {
    if (
      chunk.type !== 'chunk' ||
      !chunk.isEntry ||
      !chunk.facadeModuleId?.endsWith('.html')
    ) {
      continue;
    }
    let documentName = relative(PACKAGE_ROOT, chunk.facadeModuleId);
    let files = new Set([documentName]);
    let pending = [chunk.fileName];
    while (pending.length > 0) {
      let fileName = pending.pop()!;
      if (files.has(fileName)) {
        continue;
      }
      files.add(fileName);
      let output = bundle[fileName];
      if (output?.type === 'chunk') {
        pending.push(...output.imports);
        files = new Set([
          ...files,
          ...(output.viteMetadata?.importedCss ?? []),
          ...(output.viteMetadata?.importedAssets ?? []),
        ]);
      }
    }
    entries[documentName] = [...files].sort();
  }
  return Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function describeFiles(
  bundle: Bundle,
  loaded: Set<string>,
  stylesheetModules: Map<string, string[]>,
): Record<string, FileRecord> {
  let files: Record<string, FileRecord> = {};
  for (let fileName of [...loaded].sort()) {
    let output = bundle[fileName];
    let bytes = Buffer.byteLength(
      output.type === 'chunk' ? output.code : output.source,
    );
    if (output.type === 'chunk') {
      files[fileName] = {
        bytes,
        modules: Object.entries(output.modules)
          .filter(([, info]) => info.renderedLength > 0)
          .map(([id, info]) => ({
            ...moduleName(id),
            size: info.renderedLength,
          }))
          .sort(byModule),
      };
    } else if (stylesheetModules.has(fileName)) {
      files[fileName] = {
        bytes,
        sources: stylesheetModules
          .get(fileName)!
          .map(moduleName)
          .sort(byModule),
      };
    } else {
      files[fileName] = { bytes };
    }
  }
  return files;
}

function isCss(id: string): boolean {
  return id.split('?')[0].endsWith('.css');
}

function moduleName(id: string): ModuleName {
  let found = modulePackage(id);
  if (found.virtual !== undefined) {
    return { package: '(bundler)', module: found.virtual.replace('\0', '') };
  }
  return {
    package: found.own ? found.name! : `${found.name}@${found.version}`,
    module: found.path,
    ...(found.workspace ? hashOf(id.split('?')[0]) : {}),
  };
}

// The hash of the file the build read for a module, in the form that is the
// same in every checkout, or nothing for a module that has no file of its
// own, such as a component's scoped stylesheet, which its component's module
// covers.
function hashOf(file: string): { sha256?: string } {
  let isFile = false;
  try {
    isFile = statSync(file).isFile();
  } catch {
    // No file by that name.
  }
  if (!isFile) {
    return {};
  }
  return {
    sha256: createHash('sha256')
      .update(portableSource(readFileSync(file, 'utf8')))
      .digest('hex'),
  };
}

function byModule(a: ModuleName, b: ModuleName): number {
  return a.package.localeCompare(b.package) || a.module.localeCompare(b.module);
}

// The record's lines that one side has and the other doesn't, enough to see
// which files and modules moved.
function lineDiff(before: string, after: string): string {
  let beforeLines = before.split('\n');
  let afterLines = after.split('\n');
  let removed = beforeLines.filter((line) => !afterLines.includes(line));
  let added = afterLines.filter((line) => !beforeLines.includes(line));
  return [
    ...removed.map((line) => `- ${line.trim()}`),
    ...added.map((line) => `+ ${line.trim()}`),
  ].join('\n');
}
