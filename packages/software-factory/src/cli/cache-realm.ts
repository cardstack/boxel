import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  ensureFactoryRealmTemplate,
  type FactoryRealmOptions,
} from '../harness';
import { readSupportContext } from '../runtime-metadata';

async function main(): Promise<void> {
  let realmDirs = [
    ...new Set(
      (process.argv.slice(2).length > 0
        ? process.argv.slice(2)
        : ['test-fixtures/darkfactory-adopter']
      ).map((realmDir) => resolve(process.cwd(), realmDir)),
    ),
  ];
  let serializedSupportContext = process.env.SOFTWARE_FACTORY_CONTEXT;

  let supportContext: FactoryRealmOptions['context'] = serializedSupportContext
    ? (JSON.parse(serializedSupportContext) as FactoryRealmOptions['context'])
    : (readSupportContext() as FactoryRealmOptions['context']);

  let preparedTemplates = [];
  for (let realmDir of realmDirs) {
    let template = await ensureFactoryRealmTemplate({
      realmDir,
      context: supportContext,
    });
    preparedTemplates.push({
      realmDir,
      cacheKey: template.cacheKey,
      templateDatabaseName: template.templateDatabaseName,
      fixtureHash: template.fixtureHash,
      cacheHit: template.cacheHit,
      cacheMissReason: template.cacheMissReason,
      realmURL: template.realmURL.href,
      realmServerURL: template.realmServerURL.href,
    });
  }
  let primaryTemplate = preparedTemplates[0];
  let payload = {
    realmDir: primaryTemplate.realmDir,
    cacheKey: primaryTemplate.cacheKey,
    templateDatabaseName: primaryTemplate.templateDatabaseName,
    fixtureHash: primaryTemplate.fixtureHash,
    cacheHit: primaryTemplate.cacheHit,
    cacheMissReason: primaryTemplate.cacheMissReason,
    realmURL: primaryTemplate.realmURL,
    realmServerURL: primaryTemplate.realmServerURL,
    preparedTemplates: preparedTemplates.map((template) => ({
      realmDir: template.realmDir,
      templateDatabaseName: template.templateDatabaseName,
      templateRealmURL: template.realmURL,
      templateRealmServerURL: template.realmServerURL,
      cacheHit: template.cacheHit,
      cacheMissReason: template.cacheMissReason,
    })),
  };
  if (process.env.SOFTWARE_FACTORY_METADATA_FILE) {
    mkdirSync(dirname(process.env.SOFTWARE_FACTORY_METADATA_FILE), {
      recursive: true,
    });
    writeFileSync(
      process.env.SOFTWARE_FACTORY_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
