#!/usr/bin/env ts-node
import { registerRealmUser } from './register-realm-user-using-api';

// Usage: register-github-webhook.ts [publicURL] [roomId] [prNumber]
//
// Environment variables (override or replace positional args):
//   REALM_SERVER_URL - realm server base URL (default: http://localhost:4201)
//   COMMAND_URL      - override the command URL registered with the webhook

const realmServerURL = process.env.REALM_SERVER_URL || 'http://localhost:4201';

const commandURL =
  process.env.COMMAND_URL ||
  `${realmServerURL}/catalog/commands/process-github-event/default`;

// Default GitHub webhook config
const webhookConfig = {
  verificationType: 'HMAC_SHA256_HEADER' as const,
  verificationConfig: {
    header: 'x-hub-signature-256',
    encoding: 'hex' as const,
  },
};

// Fetch all webhooks for authenticated user
async function fetchIncomingWebhooks(jwt: string) {
  const response = await fetch(`${realmServerURL}/_incoming-webhooks`, {
    method: 'GET',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to list incoming webhooks: ${response.status} ${text}`,
    );
  }

  const json = await response.json();
  return json?.data ?? [];
}

// Create incoming webhook
async function createIncomingWebhook(
  jwt: string,
  config: typeof webhookConfig,
) {
  const response = await fetch(`${realmServerURL}/_incoming-webhooks`, {
    method: 'POST',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'incoming-webhook',
        attributes: config,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create incoming webhook: ${response.status} ${text}`,
    );
  }

  const json = await response.json();
  return json?.data;
}

// Fetch webhook commands for a specific webhook
async function fetchWebhookCommands(jwt: string, incomingWebhookId?: string) {
  const url = new URL(`${realmServerURL}/_webhook-commands`);
  if (incomingWebhookId) {
    url.searchParams.set('incomingWebhookId', incomingWebhookId);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to list webhook commands: ${response.status} ${text}`,
    );
  }

  const json = await response.json();
  return json?.data ?? [];
}

// Create webhook command
async function createWebhookCommand(
  jwt: string,
  config: {
    incomingWebhookId: string;
    command: string;
    filter?: Record<string, unknown> | null;
  },
) {
  const response = await fetch(`${realmServerURL}/_webhook-commands`, {
    method: 'POST',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'webhook-command',
        attributes: config,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create webhook command: ${response.status} ${text}`,
    );
  }

  const json = await response.json();
  return json?.data;
}

// Idempotent: ensure webhook exists with given config
async function ensureIncomingWebhook(
  jwt: string,
  config: typeof webhookConfig,
) {
  const webhooks = await fetchIncomingWebhooks(jwt);

  // Find existing webhook matching criteria
  const existing = webhooks.find(
    (w: any) =>
      w.attributes?.verificationType === config.verificationType &&
      JSON.stringify(w.attributes?.verificationConfig) ===
      JSON.stringify(config.verificationConfig),
  );

  if (existing) {
    console.log(`Found existing webhook: ${existing.id}`);
    return existing;
  }

  console.log('Creating new incoming webhook...');
  return await createIncomingWebhook(jwt, config);
}

// Idempotent: ensure webhook command exists
async function ensureWebhookCommand(
  jwt: string,
  config: {
    incomingWebhookId: string;
    command: string;
    filter?: Record<string, unknown> | null;
  },
) {
  const commands = await fetchWebhookCommands(jwt, config.incomingWebhookId);

  // Find existing command with same URL and filter
  const existing = commands.find(
    (cmd: any) =>
      cmd.attributes?.command === config.command &&
      JSON.stringify(cmd.attributes?.filter ?? null) ===
      JSON.stringify(config.filter ?? null),
  );

  if (existing) {
    console.log(`Found existing webhook command: ${existing.id}`);
    return existing;
  }

  console.log('Creating new webhook command...');
  return await createWebhookCommand(jwt, config);
}

async function main() {
  console.log('Starting GitHub webhook registration...');
  console.log(`Realm Server:  ${realmServerURL}`);
  console.log(`Command URL:   ${commandURL}`);
  console.log('');

  // Step 1: Authenticate
  console.log('Authenticating...');
  const { jwt, userId } = await registerRealmUser();
  console.log(`Authenticated as: ${userId}`);
  console.log('');

  // Step 2: Ensure webhook exists (idempotent)
  console.log('Setting up incoming webhook...');
  const webhook = await ensureIncomingWebhook(jwt, webhookConfig);

  const webhookBaseURL = realmServerURL;
  const webhookURL = `${webhookBaseURL}/_webhooks/${webhook.attributes.webhookPath}`;
  const localWebhookURL = `${realmServerURL}/_webhooks/${webhook.attributes.webhookPath}`;

  console.log('Webhook details:');
  console.log(`  ID:             ${webhook.id}`);
  console.log(`  Path:           ${webhook.attributes.webhookPath}`);
  console.log(`  Signing secret: ${webhook.attributes.signingSecret}`);
  console.log(`  Local URL:      ${localWebhookURL}`);
  console.log('');

  // Step 3: Register commands for both pull_request and pull_request_review events.
  // Two separate commands are needed because GitHub uses different event headers
  // for PR state changes vs. review submissions.
  console.log('Setting up webhook commands...');

  const baseFilter: Record<string, unknown> = {
    type: 'github-event',
  };

  const eventTypes = [
    'pull_request',
    'pull_request_review',
    'pull_request_review_comment',
    'check_run',
    'commit_comment',
    'discussion_comment',
  ];
  for (let eventType of eventTypes) {
    const cmd = await ensureWebhookCommand(jwt, {
      incomingWebhookId: webhook.id,
      command: commandURL,
      filter: { eventType, ...baseFilter },
    });
    console.log(`  ✓ ${eventType.padEnd(22)} → command ${cmd.id}`);
  }
  console.log('');

  // Step 4: Output configuration and test instructions
  console.log('='.repeat(70));
  console.log('GitHub Webhook Configuration');
  console.log('='.repeat(70));
  console.log('');
  console.log('Add this webhook to your GitHub repository:');
  console.log(`  URL:          ${webhookURL}`);
  console.log(`  Secret:       ${webhook.attributes.signingSecret}`);
  console.log(`  Content type: application/json`);
  console.log(
    `  Events:       Pull requests, Pull request reviews, Pull request review comments, Check runs, Commit comments, Discussion comments`,
  );
  console.log('');

  console.log('='.repeat(70));
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('✓ GitHub webhook registration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ GitHub webhook registration failed:', error.message);
      process.exit(1);
    });
}
