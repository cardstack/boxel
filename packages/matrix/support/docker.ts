import * as os from 'os';
import * as childProcess from 'child_process';
import * as fse from 'fs-extra';

function imageExistsLocally(image: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    childProcess.execFile(
      'docker',
      ['image', 'inspect', image],
      { encoding: 'utf8' },
      (err) => resolve(!err),
    );
  });
}

async function dockerPull(
  image: string,
  retries = 5,
  baseDelayMs = 5000,
): Promise<void> {
  // Skip the registry round-trip when the image is already present. CI warms
  // these pinned images from the GHCR mirror and retags them to their canonical
  // Docker Hub names (see .github/actions/warm-test-images), so pulling here
  // would otherwise hit Docker Hub anyway — the source of the recurring
  // "Failed to reach Synapse" host-test flake. The tags we pull are
  // version-pinned, so a stale local copy is not a concern.
  if (await imageExistsLocally(image)) {
    return;
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    const stderr = await new Promise<string | null>((resolve) => {
      childProcess.execFile(
        'docker',
        ['pull', image],
        { encoding: 'utf8' },
        (err, _stdout, stderr) =>
          resolve(err ? (stderr.trim() || err.message) : null),
      );
    });
    if (stderr === null) {
      return;
    }
    if (attempt === retries) {
      throw new Error(
        `docker pull ${image} failed after ${retries} attempts: ${stderr}`,
      );
    }
    // Exponential backoff, capped, so a transient Docker Hub outage has time
    // to recover instead of burning all attempts inside a few seconds.
    const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 40000);
    console.log(
      `docker pull ${image} failed (attempt ${attempt}/${retries}): ${stderr}. Retrying in ${delayMs / 1000}s...`,
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
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

  if (args.stdoutFile) await fse.close(stdoutFile as number);
  if (args.stderrFile) await fse.close(stderrFile as number);
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
