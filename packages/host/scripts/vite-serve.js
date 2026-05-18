/**
 * Wrapper around `vite` (dev server) for `pnpm start`. Delegates to the
 * shared launcher, which handles BOXEL_ENVIRONMENT / Traefik registration.
 * Mirrors scripts/serve-dist.js, which does the same for `vite preview`.
 *
 * Runs `ensure-boxel-ui` inline (synchronously, via execFileSync) so that
 * the `start` script can be a single `node ...` command rather than
 * `pnpm ensure-boxel-ui && node ...`. With `&&` chaining, pnpm runs the
 * script through `sh -c`, which has no SIGTERM handler — so on Ctrl-C
 * the shell dies via signal even though this Node process exits 0,
 * leaving pnpm to report `Command failed with signal "SIGTERM"` and
 * `[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]`. Running ensure-boxel-ui
 * inline keeps Node as pnpm's direct child, so pnpm sees our clean exit.
 */

const { execFileSync } = require('child_process');
const path = require('path');

execFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    'boxel-ui',
    'addon',
    'bin',
    'conditional-build.sh',
  ),
  {
    stdio: 'inherit',
  },
);

const { startWithTraefik } = require('./vite-with-traefik');

startWithTraefik({
  subcommand: null,
  defaultPort: 4200,
  label: 'vite dev server',
  nodeMemory: true,
});
