import * as childProcess from 'child_process';


export const username = 'admin';
export const password = 'password';

(async () => {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(`docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} -a`,
      (err, stdout) => {
        if (err && !stdout.includes('User ID already taken')) {
          reject(err);
        }
        resolve(stdout.trim());
      });
  });
})().catch((e) => console.error(`unexpected error`, e));
