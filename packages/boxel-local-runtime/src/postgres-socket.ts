import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function preparePostgresSocketDirectory(dataDirectory: string) {
  let directory = path.join(dataDirectory, 'pg-socket');
  if (Buffer.byteLength(path.join(directory, '.s.PGSQL.65535')) > 103) {
    const digest = createHash('sha256')
      .update(await realpath(dataDirectory))
      .digest('hex')
      .slice(0, 24);
    directory = path.join('/tmp', `boxel-pg-${digest}`);
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error(
      'Postgres requires a private socket directory owned by this user',
    );
  return directory;
}
