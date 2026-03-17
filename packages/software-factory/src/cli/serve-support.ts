import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFactorySupportServices } from '../harness';
import { sharedRuntimeDir, writeSupportMetadata } from '../runtime-metadata';

let realmDir = resolve(
  process.cwd(),
  process.argv[2] ?? 'test-fixtures/darkfactory-adopter',
);

try {
  let support = await startFactorySupportServices();

  let payload = {
    realmDir,
    context: support.context,
  };

  mkdirSync(sharedRuntimeDir, { recursive: true });
  writeSupportMetadata(payload);

  console.log(JSON.stringify(payload, null, 2));

  let stop = async () => {
    await support.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  console.error(error);
  process.exit(1);
}
