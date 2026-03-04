/**
 * Ensures the boxel-traefik Docker container is running, starting it if needed.
 * Called from branch-mode host scripts before registering with Traefik.
 */

const { execSync } = require('child_process');
const path = require('path');

function ensureTraefik() {
  const scriptPath = path.resolve(
    __dirname,
    '../../../scripts/start-traefik.sh',
  );
  try {
    execSync(`sh "${scriptPath}"`, { stdio: 'inherit' });
  } catch {
    console.error(
      '\n[branch-mode] ERROR: Failed to start Traefik. Is Docker running?\n',
    );
    process.exit(1);
  }
}

module.exports = { ensureTraefik };
