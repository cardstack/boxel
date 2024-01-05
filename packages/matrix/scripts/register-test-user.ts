import * as childProcess from 'child_process';


let username = process.env.USERNAME;
let password = process.env.PASSWORD;

(async () => {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(`docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} --no-admin`,
      (err, stdout) => {
        if (err && !stdout.includes('User ID already taken')) {
          reject(err);
        }
        console.log(stdout.trim());
        resolve(stdout.trim());
      });
  });
})().catch((e) => console.error(`unexpected error`, e));
