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
    templateRealmServerURL: process.env
      .SOFTWARE_FACTORY_TEMPLATE_REALM_SERVER_URL
      ? new URL(process.env.SOFTWARE_FACTORY_TEMPLATE_REALM_SERVER_URL)
      : undefined,
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
    await runtime.stop();
    cleanExit = true;
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
