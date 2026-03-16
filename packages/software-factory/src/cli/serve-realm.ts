// @ts-nocheck
import { readSupportContext } from '../runtime-metadata.ts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFactoryRealmServer } from '../harness.ts';

let realmDir = resolve(
  process.cwd(),
  process.argv[2] ?? 'test-fixtures/darkfactory-adopter',
);

if (!process.env.SOFTWARE_FACTORY_CONTEXT) {
  let supportContext = readSupportContext();
  if (supportContext) {
    process.env.SOFTWARE_FACTORY_CONTEXT = JSON.stringify(supportContext);
  }
}

try {
  let runtime = await startFactoryRealmServer({
    realmDir,
    templateDatabaseName: process.env.SOFTWARE_FACTORY_TEMPLATE_DATABASE_NAME,
  });

  let payload = {
    realmDir,
    realmURL: runtime.realmURL.href,
    databaseName: runtime.databaseName,
    sampleCardURL: runtime.cardURL('project-demo'),
    ownerBearerToken: runtime.createBearerToken(),
  };

  if (process.env.SOFTWARE_FACTORY_METADATA_FILE) {
    writeFileSync(
      process.env.SOFTWARE_FACTORY_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }

  console.log(JSON.stringify(payload, null, 2));

  let stop = async () => {
    await runtime.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  console.error(error);
  process.exit(1);
}
