/**
 * Wrapper around `vite` (dev server) for `pnpm start`. Delegates to the
 * shared launcher, which handles BOXEL_ENVIRONMENT / Traefik registration.
 * Mirrors scripts/serve-dist.js, which does the same for `vite preview`.
 */

// Refuse a second env-mode vite from this worktree before we start, so the
// second start exits with a clear error instead of racing the first. See
// env-mode-lock.js for the underlying constraint.
require('./env-mode-lock').refuseIfAnotherSlugLocked();

const { startWithTraefik } = require('./vite-with-traefik');

startWithTraefik({
  subcommand: null,
  defaultPort: 4200,
  label: 'vite dev server',
  nodeMemory: true,
});
