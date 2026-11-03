import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import {
  addToCreditsLedger,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { addSystemKey, SystemKeyError } from './system-keys.ts';

const log = logger('local-vendor-keys');

// The OpenRouter endpoints a local stack's proxy serves with one key. Each is
// its own destination: a row for the whole `/api/v1` prefix would also admit
// OpenRouter's key-management and credit endpoints under the platform's key.
// All of them charge Boxel credits from the cost OpenRouter reports.
const OPENROUTER_DESTINATIONS = [
  {
    destination: 'https://openrouter.ai/api/v1/chat/completions',
    supportsStreaming: true,
  },
  {
    destination: 'https://openrouter.ai/api/v1/embeddings',
    supportsStreaming: false,
  },
  {
    // Audio bytes stream through as they arrive without SSE framing, so this
    // destination does not need the SSE streaming path.
    destination: 'https://openrouter.ai/api/v1/audio/speech',
    supportsStreaming: false,
  },
  {
    destination: 'https://openrouter.ai/api/v1/audio/transcriptions',
    supportsStreaming: false,
  },
  // The rest of OpenRouter's generation API. Each answers JSON with the cost in
  // `usage.cost`, so the proxy bills them like chat. Video is left out: a job is
  // polled, and every poll repeats its cost.
  { destination: 'https://openrouter.ai/api/v1/responses', supportsStreaming: true },
  { destination: 'https://openrouter.ai/api/v1/messages', supportsStreaming: true },
  { destination: 'https://openrouter.ai/api/v1/rerank', supportsStreaming: false },
  { destination: 'https://openrouter.ai/api/v1/images', supportsStreaming: false },
  { destination: 'https://openrouter.ai/api/v1/systemone', supportsStreaming: false },
  // Alpha: typed questions and typed field extraction over a state.
  { destination: 'https://openrouter.ai/api/alpha/decisions', supportsStreaming: false },
  { destination: 'https://openrouter.ai/api/alpha/extractions', supportsStreaming: false },
];

// Credits each local user starts with, once, so the credit gate admits their
// calls and every call is visibly debited. 1000 credits are $1 of usage.
const DEFAULT_STARTING_CREDITS = 5000;

/**
 * Local stacks only. Seals the vendor keys their owner placed in
 * `BOXEL_LOCAL_VENDOR_KEYS_DIR` as system keys, the local equivalent of
 * `boxel realm-server keys add --key-file`, whose operator token needs the
 * realm secret seed a managed environment keeps out of agents' reach.
 *
 * `openrouter.key` holds an OpenRouter key. A destination that already has a
 * system key keeps it, so editing the file later changes nothing; replace a
 * key with the operator CLI. Nothing here logs or returns a key value.
 */
export async function sealLocalVendorKeys(
  dbAdapter: DBAdapter,
  directory = process.env.BOXEL_LOCAL_VENDOR_KEYS_DIR,
): Promise<void> {
  if (!directory) {
    return;
  }
  let value: string;
  try {
    value = (await readFile(path.join(directory, 'openrouter.key'), 'utf8'))
      .trim();
  } catch {
    return;
  }
  if (!value) {
    return;
  }
  for (let { destination, supportsStreaming } of OPENROUTER_DESTINATIONS) {
    try {
      await addSystemKey(dbAdapter, {
        destination,
        authMethod: 'header',
        paramName: null,
        creditStrategy: 'openrouter',
        supportsStreaming,
        value,
        note: 'Sealed from the local stack’s vendor-keys/openrouter.key',
      });
      log.info(`Sealed the local OpenRouter system key for ${destination}`);
    } catch (error) {
      if (error instanceof SystemKeyError && error.status === 409) {
        continue;
      }
      log.warn(
        `Could not seal the local OpenRouter system key for ${destination}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  await grantStartingCredits(dbAdapter, directory);
}

async function grantStartingCredits(dbAdapter: DBAdapter, directory: string) {
  let amount = DEFAULT_STARTING_CREDITS;
  try {
    let configured = Number(
      (await readFile(path.join(directory, 'starting-credits'), 'utf8')).trim(),
    );
    if (Number.isInteger(configured) && configured >= 0) {
      amount = configured;
    }
  } catch {
    // No file: the default applies.
  }
  let users = (await dbAdapter.execute(
    `SELECT id, matrix_user_id FROM users`,
  )) as { id: string; matrix_user_id: string }[];
  for (let user of users) {
    let ledger = (await dbAdapter.execute(
      `SELECT 1 FROM credits_ledger WHERE user_id = $1 LIMIT 1`,
      { bind: [user.id] },
    )) as unknown[];
    if (ledger.length > 0) {
      continue;
    }
    await addToCreditsLedger(dbAdapter, {
      userId: user.id,
      creditAmount: amount,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
    let balance = await sumUpCreditsLedger(dbAdapter, { userId: user.id });
    log.info(
      `Granted ${amount} starting credits to ${user.matrix_user_id}; balance ${balance}`,
    );
  }
}
