import { synapseStart, synapseStop } from './docker/synapse';

(async () => {
  console.log('starting synapse');
  let instance = await synapseStart('default');
  await new Promise((res) => setTimeout(res, 60 * 1000));
  console.log('stopping synapse');
  await synapseStop(instance.synapseId);
})().catch((e) => console.error(`unexpected error`, e));
