import { synapseStart, synapseStop } from '../docker/synapse';
import { startServer as startRealmServer } from '../helpers/isolated-realm-server';
import { registerRealmUsers } from '../helpers';

export default async function setup() {
  const synapse = await synapseStart();
  await registerRealmUsers(synapse);
  const realmServer = await startRealmServer();
  process.env.SYNAPSE = JSON.stringify(synapse);
  process.env.REALM_SERVER_DB = JSON.stringify(realmServer.db);
  return async () => {
    await synapseStop(synapse.synapseId);
    await realmServer.stop();
  };
}
