// @ts-nocheck
import { resolve } from 'node:path';

import { fetchRealmCardJson } from '../harness.ts';

let realmDir = resolve(process.cwd(), process.argv[2] ?? 'demo-realm');
let cardPath = process.argv[3] ?? 'person-1';
try {
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
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
