// Mint a realm-scoped JWT (boxel-session value) the way the indexer
// does. Lets Claude (via Chrome MCP) reproduce a render in a real
// browser without going through Matrix login.
//
// Mirrors `buildCreatePrerenderAuth` in
// `packages/realm-server/prerender/auth.ts`.
//
// This script is intentionally narrow: the JWT/session is realm-scoped,
// not card-scoped — once Claude has the session, it constructs the
// /render URL itself for whichever card it's investigating. The URL
// recipe is documented in the indexing-diagnostics skill.

/* eslint-env node */

import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import {
  openSync,
  writeSync,
  closeSync,
  fchmodSync,
  mkdirSync,
  constants as fsConstants,
} from 'node:fs';
import { dirname } from 'node:path';
import jwt from 'jsonwebtoken';
import {
  DEFAULT_PERMISSIONS,
  ensureTrailingSlash,
} from '@cardstack/runtime-common';
import type { RealmAction, TokenClaims } from '@cardstack/runtime-common';

// Default file Claude reads to pick up the artifacts without the user
// pasting anything. Bounded leak window — the JWT inside is 1d.
const DEFAULT_OUTPUT_PATH = '/tmp/claude-prerender.json';

interface ParsedArgs {
  positional: string[];
  opts: { [k: string]: string | boolean };
}

function usage(): void {
  process.stderr.write(
    `Usage: claude-prerender-token <realm-url> [<seed>] [options]\n` +
      `\n` +
      `Mints a realm-scoped boxel-session JWT (the same shape the indexer's\n` +
      `prerender tab uses) and writes a JSON artifact to ${DEFAULT_OUTPUT_PATH}\n` +
      `for Claude to pick up. Claude builds the /render URL itself per the\n` +
      `recipe in the indexing-diagnostics skill — no card needed here.\n` +
      `\n` +
      `Args:\n` +
      `  <realm-url>  e.g. https://realms-staging.stack.cards/ctse/myrealm/\n` +
      `  <seed>       REALM_SECRET_SEED for the target environment.\n` +
      `               If omitted, prompts interactively (paste-friendly, masked\n` +
      `               with '*' so you can see each char landed; the seed itself\n` +
      `               never echoes to the terminal or shell history).\n` +
      `               WARNING: passing the seed positionally exposes it via\n` +
      `               'ps' / /proc/<pid>/cmdline and may persist in shell\n` +
      `               history. Prefer the prompt or piped stdin.\n` +
      `\n` +
      `Options:\n` +
      `  --user <matrix-id>     Override the Matrix user ID claim. Default: derived\n` +
      `                         from the realm URL path (e.g. /ctse/realm/ → @ctse:stack.cards).\n` +
      `                         REQUIRED for system realms (1-segment paths like /catalog/),\n` +
      `                         where the owner is the realm-server bot @realm_server:<matrix-domain>.\n` +
      `                         The realm-server checks this against its permissions\n` +
      `                         DB, so it MUST be a user that actually has perms on\n` +
      `                         the target realm.\n` +
      `  --permissions <list>   Comma-separated permissions for the JWT claim. Default:\n` +
      `                         DEFAULT_PERMISSIONS from runtime-common — the same shape new\n` +
      `                         realms grant their owner ('${DEFAULT_PERMISSIONS.join(',')}').\n` +
      `                         The realm-server requires this to EXACTLY match the user's\n` +
      `                         row in realm_user_permissions — not a subset. If the default\n` +
      `                         fails with PermissionMismatch (401), query the DB:\n` +
      `                           SELECT read, write, realm_owner FROM realm_user_permissions\n` +
      `                           WHERE realm_url = '<url>' AND username = '<user>';\n` +
      `                         and pass exactly those columns as the list.\n` +
      `  --output <path>        Override output path. Default: ${DEFAULT_OUTPUT_PATH}.\n` +
      `  --no-output            Don't write the JSON artifact (stdout only).\n` +
      `  --help                 Show this help.\n`,
  );
}

const BOOLEAN_FLAGS = new Set(['no-output']);

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const opts: ParsedArgs['opts'] = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        opts[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        process.stderr.write(`error: --${key} requires a value\n`);
        process.exit(2);
      }
      opts[key] = next;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

// Mirrors `userIdFromUsername` in
// `packages/runtime-common/matrix-client.ts`: take the matrix server's
// host (here, derived from the realm URL) and produce the second-level
// domain — `realms-staging.stack.cards` → `stack.cards`. *.localhost
// stays `localhost` to match the dev-environment routing convention.
function deriveMatrixDomain(realmURL: string): string {
  const hostname = new URL(realmURL).hostname;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'localhost';
  }
  return hostname.split('.').slice(-2).join('.');
}

// Derive the realm-owner Matrix user ID from a realm URL of shape
// `<host>/<username>/<realmname>/`. Returns null for system realms
// (single-segment paths like `/catalog/`, `/experiments/`) — those
// have no path-derivable owner and require --user.
function deriveUserFromURL(realmURL: string): string | null {
  const u = new URL(realmURL);
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const username = segments[0];
  return `@${username}:${deriveMatrixDomain(realmURL)}`;
}

// Read the seed from stdin. If stdin is a TTY, each keystroke is echoed
// as `*` so the user has visual confirmation that paste landed — ported
// from `packages/boxel-cli/src/lib/prompt.ts`'s `promptPassword`
// (handles bracketed-paste markers, backspace, Ctrl+C). If stdin is
// piped/redirected, reads it all synchronously and returns trimmed.
function promptSeedSilently(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
      process.stdin.on('end', () =>
        resolve(Buffer.concat(chunks).toString('utf8').trim()),
      );
      process.stdin.on('error', reject);
      process.stdin.resume();
    });
  }
  const mutableOutput = new Writable({
    write: (_chunk, _encoding, callback) => callback(),
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableOutput,
    terminal: true,
  });

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasFlowing = stdin.readableFlowing;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      rl.close();
      // `readableFlowing` is `true | false | null` (Node stream API).
      // We call `stdin.resume()` for the prompt, so by the time
      // cleanup runs stdin is in flowing mode. Restore it to its
      // prior non-flowing state unless the caller had it actively
      // flowing (`true`). Pausing on `null` matches upstream
      // `packages/boxel-cli/src/lib/prompt.ts` and ensures the
      // script's event loop can exit after the prompt completes.
      if (wasFlowing !== true) {
        stdin.pause();
      }
    };

    let password = '';
    const onData = (chunk: Buffer) => {
      try {
        // Strip terminal bracketed-paste markers that some
        // terminals emit around a multi-char paste. Use explicit
        // escape sequences (\x1b is ESC) rather than raw control
        // chars in source — the raw form is fragile against
        // editor / formatter normalization that may silently
        // strip ESC bytes in string literals.
        const raw = chunk
          .toString()
          .split('\x1b[200~')
          .join('')
          .split('\x1b[201~')
          .join('');
        for (const c of raw) {
          if (c === '\n' || c === '\r') {
            cleanup();
            process.stderr.write('\n');
            resolve(password);
            return;
          } else if (c === '\x03') {
            cleanup();
            process.exit(130);
          } else if (c === '\x7f' || c === '\b') {
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stderr.write('\b \b');
            }
          } else if (c >= ' ') {
            password += c;
            process.stderr.write('*');
          }
        }
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    try {
      process.stderr.write(question);
      stdin.on('data', onData);
      stdin.resume();
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

const VALID_PERMISSIONS = new Set<RealmAction>([
  'read',
  'write',
  'realm-owner',
  'assume-user',
]);
// Loose Matrix-ID validation — the realm-server has stricter rules but a
// fail-fast here prevents typos like `@ctse-stack.cards` (missing colon)
// from minting a token that produces a confusing 401 minutes later.
const MATRIX_ID_RE = /^@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9.\-:]+$/;

async function main(): Promise<void> {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || positional.length < 1) {
    usage();
    process.exit(opts.help ? 0 : 2);
  }
  // Validate the realm URL up front with an actionable error rather
  // than letting `new URL()` throw bare "Invalid URL" deep in main.
  let realmURL: string;
  try {
    realmURL = ensureTrailingSlash(new URL(positional[0]).href);
  } catch {
    process.stderr.write(
      `error: <realm-url> is not a valid URL: ${positional[0]}\n` +
        `       Expected something like https://realms-staging.stack.cards/ctse/myrealm/.\n`,
    );
    process.exit(2);
  }
  const realmOrigin = ensureTrailingSlash(new URL(realmURL).origin);

  // Resolve userId before requesting the seed: bad URL/system-realm/bad
  // --user should fail fast without prompting (and discarding) a
  // freshly-pasted seed.
  let userId = opts.user as string | undefined;
  if (userId) {
    if (!MATRIX_ID_RE.test(userId)) {
      process.stderr.write(
        `error: --user must be a Matrix ID like '@user:host', got '${userId}'\n`,
      );
      process.exit(2);
    }
  } else {
    const derived = deriveUserFromURL(realmURL);
    if (!derived) {
      process.stderr.write(
        `error: cannot derive user from realm URL ${realmURL}.\n` +
          `       This looks like a system realm (single-segment path).\n` +
          `       Pass --user <matrix-id> explicitly. System realms are\n` +
          `       owned by the realm-server bot, typically\n` +
          `       @realm_server:${deriveMatrixDomain(realmURL)}.\n`,
      );
      process.exit(2);
    }
    userId = derived;
  }

  // Validate permissions before the seed prompt, same reasoning.
  const permissionsOpt = opts.permissions as string | undefined;
  const rawPermissions = permissionsOpt
    ? permissionsOpt
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [...DEFAULT_PERMISSIONS];
  const invalidPerms = rawPermissions.filter(
    (p): p is string => !VALID_PERMISSIONS.has(p as RealmAction),
  );
  if (invalidPerms.length) {
    process.stderr.write(
      `error: --permissions contains unknown values: ${invalidPerms.join(', ')}\n` +
        `       Valid values: ${[...VALID_PERMISSIONS].join(', ')}\n`,
    );
    process.exit(2);
  }
  // Narrow to RealmAction[] now that VALID_PERMISSIONS has gated the values.
  const permissions = rawPermissions as RealmAction[];

  // Seed last — by this point everything else has validated, so the seed
  // is the final input we ask for.
  const rawSecret =
    positional.length >= 2
      ? positional[1]
      : await promptSeedSilently('Paste seed: ');
  const secret = rawSecret.trim();
  if (!secret) {
    process.stderr.write(
      `error: empty seed. Pass the seed as the second positional argument or\n` +
        `       paste it at the prompt (Ctrl+C cancels). An empty seed would mint\n` +
        `       a JWT that fails signature verification on the server.\n`,
    );
    process.exit(2);
  }

  const claims: TokenClaims = {
    user: userId,
    realm: realmURL,
    sessionRoom: '',
    permissions,
    realmServerURL: realmOrigin,
  };
  const token = jwt.sign(claims, secret, { expiresIn: '1d' });
  const session = JSON.stringify({ [realmURL]: token });

  process.stdout.write(`JWT=${token}\n`);
  process.stdout.write(`SESSION=${session}\n`);

  if (opts['no-output']) return;

  const outputPath = (opts.output as string | undefined) ?? DEFAULT_OUTPUT_PATH;
  const decoded = jwt.decode(token) as { iat?: number; exp?: number } | null;
  const artifact = {
    mintedAt: new Date().toISOString(),
    expiresAt:
      decoded?.exp != null ? new Date(decoded.exp * 1000).toISOString() : null,
    user: userId,
    realmUrl: realmURL,
    jwt: token,
    session,
  };
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    // The default output path is in /tmp, which is shared on multi-user
    // hosts and the filename is predictable — defend against a prior
    // attacker-planted symlink (which `writeFileSync` would follow,
    // dumping the JWT into an attacker-controlled location).
    //
    // `O_NOFOLLOW` makes the kernel refuse the open if the final path
    // component is a symlink. `O_TRUNC` clears any prior content;
    // `O_CREAT` creates the file with `0o600` from the start (no umask
    // window). The `unlink+writeFileSync` two-call pattern has a TOCTOU
    // race in between; a single `openSync` with these flags is atomic.
    const data = Buffer.from(JSON.stringify(artifact, null, 2) + '\n');
    const fd = openSync(
      outputPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_TRUNC |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      // The 0o600 mode argument to `openSync` only applies when the
      // kernel CREATES the file (O_CREAT path). If the file already
      // existed — last run left it behind, an attacker on a shared
      // /tmp pre-created it before we ran — the existing mode bits
      // are preserved across the O_TRUNC. Force-narrow them with
      // `fchmodSync` so the JWT artifact is always 0600 on disk
      // regardless of what was there before.
      fchmodSync(fd, 0o600);
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    process.stderr.write(`\nWrote artifact: ${outputPath}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `warning: failed to write artifact to ${outputPath}: ${msg}\n` +
        `         (stdout output above is the same data; pass --no-output to silence this.)\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
