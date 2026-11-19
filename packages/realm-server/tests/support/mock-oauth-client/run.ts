/* eslint-env node */

// Runs Example AI app against a running development stack, for screenshots
// of a whole flow: its Connect page, Boxel's pages, and its result page.
//
//   pnpm oauth:mock-client [--mode loopback|unverified] [--realm-server <url>] [--port <n>]
//
// The stack's realm server must run with its OAuth provider on, as the
// development realm server does unless BOXEL_DEV_OAUTH_PROVIDER=false was set
// when the stack started. The realm server defaults to REALM_BASE_URL, which the
// repo's mise environment sets, so run this from inside the checkout.
//
// The `unverified` mode registers a redirect on the web,
// `https://ai-app.example.com/callback`, which nothing serves: after Boxel's
// pages, the browser lands on that unreachable URL. To see the result page,
// open the app's own `/callback` with the same query string.
//
// The `cimd` mode runs only in the realm server's tests: a stack downloads a
// metadata document only from a real HTTPS client ID, and nothing serves one
// for this app.

// In environment mode, `*.localhost` names resolve to loopback for fetch.
import '../../../setup-localhost-resolver.ts';
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

let port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(
    `--port must be a whole number from 0 to 65535, not "${values.port}"`,
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
    port,
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

// Stops once, however many signals arrive: a second Ctrl+C, or SIGINT then
// SIGTERM, would otherwise close the server twice.
let stopping = false;
let stop = async () => {
  if (stopping) {
    return;
  }
  stopping = true;
  await running.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
