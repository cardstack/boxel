/**
 * Wrapper around `vite preview` for `pnpm serve:dist`. Delegates to the
 * shared launcher, which handles BOXEL_ENVIRONMENT / Traefik registration.
 * Mirrors scripts/vite-serve.js, which does the same for the dev server.
 *
 * CORS headers and SPA fallback are configured in vite.config.mjs under
 * `preview`.
 */

const { startWithTraefik } = require('./vite-with-traefik');

startWithTraefik({
  subcommand: 'preview',
  defaultPort: 4200,
  label: 'vite preview',
});
