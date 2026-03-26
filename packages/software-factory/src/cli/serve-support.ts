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
  };

  await new Promise<void>((resolve, reject) => {
    let handleSignal = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      void stop().then(resolve).catch(reject);
    };
    let onSigint = () => handleSignal();
    let onSigterm = () => handleSignal();
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
