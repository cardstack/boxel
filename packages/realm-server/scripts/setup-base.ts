/* eslint-env node */
import { ensureSymlinkSync, existsSync } from 'fs-extra';
import { assetsDir } from '@cardstack/runtime-common';
import { resolve, join } from 'path';

const baseRealm = resolve(join(__dirname, '..', '..', 'base'));
const dist = resolve(join(__dirname, '..', '..', 'host', 'dist'));

if (!existsSync(dist)) {
  console.error(
    `${dist} folder is missing. Please perform an ember build first in order to create dist assets that the realm server requires`,
  );
  process.exit(-1);
}
ensureSymlinkSync(dist, join(baseRealm, assetsDir.replace(/\/$/, '')));
