import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFactorySupportServices } from '../harness';
import { sharedRuntimeDir, writeSupportMetadata } from '../runtime-metadata';

async function main(): Promise<void> {
  let realmDir = resolve(
    process.cwd(),
    process.argv[2] ?? 'test-fixtures/darkfactory-adopter',
  );

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

  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
