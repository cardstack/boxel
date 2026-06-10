import {
  createRegistrationToken,
  loginUser,
} from '../support/synapse/index.ts';
import { adminUsername, adminPassword } from './register-test-user.ts';

(async () => {
  let cred = await loginUser(adminUsername, adminPassword);
  await createRegistrationToken(cred.accessToken, 'dev-token');
})().catch((e) => console.error(`unexpected error`, e));
