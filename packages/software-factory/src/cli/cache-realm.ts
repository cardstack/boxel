import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  ensureFactoryRealmTemplate,
  type FactoryRealmOptions,
} from '../harness';
import { readSupportContext } from '../runtime-metadata';

async function main(): Promise<void> {
  let realmDir = resolve(
    process.cwd(),
    process.argv[2] ?? 'test-fixtures/darkfactory-adopter',
  );
  let serializedSupportContext = process.env.SOFTWARE_FACTORY_CONTEXT;

  let supportContext: FactoryRealmOptions['context'] = serializedSupportContext
    ? (JSON.parse(serializedSupportContext) as FactoryRealmOptions['context'])
    : (readSupportContext() as FactoryRealmOptions['context']);

  let template = await ensureFactoryRealmTemplate({
    realmDir,
    context: supportContext,
  });
  let payload = {
    realmDir,
    cacheKey: template.cacheKey,
    templateDatabaseName: template.templateDatabaseName,
    fixtureHash: template.fixtureHash,
    cacheHit: template.cacheHit,
    realmURL: template.realmURL.href,
    realmServerURL: template.realmServerURL.href,
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
