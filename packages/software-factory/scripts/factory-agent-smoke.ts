/**
 * Smoke test for the FactoryAgent → OpenRouter round-trip.
 *
 * Usage:
 *   pnpm factory:agent-smoke -- --realm-server-url <url> [--model <model>]
 *
 * Prerequisites:
 *
 *   1. Realm server authentication — one of:
 *      a. Active Boxel CLI profile (`boxel profile add` then `boxel profile switch`)
 *      b. Environment variables: MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD
 *
 *   2. OpenRouter API key — choose ONE of these approaches:
 *
 *      a. OPENROUTER_API_KEY env var (simplest for local dev / CI):
 *         Calls OpenRouter directly, bypassing the realm server proxy.
 *
 *           OPENROUTER_API_KEY=sk-or-... pnpm factory:agent-smoke -- --realm-server-url <url>
 *
 *      b. Realm server proxy_endpoints table (production path):
 *         The factory goes through _request-forward, which reads the key from
 *         the `proxy_endpoints` table in PostgreSQL.
 *
 *         For local dev, insert it once:
 *
 *           psql -h localhost -p 5435 -U postgres -d boxel
 *
 *           INSERT INTO proxy_endpoints (
 *             id, url, api_key, credit_strategy, supports_streaming,
 *             created_at, updated_at
 *           ) VALUES (
 *             gen_random_uuid(),
 *             'https://openrouter.ai/api/v1/chat/completions',
 *             '<your-openrouter-api-key>',
 *             'openrouter',
 *             true,
 *             NOW(), NOW()
 *           );
 *
 *         For staging/production the row is managed by deployment infrastructure.
 *
 *   3. The realm server must be running and reachable at --realm-server-url.
 *
 * Model selection (optional):
 *   --model <openrouter-model-id>       e.g. anthropic/claude-opus-4
 *   FACTORY_LLM_MODEL env var           same format
 *   Falls back to FACTORY_DEFAULT_MODEL (anthropic/claude-sonnet-4)
 */

import { parseArgs } from 'node:util';

import {
  OpenRouterFactoryAgent,
  resolveFactoryModel,
  type AgentContext,
} from './lib/factory-agent';

async function main(): Promise<void> {
  let { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'realm-server-url': { type: 'string' },
      model: { type: 'string' },
    },
    strict: true,
  });

  let realmServerUrl = values['realm-server-url'];
  if (!realmServerUrl) {
    console.error(
      'Usage: pnpm factory:agent-smoke -- --realm-server-url <url> [--model <model>]',
    );
    process.exit(1);
  }

  // Ensure trailing slash
  if (!realmServerUrl.endsWith('/')) {
    realmServerUrl += '/';
  }

  let model = resolveFactoryModel(values.model);
  console.log(`Model: ${model}`);
  console.log(`Realm server: ${realmServerUrl}`);
  console.log();

  let agent = new OpenRouterFactoryAgent({
    model,
    realmServerUrl,
  });

  let context: AgentContext = {
    project: {
      id: 'Project/smoke-test',
      title: 'Smoke Test Project',
      description: 'A trivial project used to verify the factory agent works.',
    },
    ticket: {
      id: 'Ticket/smoke-test-hello',
      title: 'Create a hello-world card',
      description:
        'Create a simple HelloWorld card definition that renders "Hello, world!" in its fitted view.',
    },
    knowledge: [],
    skills: [],
    tools: [],
    targetRealmUrl: 'https://example.test/user/target/',
    testRealmUrl: 'https://example.test/user/target-tests/',
  };

  console.log('Sending plan() request...');
  console.log();

  let actions = await agent.plan(context);

  console.log(`Received ${actions.length} action(s):`);
  console.log(JSON.stringify(actions, null, 2));
  console.log();
  console.log('Smoke test passed.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
