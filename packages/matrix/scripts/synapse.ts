import { synapseStart } from '../docker/synapse';
import { dockerStop } from '../docker';
import { resolve } from 'path';
import {
  getSynapseContainerName,
  deregisterSynapseFromTraefik,
} from '../helpers/branch-config';

const [command] = process.argv.slice(2);
let dataDir = process.env.SYNAPSE_DATA_DIR
  ? resolve(process.env.SYNAPSE_DATA_DIR)
  : undefined;
let containerName = getSynapseContainerName();
(async () => {
  if (command === 'start') {
    await synapseStart({
      template: 'dev',
      dataDir,
      containerName,
      suppressRegistrationSecretFile: true,
    });
  } else if (command === 'stop') {
    deregisterSynapseFromTraefik();
    await dockerStop({ containerId: containerName });
    console.log(`stopped container '${containerName}'`);
  } else {
    console.error(
      `Unknown command "${command}", available commands are "start" and "stop"`,
    );
    process.exit(1);
  }
})().catch((e) => console.error(`unexpected error`, e));
