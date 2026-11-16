/* eslint-env node */

// Runs Example AI app against a running development stack, for screenshots
// of a whole flow: its Connect page, Boxel's pages, and its result page.
//
//   pnpm oauth:mock-client [--mode loopback|unverified] [--realm-server <url>] [--port <n>]
//
// The stack's realm server must run with its OAuth provider on: set
// BOXEL_DEV_OAUTH_PROVIDER=true in the worktree's `.envrc`, then start the
// stack. The realm server defaults to REALM_BASE_URL, which the repo's mise
// environment sets.
//
// The `cimd` mode runs only in the realm server's tests: a stack downloads a
// metadata document only from a real HTTPS client ID, and nothing serves one
// for this app.

import { parseArgs } from 'util';
import {
  EXAMPLE_AI_APP_NAME,
  REGISTRATION_MODES,
  fetchTransport,
  type RegistrationMode,
} from './client.ts';
import { startExampleAIApp } from './server.ts';

let { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'loopback' },
    'realm-server': { type: 'string' },
    port: { type: 'string', default: '0' },
  },
});

let mode = values.mode as RegistrationMode;
if (!REGISTRATION_MODES.includes(mode)) {
  console.error(
    `--mode must be one of ${REGISTRATION_MODES.join(', ')}, not "${values.mode}"`,
  );
  process.exit(1);
}
if (mode === 'cimd') {
  console.error(
    'The cimd mode runs only in the realm server tests: a development stack has no HTTPS client ID to download this app’s metadata document from.',
  );
  process.exit(1);
}

let issuer = values['realm-server'] ?? process.env.REALM_BASE_URL;
if (!issuer) {
  console.error(
    'Pass --realm-server <url>, or run inside the repo so mise sets REALM_BASE_URL.',
  );
  process.exit(1);
}

let running;
try {
  running = await startExampleAIApp({
    mode,
    issuer,
    transport: fetchTransport(),
    port: Number(values.port),
  });
} catch (error) {
  console.error(
    `${EXAMPLE_AI_APP_NAME} couldn't register with ${issuer}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  if (String((error as { cause?: unknown })?.cause).includes('certificate')) {
    console.error(
      "Node doesn't trust the stack's certificate: set NODE_EXTRA_CA_CERTS to mkcert's rootCA.pem.",
    );
  }
  process.exit(1);
}

console.log(`${EXAMPLE_AI_APP_NAME} (${mode}) registered with ${issuer}`);
console.log(`Connect page: ${running.origin}/`);
console.log('Press Ctrl+C to stop.');

let stop = async () => {
  await running.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
