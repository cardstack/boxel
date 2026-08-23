import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  captureRepositoryCheckpoint,
  hashBytes,
  pack,
  publishToStore,
  readBranchHead,
  readRepositoryConfig,
  readStoreMeta,
  repositoryManifest,
  unpack,
  writeRepositoryConfig,
} from '@cardstack/deck/node';
import { extractSpecifiers } from '@cardstack/deck/vendor';
import { deckCollaborationPolicyFromEnvironment } from '../lib/deck-collaboration-policy.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';
import { buildDeckVersionIndex } from '../lib/deck-version-index.ts';

const execFileAsync = promisify(execFile);
const moduleExtensions = new Set([
  '.gts',
  '.gjs',
  '.ts',
  '.js',
  '.mts',
  '.mjs',
]);
const resolveExtensions = [
  '',
  '.gts',
  '.gjs',
  '.ts',
  '.js',
  '.mts',
  '.mjs',
  '.json',
  '.css',
  '.svg',
];

interface SliceManifest {
  format: 'boxel-pretui-slice-v1';
  packageName: string;
  version: string;
  sourceRevision: string;
  maxFiles: number;
  sourceRoots: string[];
  runtimeRoots: string[];
  dependencies: Record<string, string>;
  locks: Record<string, string>;
}

function posixPath(path: string): string {
  return path.split('\\').join('/');
}

async function listFiles(root: string, current = root): Promise<string[]> {
  let result: string[] = [];
  for (let entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    let absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(root, absolute)));
    } else if (entry.isFile()) {
      result.push(posixPath(relative(root, absolute)));
    }
  }
  return result.sort();
}

function resolveRelativeImport(
  from: string,
  specifier: string,
  available: Set<string>,
): string | undefined {
  let fromParts = from.split('/');
  fromParts.pop();
  for (let part of specifier.split('/')) {
    if (part === '.' || part === '') {
      continue;
    }
    if (part === '..') {
      fromParts.pop();
    } else {
      fromParts.push(part);
    }
  }
  let base = fromParts.join('/');
  for (let extension of resolveExtensions) {
    let candidate = `${base}${extension}`;
    if (available.has(candidate)) {
      return candidate;
    }
  }
  for (let extension of resolveExtensions.slice(1)) {
    let candidate = `${base}/index${extension}`;
    if (available.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function dependencyClosure(
  sourceDir: string,
  manifest: SliceManifest,
): Promise<{ files: string[]; externals: string[] }> {
  let available = new Set(await listFiles(sourceDir));
  let queue = [...manifest.runtimeRoots];
  let files = new Set<string>();
  let externals = new Set<string>();
  let unresolved: string[] = [];
  while (queue.length > 0) {
    let path = queue.shift()!;
    if (files.has(path)) {
      continue;
    }
    if (!available.has(path)) {
      unresolved.push(path);
      continue;
    }
    files.add(path);
    if (files.size > manifest.maxFiles) {
      throw new Error(
        `Known Date closure exceeded its reviewed ${manifest.maxFiles}-file boundary`,
      );
    }
    if (!moduleExtensions.has(extname(path))) {
      continue;
    }
    let source = await readFile(join(sourceDir, path), 'utf8');
    for (let specifier of extractSpecifiers(source)) {
      if (path === 'controls-known-date.gts' && specifier === './controls') {
        continue;
      }
      if (!specifier.startsWith('.')) {
        externals.add(specifier);
        continue;
      }
      let resolved = resolveRelativeImport(path, specifier, available);
      if (resolved) {
        queue.push(resolved);
      } else {
        unresolved.push(`${path} -> ${specifier}`);
      }
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      `unresolved Known Date dependencies:\n${unresolved.join('\n')}`,
    );
  }
  return { files: [...files].sort(), externals: [...externals].sort() };
}

let args = process.argv.slice(2);
if (args[0] === '--') {
  args.shift();
}
const [realmDirArg, sourceDirArg] = args;
if (!realmDirArg || !sourceDirArg) {
  throw new Error(
    'usage: tsx scripts/seed-pretui-known-date.ts <realm-dir> <pretui-source-dir>',
  );
}

let realmDir = resolve(realmDirArg);
let sourceDir = resolve(sourceDirArg);
let manifestPath = new URL(
  '../fixtures/pretui-known-date/manifest.json',
  import.meta.url,
);
let manifest = JSON.parse(
  await readFile(manifestPath, 'utf8'),
) as SliceManifest;
let { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
  cwd: sourceDir,
});
let actualRevision = stdout.trim();
if (actualRevision !== manifest.sourceRevision) {
  throw new Error(
    `PretUI source is ${actualRevision}; fixture requires ${manifest.sourceRevision}`,
  );
}

let closure = await dependencyClosure(sourceDir, manifest);
let packageJSON = {
  name: manifest.packageName,
  version: manifest.version,
  type: 'module',
  exports: {
    './controls-known-date': './controls-known-date.gts',
    './known-date-demo': './known-date-demo.gts',
    './known-date-card': './PretuiComponent/knowndate.json',
  },
  dependencies: manifest.dependencies,
};
let importMap = { imports: manifest.locks, scopes: {} };
let provenance = {
  format: manifest.format,
  sourceRepository: 'cardstack/pretui',
  sourceRevision: manifest.sourceRevision,
  sourceRoots: manifest.sourceRoots,
  runtimeRoots: manifest.runtimeRoots,
  closure: closure.files,
  externals: closure.externals,
  transforms: [
    'controls-known-date.gts: ./controls -> ./known-date-input',
    'pretui-component.gts: narrowed catalog card for Known Date',
    'demo-controls-known-date.gts: narrowed deterministic catalog demo',
  ],
};

const knownDateInput = `
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

interface InputSignature {
  Element: HTMLInputElement;
  Args: {
    controlId?: string;
    value?: string;
    placeholder?: string;
    invalid?: boolean;
    disabled?: boolean;
    onInput?: (value: string) => void;
  };
}

export class Input extends Component<InputSignature> {
  handleInput = (event: Event) => {
    this.args.onInput?.((event.target as HTMLInputElement).value);
  };

  <template>
    <input
      id={{@controlId}}
      class='known-date-input'
      value={{@value}}
      placeholder={{@placeholder}}
      aria-invalid={{if @invalid 'true'}}
      disabled={{@disabled}}
      {{on 'input' this.handleInput}}
      ...attributes
    />
    <style scoped>
      .known-date-input {
        min-height: 2.5rem;
        padding: 0.45rem 0.65rem;
        border: 1px solid var(--input, #c8ccd4);
        border-radius: var(--radius, 0.625rem);
        background: var(--field, #fff);
        color: var(--foreground, #292731);
        font: inherit;
      }
      .known-date-input:focus-visible {
        outline: 0.1875rem solid color-mix(in srgb, var(--primary, #00a884) 30%, transparent);
        border-color: var(--primary, #00a884);
      }
      .known-date-input[aria-invalid='true'] {
        border-color: var(--destructive, #d43f4c);
      }
    </style>
  </template>
}
`.trimStart();

const knownDateDemo = `
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { KnownDate, type KnownDateResult } from './controls-known-date.gts';

export class KnownDateDemo extends Component {
  @tracked selected = '1990-04-15';
  @tracked verdict = 'Ready for a known date';

  update = (iso: string | undefined, result: KnownDateResult) => {
    this.selected = iso ?? '';
    this.verdict = iso
      ? 'Accepted as ' + iso
      : result.empty
        ? 'Ready for a known date'
        : result.issue ?? 'Keep typing';
  };

  <template>
    <section class='known-date-demo'>
      <header>
        <span class='eyebrow'>PRETUI · INPUTS · 0.4.0</span>
        <h1>A date somebody already knows.</h1>
        <p>Type a birthday, issue date, or expiry without paging through a calendar.</p>
      </header>
      <div class='stage'>
        <KnownDate
          @label='When was the lot harvested?'
          @hint='Try 27 3 2007, March, or paste 2007-03-27 into any box.'
          @locale='en-GB'
          @reference='2026-08-23'
          @value='1990-04-15'
          @min='1900-01-01'
          @max='2099-12-31'
          @onChange={{this.update}}
        />
      </div>
      <footer>
        <span>Deterministic reference</span>
        <strong>{{this.verdict}}</strong>
      </footer>
    </section>
    <style scoped>
      .known-date-demo { --primary: #00a884; --foreground: #272330; --field: #fff; display: grid; gap: 1.5rem; max-width: 46rem; padding: 2rem; border: 1px solid #dedde3; border-radius: 1.25rem; background: linear-gradient(145deg, #fbfbf8, #f2f6f3); color: var(--foreground); box-shadow: 0 1.25rem 3rem rgb(39 35 48 / 10%); font-family: 'IBM Plex Sans', system-ui, sans-serif; }
      header { display: grid; gap: .4rem; } .eyebrow { color: #007c63; font: 700 .7rem/1.2 ui-monospace, monospace; letter-spacing: .12em; } h1 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.5rem); letter-spacing: -.04em; } p { max-width: 36rem; margin: 0; color: #67636f; line-height: 1.55; }
      .stage { padding: 1.5rem; border-radius: 1rem; background: rgb(255 255 255 / 86%); box-shadow: inset 0 0 0 1px rgb(39 35 48 / 8%); }
      footer { display: flex; justify-content: space-between; gap: 1rem; padding-top: 1rem; border-top: 1px solid #dedde3; color: #76717d; font: .75rem/1.4 ui-monospace, monospace; } footer strong { color: #007c63; text-align: right; }
    </style>
  </template>
}
`.trimStart();

const pretuiComponent = `
import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { KnownDateDemo } from './known-date-demo.gts';

export class PretuiComponent extends CardDef {
  static displayName = 'PretUI Component';
  @field componentName = contains(StringField);
  @field category = contains(StringField);
  @field tier = contains(StringField);
  @field brief = contains(StringField);
  @field version = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template><KnownDateDemo /></template>
  };
}
`.trimStart();

let generated = new Map<string, Buffer>([
  ['package.json', Buffer.from(`${JSON.stringify(packageJSON, null, 2)}\n`)],
  ['importmap.json', Buffer.from(`${JSON.stringify(importMap, null, 2)}\n`)],
  [
    '.deck-source.json',
    Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
  ],
  ['known-date-input.gts', Buffer.from(knownDateInput)],
  ['known-date-demo.gts', Buffer.from(knownDateDemo)],
  ['pretui-component.gts', Buffer.from(pretuiComponent)],
]);
for (let path of closure.files) {
  let bytes = await readFile(join(sourceDir, path));
  if (path === 'controls-known-date.gts') {
    bytes = Buffer.from(
      bytes
        .toString()
        .replace("from './controls';", "from './known-date-input.gts';"),
    );
  }
  generated.set(path, bytes);
}
for (let path of manifest.sourceRoots) {
  generated.set(`_source/${path}`, await readFile(join(sourceDir, path)));
}

for (let [path, bytes] of generated) {
  let destination = join(realmDir, ...path.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

let packBytes = pack(
  [...generated].map(([path, bytes]) => ({ path, bytes })),
  {
    sourceDepot: `git+https://github.com/cardstack/pretui.git#${manifest.sourceRevision}`,
    sourceBase: `https://github.com/cardstack/pretui/tree/${manifest.sourceRevision}/`,
    package: manifest.packageName.slice(1),
    version: manifest.version,
    mode: 'bare',
    toolchain: { fixture: manifest.format },
  },
);
let { treeHash } = unpack(packBytes);
let packageName = manifest.packageName.slice(1);
let storeDir = join(realmDir, '.deck', 'store');
let existing = (await readStoreMeta(storeDir, packageName))?.versions[
  manifest.version
];
if (existing && existing.treeHash !== treeHash) {
  throw new Error(
    `${manifest.packageName}@${manifest.version} already names ${existing.treeHash}, not ${treeHash}`,
  );
}
let versionRecord =
  existing ??
  (await publishToStore(storeDir, packageName, manifest.version, packBytes, {
    tag: 'latest',
    now: new Date('2026-08-23T00:00:00.000Z'),
  }));
let versionIndex = await buildDeckVersionIndex({
  realmDir,
  packageName,
  version: manifest.version,
});
let packageRRI = `${manifest.packageName}/`;
let policy = deckCollaborationPolicyFromEnvironment();
let protocol = openDeckRepositoryProtocol({
  realmDir,
  realmRRI: packageRRI,
  policy,
});
let config = repositoryManifest({
  roots: [packageRRI],
  members: { [packageRRI]: '.' },
});
if (!(await readRepositoryConfig(realmDir))) {
  await writeRepositoryConfig(realmDir, config);
}
let main = await readBranchHead(realmDir, 'main');
let checkpointHash = main?.latestCheckpointHash;
if (!checkpointHash) {
  checkpointHash = (
    await captureRepositoryCheckpoint({
      realmDir,
      config,
      branch: 'main',
      historyHead: `history:${hashBytes(Buffer.from(`pretui-known-date:${manifest.version}`)).slice(0, 24)}`,
      indexGenerationHash: versionIndex.indexHash,
      message: `Publish ${manifest.packageName}@${manifest.version}`,
      author: { id: '@fixture:boxel.test', name: 'PretUI Fixture' },
      createdAt: '2026-08-23T00:00:00.000Z',
    })
  ).checkpointHash;
}
let origin = await protocol.recordVersionOrigin({
  versionRRI: `${manifest.packageName}@${manifest.version}/`,
  checkpointHash,
  treeHash: versionRecord.treeHash,
  indexHash: versionIndex.indexHash,
});

console.log(
  JSON.stringify(
    {
      packageRRI: `${manifest.packageName}@${manifest.version}/`,
      treeHash: versionRecord.treeHash,
      indexHash: versionIndex.indexHash,
      checkpointHash: origin.checkpointHash,
      cards: versionIndex.cards.map((card) => card.rri),
      roots: manifest.sourceRoots,
      files: closure.files.length,
      externals: closure.externals,
    },
    null,
    2,
  ),
);
