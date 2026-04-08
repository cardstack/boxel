// This should be first
import '../setup-logger';

import { resolve } from 'node:path';

import { fetchRealmCardJson } from '../harness';
import { readSupportContext } from '../runtime-metadata';
import { logger } from '../logger';

let log = logger('smoke-realm');

async function main(): Promise<void> {
  let realmDir = resolve(
    process.cwd(),
    process.argv[2] ?? 'test-fixtures/darkfactory-adopter',
  );
  let cardPath = process.argv[3] ?? 'project-demo';

  if (!process.env.SOFTWARE_FACTORY_CONTEXT) {
    let supportContext = readSupportContext();
    if (supportContext) {
      process.env.SOFTWARE_FACTORY_CONTEXT = JSON.stringify(supportContext);
    }
  }

  let response = await fetchRealmCardJson(cardPath, { realmDir });
  log.info(
    JSON.stringify(
      {
        realmDir,
        cardPath,
        status: response.status,
        url: response.url,
        body: JSON.parse(response.body),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  log.error(String(error));
  process.exit(1);
});
