import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Provisioning only. The native runtime owns the long-running postgres child.
// The password travels over stdin; neither argv nor diagnostics contain it.
export async function initializeLocalPostgres({
  binaryDirectory,
  dataDirectory,
  password,
}: {
  binaryDirectory: string;
  dataDirectory: string;
  password: string;
}): Promise<void> {
  if (!path.isAbsolute(binaryDirectory) || !path.isAbsolute(dataDirectory))
    throw new Error(
      'Local Postgres requires absolute native asset and data directories',
    );
  if (!/^[a-f0-9]{64}$/.test(password))
    throw new Error('Local Postgres requires its generated stack password');
  try {
    let version = (
      await readFile(path.join(dataDirectory, 'PG_VERSION'), 'utf8')
    ).trim();
    if (version !== '16')
      throw new Error('Local stack requires Postgres 16 data');
    return;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
  }
  await mkdir(path.dirname(dataDirectory), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    let child = spawn(
      path.join(binaryDirectory, 'initdb'),
      [
        '-D',
        dataDirectory,
        '-U',
        'postgres',
        '--auth=scram-sha-256',
        '--pwfile=/dev/stdin',
        '--no-locale',
        '--encoding=UTF8',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    let timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Local Postgres initialization timed out'));
    }, 60_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Cannot start local Postgres initialization'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            'Local Postgres initialization failed; preserve the data directory for diagnosis',
          ),
        );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${password}\n`);
  });
}
