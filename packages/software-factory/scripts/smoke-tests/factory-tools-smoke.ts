/**
 * Smoke test for the ToolRegistry, ToolExecutor, and ToolBuilder.
 *
 * No running services required — exercises the registry, manifest validation,
 * safety checks, mocked realm-api round-trips, and the FactoryTool builder
 * entirely in-process.
 *
 * Usage:
 *   pnpm smoke:tools
 */

// This should be first
import '../../src/setup-logger.ts';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from '../../src/logger.ts';

import {
  ToolExecutor,
  ToolNotFoundError,
  ToolSafetyError,
} from '../../src/factory-tool-executor.ts';

function makeMockClient(fetchImpl: typeof globalThis.fetch): BoxelCLIClient {
  async function jsonFetch(
    input: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetchImpl(input, init);
  }
  let mock = {
    async read(realmUrl: string, path: string) {
      let url = new URL(
        path,
        realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`,
      ).href;
      let response = await jsonFetch(url, { method: 'GET' });
      if (!response.ok) {
        return { ok: false, status: response.status, error: 'http error' };
      }
      return {
        ok: true,
        status: response.status,
        document: await response.json(),
      };
    },
    async write(realmUrl: string, path: string) {
      let url = new URL(
        path,
        realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`,
      ).href;
      let response = await jsonFetch(url, { method: 'POST' });
      return response.ok ? { ok: true } : { ok: false, error: 'http error' };
    },
    async delete(realmUrl: string, path: string) {
      let url = new URL(
        path,
        realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`,
      ).href;
      let response = await jsonFetch(url, { method: 'DELETE' });
      return response.ok ? { ok: true } : { ok: false, error: 'http error' };
    },
    async search(realmUrl: string) {
      let response = await jsonFetch(`${realmUrl}_search`, { method: 'QUERY' });
      if (!response.ok) {
        return { ok: false, status: response.status, error: 'http error' };
      }
      let json = await response.json();
      return { ok: true, data: json?.data };
    },
    async listFiles() {
      return { filenames: [] };
    },
    async runCommand() {
      return { status: 'ready' as const, result: null, error: null };
    },
    async lint() {
      return { fixed: false, output: '', messages: [] };
    },
    async waitForReady() {
      return { ready: true };
    },
    async waitForFile() {
      return true;
    },
    async atomicOperation() {
      return { ok: true };
    },
    async cancelAllIndexingJobs() {
      return { ok: true };
    },
    async getRealmToken() {
      return 'Bearer mock-jwt';
    },
    async authedFetch(input: string | URL | Request, init?: RequestInit) {
      return fetchImpl(input, init);
    },
    async authedServerFetch(input: string | URL | Request, init?: RequestInit) {
      return fetchImpl(input, init);
    },
    getActiveProfile() {
      return null;
    },
    async pull() {
      return { files: [] };
    },
    async createRealm() {
      return {
        realmUrl: 'https://realms.example.test/mock/',
        created: true,
      };
    },
  };
  return mock as unknown as BoxelCLIClient;
}
import {
  buildFactoryTools,
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type DoneResult,
  type ClarificationResult,
} from '../../src/factory-tool-builder.ts';
import { ToolRegistry } from '../../src/factory-tool-registry.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let log = logger('factory-tools-smoke');

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    log.info(`  \u2713 ${label}`);
  } else {
    failed++;
    log.info(`  \u2717 ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // 1. Registry
  // -----------------------------------------------------------------------

  log.info('');
  log.info('=== Tool Registry ===');
  log.info('');

  let registry = new ToolRegistry();
  let manifests = registry.getManifests();

  log.info(`Registered tools: ${manifests.length}`);
  log.info('');

  let byCategory: Record<string, string[]> = {};
  for (let m of manifests) {
    (byCategory[m.category] ??= []).push(m.name);
  }

  for (let [category, names] of Object.entries(byCategory)) {
    log.info(`  ${category} (${names.length}):`);
    for (let name of names) {
      let manifest = registry.getManifest(name)!;
      let requiredArgs = manifest.args
        .filter((a) => a.required)
        .map((a) => a.name);
      let optionalArgs = manifest.args
        .filter((a) => !a.required)
        .map((a) => a.name);
      log.info(
        `    - ${name}  [${manifest.outputFormat}]` +
          (requiredArgs.length
            ? `  required: ${requiredArgs.join(', ')}`
            : '') +
          (optionalArgs.length ? `  optional: ${optionalArgs.join(', ')}` : ''),
      );
    }
    log.info('');
  }

  check('has script tools', byCategory['script']?.length === 2);
  check('has boxel-cli tools', byCategory['boxel-cli']?.length === 6);
  check('has realm-api tools', byCategory['realm-api']?.length === 5);
  check(
    'all names unique',
    new Set(manifests.map((m) => m.name)).size === manifests.length,
  );

  // -----------------------------------------------------------------------
  // 2. Argument validation
  // -----------------------------------------------------------------------

  log.info('');
  log.info('=== Argument Validation ===');
  log.info('');

  let validErrors = registry.validateArgs('search-realm', {
    realm: 'http://example.test/',
  });
  check('valid args -> no errors', validErrors.length === 0);

  let missingErrors = registry.validateArgs('search-realm', {});
  check(
    'missing required arg -> error',
    missingErrors.length > 0 && missingErrors[0].includes('realm'),
  );

  let unknownErrors = registry.validateArgs('not-a-tool', {});
  check(
    'unknown tool -> error',
    unknownErrors.length > 0 && unknownErrors[0].includes('Unknown'),
  );

  // -----------------------------------------------------------------------
  // 3. Safety constraints
  // -----------------------------------------------------------------------

  log.info('');
  log.info('=== Safety Constraints ===');
  log.info('');

  let safetyClient = makeMockClient(async () => new Response('{}'));
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealm: 'https://realms.example.test/user/target/',
    sourceRealm: 'https://realms.example.test/user/source/',
    allowedRealmPrefixes: ['https://realms.example.test/user/scratch-'],
    client: safetyClient,
  });

  // Unregistered tool
  try {
    await executor.execute('rm-rf');
    check('rejects unregistered tool', false, 'did not throw');
  } catch (err) {
    check('rejects unregistered tool', err instanceof ToolNotFoundError);
  }

  // Source realm targeting
  try {
    await executor.execute('search-realm', {
      realm: 'https://realms.example.test/user/source/',
    });
    check('rejects source realm', false, 'did not throw');
  } catch (err) {
    check('rejects source realm', err instanceof ToolSafetyError);
  }

  // Unknown realm targeting (realm-api)
  try {
    await executor.execute('realm-read', {
      'realm-url': 'https://evil.example.test/hacker/realm/',
      path: 'secrets.json',
    });
    check('rejects unknown realm', false, 'did not throw');
  } catch (err) {
    check('rejects unknown realm', err instanceof ToolSafetyError);
  }

  // -----------------------------------------------------------------------
  // 4. Mocked realm-api round-trip
  // -----------------------------------------------------------------------

  log.info('');
  log.info('=== Realm API Round-Trip (mock) ===');
  log.info('');

  let mockCallCount = 0;

  let mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    mockCallCount++;
    let url = String(input);
    let method = init?.method ?? 'GET';
    log.info(`  -> ${method} ${url}`);
    return new Response(
      JSON.stringify({
        data: [{ id: 'CardDef/hello', type: 'card' }],
      }),
      { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
    );
  }) as typeof globalThis.fetch;
  let mockClient = makeMockClient(mockFetch);
  let mockExecutor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealm: 'https://realms.example.test/user/target/',
    client: mockClient,
  });

  let readResult = await mockExecutor.execute('realm-read', {
    'realm-url': 'https://realms.example.test/user/target/',
    path: 'CardDef/hello.gts',
  });
  check('realm-read exitCode=0', readResult.exitCode === 0);
  check('realm-read has output', readResult.output !== undefined);
  check(
    `realm-read duration ${readResult.durationMs}ms`,
    readResult.durationMs >= 0,
  );

  let searchResult = await mockExecutor.execute('realm-search', {
    'realm-url': 'https://realms.example.test/user/target/',
    query: JSON.stringify({ filter: { type: { name: 'Issue' } } }),
  });
  check('realm-search exitCode=0', searchResult.exitCode === 0);

  let writeResult = await mockExecutor.execute('realm-write', {
    'realm-url': 'https://realms.example.test/user/target/',
    path: 'CardDef/new.gts',
    content: 'export class NewCard {}',
  });
  check('realm-write exitCode=0', writeResult.exitCode === 0);

  check(`mock fetch called ${mockCallCount} times`, mockCallCount === 3);

  // -----------------------------------------------------------------------
  // 5. FactoryTool builder
  // -----------------------------------------------------------------------

  log.info('');
  log.info('=== Factory Tool Builder ===');
  log.info('');

  let toolBuilderFetchCount = 0;
  let toolBuilderFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    toolBuilderFetchCount++;
    let url = String(input);
    let method = init?.method ?? 'GET';
    log.info(`  -> ${method} ${url}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': SupportedMimeType.JSON },
    });
  }) as typeof globalThis.fetch;

  let toolBuilderClient = makeMockClient(toolBuilderFetch);
  let toolBuilderExecutor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealm: 'https://realms.example.test/user/target/',
    client: toolBuilderClient,
  });

  let factoryTools = buildFactoryTools(
    {
      targetRealm: 'https://realms.example.test/user/target/',
      realmServerUrl: 'https://realms.example.test/',
      client: toolBuilderClient,
      // Smoke test doesn't exercise fs I/O — any real path is fine.
      workspaceDir: '/tmp/boxel-factory-smoke',
      syncWorkspace: async () => ({ ok: true }),
    },
    toolBuilderExecutor,
    registry,
  );

  let toolNames = factoryTools.map((t) => t.name);
  log.info(`  Built ${factoryTools.length} tools:`);
  log.info(
    `    factory: ${toolNames.filter((n) => ['write_file', 'read_file', 'search_realm', 'run_command', 'signal_done', 'request_clarification', 'update_project', 'update_issue', 'create_knowledge'].includes(n)).join(', ')}`,
  );
  log.info(
    `    registered: ${toolNames.filter((n) => !['write_file', 'read_file', 'search_realm', 'run_command', 'signal_done', 'request_clarification', 'update_project', 'update_issue', 'create_knowledge'].includes(n)).join(', ')}`,
  );
  log.info('');

  check('has write_file tool', toolNames.includes('write_file'));
  check('has read_file tool', toolNames.includes('read_file'));
  check('has search_realm tool', toolNames.includes('search_realm'));
  check('has signal_done tool', toolNames.includes('signal_done'));
  check(
    'has request_clarification tool',
    toolNames.includes('request_clarification'),
  );
  check('includes registered script tools', toolNames.includes('search-realm'));
  check(
    'includes registered realm-api tools',
    toolNames.includes('realm-read'),
  );

  // Test write_file with .gts (module source)
  let writeFileTool = factoryTools.find((t) => t.name === 'write_file')!;
  toolBuilderFetchCount = 0;
  let gtsResult = (await writeFileTool.execute({
    path: 'my-card.gts',
    content: 'export class MyCard {}',
  })) as { ok: boolean };
  check('write_file .gts succeeds', gtsResult.ok === true);
  check('write_file .gts made HTTP call', toolBuilderFetchCount === 1);

  // Test write_file with .json (card source)
  toolBuilderFetchCount = 0;
  let jsonResult = (await writeFileTool.execute({
    path: 'Card/1.json',
    content: JSON.stringify({ data: { type: 'card', attributes: {} } }),
  })) as { ok: boolean };
  check('write_file .json succeeds', jsonResult.ok === true);
  check('write_file .json made HTTP call', toolBuilderFetchCount === 1);

  // Test write_file to test realm
  toolBuilderFetchCount = 0;
  await writeFileTool.execute({
    path: 'Tests/spec.ts',
    content: 'test content',
    realm: 'test',
  });
  check('write_file to test realm made HTTP call', toolBuilderFetchCount === 1);

  // Test signal_done
  let doneTool = factoryTools.find((t) => t.name === 'signal_done')!;
  let doneResult = (await doneTool.execute({})) as DoneResult;
  check('signal_done returns DONE_SIGNAL', doneResult.signal === DONE_SIGNAL);

  // Test request_clarification
  let clarifyTool = factoryTools.find(
    (t) => t.name === 'request_clarification',
  )!;
  let clarifyResult = (await clarifyTool.execute({
    message: 'Need more info',
  })) as ClarificationResult;
  check(
    'request_clarification returns CLARIFICATION_SIGNAL',
    clarifyResult.signal === CLARIFICATION_SIGNAL,
  );
  check(
    'request_clarification has message',
    clarifyResult.message === 'Need more info',
  );

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  log.info('');
  log.info('===========================');
  log.info(`  ${passed} passed, ${failed} failed`);
  log.info('===========================');
  log.info('');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error(
    'Smoke test failed:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
