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
  getSynapseContainerName,
  registerServiceWithTraefik,
  setSynapseURL,
} from '../helpers/environment-config';

// The test Synapse MUST overwrite the dev 'matrix' Traefik route because
// Playwright's page.route cannot intercept WebSocket connections. The Ember
// app's Matrix client uses WebSockets, so it must connect to the test Synapse
// at the same hostname the Ember config expects (matrix.*.localhost).
// The dev Synapse container stays running; only the Traefik route is swapped.
// Teardown restores the dev route.
const MATRIX_TEST_SYNAPSE_SERVICE = 'matrix';
const MATRIX_TEST_SMTP_SERVICE = 'smtp-test';

export default async function setup() {
  const envMode = isEnvironmentMode();

  // Save the dev Synapse's port so we can restore the Traefik route in teardown
  let devSynapsePort: number | undefined;
  if (envMode) {
    try {
      let { execSync } = await import('child_process');
      let output = execSync(
        `docker port ${getSynapseContainerName()} 8008/tcp`,
        { encoding: 'utf-8' },
      ).trim();
      devSynapsePort = parseInt(output.split('\n')[0].split(':').pop()!, 10);
    } catch {
      // Dev Synapse not running — nothing to restore
    }
  }

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

  // Wait for the test Synapse to be reachable through Traefik before registering users
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
    // Restore the dev Synapse's Traefik route (the test Synapse overwrote it)
    if (envMode && devSynapsePort) {
      registerServiceWithTraefik('matrix', devSynapsePort);
      console.log(`Restored dev Synapse route (port ${devSynapsePort})`);
    }
    await realmServer.stop();
    await prerenderServer.stop();
    await smtpStop();
  };
}
