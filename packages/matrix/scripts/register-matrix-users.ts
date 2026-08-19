import * as childProcess from 'child_process';

import {
  createRegistrationToken,
  loginUser,
} from '../support/synapse/index.ts';
import { ensureUserRecord } from '../helpers/ensure-user-record.ts';
import {
  getSynapseContainerName,
  tryGetSynapseURL,
} from '../support/environment-config.ts';
import { realmPassword } from '../helpers/realm-credentials.ts';

type Mode = 'all' | 'realms-only';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password';

const REALM_USERS = [
  'realm_server',
  'node-test_realm-server',
  'base_realm',
  'experiments_realm',
  'catalog_realm',
  'boxel_homepage_realm',
  'submission_realm',
  'node-test_realm',
  'skills_realm',
  'software_factory_realm',
  'test_realm',
  'openrouter_realm',
];

interface ExtraUser {
  username: string;
  password: string;
  admin: boolean;
  ensureUserRecord: boolean;
}

const EXTRA_USERS: ExtraUser[] = [
  { username: 'aibot', password: 'pass', admin: false, ensureUserRecord: true },
  {
    username: 'submissionbot',
    password: 'password',
    admin: true,
    ensureUserRecord: false,
  },
  {
    username: 'user',
    password: 'password',
    admin: false,
    ensureUserRecord: true,
  },
  {
    username: 'skills_writer',
    password: 'password',
    admin: false,
    ensureUserRecord: true,
  },
  {
    username: 'homepage_writer',
    password: 'password',
    admin: false,
    ensureUserRecord: true,
  },
];

async function waitForSynapse(): Promise<void> {
  // The budget is deliberately generous. On a cold or loaded CI runner the
  // image pull and migrations can take minutes, and a too-tight window took out
  // the whole test shard before a single test ran rather than tolerating a slow
  // start.
  const maxAttempts = 60;
  const intervalMs = 5000;
  // Re-resolve the address on every attempt. This gate is expected to start
  // before Synapse does, and in environment mode Synapse's host port is only
  // discoverable once its container exists — so resolving once up front would
  // capture "not knowable yet" and then poll that stale answer for the whole
  // budget, never noticing the container that appeared a few seconds later.
  let lastUrl: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const base = tryGetSynapseURL()?.replace(/\/$/, '');
    if (base) {
      // `/_matrix/client/versions` returns 200 only once Synapse has finished
      // booting and running its database migrations, so it is a truer readiness
      // signal than a HEAD on the root (which can answer non-2xx while the
      // server is still coming up, or 404 depending on config).
      lastUrl = `${base}/_matrix/client/versions`;
      try {
        const res = await fetch(lastUrl);
        if (res.ok) return;
      } catch {
        // fall through to retry
      }
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Distinguish the two ways this wait runs out, because they point at
  // different things: a container that never came up, versus one that came up
  // but never finished booting.
  const target =
    lastUrl ??
    `container ${getSynapseContainerName()}, which never started (no published port to poll)`;
  throw new Error(
    `Failed to reach Synapse at ${target} after ${maxAttempts} attempts (~${Math.round(
      (maxAttempts * intervalMs) / 1000,
    )}s).`,
  );
}

function execAsync(
  command: string,
): Promise<{ err: Error | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    childProcess.exec(command, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

async function waitForPostgres(): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { err } = await execAsync(
      'docker exec boxel-pg pg_isready -U postgres',
    );
    if (!err) return;
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Postgres (boxel-pg) did not become ready after ${maxAttempts} attempts.`,
  );
}

async function registerUser({
  username,
  password,
  admin,
  label,
}: {
  username: string;
  password: string;
  admin: boolean;
  label: string;
}): Promise<void> {
  const container = getSynapseContainerName();
  const adminFlag = admin ? '--admin' : '--no-admin';
  const command = `docker exec ${container} register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} ${adminFlag}`;
  console.log(`[${label}] Registering`);
  const { err, stdout } = await execAsync(command);
  if (err) {
    if (stdout.includes('User ID already taken')) {
      const cred = await loginUser(username, password);
      if (!cred.userId) {
        throw new Error(
          `User ${username} already exists, but the password does not match`,
        );
      }
      console.log(`[${label}] Already exists and the password matches`);
      return;
    }
    throw err;
  }
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) console.log(`[${label}] ${trimmed}`);
  }
}

async function main() {
  const arg = process.argv[2];
  const mode: Mode = (arg as Mode) || 'all';
  if (mode !== 'all' && mode !== 'realms-only') {
    console.error(`unknown mode "${arg}"; expected "all" or "realms-only"`);
    process.exit(-1);
  }

  const realmSecretSeed =
    process.env.REALM_SECRET_SEED || "shhh! it's a secret";

  // In 'all' mode we'll INSERT into the users table for bot/writer accounts,
  // so ensure Postgres is reachable too. 'realms-only' mode never touches
  // Postgres, so we skip that check there.
  await Promise.all(
    mode === 'all' ? [waitForSynapse(), waitForPostgres()] : [waitForSynapse()],
  );

  // The admin user must exist before we can mint a registration token, so
  // register it sequentially first. Everything else fans out in parallel.
  if (mode === 'all') {
    await registerUser({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      admin: true,
      label: ADMIN_USERNAME,
    });
  }

  const tasks: Promise<unknown>[] = [];

  if (mode === 'all') {
    tasks.push(
      (async () => {
        const cred = await loginUser(ADMIN_USERNAME, ADMIN_PASSWORD);
        await createRegistrationToken(cred.accessToken, 'dev-token');
      })(),
    );
  }

  for (const realmUser of REALM_USERS) {
    tasks.push(
      (async () => {
        const password = await realmPassword(realmUser, realmSecretSeed);
        await registerUser({
          username: realmUser,
          password,
          admin: false,
          label: `realm user ${realmUser}`,
        });
      })(),
    );
  }

  if (mode === 'all') {
    for (const u of EXTRA_USERS) {
      tasks.push(
        (async () => {
          await registerUser({
            username: u.username,
            password: u.password,
            admin: u.admin,
            label: u.username,
          });
          if (u.ensureUserRecord) {
            await ensureUserRecord(`@${u.username}:localhost`);
          }
        })(),
      );
    }
  }

  await Promise.all(tasks);
}

main().catch((e) => {
  console.error('unexpected error', e);
  process.exit(1);
});
