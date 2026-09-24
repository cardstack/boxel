#!/usr/bin/env node
// Makes sure every matrix user the runner drives a browser as exists and takes
// the password the runner will use. A missing one used to surface as a login
// failure on the first turn of a paid run, which is the worst moment to find
// out; this is the same check, before anything is spent.
//
//   node ensure-users.ts            # check, and register whoever is missing
//   node ensure-users.ts --check    # report only, exit 1 if any is missing
//
// Env: EVAL_USERS / EVAL_USER (comma-separated, defaults to the five the spec
// uses), EVAL_PASSWORD, EVAL_MATRIX_URL.

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { loginWithPassword } from './matrix-api.ts';

export const DEFAULT_USERS = [1, 2, 3, 4, 5].map(
  (n) => `ai-assistant-eval-user-${n}`,
);

// packages/matrix owns registration: it talks to the synapse container and
// also adds the row in the users table that the realm server expects. Calling
// it beats a second implementation that could drift from it.
const REGISTER_SCRIPT = join(
  import.meta.dirname,
  '..',
  'matrix',
  'scripts',
  'register-test-user.ts',
);

export function evalUsers(): string[] {
  let configured = process.env.EVAL_USERS ?? process.env.EVAL_USER;
  if (!configured) {
    return DEFAULT_USERS;
  }
  return configured
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

export async function canLogIn(
  username: string,
  password: string,
): Promise<boolean> {
  try {
    await loginWithPassword(username, password);
    return true;
  } catch {
    return false;
  }
}

function register(username: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child = spawn(process.execPath, [REGISTER_SCRIPT], {
      cwd: join(import.meta.dirname, '..', 'matrix'),
      env: {
        ...process.env,
        MATRIX_USERNAME: username,
        MATRIX_PASSWORD: password,
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`registering ${username} exited ${code}`)),
    );
  });
}

async function main() {
  let checkOnly = process.argv.slice(2).includes('--check');
  let password = process.env.EVAL_PASSWORD ?? 'password';
  let users = evalUsers();
  let missing: string[] = [];

  for (let username of users) {
    if (await canLogIn(username, password)) {
      continue;
    }
    missing.push(username);
  }

  if (missing.length === 0) {
    console.log(`[users] all ${users.length} eval users can sign in`);
    return;
  }

  if (checkOnly) {
    console.error(
      `[users] cannot sign in as: ${missing.join(', ')}\n` +
        `[users] run \`pnpm eval:users\` to register them`,
    );
    process.exit(1);
  }

  for (let username of missing) {
    console.log(`[users] registering ${username}`);
    await register(username, password);
  }

  // A registration that reported success but still cannot sign in means the
  // account exists with a different password, which no amount of registering
  // fixes.
  let stillMissing: string[] = [];
  for (let username of missing) {
    if (!(await canLogIn(username, password))) {
      stillMissing.push(username);
    }
  }
  if (stillMissing.length > 0) {
    console.error(
      `[users] still cannot sign in as: ${stillMissing.join(', ')} — the ` +
        `account exists with another password, so either use it with ` +
        `EVAL_PASSWORD or pick other names with EVAL_USERS`,
    );
    process.exit(1);
  }
  console.log(
    `[users] registered ${missing.length}, all eval users can sign in`,
  );
}

main().catch((error) => {
  console.error(
    `[users] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
