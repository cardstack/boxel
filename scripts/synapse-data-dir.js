/**
 * The data directory of the dev synapse.
 *
 * Outside environment mode, one machine-wide container (`boxel-synapse`) serves
 * every checkout, and its data directory is shared by all of them: the main
 * checkout's `packages/matrix/synapse-data`, also when the caller runs in a
 * linked worktree. Synapse writes a new registration secret into
 * `homeserver.yaml` each time it starts, and every checkout must read that
 * secret from the directory the running container mounts. A worktree's own
 * directory would hold a stale secret, and it would be gone when the worktree
 * is deleted while synapse still mounts it.
 *
 * The shared directory is found from git's common directory. When it is named
 * `.git`, its parent is the main checkout. Otherwise the repository is bare (or
 * a submodule), there is no main checkout, and the directory is
 * `boxel-synapse-data` inside the common directory. A checkout that is not a
 * linked worktree (CI, the main checkout) resolves to its own
 * `packages/matrix/synapse-data`, as does a directory git can't read.
 *
 * In environment mode (BOXEL_ENVIRONMENT set) each environment has its own
 * container, and its data directory is the current checkout's
 * `packages/matrix/synapse-data-<slug>`.
 *
 * Used by:
 *   packages/matrix/package.json `clean` (through the CLI below)
 *   packages/matrix/scripts/compact-synapse-db.ts
 *   packages/matrix/scripts/start-synapse.sh (through the CLI below)
 *   packages/realm-server/scripts/full-reset.sh (through the CLI below)
 *   packages/realm-server/synapse.ts
 *
 * Run as a script, it prints `synapseDataDir()`.
 */

/* eslint-env node */
'use strict';

const { execFileSync } = require('child_process');
const { basename, dirname, join, resolve } = require('path');
const { sanitizeSlug } = require('./env-slug.js');

const DEFAULT_CHECKOUT = resolve(__dirname, '..');

/**
 * @param {string} checkout
 * @returns {string | undefined} the absolute git common directory
 */
function gitCommonDir(checkout) {
  try {
    // Relative to the working directory when git prints a relative path;
    // `--path-format=absolute` would need git 2.31.
    let commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: checkout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return resolve(checkout, commonDir);
  } catch {
    // Not a git checkout, or git is not installed.
    return undefined;
  }
}

/**
 * The data directory of the machine-wide dev synapse.
 *
 * @param {string} [checkout] the root of the checkout to start from
 * @returns {string} an absolute path
 */
function sharedSynapseDataDir(checkout = DEFAULT_CHECKOUT) {
  let commonDir = gitCommonDir(checkout);
  if (commonDir === undefined) {
    return join(resolve(checkout), 'packages', 'matrix', 'synapse-data');
  }
  if (basename(commonDir) === '.git') {
    return join(dirname(commonDir), 'packages', 'matrix', 'synapse-data');
  }
  return join(commonDir, 'boxel-synapse-data');
}

/**
 * The data directory of the synapse this checkout uses: the environment's own
 * in environment mode, the shared one otherwise.
 *
 * @param {string} [checkout] the root of the checkout to start from
 * @returns {string} an absolute path
 */
function synapseDataDir(checkout = DEFAULT_CHECKOUT) {
  let environment = process.env.BOXEL_ENVIRONMENT;
  if (environment) {
    return join(
      resolve(checkout),
      'packages',
      'matrix',
      `synapse-data-${sanitizeSlug(environment)}`,
    );
  }
  return sharedSynapseDataDir(checkout);
}

if (require.main === module) {
  console.log(synapseDataDir(process.argv[2]));
}

module.exports = { sharedSynapseDataDir, synapseDataDir };
