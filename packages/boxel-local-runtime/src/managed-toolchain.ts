import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const pending = new Map<string, Promise<unknown>>();
async function download(url: string, signal: AbortSignal): Promise<Buffer> {
  const result = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
  });
  if (!result.ok) throw new Error('The managed toolchain download failed');
  const length = Number(result.headers.get('content-length') ?? 0);
  if (length > 150 * 1024 * 1024)
    throw new Error('Toolchain download exceeds its size limit');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = result.body?.getReader();
  if (!reader) throw new Error('Empty toolchain download');
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 150 * 1024 * 1024)
        throw new Error('Toolchain download exceeds its size limit');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
async function portableLinks(root: string): Promise<void> {
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isSymbolicLink()) continue;
    const relative = path.relative(
      root,
      await realpath(path.join(entry.parentPath, entry.name)),
    );
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error('A toolchain link escapes its installation');
  }
}
async function unpack(
  archive: Buffer,
  destination: string,
  signal: AbortSignal,
) {
  const file = `${destination}.tgz`;
  const temporary = `${destination}.pending`;
  await rm(temporary, { recursive: true, force: true });
  await writeFile(file, archive, { mode: 0o600 });
  try {
    const { stdout } = await exec('/usr/bin/tar', ['-tzf', file], {
      signal,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (
      stdout
        .split('\n')
        .filter(Boolean)
        .some(
          (name) =>
            path.isAbsolute(name) ||
            name.split('/').includes('..') ||
            name.includes('\0'),
        )
    )
      throw new Error('Invalid toolchain archive path');
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    await exec(
      '/usr/bin/tar',
      ['-xzf', file, '-C', temporary, '--strip-components=1'],
      { signal },
    );
    await portableLinks(temporary);
    await rename(temporary, destination);
  } finally {
    await rm(file, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}
export function managedToolchain(
  directory: string,
  source: string,
  signal: AbortSignal,
) {
  const previous = pending.get(directory) ?? Promise.resolve();
  const result = previous
    .catch(() => {})
    .then(() => install(directory, source, signal));
  pending.set(directory, result);
  void result
    .finally(() => {
      if (pending.get(directory) === result) pending.delete(directory);
    })
    .catch(() => {});
  return result;
}

async function install(directory: string, source: string, signal: AbortSignal) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Managed environments currently support macOS arm64');
  const manifest: unknown = JSON.parse(
    await readFile(path.join(source, 'package.json'), 'utf8'),
  );
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('packageManager' in manifest) ||
    typeof manifest.packageManager !== 'string'
  )
    throw new Error('The source must pin pnpm');
  const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
    manifest.packageManager,
  )?.[1];
  const pins = await readFile(path.join(source, '.mise.toml'), 'utf8');
  const nodeVersion = /^node\s*=\s*"(\d+\.\d+\.\d+)"/m.exec(pins)?.[1];
  if (!pnpmVersion || !nodeVersion)
    throw new Error('The source must pin exact Node and pnpm versions');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const nodeRoot = path.join(
    directory,
    `node-${nodeVersion}-${process.platform}-${process.arch}`,
  );
  const pnpmRoot = path.join(directory, `pnpm-${pnpmVersion}`);
  const node = path.join(nodeRoot, 'bin/node');
  const pnpm = path.join(
    pnpmRoot,
    Number(pnpmVersion.split('.')[0]) >= 11 ? 'bin/pnpm.mjs' : 'bin/pnpm.cjs',
  );
  if (!(await stat(node).catch(() => null))?.isFile()) {
    const filename = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
    const base = `https://nodejs.org/dist/v${nodeVersion}/`;
    const sums = (await download(`${base}SHASUMS256.txt`, signal)).toString(
      'utf8',
    );
    const expected = sums
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .find((parts) => parts[1] === filename)?.[0];
    const bytes = await download(base + filename, signal);
    if (
      !expected ||
      createHash('sha256').update(bytes).digest('hex') !== expected
    )
      throw new Error('Node toolchain checksum failed');
    await unpack(bytes, nodeRoot, signal);
  }
  if (!(await stat(pnpm).catch(() => null))?.isFile()) {
    const metadata: unknown = JSON.parse(
      (
        await download(`https://registry.npmjs.org/pnpm/${pnpmVersion}`, signal)
      ).toString('utf8'),
    );
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      !('dist' in metadata) ||
      !metadata.dist ||
      typeof metadata.dist !== 'object' ||
      !('integrity' in metadata.dist) ||
      typeof metadata.dist.integrity !== 'string'
    )
      throw new Error('Invalid pnpm release metadata');
    const bytes = await download(
      `https://registry.npmjs.org/pnpm/-/pnpm-${pnpmVersion}.tgz`,
      signal,
    );
    if (
      `sha512-${createHash('sha512').update(bytes).digest('base64')}` !==
      metadata.dist.integrity
    )
      throw new Error('pnpm toolchain checksum failed');
    await unpack(bytes, pnpmRoot, signal);
  }
  const { stdout } = await exec(node, ['--version'], { signal });
  if (stdout.trim() !== `v${nodeVersion}`)
    throw new Error('Managed Node version mismatch');
  const { stdout: pnpmOutput } = await exec(node, [pnpm, '--version'], {
    signal,
    timeout: 180000,
  }).catch(() => {
    throw new Error(
      'Could not verify the pinned pnpm toolchain. Check your connection and try setup again.',
    );
  });
  if (pnpmOutput.trim() !== pnpmVersion)
    throw new Error('Managed pnpm version mismatch');
  return { node, pnpm };
}
