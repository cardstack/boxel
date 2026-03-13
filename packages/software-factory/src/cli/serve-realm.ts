// @ts-nocheck
import { resolve } from 'node:path';

import { startFactoryRealmServer } from '../harness.ts';

let realmDir = resolve(process.cwd(), process.argv[2] ?? 'demo-realm');
try {
  let runtime = await startFactoryRealmServer({ realmDir });

  console.log(
    JSON.stringify(
      {
        realmDir,
        realmURL: runtime.realmURL.href,
        sampleCardURL: runtime.cardURL('person-1'),
      },
      null,
      2,
    ),
  );

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
