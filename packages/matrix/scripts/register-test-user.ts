import * as childProcess from 'child_process';

import { loginUser } from '../docker/synapse';
export const adminUsername = 'admin';
export const adminPassword = 'password';

let username = process.env.MATRIX_USERNAME || adminUsername;
let password = process.env.MATRIX_PASSWORD || adminPassword;
let isAdmin = process.env.MATRIX_IS_ADMIN;

(async () => {
  return new Promise<string>((resolve, reject) => {
    const command = `docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} ${
      isAdmin === 'TRUE' ? `--admin` : `--no-admin`
    }`;
    childProcess.exec(command, async (err, stdout) => {
      if (err) {
        if (stdout.includes('User ID already taken')) {
          let cred = await loginUser(username, password);
          if (!cred.userId) {
            reject(
              `User ${username} already exists, but the password does not match`,
            );
            return;
          } else {
            console.log(
              `User ${username} already exists and the password matches`,
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
