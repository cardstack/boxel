/**
 * Wrapper around `vite` (dev server) for `pnpm start`. Delegates to the
 * shared launcher, which handles BOXEL_ENVIRONMENT / Traefik registration.
 * Mirrors scripts/serve-dist.js, which does the same for `vite preview`.
 */

const { startWithTraefik } = require('./vite-with-traefik');

startWithTraefik({
  subcommand: null,
  defaultPort: 4200,
  label: 'vite dev server',
  nodeMemory: true,
});
