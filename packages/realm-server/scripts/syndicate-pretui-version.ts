import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

import {
  hashBytes,
  readStoreMeta,
  readStoredPack,
  treeHashFromEntries,
  unpack,
} from '@cardstack/deck/node';
import { format, type Plugin } from 'prettier';

import { deckCollaborationPolicyFromEnvironment } from '../handlers/serve-deck-version.ts';
import { buildDeckVersionIndex } from '../lib/deck-version-index.ts';

const MAPPING_VERSION = 'pretui-boxel-workspace-v1';
const require = createRequire(import.meta.url);
const emberTemplateTag =
  require('prettier-plugin-ember-template-tag') as Plugin;
const GENERATED_FILES = [
  'controls-known-date.gts',
  'known-date-demo.gts',
  'known-date-input.gts',
] as const;

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function posixPath(path: string): string {
  return path.split('\\').join('/');
}

async function listFiles(root: string, current = root): Promise<string[]> {
  let output: string[] = [];
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return output;
  }
  for (let entry of entries) {
    if (entry.name === 'node_modules') {
      continue;
    }
    let absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFiles(root, absolute)));
    } else if (entry.isFile()) {
      output.push(posixPath(relative(root, absolute)));
    }
  }
  return output.sort();
}

async function writeOrCheck(
  targetDir: string,
  outputs: Map<string, Buffer>,
  check: boolean,
): Promise<void> {
  if (check) {
    let actualPaths = await listFiles(targetDir);
    let expectedPaths = [...outputs.keys()].sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      throw new Error(
        `syndicated file list drift\nexpected: ${expectedPaths.join(', ')}\nactual: ${actualPaths.join(', ')}`,
      );
    }
    for (let [path, expected] of outputs) {
      let actual = await readFile(join(targetDir, ...path.split('/')));
      if (!actual.equals(expected)) {
        throw new Error(`syndicated file drift: ${path}`);
      }
    }
    return;
  }
  let existing = await listFiles(targetDir);
  let expected = new Set(outputs.keys());
  let unknown = existing.filter((path) => !expected.has(path));
  if (unknown.length > 0) {
    throw new Error(
      `refusing to overwrite a non-generated PretUI package: ${unknown.join(', ')}`,
    );
  }
  for (let [path, bytes] of outputs) {
    let destination = join(targetDir, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}

let args = process.argv.slice(2);
let check = args.includes('--check');
args = args.filter((arg) => arg !== '--' && arg !== '--check');
let [realmDirArg, version = '0.4.0', targetDirArg] = args;
if (!realmDirArg || !targetDirArg) {
  throw new Error(
    'usage: tsx scripts/syndicate-pretui-version.ts <realm-dir> [version] <target-dir> [--check]',
  );
}

let realmDir = resolve(realmDirArg);
let targetDir = resolve(targetDirArg);
let packageName = 'cardstack/pretui';
let packageRRI = `@${packageName}/`;
let policy = deckCollaborationPolicyFromEnvironment();
if (!policy.enabled || !policy.realmRRIs.has(packageRRI)) {
  throw new Error(
    `Deck collaboration is not enabled for ${packageRRI}; set the operator flag and exact realm-RRI allowlist`,
  );
}
let storeDir = join(realmDir, '.deck', 'store');
let meta = await readStoreMeta(storeDir, packageName);
let record = meta?.versions[version];
let packBytes = await readStoredPack(storeDir, packageName, version);
if (!record || !packBytes) {
  throw new Error(`@cardstack/pretui@${version}/ is not in ${storeDir}`);
}
let { files, treeHash } = unpack(packBytes);
if (treeHash !== record.treeHash) {
  throw new Error('stored PretUI Version tree does not match its metadata');
}
let sourceIndex = await buildDeckVersionIndex({
  realmDir,
  packageName,
  version,
});
let outputs = new Map<string, Buffer>();
for (let path of GENERATED_FILES) {
  let bytes = files.get(path);
  if (!bytes) {
    throw new Error(`PretUI Version is missing syndication input ${path}`);
  }
  outputs.set(`src/${path}`, bytes);
}
outputs.set(
  'src/index.ts',
  Buffer.from(
    "export * from './controls-known-date.gts';\nexport * from './known-date-demo.gts';\n",
  ),
);
for (let [path, bytes] of outputs) {
  let source = bytes.toString();
  if (path === 'src/controls-known-date.gts') {
    source = source.replace(
      '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the\n' +
        '    // Glimmer owner is opaque here; the base class types it internally.\n',
      '    // Glimmer owner is opaque here; the base class types it internally.\n',
    );
  }
  outputs.set(
    path,
    Buffer.from(
      await format(source, {
        filepath: path,
        plugins: [emberTemplateTag],
        singleQuote: true,
      }),
    ),
  );
}
outputs.set(
  'package.json',
  json({
    name: '@cardstack/pretui',
    version,
    private: true,
    type: 'module',
    exports: {
      '.': './src/index.ts',
      './known-date': './src/controls-known-date.gts',
      './known-date-demo': './src/known-date-demo.gts',
    },
    dependencies: {
      '@glimmer/component': '^2.0.0',
      '@glimmer/tracking': '^1.0.4',
      'ember-source': 'catalog:',
    },
    devDependencies: {
      '@cardstack/local-types': 'workspace:*',
      '@glint/ember-tsc': 'catalog:',
      '@tsconfig/ember': '3.0.1',
      '@typescript-eslint/eslint-plugin': 'catalog:',
      '@typescript-eslint/parser': 'catalog:',
      'ember-eslint-parser': '0.13.0',
      'ember-template-lint': 'catalog:',
      eslint: 'catalog:',
      'eslint-config-prettier': 'catalog:',
      'eslint-plugin-ember': 'catalog:',
      'eslint-plugin-prettier': 'catalog:',
      prettier: 'catalog:',
      typescript: 'catalog:',
    },
    scripts: {
      lint: 'pnpm lint:types && pnpm lint:js && pnpm lint:hbs',
      'lint:types': 'ember-tsc --noEmit',
      'lint:js': 'eslint . --report-unused-disable-directives',
      'lint:hbs': 'ember-template-lint .',
    },
    'ember-addon': { type: 'addon', version: 2 },
  }),
);
outputs.set(
  '.eslintrc.cjs',
  Buffer.from(`'use strict';

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    warnOnUnsupportedTypeScriptVersion: false,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  env: { browser: true },
  rules: {
    'no-undef': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['**/*.gts'],
      parser: 'ember-eslint-parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
        warnOnUnsupportedTypeScriptVersion: false,
      },
      plugins: ['ember', '@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:ember/recommended',
        'plugin:ember/recommended-gts',
        'plugin:prettier/recommended',
      ],
      rules: {
        'no-undef': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
`),
);
outputs.set(
  '.template-lintrc.cjs',
  Buffer.from(`'use strict';

module.exports = {
  extends: ['recommended'],
  rules: {
    'no-forbidden-elements': false,
  },
};
`),
);
outputs.set(
  'tsconfig.json',
  Buffer.from(`{
  "extends": "@tsconfig/ember/tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "experimentalDecorators": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "es2020",
    "types": ["@cardstack/local-types"]
  },
  "include": ["src/**/*"]
}
`),
);
outputs.set(
  'README.md',
  Buffer.from(
    '# @cardstack/pretui\n\nGenerated from an exact canonical Deck Version. Do not edit this subtree; change PretUI in its realm, publish a Version, then syndicate again.\n',
  ),
);
let generatedSourceHash = treeHashFromEntries(
  [...outputs].map(([path, bytes]) => ({ path, sha256: hashBytes(bytes) })),
).treeHash;
let lockBytes = files.get('importmap.json');
if (!lockBytes) {
  throw new Error('PretUI Version has no exact import-map lock');
}
outputs.set(
  'DECK_SOURCE.json',
  json({
    format: 'boxel-deck-syndication-v1',
    mappingVersion: MAPPING_VERSION,
    sourceVersionRRI: `@cardstack/pretui@${version}/`,
    sourceTreeHash: treeHash,
    sourceIndexHash: sourceIndex.indexHash,
    sourceLockHash: hashBytes(lockBytes),
    generatedSourceHash,
    checkpointHash: null,
    checkpointNote:
      'A6 predates the B0 Checkpoint adapter; exact Version, tree, index, and lock hashes are authoritative.',
  }),
);

await writeOrCheck(targetDir, outputs, check);
console.log(
  JSON.stringify(
    {
      mode: check ? 'verified' : 'syndicated',
      sourceVersionRRI: `@cardstack/pretui@${version}/`,
      sourceTreeHash: treeHash,
      sourceIndexHash: sourceIndex.indexHash,
      generatedSourceHash,
      targetDir,
    },
    null,
    2,
  ),
);
