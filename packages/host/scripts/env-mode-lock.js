/**
 * Per-worktree lock for env-mode host vites.
 *
 * Embroider writes packages/host/node_modules/.embroider/content-for.json
 * once at vite boot with the URL-encoded `config/environment.js` ENV blob
 * (the `<meta name="@cardstack/host/config/environment">` content shipped
 * to every page). Two env-mode vites launched from the same worktree
 * share that file: whichever booted last wins, and
 * `host.<slug-1>.localhost` ends up serving `<slug-2>`'s realm/matrix/icons
 * URLs even though Traefik is routing to the correct port.
 *
 * The launchers (`vite-serve.js`, `serve-dist.js`) call
 * `refuseIfAnotherSlugLocked` BEFORE any expensive setup (boxel-ui
 * conditional build, vite require) so a second start exits immediately
 * with a clear message instead of looking like a hang.
 *
 * Cross-worktree envs are not affected — each worktree has its own
 * node_modules, so each gets its own lockfile and its own embroider
 * cache.
 */

const fs = require('fs');
const path = require('path');
const { sanitizeSlug } = require('../../../scripts/env-slug.js');

const ENV_MODE_LOCK_PATH = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.embroider',
  '.env-mode-lock',
);

function getEnvSlug() {
  // Mirrors traefik-helpers.js's `getEnvSlug`: prefer ENV_SLUG set by
  // mise's env-vars.sh (already sanitized), fall back to sanitizing
  // BOXEL_ENVIRONMENT directly when invoked outside mise.
  if (process.env.ENV_SLUG) return process.env.ENV_SLUG;
  return sanitizeSlug(process.env.BOXEL_ENVIRONMENT);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is owned by someone else —
    // still "alive" for our purposes (the cache fight applies regardless
    // of owner).
    return e.code === 'EPERM';
  }
}

function readEnvModeLock() {
  let content;
  try {
    content = fs.readFileSync(ENV_MODE_LOCK_PATH, 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(
        `[environment-mode] Could not read ${ENV_MODE_LOCK_PATH}: ${e.message}`,
      );
    }
    return null;
  }
  let [pidStr, lockedSlug] = content.trim().split(/\s+/, 2);
  let pid = Number(pidStr);
  if (!pid || !lockedSlug) return null;
  return { pid, slug: lockedSlug };
}

function refuseIfAnotherSlugLocked() {
  // Only relevant in env mode — standard mode doesn't touch the cache
  // in a slug-dependent way.
  if (!process.env.BOXEL_ENVIRONMENT) return;
  let currentSlug = getEnvSlug();
  if (!currentSlug) return;
  let lock = readEnvModeLock();
  if (!lock) return;
  if (lock.slug === currentSlug) return; // same env, idempotent
  if (!isPidAlive(lock.pid)) return; // stale, will be overwritten later
  console.error(
    '\n[environment-mode] Refusing to start: another env-mode vite is already\n' +
      `running from this worktree's packages/host (PID ${lock.pid},\n` +
      `BOXEL_ENVIRONMENT slug "${lock.slug}"). This worktree's embroider cache\n` +
      `at packages/host/node_modules/.embroider/ is shared across processes,\n` +
      'so a second env launched here would silently make both vites serve\n' +
      'identical HTML for whichever started last (the upstream port routing\n' +
      "is fine — it's the bundled config/environment that gets clobbered).\n" +
      '\n' +
      'Use a separate git worktree per environment; see the "Environment\n' +
      'mode: parallel environments" section of the repo-root README.\n',
  );
  process.exit(1);
}

function writeEnvModeLock(slug) {
  try {
    fs.mkdirSync(path.dirname(ENV_MODE_LOCK_PATH), { recursive: true });
    fs.writeFileSync(ENV_MODE_LOCK_PATH, `${process.pid} ${slug}\n`, 'utf-8');
  } catch (e) {
    console.warn(
      `[environment-mode] Could not write ${ENV_MODE_LOCK_PATH}: ${e.message}`,
    );
  }
}

function removeEnvModeLockIfOwned() {
  let lock = readEnvModeLock();
  if (lock && lock.pid === process.pid) {
    try {
      fs.unlinkSync(ENV_MODE_LOCK_PATH);
    } catch {
      /* already gone */
    }
  }
}

module.exports = {
  ENV_MODE_LOCK_PATH,
  refuseIfAnotherSlugLocked,
  writeEnvModeLock,
  removeEnvModeLockIfOwned,
};
