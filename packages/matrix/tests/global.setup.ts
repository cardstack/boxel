import {
  synapseStart,
  synapseStop,
  registerUser,
  createRegistrationToken,
} from '../docker/synapse';
import { startServer as startRealmServer } from '../helpers/isolated-realm-server';
import { registerRealmUsers, REGISTRATION_TOKEN } from '../helpers';
import { smtpStart, smtpStop } from '../docker/smtp4dev';

export default async function setup() {
  await smtpStart();
  const synapse = await synapseStart();
  await registerRealmUsers(synapse);
  let admin = await registerUser(synapse, 'admin', 'adminpass', true);
  await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
  const realmServer = await startRealmServer();
  process.env.MATRIX_TEST_CONTEXT = JSON.stringify({
    adminAccessToken: admin.accessToken,
    synapse,
    realmServerDb: realmServer.db,
  });
  return async () => {
    await synapseStop(synapse.synapseId);
    await realmServer.stop();
    await smtpStop();
  };
}
