import { constants } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const profileFile = process.env.BOXEL_NATIVE_PROFILE;
const destination = process.env.BOXEL_NATIVE_ASSETS_OUTPUT;
if (
  !profileFile ||
  !destination ||
  !path.isAbsolute(profileFile) ||
  !path.isAbsolute(destination)
)
  throw new Error(
    'Set absolute BOXEL_NATIVE_PROFILE and BOXEL_NATIVE_ASSETS_OUTPUT paths',
  );
if (
  await stat(destination).then(
    () => true,
    () => false,
  )
)
  throw new Error('Native asset output already exists');
const profile = JSON.parse(await readFile(profileFile, 'utf8'));
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error(
    'This native asset builder requires managed Ollama on macOS arm64',
  );
if (
  !profile ||
  typeof profile !== 'object' ||
  Array.isArray(profile) ||
  !profile.ollama ||
  typeof profile.ollama !== 'object' ||
  !['postgresBin', 'tuwunelBinary', 'chromeBinary'].every(
    (key) =>
      typeof profile[key] === 'string' &&
      path.isAbsolute(profile[key]) &&
      !profile[key].includes('\0'),
  ) ||
  !['binary'].every(
    (key) =>
      typeof profile.ollama[key] === 'string' &&
      path.isAbsolute(profile.ollama[key]) &&
      !profile.ollama[key].includes('\0'),
  ) ||
  !Array.isArray(profile.modelIds) ||
  !profile.modelIds.length ||
  !profile.modelIds.every(
    (id) => typeof id === 'string' && /^[a-zA-Z0-9._:/-]+$/.test(id),
  ) ||
  typeof profile.titleModel !== 'string' ||
  !profile.modelIds.includes(profile.titleModel)
)
  throw new Error('Invalid native asset profile');
const stage = `${destination}.stage-${randomUUID()}`;
await mkdir(stage, { recursive: true });
const copy = async (source, relative) => {
  if (typeof source !== 'string' || !path.isAbsolute(source))
    throw new Error('Native source assets require explicit absolute paths');
  const target = path.join(stage, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(await realpath(source), target, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
};
const chromeMarker = '.app/';
const chromeIndex = profile.chromeBinary.indexOf(chromeMarker);
if (chromeIndex < 0) throw new Error('A Chrome application bundle is required');
const chromeApp = profile.chromeBinary.slice(0, chromeIndex + 4);
await copy(path.dirname(profile.postgresBin), 'postgres');
await copy(profile.tuwunelBinary, 'matrix/tuwunel');
await copy(chromeApp, 'chrome/Chrome.app');
await copy(path.dirname(profile.ollama.binary), 'ollama');
for (const relative of await readdir(stage, { recursive: true })) {
  const entry = path.join(stage, relative);
  const info = await lstat(entry);
  if (info.isSymbolicLink()) {
    const resolved = path.relative(stage, await realpath(entry));
    if (
      resolved === '..' ||
      resolved.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolved)
    )
      throw new Error('A native asset link escapes the packaged assets');
  } else if (!info.isDirectory() && !info.isFile())
    throw new Error('A native asset is not a regular file');
}
await writeFile(
  path.join(stage, 'native-assets.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      postgresBin: 'postgres/bin',
      tuwunelBinary: 'matrix/tuwunel',
      chromeBinary: `chrome/Chrome.app/${profile.chromeBinary.slice(chromeIndex + chromeMarker.length)}`,
      ollamaBinary: `ollama/${path.basename(profile.ollama.binary)}`,
      modelsDirectory: null,
      modelIds: profile.modelIds,
      titleModel: profile.titleModel,
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  path.join(stage, 'README.txt'),
  'Boxel native runtime assets for private macOS arm64 preview builds.\nIncludes Postgres 16, Tuwunel, Chrome for Testing and Ollama. Boxel-hosted models are the default. Model weights are never included; local models are downloaded separately into the user cache after opting in.\nNo user realms, database files, credentials, or desktop profile are included.\nKeep the adjacent license files when redistributing.\n',
);
await rename(stage, destination);
console.log(
  JSON.stringify({ directory: destination, modelIds: profile.modelIds }),
);
