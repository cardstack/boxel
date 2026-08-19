import * as childProcess from 'child_process';

import { loginUser } from '../support/synapse/index.ts';
import { ensureUserRecord } from '../helpers/ensure-user-record.ts';
import { getSynapseContainerName } from '../support/environment-config.ts';
export const adminUsername = 'admin';
export const adminPassword = 'password';

let username = process.env.MATRIX_USERNAME || adminUsername;
let password = process.env.MATRIX_PASSWORD || adminPassword;
let isAdmin = process.env.MATRIX_IS_ADMIN;

(async () => {
  return new Promise<string>((resolve, reject) => {
    const matrixUserId = username.startsWith('@')
      ? username
      : `@${username}:localhost`;
    const shouldEnsureUserRecord = isAdmin !== 'TRUE';
    const command = `docker exec ${getSynapseContainerName()} register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} ${
      isAdmin === 'TRUE' ? `--admin` : `--no-admin`
    }`;
    childProcess.exec(command, async (err, stdout) => {
      if (err) {
        if (stdout.includes('User ID already taken')) {
          let cred = await loginUser(username, password);
          if (!cred.userId) {
            reject(
              `User ${username} already exists in matrix, but the password does not match`,
            );
            return;
          } else {
            if (shouldEnsureUserRecord) {
              await ensureUserRecord(matrixUserId);
            }
            console.log(
              `User ${username} already exists in matrix and the password matches`,
            );
            resolve(`User already exists as ${cred.userId}`);
            return;
          }
        }
        reject(err);
      }
      if (shouldEnsureUserRecord) {
        await ensureUserRecord(matrixUserId);
      }
      console.log(stdout.trim());
      resolve(stdout.trim());
    });
  });
})().catch((e) => console.error(`unexpected error`, e));
