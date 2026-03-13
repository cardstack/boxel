// @ts-nocheck
import { resolve } from 'node:path';

import { ensureFactoryRealmTemplate } from '../harness.ts';

let realmDir = resolve(process.cwd(), process.argv[2] ?? 'demo-realm');
try {
  let template = await ensureFactoryRealmTemplate({ realmDir });
  console.log(
    JSON.stringify(
      {
        realmDir,
        cacheKey: template.cacheKey,
        templateDatabaseName: template.templateDatabaseName,
        fixtureHash: template.fixtureHash,
        cacheHit: template.cacheHit,
      },
      null,
      2,
    ),
  );
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
