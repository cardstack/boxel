import * as os from 'os';
import * as childProcess from 'child_process';
import * as fse from 'fs-extra';

export function dockerRun(args: {
  image: string;
  containerName: string;
  dockerParams?: string[];
  applicationParams?: string[];
  runAsUser?: true;
}): Promise<string> {
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
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
        resolve(stdout);
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
