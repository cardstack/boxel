// The build's output, recorded: each file the entry documents load, its size,
// and each module in it by package, version and rendered size. The record is
// committed (`build-record.json`), so a change to what the secure origin
// serves — a bump to Ember or to any allowed package included — shows in the
// pull request that makes it.
//
// A build writes the record. With SECURE_ORIGIN_BUILD_RECORD=check it instead
// fails when the output differs from the committed record, which is how CI
// keeps the two in step.
//
// The plugin also writes `manifest.json` into the output: the placeholder base
// asset URLs are written under, and each entry document and the files it
// loads, which is all the realm server serves. The record covers those files
// alone, and a file no entry loads is dropped from the output where the
// bundle still holds it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Plugin, Rollup } from 'vite';

import { modulePackage, PACKAGE_ROOT } from './module-package.ts';

type Bundle = Rollup.OutputBundle;

interface ModuleName {
  package: string;
  module: string;
}

interface FileRecord {
  bytes: number;
  modules?: (ModuleName & { size: number })[];
  sources?: ModuleName[];
}

export const RECORD_FILE = join(PACKAGE_ROOT, 'build-record.json');
export const MANIFEST_FILE = 'manifest.json';

export function buildRecord({
  mode = 'write',
}: { mode?: 'write' | 'check' } = {}): Plugin {
  let base: string;
  // Each chunk's stylesheets, by the name of the stylesheet the chunk's CSS
  // is written to. Read as chunks render: a chunk holding only CSS, like
  // `layers`, is gone from the bundle by the time it is written, and its
  // stylesheet is listed among its importers'.
  let stylesheetModules = new Map<string, string[]>();
  return {
    name: 'secure-origin-build-record',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base;
    },
    buildStart() {
      stylesheetModules.clear();
    },
    renderChunk(_code, chunk) {
      stylesheetModules.set(`${chunk.name}.css`, chunk.moduleIds.filter(isCss));
      return null;
    },
    generateBundle(_options, bundle) {
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

      let record = `${JSON.stringify(
        { entries, files: describeFiles(bundle, loaded, stylesheetModules) },
        null,
        2,
      )}\n`;
      if (mode === 'check') {
        let committed = existsSync(RECORD_FILE)
          ? readFileSync(RECORD_FILE, 'utf8')
          : '';
        if (committed !== record) {
          this.error(
            `The secure origin's build output differs from build-record.json:\n${lineDiff(
              committed,
              record,
            )}\nRun \`pnpm build\` in packages/secure-origin and commit build-record.json.`,
          );
        }
      } else if (
        !existsSync(RECORD_FILE) ||
        readFileSync(RECORD_FILE, 'utf8') !== record
      ) {
        writeFileSync(RECORD_FILE, record);
      }
    },
  };
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
