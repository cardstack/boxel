import { synapseStart } from '../docker/synapse';
import { dockerStop } from '../docker';
import { resolve } from 'path';

const [command] = process.argv.slice(2);
let dataDir = process.env.SYNAPSE_DATA_DIR
  ? resolve(process.env.SYNAPSE_DATA_DIR)
  : undefined;
(async () => {
  if (command === 'start') {
    await synapseStart({ template: 'dev', dataDir });
  } else if (command === 'stop') {
    await dockerStop({ containerId: 'boxel-synapse' });
    console.log(`stopped container 'boxel-synapse'`);
  } else {
    console.error(
      `Unknown command "${command}", available commands are "start" and "stop"`
    );
    process.exit(1);
  }
})().catch((e) => console.error(`unexpected error`, e));
