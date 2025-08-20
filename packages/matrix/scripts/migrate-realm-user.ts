import { loginUser, updateUser } from '../docker/synapse';

import { realmPassword } from '../helpers/realm-credentials';

let adminUser = process.env.ADMIN_USERNAME || 'admin';
let adminPassword = process.env.ADMIN_PASSWORD || 'password';
let matrixURL = process.env.MATRIX_URL;
let realmSecretSeed = process.env.REALM_SECRET_SEED;

if (!realmSecretSeed) {
  console.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const [realmUser] = process.argv.slice(2);
if (!realmUser) {
  console.error(`please specify the realm user to migrate`);
  process.exit(-1);
}

(async () => {
  let synapseInstance = {
    port: matrixURL ? matrixURL.split(':')[1] : 8008,
  } as any;
  let cred = await loginUser(synapseInstance, adminUser, adminPassword);
  if (!cred.userId) {
    console.error(
      `Incorrect admin credentials. Specify the matrix admin credentials in the ADMIN_USERNAME and ADMIN_PASSWORD environment variables`,
    );
    process.exit(-1);
  }
  let password = await realmPassword(realmUser, realmSecretSeed);
  await updateUser(synapseInstance, cred.accessToken, realmUser, { password });
  console.log(`completed migration of ${realmUser}`);
})().catch((e) => console.error(`unexpected error`, e));
