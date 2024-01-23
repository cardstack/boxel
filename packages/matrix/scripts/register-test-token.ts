import { createRegistrationToken, loginUser } from '../docker/synapse';
import { adminUsername, adminPassword } from './register-test-user';

(async () => {
  let cred = await loginUser(adminUsername, adminPassword);
  await createRegistrationToken(cred.accessToken, 'dev-token');
})().catch((e) => console.error(`unexpected error`, e));
