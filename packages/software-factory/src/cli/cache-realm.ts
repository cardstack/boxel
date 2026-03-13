// @ts-nocheck
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ensureFactoryRealmTemplate } from '../harness.ts';

let realmDir = resolve(process.cwd(), process.argv[2] ?? 'demo-realm');
try {
  let template = await ensureFactoryRealmTemplate({ realmDir });
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
