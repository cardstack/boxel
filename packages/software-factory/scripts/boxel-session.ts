// This should be first
import '../src/setup-logger';

import { logger } from '../src/logger';

let log = logger('boxel-session');

// boxel-session used to print Matrix + per-realm JWTs to stdout for browser
// session handoff. After CS-10642 the factory no longer exposes raw tokens —
// auth is handled by @cardstack/boxel-cli's ProfileManager singleton, and
// browser-side flows that genuinely need a JWT in the document (Playwright
// page.route, manual debugging) need a different surface.
//
// TODO: reimplement with a minimal `boxel session --realm <url>` exposed
// from boxel-cli that prints the per-realm JWT only, with an explicit opt-in
// flag. The script is left as a stub so callers fail fast with a clear
// message rather than silently importing deleted helpers.

async function main(): Promise<void> {
  log.error(
    'boxel-session is not available after CS-10642. Use `boxel profile` ' +
      'or @cardstack/boxel-cli APIs directly.',
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error(message);
  process.exit(1);
});
