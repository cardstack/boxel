/**
 * Checks that the boxel-traefik Docker container is running.
 * Called from branch-mode host scripts before registering with Traefik.
 */

const { execSync } = require('child_process');

function ensureTraefik() {
  try {
    const output = execSync(
      "docker ps --format '{{.Names}}' 2>/dev/null",
      { encoding: 'utf-8' },
    );
    if (output.split('\n').some((name) => name.trim() === 'boxel-traefik')) {
      return; // already running
    }
  } catch {
    // docker not available or errored
  }

  console.error(
    '\n[branch-mode] ERROR: Traefik is not running.\n' +
    '  Branch mode requires Traefik for hostname-based routing.\n' +
    '  Start it with:  sh scripts/start-traefik.sh\n',
  );
  process.exit(1);
}

module.exports = { ensureTraefik };
