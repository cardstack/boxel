import { resolve } from 'node:path';

import { fetchRealmCardJson } from '../harness';
import { readSupportContext } from '../runtime-metadata';

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
  console.log(
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
  console.error(error);
  process.exit(1);
});
