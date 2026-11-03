import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { satisfies } from 'semver';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const runtimeDependencyManifest = JSON.parse(
  await readFile(
    new URL('./runtime-dependencies.json', import.meta.url),
    'utf8',
  ),
);
if (
  runtimeDependencyManifest.schemaVersion !== 1 ||
  !runtimeDependencyManifest.workspaceDevelopmentDependencies
)
  throw new Error('Invalid runtime dependency manifest');
const assetPackages = new Set(['host', 'boxel-icons', 'base']);
const excludedSegments = new Set([
  'node_modules',
  '.git',
  '.boxel-history',
  '.boxel-sync',
  'tests',
  'test',
  '__tests__',
  'test-fixtures',
  'coverage',
  'docs-app',
]);

export function isRuntimeSource(relative) {
  const segments = relative.split('/');
  return (
    !segments.some(
      (segment) =>
        excludedSegments.has(segment) ||
        (segment.startsWith('.') &&
          !['.realm.json', '.boxelignore'].includes(segment)),
    ) &&
    !/(?:\.test\.|\.spec\.|-test\.)/.test(path.basename(relative)) &&
    !relative.endsWith('.map') &&
    !relative.endsWith('.tsbuildinfo') &&
    !/(?:^|\/)(?:secrets|credentials|profile)\.(?:json|bin)$/i.test(relative)
  );
}

async function resolveDependency(directory, name) {
  let current = directory;
  for (;;) {
    const candidate = path.join(current, 'node_modules', name);
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(`Missing installed runtime dependency: ${name}`);
    current = parent;
  }
}

export async function assertPortableLinks(root) {
  root = await realpath(root);
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await readlink(filename);
        const resolved = await realpath(filename);
        const relative = path.relative(root, resolved);
        if (
          path.isAbsolute(target) ||
          relative === '..' ||
          relative.startsWith(`..${path.sep}`)
        )
          throw new Error('Runtime payload contains an external symbolic link');
      } else if (entry.isDirectory()) {
        await visit(filename);
      }
    }
  }
  await visit(root);
}

export async function stageRuntimeTree({ sourceRoot, destination }) {
  sourceRoot = await realpath(sourceRoot);
  destination = path.resolve(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  destination = path.join(
    await realpath(path.dirname(destination)),
    path.basename(destination),
  );
  const relativeDestination = path.relative(sourceRoot, destination);
  if (
    relativeDestination === '' ||
    (!relativeDestination.startsWith(`..${path.sep}`) &&
      relativeDestination !== '..' &&
      !path.isAbsolute(relativeDestination))
  )
    throw new Error('Runtime output must be outside the source checkout');
  try {
    await lstat(destination);
    throw new Error('Runtime output already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { stdout: inventory } = await exec(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      'packages',
    ],
    { cwd: sourceRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  const { stdout: deletedInventory } = await exec(
    'git',
    ['ls-files', '--deleted', '-z', '--', 'packages'],
    { cwd: sourceRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  const deleted = new Set(deletedInventory.split('\0').filter(Boolean));
  const files = [
    ...new Set(
      inventory.split('\0').filter((file) => file && !deleted.has(file)),
    ),
  ].sort();
  const stage = `${destination}.stage-${randomUUID()}`;
  const packages = new Map();
  const sourceDigests = [];
  await mkdir(stage, { recursive: true });
  try {
    for (const filename of ['scripts/env-slug.js']) {
      const source = path.join(sourceRoot, filename);
      const info = await lstat(source);
      if (!info.isFile())
        throw new Error('Runtime support must be a regular file');
      const contents = await readFile(source);
      const target = path.join(stage, filename);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, { mode: info.mode & 0o777 });
      sourceDigests.push([
        filename,
        createHash('sha256').update(contents).digest('hex'),
      ]);
    }
    const stagePackage = async (directory) => {
      directory = await realpath(directory);
      const existing = packages.get(directory);
      if (existing) return existing;
      const manifest = JSON.parse(
        await readFile(path.join(directory, 'package.json'), 'utf8'),
      );
      if (
        typeof manifest.name !== 'string' ||
        !/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(manifest.name)
      )
        throw new Error('Invalid runtime package name');
      const relative = path.relative(
        path.join(sourceRoot, 'packages'),
        directory,
      );
      const workspace =
        relative !== '' && !relative.includes(path.sep) && relative !== '..';
      const output = workspace
        ? path.join('packages', relative)
        : path.join(
            'node_modules',
            '.boxel',
            createHash('sha256').update(directory).digest('hex').slice(0, 20),
            'node_modules',
            manifest.name,
          );
      packages.set(directory, output);
      const target = path.join(stage, output);
      await mkdir(target, { recursive: true });
      if (workspace) {
        const prefix = `packages/${relative}/`;
        for (const filename of files.filter(
          (file) =>
            file.startsWith(prefix) &&
            isRuntimeSource(file.slice(prefix.length)) &&
            (!['host', 'boxel-icons'].includes(relative) ||
              file === `${prefix}package.json`),
        )) {
          let source = path.join(sourceRoot, filename);
          let info = await lstat(source);
          if (info.isSymbolicLink()) {
            source = await realpath(source);
            const resolved = path.relative(sourceRoot, source);
            if (
              resolved.startsWith(`..${path.sep}`) ||
              resolved === '..' ||
              path.isAbsolute(resolved) ||
              !isRuntimeSource(resolved)
            )
              throw new Error(
                'Runtime workspace source must contain regular files inside the checkout',
              );
            info = await lstat(source);
          }
          if (!info.isFile())
            throw new Error(
              'Runtime workspace source must contain regular files',
            );
          const contents = await readFile(source);
          const dest = path.join(stage, filename);
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, contents, { mode: info.mode & 0o777 });
          sourceDigests.push([
            filename,
            createHash('sha256').update(contents).digest('hex'),
          ]);
        }
        if (
          relative === 'host' ||
          relative === 'boxel-icons' ||
          relative === 'boxel-ui' ||
          relative === 'boxel-local-runtime'
        ) {
          await cp(path.join(directory, 'dist'), path.join(target, 'dist'), {
            recursive: true,
            mode: constants.COPYFILE_FICLONE,
            filter: (file) => !file.endsWith('.map'),
          });
        }
      } else {
        await cp(directory, target, {
          recursive: true,
          mode: constants.COPYFILE_FICLONE,
          filter: (file) =>
            file === directory ||
            (!path
              .relative(directory, file)
              .split(path.sep)
              .some(
                (segment) =>
                  excludedSegments.has(segment) ||
                  segment === 'docs' ||
                  segment === '.DS_Store',
              ) &&
              !(
                manifest.name === '@octokit/auth-token' &&
                path.relative(directory, file) === 'README.md'
              )),
        });
      }
      if (workspace && assetPackages.has(relative)) return output;
      const dependencies = {
        ...manifest.dependencies,
        ...(workspace
          ? Object.fromEntries(
              Object.entries(manifest.devDependencies ?? {}).filter(([name]) =>
                (
                  runtimeDependencyManifest.workspaceDevelopmentDependencies[
                    relative
                  ] ?? []
                ).includes(name),
              ),
            )
          : {}),
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };
      for (const name of Object.keys(dependencies).sort()) {
        let dependency;
        try {
          dependency = await resolveDependency(directory, name);
        } catch (error) {
          if (
            name in (manifest.optionalDependencies ?? {}) ||
            name in (manifest.peerDependencies ?? {})
          )
            continue;
          throw error;
        }
        if (
          manifest.peerDependenciesMeta?.[name]?.optional === true &&
          !(name in (manifest.dependencies ?? {})) &&
          !(name in (manifest.optionalDependencies ?? {}))
        ) {
          const installed = JSON.parse(
            await readFile(path.join(dependency, 'package.json'), 'utf8'),
          );
          if (
            typeof installed.version !== 'string' ||
            !satisfies(installed.version, manifest.peerDependencies[name])
          )
            continue;
        }
        const resolvedOutput = await stagePackage(dependency);
        const link = path.join(target, 'node_modules', name);
        await mkdir(path.dirname(link), { recursive: true });
        await symlink(
          path.relative(path.dirname(link), path.join(stage, resolvedOutput)),
          link,
          'dir',
        );
      }
      return output;
    };
    for (const name of [
      'boxel-local-runtime',
      'realm-server',
      'ai-bot',
      'base',
      'host',
      'boxel-icons',
    ])
      await stagePackage(path.join(sourceRoot, 'packages', name));
    const { stdout: revision } = await exec('git', ['rev-parse', 'HEAD'], {
      cwd: sourceRoot,
    });
    const metadata = {
      schemaVersion: 1,
      sourceRevision: revision.trim(),
      sourceSha256: createHash('sha256')
        .update(
          JSON.stringify(
            sourceDigests.sort(([left], [right]) => left.localeCompare(right)),
          ),
        )
        .digest('hex'),
      runtimeDependenciesSha256: createHash('sha256')
        .update(JSON.stringify(runtimeDependencyManifest))
        .digest('hex'),
      packageCount: packages.size,
      sourceFileCount: sourceDigests.length,
      developmentSourceLink: false,
    };
    await writeFile(
      path.join(stage, 'runtime-build.json'),
      JSON.stringify(metadata, null, 2) + '\n',
    );
    await assertPortableLinks(stage);
    await rename(stage, destination);
    return metadata;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
