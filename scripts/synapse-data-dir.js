/**
 * The data directory of the machine-wide dev synapse (the `boxel-synapse`
 * container) outside environment mode.
 *
 * The directory is always the main checkout's `packages/matrix/synapse-data`,
 * also when the caller runs in a linked worktree. Synapse writes a new
 * registration secret into `homeserver.yaml` each time it starts, and every
 * checkout must read that secret from the directory the running container
 * mounts. A worktree's own directory would hold a stale secret, and it would
 * be gone when the worktree is deleted while synapse still mounts it.
 *
 * A checkout that is not a linked worktree (CI, the main checkout) resolves to
 * its own directory. When git can't name a main checkout (git is missing, or
 * the repository is bare), the result is the checkout given.
 *
 * Environment mode does not use this directory: each environment has its own
 * container and its own `synapse-data-<slug>` in the current checkout.
 *
 * Used by:
 *   packages/matrix/scripts/start-synapse.sh (through the CLI below)
 *   packages/matrix/scripts/compact-synapse-db.ts
 *   packages/realm-server/scripts/full-reset.sh (through the CLI below)
 *   packages/realm-server/synapse.ts
 *
 * Run as a script, it prints the directory.
 */

'use strict';

const { execFileSync } = require('child_process');
const { basename, dirname, join, resolve } = require('path');

const DEFAULT_CHECKOUT = resolve(__dirname, '..');

/**
 * @param {string} [checkout] the root of the checkout to start from
 * @returns {string} the main checkout's root
 */
function mainCheckoutRoot(checkout = DEFAULT_CHECKOUT) {
  try {
    let commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (basename(commonDir) === '.git') {
      return dirname(commonDir);
    }
  } catch {
    // Not a git checkout, or git is not installed.
  }
  return resolve(checkout);
}

/**
 * @param {string} [checkout] the root of the checkout to start from
 * @returns {string} the absolute path of the shared synapse data directory
 */
function sharedSynapseDataDir(checkout = DEFAULT_CHECKOUT) {
  return join(mainCheckoutRoot(checkout), 'packages', 'matrix', 'synapse-data');
}

if (require.main === module) {
  console.log(sharedSynapseDataDir(process.argv[2]));
}

module.exports = { mainCheckoutRoot, sharedSynapseDataDir };
