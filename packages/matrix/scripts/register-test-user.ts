import * as childProcess from 'child_process';

import { loginUser } from '../docker/synapse';

export const adminUsername = 'admin';
export const adminPassword = 'password';

let username = process.env.USERNAME || adminUsername;
let password = process.env.PASSWORD || adminPassword;

(async () => {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(
      `docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} --no-admin`,
      async (err, stdout) => {
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
      },
    );
  });
})().catch((e) => console.error(`unexpected error`, e));
