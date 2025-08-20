import { createRegistrationToken, loginUser } from '../docker/synapse';
import { adminUsername, adminPassword } from './register-test-user';

(async () => {
  let synapseInstance = { port: 8008 } as any;
  let cred = await loginUser(synapseInstance, adminUsername, adminPassword);
  await createRegistrationToken(synapseInstance, cred.accessToken, 'dev-token');
})().catch((e) => console.error(`unexpected error`, e));
