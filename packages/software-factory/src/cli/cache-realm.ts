// @ts-nocheck
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ensureFactoryRealmTemplate } from '../harness.ts';
import { readSupportContext } from '../runtime-metadata.ts';

let realmDir = resolve(
  process.cwd(),
  process.argv[2] ?? 'test-fixtures/darkfactory-adopter',
);

let supportContext = process.env.SOFTWARE_FACTORY_CONTEXT
  ? JSON.parse(process.env.SOFTWARE_FACTORY_CONTEXT)
  : readSupportContext();

try {
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
  };
  if (process.env.SOFTWARE_FACTORY_METADATA_FILE) {
    writeFileSync(
      process.env.SOFTWARE_FACTORY_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
