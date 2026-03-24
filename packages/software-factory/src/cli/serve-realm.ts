import { readSupportContext } from '../runtime-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFactoryRealmServer } from '../harness';

async function main(): Promise<void> {
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

  let runtime = await startFactoryRealmServer({
    realmDir,
    templateDatabaseName: process.env.SOFTWARE_FACTORY_TEMPLATE_DATABASE_NAME,
  });

  let payload = {
    realmDir,
    realmURL: runtime.realmURL.href,
    realmServerURL: runtime.realmServerURL.href,
    databaseName: runtime.databaseName,
    ports: runtime.ports,
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

  let cleanExit = false;
  let keepAlive = setInterval(() => {}, 60_000);
  process.on('exit', () => {
    if (!cleanExit) {
      for (let pid of runtime.childPids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already dead
        }
      }
    }
  });

  let stop = async () => {
    clearInterval(keepAlive);
    await runtime.stop();
    cleanExit = true;
    process.exit(0);
  };

  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  // Keep the harness process alive so its managed children stay attached until
  // the test fixture explicitly shuts the stack down.
  await new Promise<void>(() => {});
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
