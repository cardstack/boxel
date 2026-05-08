#!/usr/bin/env node
// Temporary shim for CS-10992: boxel-catalog still references some host
// commands and field names that were renamed from URL-flavored to
// identifier-flavored. This script rewrites the cloned `contents/` tree
// in place after catalog:setup / catalog:update / catalog:reset so the
// renamed surface resolves at load time.
//
// Edits are pinned to exact source spans so reruns are no-ops once the
// strings are gone, and unintended matches in unrelated code are
// impossible. Every edit must apply or the script fails loudly.
//
// Once the boxel-catalog PR landing the new surface is merged, delete
// this file and remove its invocation from package.json. Tracked by
// CS-11046.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'contents');

if (!existsSync(ROOT)) {
  console.log(`[rewrite-legacy-aliases] ${ROOT} not found, skipping.`);
  process.exit(0);
}

// Each entry is [relativePath, [[oldString, newString], ...]].
// The old strings include enough context to be unambiguous within the
// file. If `oldString` is missing AND `newString` is already present,
// the edit is a no-op (idempotent). If neither is present, that's a
// failure — the file diverged from what the script expects.
const REWRITES = [
  [
    'catalog-app/components/listing-fitted.gts',
    [
      [
        'realmMeta.url !== this.args.model[realmURL]?.href,',
        'realmMeta.realmIdentifier !== this.args.model[realmURL]?.href,',
      ],
      ['url: realmMeta.url,', 'url: realmMeta.realmIdentifier,'],
    ],
  ],
  [
    'catalog-app/listing/listing.gts',
    [
      [
        'realmMeta.url !== this.args.model[realmURL]?.href,',
        'realmMeta.realmIdentifier !== this.args.model[realmURL]?.href,',
      ],
      ['url: realmMeta.url,', 'url: realmMeta.realmIdentifier,'],
    ],
  ],
  [
    'commands/listing-create.ts',
    [
      [
        "import GetCatalogRealmUrlsCommand from '@cardstack/boxel-host/commands/get-catalog-realm-urls';",
        "import GetCatalogRealmIdentifiersCommand from '@cardstack/boxel-host/commands/get-catalog-realm-identifiers';",
      ],
      [
        "import GetRealmOfUrlCommand from '@cardstack/boxel-host/commands/get-realm-of-url';",
        "import GetRealmOfResourceIdentifierCommand from '@cardstack/boxel-host/commands/get-realm-of-resource-identifier';",
      ],
      [
        'const { urls } = await new GetCatalogRealmUrlsCommand(',
        'const { realmIdentifiers: urls } = await new GetCatalogRealmIdentifiersCommand(',
      ],
      [
        'const { moduleUrls } = await new SanitizeModuleListCommand(\n      this.commandContext,\n    ).execute({ moduleUrls: Array.from(modulesToCreate) });',
        'const { moduleIdentifiers: moduleUrls } = await new SanitizeModuleListCommand(\n      this.commandContext,\n    ).execute({ moduleIdentifiers: Array.from(modulesToCreate) });',
      ],
      [
        'const { realmUrl: resourceRealmUrl } = await new GetRealmOfUrlCommand(\n      this.commandContext,\n    ).execute({ url: resourceUrl });',
        'const { realmIdentifier: resourceRealmUrl } = await new GetRealmOfResourceIdentifierCommand(\n      this.commandContext,\n    ).execute({ resourceIdentifier: resourceUrl });',
      ],
    ],
  ],
  [
    'commands/listing-install.ts',
    [
      [
        'let { realmUrl } = await new ValidateRealmCommand(\n      this.commandContext,\n    ).execute({ realmUrl: realm });',
        'let { realmIdentifier: realmUrl } = await new ValidateRealmCommand(\n      this.commandContext,\n    ).execute({ realmIdentifier: realm });',
      ],
      [
        '.execute({ url: sourceCard.id });',
        '.execute({ cardIdentifier: sourceCard.id });',
      ],
      [
        '.execute({ realmUrl, operations }));',
        '.execute({ realmIdentifier: realmUrl, operations }));',
      ],
    ],
  ],
  [
    'commands/listing-use.ts',
    [
      [
        'let { realmUrl } = await new ValidateRealmCommand(\n      this.commandContext,\n    ).execute({ realmUrl: realm });',
        'let { realmIdentifier: realmUrl } = await new ValidateRealmCommand(\n      this.commandContext,\n    ).execute({ realmIdentifier: realm });',
      ],
    ],
  ],
  [
    'commands/listing-remix.ts',
    [
      [
        'let { realmUrl } = await new ValidateRealmCommand(\n      this.commandContext,\n    ).execute({ realmUrl: realm });',
        'let { realmIdentifier: realmUrl } = await new ValidateRealmCommand(\n      this.commandContext,\n    ).execute({ realmIdentifier: realm });',
      ],
    ],
  ],
  [
    'commands/listing-update-specs.ts',
    [
      [
        'const { moduleUrls } = await new SanitizeModuleListCommand(\n      this.commandContext,\n    ).execute({ moduleUrls: deps });',
        'const { moduleIdentifiers: moduleUrls } = await new SanitizeModuleListCommand(\n      this.commandContext,\n    ).execute({ moduleIdentifiers: deps });',
      ],
    ],
  ],
  [
    'commands/collect-submission-files.ts',
    [
      [
        'let binary = await readBinaryFileCommand.execute({\n            url: thumbnailUrl,\n          });',
        'let binary = await readBinaryFileCommand.execute({\n            fileIdentifier: thumbnailUrl,\n          });',
      ],
      [
        'let binary = await readBinaryFileCommand.execute({ url: fileDefUrl });',
        'let binary = await readBinaryFileCommand.execute({ fileIdentifier: fileDefUrl });',
      ],
    ],
  ],
];

let totalEdits = 0;
let touchedFiles = 0;
let errors = [];

for (let [relPath, edits] of REWRITES) {
  let path = join(ROOT, relPath);
  if (!existsSync(path)) {
    errors.push(`missing file: ${relPath}`);
    continue;
  }
  let original = await readFile(path, 'utf8');
  let updated = original;
  let edited = false;
  for (let [oldStr, newStr] of edits) {
    if (updated.includes(oldStr)) {
      updated = updated.split(oldStr).join(newStr);
      edited = true;
      totalEdits += 1;
    } else if (!updated.includes(newStr)) {
      errors.push(
        `${relPath}: neither old nor new form found for edit:\n  old: ${JSON.stringify(oldStr.slice(0, 80))}...`,
      );
    }
    // else: already rewritten — idempotent re-run
  }
  if (edited) {
    await writeFile(path, updated);
    touchedFiles += 1;
    console.log(`  rewrote ${relPath}`);
  }
}

if (errors.length) {
  console.error('[rewrite-legacy-aliases] errors:');
  for (let e of errors) console.error('  ' + e);
  process.exit(1);
}

console.log(
  `[rewrite-legacy-aliases] applied ${totalEdits} edit${totalEdits === 1 ? '' : 's'} across ${touchedFiles} file${touchedFiles === 1 ? '' : 's'}.`,
);
