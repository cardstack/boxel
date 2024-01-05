import * as childProcess from 'child_process';

export const adminUsername = 'admin';
export const adminPassword = 'password';

let username = process.env.USERNAME || adminUsername;
let password = process.env.PASSWORD || adminPassword;

(async () => {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(`docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} --no-admin`,
      (err, stdout) => {
        if (err) {
          reject(err);
        }
        console.log(stdout.trim());
        resolve(stdout.trim());
      });
  });
})().catch((e) => console.error(`unexpected error`, e));
