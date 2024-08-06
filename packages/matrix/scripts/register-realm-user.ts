import * as childProcess from 'child_process';

import { loginUser } from '../docker/synapse';

import { realmPassword } from './realm-credentials';

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
  let password = await realmPassword(realmUser, realmSecretSeed);
  return new Promise<string>((resolve, reject) => {
    const command = `docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${realmUser} -p ${password} --no-admin`;
    childProcess.exec(command, async (err, stdout) => {
      if (err) {
        if (stdout.includes('User ID already taken')) {
          let cred = await loginUser(realmUser, password);
          if (!cred.userId) {
            reject(
              `User ${realmUser} already exists, but the password does not match. Use migrate-realm-user script to fix`,
            );
            return;
          } else {
            console.log(
              `User ${realmUser} already exists and the password matches`,
            );
            resolve(`User already exists as ${cred.userId}`);
            return;
          }
        }
        reject(err);
      }
      console.log(stdout.trim());
      resolve(stdout.trim());
    });
  });
})().catch((e) => console.error(`unexpected error`, e));
