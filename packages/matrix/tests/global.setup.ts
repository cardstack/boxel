import {
  synapseStart,
  synapseStop,
  registerUser,
  createRegistrationToken,
} from '../docker/synapse';
import {
  startServer as startRealmServer,
  startPrerenderServer,
} from '../helpers/isolated-realm-server';
import type { IsolatedRealmServer } from '../helpers/isolated-realm-server';
import { registerRealmUsers, REGISTRATION_TOKEN } from '../helpers';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  isEnvironmentMode,
  getSynapseURL,
  deregisterSynapseFromTraefik,
} from '../helpers/environment-config';

export default async function setup() {
  await smtpStart();
  const synapse = await synapseStart();
  await registerRealmUsers(synapse);
  let admin = await registerUser(synapse, 'admin', 'adminpass', true);
  await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
  const prerenderServer = await startPrerenderServer();
  // In environment mode the Synapse URL is routed through Traefik;
  // otherwise use the direct localhost port.
  const matrixURL = isEnvironmentMode()
    ? getSynapseURL()
    : `http://localhost:${synapse.port}`;
  let realmServer: IsolatedRealmServer;
  try {
    realmServer = await startRealmServer({
      synapse,
      prerenderURL: prerenderServer.url,
    });
  } catch (err) {
    await prerenderServer.stop();
    throw err;
  }
  process.env.MATRIX_TEST_CONTEXT = JSON.stringify({
    adminAccessToken: admin.accessToken,
    synapse,
    realmServerDb: realmServer.db,
    matrixUrl: matrixURL,
    prerenderUrl: prerenderServer.url,
  });
  return async () => {
    await synapseStop(synapse.synapseId);
    deregisterSynapseFromTraefik();
    await realmServer.stop();
    await prerenderServer.stop();
    await smtpStop();
  };
}
