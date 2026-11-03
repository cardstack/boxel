import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface BundledAssets {
  schemaVersion: 1;
  platform: string;
  arch: string;
  postgresBin: string;
  tuwunelBinary: string;
  chromeBinary: string;
  ollamaBinary: string | null;
  modelsDirectory: string | null;
  modelIds: string[];
  titleModel: string;
}

function parseAssets(value: unknown): BundledAssets {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid bundled Boxel assets');
  const fields = [
    'schemaVersion',
    'platform',
    'arch',
    'postgresBin',
    'tuwunelBinary',
    'chromeBinary',
    'ollamaBinary',
    'modelsDirectory',
    'modelIds',
    'titleModel',
  ];
  if (
    Object.keys(value).some((key) => !fields.includes(key)) ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('platform' in value) ||
    value.platform !== process.platform ||
    !('arch' in value) ||
    value.arch !== process.arch
  )
    throw new Error('Bundled Boxel assets do not support this computer');
  for (const field of [
    'postgresBin',
    'tuwunelBinary',
    'chromeBinary',
    'ollamaBinary',
    'modelsDirectory',
  ]) {
    const candidate = Reflect.get(value, field);
    if (
      candidate === null &&
      ['ollamaBinary', 'modelsDirectory'].includes(field)
    )
      continue;
    if (
      typeof candidate !== 'string' ||
      !candidate ||
      path.isAbsolute(candidate) ||
      candidate.split(/[\\/]/).some((segment) => segment === '..') ||
      candidate.includes('\0')
    )
      throw new Error('Invalid bundled Boxel asset path');
  }
  if (
    !('modelIds' in value) ||
    !Array.isArray(value.modelIds) ||
    value.modelIds.length === 0 ||
    !value.modelIds.every(
      (id): id is string =>
        typeof id === 'string' && /^[a-zA-Z0-9._:/-]+$/.test(id),
    ) ||
    !('titleModel' in value) ||
    typeof value.titleModel !== 'string' ||
    !value.modelIds.includes(value.titleModel)
  )
    throw new Error('Invalid bundled Boxel models');
  return value as BundledAssets;
}

export async function prepareBundledBoxelProfile(options: {
  assetDirectory: string;
  dataDirectory: string;
  previousAssetDirectories?: readonly string[];
}): Promise<string> {
  const root = await realpath(options.assetDirectory);
  const assets = parseAssets(
    JSON.parse(await readFile(path.join(root, 'native-assets.json'), 'utf8')),
  );
  const resolveAsset = async (
    relative: string,
    directory: boolean,
  ): Promise<string> => {
    const filename = await realpath(path.join(root, relative));
    const resolved = path.relative(root, filename);
    if (
      resolved === '..' ||
      resolved.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolved)
    )
      throw new Error('Bundled Boxel asset escapes its package');
    const info = await stat(filename);
    if (directory ? !info.isDirectory() : !info.isFile())
      throw new Error('Bundled Boxel asset is unavailable');
    return filename;
  };
  const [postgresBin, tuwunelBinary, chromeBinary, ollamaBinary] =
    await Promise.all([
      resolveAsset(assets.postgresBin, true),
      resolveAsset(assets.tuwunelBinary, false),
      resolveAsset(assets.chromeBinary, false),
      assets.ollamaBinary ? resolveAsset(assets.ollamaBinary, false) : null,
    ]);
  if (!path.isAbsolute(options.dataDirectory))
    throw new Error('Bundled Boxel requires an absolute data directory');
  let parent = path.resolve(options.dataDirectory);
  const remaining: string[] = [];
  for (;;) {
    try {
      parent = await realpath(parent);
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
      remaining.unshift(path.basename(parent));
      parent = path.dirname(parent);
    }
  }
  const dataDirectory = path.join(parent, ...remaining);
  const dataRelative = path.relative(root, dataDirectory);
  if (
    dataRelative === '' ||
    (!dataRelative.startsWith(`..${path.sep}`) &&
      dataRelative !== '..' &&
      !path.isAbsolute(dataRelative))
  )
    throw new Error('Boxel data must be stored outside its installed package');
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const userProfile = path.join(dataDirectory, 'profile.json');
  try {
    const info = await lstat(userProfile);
    if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0)
      throw new Error('Invalid private native profile');
    const text = await readFile(userProfile, 'utf8');
    const existing: unknown = JSON.parse(text);
    let changed = false;
    const relocate = async (candidate: unknown): Promise<string | null> => {
      if (typeof candidate !== 'string' || !path.isAbsolute(candidate))
        return null;
      for (const previous of options.previousAssetDirectories ?? []) {
        const relative = path.relative(previous, candidate);
        if (
          relative === '..' ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        )
          continue;
        for (const destination of [
          root,
          ...(options.previousAssetDirectories ?? []),
        ]) {
          const replacement = path.join(destination, relative);
          if (replacement === candidate) return null;
          try {
            await stat(replacement);
            return replacement;
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
              )
            )
              throw error;
          }
        }
      }
      return null;
    };
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      for (const name of ['postgresBin', 'tuwunelBinary', 'chromeBinary']) {
        const replacement = await relocate(Reflect.get(existing, name));
        if (replacement) {
          Reflect.set(existing, name, replacement);
          changed = true;
        }
      }
      const local = Reflect.get(existing, 'ollama');
      if (local && typeof local === 'object' && !Array.isArray(local)) {
        const replacement = await relocate(Reflect.get(local, 'binary'));
        if (replacement) {
          Reflect.set(local, 'binary', replacement);
          changed = true;
        }
      }
    }
    if (changed) {
      const temporary = `${userProfile}.${randomUUID()}`;
      await writeFile(temporary, JSON.stringify(existing, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, userProfile);
    }
    return userProfile;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
  }
  const modelsDirectory = path.join(dataDirectory, 'models');
  await mkdir(modelsDirectory, { recursive: true, mode: 0o700 });
  const profileFile = path.join(dataDirectory, 'bundled-profile.json');
  const temporary = `${profileFile}.${randomUUID()}`;
  await writeFile(
    temporary,
    JSON.stringify(
      {
        schemaVersion: 1,
        dataDirectory: path.join(dataDirectory, 'stack'),
        postgresBin,
        tuwunelBinary,
        chromeBinary,
        ...(ollamaBinary
          ? { ollama: { binary: ollamaBinary, modelsDirectory } }
          : { modelBaseURL: 'http://127.0.0.1:11434/v1' }),
        modelIds: assets.modelIds,
        titleModel: assets.titleModel,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  await rename(temporary, profileFile);
  return profileFile;
}
