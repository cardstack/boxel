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

// Separate service names so test infrastructure doesn't collide with the dev
// stack. The isolated realm server rewrites the Ember config's matrixURL in
// its index.html response (see server.ts retrieveIndexHTML), so the browser
// connects to matrix-test.*.localhost automatically.
const MATRIX_TEST_SYNAPSE_SERVICE = 'matrix-test';
const MATRIX_TEST_SMTP_SERVICE = 'smtp-test';

export default async function setup() {
  const envMode = isEnvironmentMode();

  await smtpStart({ traefikServiceName: MATRIX_TEST_SMTP_SERVICE });
  const synapse = await synapseStart(
    {
      traefikServiceName: MATRIX_TEST_SYNAPSE_SERVICE,
      // Use a separate container so the dev Synapse keeps running
      ...(envMode
        ? { containerName: `boxel-synapse-test-${getEnvironmentSlug()}` }
        : {}),
    },
    // In env mode, don't stop the dev Synapse
    !envMode,
  );

  // In env mode, override getSynapseURL() BEFORE registering users so all
  // Synapse API calls (registerUser, createRegistrationToken, loginUser)
  // hit the test Synapse, not the dev Synapse.
  const matrixURL = envMode
    ? `http://${MATRIX_TEST_SYNAPSE_SERVICE}.${getEnvironmentSlug()}.localhost`
    : `http://localhost:${synapse.port}`;
  setSynapseURL(matrixURL);

  // Wait for the test Synapse to be reachable through Traefik
  if (envMode) {
    let start = Date.now();
    while (Date.now() - start < 30_000) {
      try {
        let res = await fetch(`${matrixURL}/health`);
        if (res.ok) break;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  await registerRealmUsers(synapse);
  let admin = await registerUser(synapse, 'admin', 'adminpass', true);
  await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);

  // In env mode, wait for the host app before starting the realm server —
  // the realm server fetches index.html from distURL on boot and exits if
  // it's not available.
  if (envMode) {
    let hostUrl = `http://host.${getEnvironmentSlug()}.localhost`;
    let start = Date.now();
    let ready = false;
    while (Date.now() - start < 60_000) {
      try {
        let res = await fetch(hostUrl);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
      throw new Error(
        `Host app at ${hostUrl} not available after 60s. Is the dev stack running? (BOXEL_ENVIRONMENT=${process.env.BOXEL_ENVIRONMENT} mise run dev-all)`,
      );
    }
  }

  const prerenderServer = await startPrerenderServer();
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
