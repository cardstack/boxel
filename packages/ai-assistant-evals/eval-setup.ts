#!/usr/bin/env node
// Creates the writer's evaluations workspace and pushes eval-realm/ into it:
// the three card definitions, the evaluations, and the fixtures they copy
// into test workspaces. Safe to run again: the workspace is reused and every
// file is written over.
//
//   node eval-setup.ts                     # workspace "evals" for EVAL_WRITER_USER
//   node eval-setup.ts --endpoint my-evals --name "My evaluations"
//
// The display name is applied on every run, so renaming here renames a
// workspace that already exists; _create-realm only sets a name when it
// creates one.
//
// Env: EVAL_WRITER_USER / EVAL_WRITER_PASSWORD (default user / password),
// EVAL_MATRIX_URL, EVAL_REALM_SERVER_URL (default https://localhost:4201).

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { addRealmToAccountData, loginWithPassword } from './matrix-api.ts';
import { RealmClient, waitForCard } from './realm-api.ts';
import {
  REALM_SERVER_URL,
  WRITER_PASSWORD,
  WRITER_USER,
} from './eval-config.ts';

const EVAL_REALM_DIR = join(import.meta.dirname, 'eval-realm');

function parseArgs(argv: string[]) {
  let endpoint = 'evals';
  let name = 'AI Assistant Evaluations';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--endpoint') {
      endpoint = argv[++i];
    } else if (argv[i] === '--name') {
      name = argv[++i];
    } else {
      throw new Error(
        'usage: node eval-setup.ts [--endpoint <slug>] [--name <display name>]',
      );
    }
  }
  return { endpoint, name };
}

async function walk(dir: string): Promise<string[]> {
  let out: string[] = [];
  for (let entry of await readdir(dir, { withFileTypes: true })) {
    let full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out.sort();
}

// The workspace's display name lives in `realm.json` at its root, as
// cardInfo.name. Patch that one field rather than writing the file fresh, so a
// hand-set icon or background survives.
async function renameRealm(
  client: RealmClient,
  realmUrl: string,
  name: string,
): Promise<boolean> {
  let fileUrl = `${realmUrl}realm.json`;
  let config: {
    data?: {
      attributes?: { cardInfo?: { name?: string } };
      meta?: { adoptsFrom: { module: string; name: string } };
    };
  };
  try {
    let { body } = await client.getSource(realmUrl, fileUrl);
    config = JSON.parse(new TextDecoder().decode(body));
  } catch {
    // A workspace with no readable realm.json gets one from the write below.
    config = {};
  }
  let cardInfo = (((config.data ??= {}).attributes ??= {}).cardInfo ??= {});
  if (cardInfo.name === name) {
    return false;
  }
  cardInfo.name = name;
  config.data!.meta ??= {
    adoptsFrom: {
      module: '@cardstack/base/realm-config',
      name: 'RealmConfig',
    },
  };
  await client.putSource(realmUrl, fileUrl, JSON.stringify(config));
  return true;
}

async function main() {
  let { endpoint, name } = parseArgs(process.argv.slice(2));
  let credentials = await loginWithPassword(WRITER_USER, WRITER_PASSWORD);
  let client = new RealmClient(credentials.accessToken, credentials.userId);

  let realm = await client.createRealm(REALM_SERVER_URL, endpoint, name);
  console.log(
    `[setup] ${realm.created ? 'created' : 'using'} workspace ${realm.url}`,
  );
  if (!realm.created && (await renameRealm(client, realm.url, name))) {
    console.log(`[setup] renamed it to "${name}"`);
  }
  if (
    await addRealmToAccountData(
      credentials.userId,
      credentials.accessToken,
      realm.url,
    )
  ) {
    console.log(`[setup] added it to @${WRITER_USER}'s workspace list`);
  }

  let files = await walk(EVAL_REALM_DIR);
  // Definitions first, so instances index against them on the first pass.
  files.sort(
    (a, b) => Number(a.endsWith('.json')) - Number(b.endsWith('.json')),
  );
  let cards: string[] = [];
  for (let file of files) {
    let path = relative(EVAL_REALM_DIR, file).split('\\').join('/');
    await client.putSource(
      realm.url,
      `${realm.url}${path}`,
      await readFile(file, 'utf8'),
    );
    console.log(`[setup] wrote ${path}`);
    if (path.endsWith('.json')) {
      cards.push(`${realm.url}${path.replace(/\.json$/, '')}`);
    }
  }
  for (let card of cards) {
    await waitForCard(client, realm.url, card);
  }
  console.log(`\n[setup] ${cards.length} cards indexed. Evaluations:`);
  for (let card of cards.filter((c) => c.includes('/Evaluation/'))) {
    console.log(`  ${card}`);
  }
  console.log(
    `\n[setup] run one with: pnpm eval <evaluation-url> ["Model A,Model B"]`,
  );
}

main().catch((error) => {
  console.error(
    `[setup] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
