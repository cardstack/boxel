import yargs from 'yargs';
import log, { LogLevelNames } from 'loglevel';
import { writeFileSync, moveSync, ensureDirSync } from 'fs-extra';
import { execSync } from 'child_process';
import { dirSync as tmpDirSync } from 'tmp';
import { join, resolve } from 'path';

let { path, url, logLevel } = yargs(process.argv.slice(2))
  .usage('Fetch host Fastboot assets')
  .options({
    url: {
      description: 'URL to fetch assets from',
      demandOption: true,
      type: 'string',
    },
    path: {
      description: 'Path to unzip assets into',
      type: 'string',
      default: './dist',
    },
    logLevel: {
      description: 'how detailed log output should be',
      choices: ['trace', 'debug', 'info', 'warn', 'error'],
      default: 'info',
    },
  })
  .parseSync();

log.setLevel(logLevel as LogLevelNames);
log.info(`Set fetch-dist log level to ${logLevel}`);
path = resolve(path);

if (!url.endsWith('/')) {
  url = `${url}/`;
}

(async () => {
  let zipUrl = `${url}boxel_dist/dist.zip`;
  log.info(`Fetching zip from ${zipUrl}`);

  let zipResponse = await fetch(zipUrl);
  let zipBuffer = await zipResponse.arrayBuffer();

  let tmp = tmpDirSync();
  let zipPath = join(tmp.name, 'dist.zip');

  log.debug(`Writing zip to ${zipPath}`);
  writeFileSync(zipPath, Buffer.from(zipBuffer));

  log.debug(`Extracting zip`);
  execSync(`unzip -q ${zipPath} -d ${tmp.name}`);

  // extract and move are separate operations such that
  // the dist appears atomically in the file system
  let tmpDist = join(tmp.name, 'dist');
  log.debug(`Moving zip contents from ${tmpDist} to ${path}`);

  ensureDirSync(path);
  moveSync(tmpDist, path, { overwrite: true });
})().catch((e: any) => {
  log.error(`Unexpected error fetching dist, stopping`, e);
  process.exit(1);
});
