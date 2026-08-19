import {
  synapseStart,
  synapseStop,
  registerUser,
  createRegistrationToken,
} from '../support/synapse/index.ts';
import {
  startServer as startRealmServer,
  startPrerenderServer,
} from '../support/isolated-realm-server.ts';
import type { IsolatedRealmServer } from '../support/isolated-realm-server.ts';
import { registerRealmUsers, REGISTRATION_TOKEN } from '../helpers/index.ts';
import { smtpStart, smtpStop } from '../docker/smtp4dev.ts';
import {
  mockOauth2Start,
  mockOauth2Stop,
  MOCK_OAUTH2_ISSUER,
} from '../docker/mock-oauth2.ts';

export default async function setup() {
  await smtpStart();
  // Start the mock OIDC provider before Synapse and expose its issuer, so
  // cfgDirFromTemplate keeps the Google OIDC block (gated on MOCK_OAUTH2_ISSUER)
  // when it generates homeserver.yaml.
  await mockOauth2Start();
  process.env.MOCK_OAUTH2_ISSUER = MOCK_OAUTH2_ISSUER;
  const synapse = await synapseStart();
  await registerRealmUsers(synapse);
  let admin = await registerUser(synapse, 'admin', 'adminpass', true);
  await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
  const prerenderServer = await startPrerenderServer();
  const matrixURL = `http://localhost:${synapse.port}`;
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
    await realmServer.stop();
    await prerenderServer.stop();
    await smtpStop();
    await mockOauth2Stop();
  };
}
