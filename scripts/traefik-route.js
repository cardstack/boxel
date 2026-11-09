/**
 * Waits for Traefik to load a route file an env-mode service just wrote.
 * Required by:
 *   packages/host/scripts/traefik-helpers.js
 *   packages/matrix/support/environment-config.ts
 *   packages/realm-server/lib/dev-service-registry.ts
 *   packages/realm-server/scripts/start-icons.sh
 */

/* eslint-env node */
'use strict';

const { spawn } = require('child_process');

// Traefik's API, published on the host by docker-compose.traefik.yml.
const DEFAULT_API_URL = 'http://127.0.0.1:4230';
// Docker Desktop on macOS has delivered a route file to Traefik within about
// 2s; one still missing after this long isn't coming.
const DEFAULT_TIMEOUT_MS = 5000;
// Long enough for a restart already under way to finish: `docker restart`
// gives Traefik up to 10s to shut down gracefully.
const DEFAULT_UNREACHABLE_TIMEOUT_MS = 30000;
const DEFAULT_INTERVAL_MS = 100;

/**
 * Traefik reloads a route file when its file watcher sees it change. On macOS
 * that change crosses Docker Desktop's file sharing, which hasn't always
 * delivered it, so there Traefik's API is polled until the service
 * `serviceKey` lists `serverURL`. Only a route that doesn't appear within
 * `timeoutMs` of Traefik answering restarts Traefik, because a restart drops
 * the connections of every environment on the machine.
 *
 * While the API doesn't answer, Traefik is most likely restarting for another
 * service's route. It reads every route file when it starts, so that time
 * doesn't count toward `timeoutMs`; only an API that stays silent for
 * `unreachableTimeoutMs` restarts Traefik. Elsewhere the watcher is trusted.
 *
 * Never rejects.
 *
 * @param {string} serviceKey The service's key in the route file.
 * @param {string} serverURL The URL the route file gives the service's server.
 * @param {{
 *   platform?: string,
 *   apiURL?: string,
 *   timeoutMs?: number,
 *   unreachableTimeoutMs?: number,
 *   intervalMs?: number,
 *   warn?: (message: string) => void,
 *   restart?: () => void,
 * }} [opts]
 * @returns {Promise<'loaded' | 'restarted' | 'unchecked'>}
 */
async function awaitTraefikRoute(serviceKey, serverURL, opts = {}) {
  let {
    platform = process.platform,
    apiURL = DEFAULT_API_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    unreachableTimeoutMs = DEFAULT_UNREACHABLE_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    warn = (message) => console.warn(message),
    restart = () => restartTraefik(warn),
  } = opts;
  if (platform !== 'darwin') {
    return 'unchecked';
  }
  let deadline = Date.now() + timeoutMs;
  let unreachableDeadline;
  for (;;) {
    let state = await routeState(apiURL, serviceKey, serverURL);
    if (state === 'loaded') {
      return 'loaded';
    }
    let now = Date.now();
    if (state === 'unreachable') {
      unreachableDeadline ??= now + unreachableTimeoutMs;
      deadline = now + timeoutMs;
      if (now >= unreachableDeadline) {
        warn(
          `Traefik's API did not answer for ${unreachableTimeoutMs}ms; restarting Traefik`,
        );
        break;
      }
    } else {
      unreachableDeadline = undefined;
      if (now >= deadline) {
        warn(
          `Traefik did not load the route for ${serviceKey} within ${timeoutMs}ms; restarting it`,
        );
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  restart();
  return 'restarted';
}

/**
 * @returns {Promise<'loaded' | 'missing' | 'unreachable'>}
 */
async function routeState(apiURL, serviceKey, serverURL) {
  try {
    let response = await fetch(
      `${apiURL}/api/http/services/${serviceKey}@file`,
      { signal: AbortSignal.timeout(1000) },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return 'missing';
    }
    let service = await response.json();
    let servers = service?.loadBalancer?.servers ?? [];
    return servers.some((server) => server.url === serverURL)
      ? 'loaded'
      : 'missing';
  } catch {
    return 'unreachable';
  }
}

function restartTraefik(warn) {
  let child = spawn('docker', ['restart', 'boxel-traefik'], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', (error) =>
    warn(`Could not restart Traefik: ${error.message}`),
  );
  child.unref();
}

module.exports = { awaitTraefikRoute };
