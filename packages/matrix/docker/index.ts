import * as os from 'os';
import * as childProcess from 'child_process';
import * as fse from 'fs-extra';

function dockerPull(
  image: string,
  retries = 3,
  delayMs = 5000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let attempt = 0;
    function tryPull() {
      attempt++;
      childProcess.execFile(
        'docker',
        ['pull', image],
        { encoding: 'utf8' },
        (err, _stdout, stderr) => {
          if (!err) {
            resolve();
            return;
          }
          if (attempt < retries) {
            console.log(
              `docker pull ${image} failed (attempt ${attempt}/${retries}): ${stderr.trim()}. Retrying in ${delayMs / 1000}s...`,
            );
            setTimeout(tryPull, delayMs);
          } else {
            reject(
              new Error(
                `docker pull ${image} failed after ${retries} attempts: ${err.message}`,
              ),
            );
          }
        },
      );
    }
    tryPull();
  });
}

export async function dockerRun(args: {
  image: string;
  containerName: string;
  dockerParams?: string[];
  applicationParams?: string[];
  runAsUser?: true;
}): Promise<string> {
  await dockerPull(args.image);

  const userInfo = os.userInfo();
  const params = args.dockerParams ?? [];
  const appParams = args.applicationParams ?? [];

  if (args.runAsUser && userInfo.uid >= 0) {
    // On *nix we run the docker container as our uid:gid otherwise cleaning it up its media_store can be difficult
    params.push('-u', `${userInfo.uid}:${userInfo.gid}`);
  }

  return new Promise<string>((resolve, reject) => {
    childProcess.execFile(
      'docker',
      [
        'run',
        '--name',
        args.containerName,
        '-d',
        ...params,
        args.image,
        ...appParams,
      ],
      (err, stdout) => {
        if (err) {
          reject(err);
        }
        resolve(stdout.trim());
      },
    );
  });
}

export function dockerExec(args: {
  containerId: string;
  params: string[];
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    childProcess.execFile(
      'docker',
      ['exec', args.containerId, ...args.params],
      { encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          console.log(stdout);
          console.log(stderr);
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * Create a docker network; does not fail if network already exists
 */
export function dockerCreateNetwork(args: {
  networkName: string;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    childProcess.execFile(
      'docker',
      ['network', 'create', '--subnet=172.20.0.0/16', args.networkName],
      { encoding: 'utf8' },
      (err, _stdout, stderr) => {
        if (err) {
          if (
            stderr.includes(
              `network with name ${args.networkName} already exists`,
            )
          ) {
            // Don't consider this as error
            resolve();
          }
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
}

export async function dockerLogs(args: {
  containerId: string;
  stdoutFile?: string;
  stderrFile?: string;
}): Promise<void> {
  const stdoutFile = args.stdoutFile
    ? await fse.open(args.stdoutFile, 'w')
    : 'ignore';
  const stderrFile = args.stderrFile
    ? await fse.open(args.stderrFile, 'w')
    : 'ignore';

  await new Promise<void>((resolve) => {
    childProcess
      .spawn('docker', ['logs', args.containerId], {
        stdio: ['ignore', stdoutFile, stderrFile],
      })
      .once('close', resolve);
  });

  if (args.stdoutFile) await fse.close(<number>stdoutFile);
  if (args.stderrFile) await fse.close(<number>stderrFile);
}

export function dockerStop(args: { containerId: string }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    childProcess.execFile('docker', ['stop', args.containerId], (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

export function dockerRm(args: { containerId: string }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    childProcess.execFile('docker', ['rm', args.containerId], (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}
