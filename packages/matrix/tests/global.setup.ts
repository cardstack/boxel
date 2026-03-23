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
  getEnvironmentSlug,
  deregisterServiceFromTraefik,
  setSynapseURL,
} from '../helpers/environment-config';

// Distinct service names so matrix tests don't overwrite dev services
const MATRIX_TEST_SYNAPSE_SERVICE = 'matrix-test';
const MATRIX_TEST_SMTP_SERVICE = 'smtp-test';

export default async function setup() {
  await smtpStart({ traefikServiceName: MATRIX_TEST_SMTP_SERVICE });
  const synapse = await synapseStart({
    traefikServiceName: MATRIX_TEST_SYNAPSE_SERVICE,
  });
  await registerRealmUsers(synapse);
  let admin = await registerUser(synapse, 'admin', 'adminpass', true);
  await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);

  const prerenderServer = await startPrerenderServer();
  // In environment mode the Synapse URL is routed through Traefik
  // using a test-specific service name; otherwise use the direct localhost port.
  const envMode = isEnvironmentMode();
  const matrixURL = envMode
    ? `http://${MATRIX_TEST_SYNAPSE_SERVICE}.${getEnvironmentSlug()}.localhost`
    : `http://localhost:${synapse.port}`;
  // Override so all Synapse API calls in synapse/index.ts use the test instance
  setSynapseURL(matrixURL);
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
    if (envMode) {
      deregisterServiceFromTraefik(MATRIX_TEST_SYNAPSE_SERVICE);
    }
    await realmServer.stop();
    await prerenderServer.stop();
    await smtpStop();
  };
}
