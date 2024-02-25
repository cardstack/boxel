import * as childProcess from 'child_process';

import { loginUser } from '../docker/synapse';

export const adminUsername = 'admin';
export const adminPassword = 'password';

let username = process.env.MATRIX_USERNAME || adminUsername;
let password = process.env.MATRIX_PASSWORD || adminPassword;

(async () => {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(
      `docker run --name synapse-admin -p 8080:80 -d awesometechnologies/synapse-admin && docker start synapse-admin`,
      async (err, stdout) => {
        console.log(stdout);
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
