import * as childProcess from 'child_process';

(async () => {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(
      `docker run --name synapse-admin -p 8080:80 -d awesometechnologies/synapse-admin && docker start synapse-admin`,
      async (err, stdout) => {
        console.log(stdout);
        if (err) {
          reject(err);
        }
        console.log(stdout.trim());
        resolve(stdout.trim());
      },
    );
  });
})().catch((e) => console.error(`unexpected error`, e));
