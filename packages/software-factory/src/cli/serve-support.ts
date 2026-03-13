// @ts-nocheck
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFactoryGlobalContext } from '../harness.ts';
import {
  defaultSupportMetadataFile,
  sharedRuntimeDir,
} from '../runtime-metadata.ts';

let realmDir = resolve(process.cwd(), process.argv[2] ?? 'demo-realm');
let metadataFile =
  process.env.SOFTWARE_FACTORY_METADATA_FILE ?? defaultSupportMetadataFile;

try {
  let support = await startFactoryGlobalContext({ realmDir });

  let payload = {
    realmDir,
    context: support.context,
  };

  mkdirSync(sharedRuntimeDir, { recursive: true });
  writeFileSync(metadataFile, JSON.stringify(payload, null, 2));

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
