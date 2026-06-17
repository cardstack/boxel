/**
 * Integration smoke tests for the software factory.
 *
 * Sets up three real-world scenarios in a live Boxel realm and invokes
 * `pnpm factory:go` against them. These tests hit a real LLM and write
 * to a real realm — they are NOT part of CI.
 *
 * Scenarios:
 *   1. Bootstrap complete, no code yet — agent implements from scratch
 *   2. Blocked issue with validation failures — agent retries blocked work by default
 *   3. Completed project, new enhancement — agent picks up new backlog issue
 *
 * Prerequisites:
 *   - Docker running, `mise run dev-all` (realm server, host app, Synapse, etc.)
 *   - Active Boxel profile (`boxel profile add`)
 *   - LLM backend credentials matching --agent (default: `claude login` or
 *     ANTHROPIC_API_KEY; `--agent openrouter` needs OPENROUTER_API_KEY)
 *
 * Usage:
 *   pnpm smoke:factory-scenarios --scenario 1 [--debug]
 *   pnpm smoke:factory-scenarios --scenario 2 [--debug]
 *   pnpm smoke:factory-scenarios --scenario 3 [--debug]
 *   pnpm smoke:factory-scenarios --scenario all [--debug]
 */

// This should be first
import '../../src/setup-logger.ts';

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { inferDarkfactoryModuleUrl } from '../../src/factory-seed.ts';
import { logger } from '../../src/logger.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let log = logger('smoke-factory-scenarios');
let packageRoot = resolve(import.meta.dirname, '../..');

const DEFAULT_BRIEF_URL =
  'http://localhost:4201/software-factory/Wiki/sticky-note';

// ---------------------------------------------------------------------------
// Card fixture content
// ---------------------------------------------------------------------------

function buildSeedIssueDocument(darkfactoryModuleUrl: string) {
  return {
    data: {
      type: 'card',
      attributes: {
        issueId: 'BOOT-1',
        summary: 'Process brief and create project artifacts',
        description: 'Bootstrap issue — already completed.',
        issueType: 'bootstrap',
        status: 'done',
        priority: 'critical',
        order: 0,
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
      },
      meta: {
        adoptsFrom: { module: darkfactoryModuleUrl, name: 'Issue' },
      },
    },
  };
}

function buildProjectDocument(
  darkfactoryModuleUrl: string,
  overrides?: { projectStatus?: string },
) {
  return {
    data: {
      type: 'card',
      attributes: {
        projectCode: 'HELLO',
        projectName: 'Hello Card Project',
        projectStatus: overrides?.projectStatus ?? 'active',
        objective:
          'Create a HelloCard with a greeting field that renders in isolated view.',
        scope:
          '## Scope\n\nSingle card definition with one string field, co-located QUnit tests, and a catalog spec.',
        technicalContext:
          '## Technical Context\n\nUses Boxel CardDef with @field decorator. Greeting field renders in isolated template.',
        successCriteria:
          '- HelloCard definition with greeting field\n- Isolated view renders greeting\n- QUnit tests pass\n- Catalog spec with example instance',
      },
      meta: {
        adoptsFrom: { module: darkfactoryModuleUrl, name: 'Project' },
      },
    },
  };
}

function buildKnowledgeArticleDocument(darkfactoryModuleUrl: string) {
  return {
    data: {
      type: 'card',
      attributes: {
        articleTitle: 'Hello Card Brief Context',
        articleType: 'context',
        content:
          '## Brief Context\n\nBuild a HelloCard — a simple greeting card with a `greeting` string field. ' +
          'The card should render the greeting text in its isolated view using a `<h1>` tag with a `data-test-greeting` attribute. ' +
          'If no greeting is set, display "Hello World" as the default.',
        tags: ['hello-card', 'brief'],
        updatedAt: '2026-04-14T00:00:00.000Z',
      },
      meta: {
        adoptsFrom: { module: darkfactoryModuleUrl, name: 'KnowledgeArticle' },
      },
    },
  };
}

function buildIssueDocument(
  darkfactoryModuleUrl: string,
  opts: {
    issueId: string;
    summary: string;
    description: string;
    status: string;
    priority: string;
    order: number;
    acceptanceCriteria?: string;
    comments?: { body: string; author: string; datetime: string }[];
  },
) {
  return {
    data: {
      type: 'card',
      attributes: {
        issueId: opts.issueId,
        summary: opts.summary,
        description: opts.description,
        issueType: 'feature',
        status: opts.status,
        priority: opts.priority,
        order: opts.order,
        acceptanceCriteria:
          opts.acceptanceCriteria ??
          '- [ ] Card definition exists\n- [ ] Tests pass',
        comments: opts.comments ?? [],
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
      },
      relationships: {
        project: {
          links: { self: '../Projects/hello-card' },
        },
        'relatedKnowledge.0': {
          links: {
            self: '../Knowledge Articles/hello-card-brief-context',
          },
        },
      },
      meta: {
        adoptsFrom: { module: darkfactoryModuleUrl, name: 'Issue' },
      },
    },
  };
}

function buildSpecDocument() {
  return {
    data: {
      type: 'card',
      attributes: {
        ref: { module: './hello', name: 'HelloCard' },
        specType: 'card',
        readMe:
          '# HelloCard\n\nA simple greeting card with a greeting field that renders in isolated view.',
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/spec',
          name: 'Spec',
        },
      },
    },
  };
}

// Working HelloCard .gts content (passes tests)
const WORKING_HELLO_GTS = `import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class HelloCard extends CardDef {
  static displayName = 'Hello Card';
  @field greeting = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: HelloCard) {
      return this.greeting ?? 'Hello World';
    },
  });
  static isolated = class Isolated extends Component<typeof HelloCard> {
    <template>
      <h1 data-test-greeting>{{if @model.greeting @model.greeting 'Hello World'}}</h1>
    </template>
  };
}
`;

// Buggy HelloCard .gts content (doesn't render greeting — test fails)
const BUGGY_HELLO_GTS = `import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class HelloCard extends CardDef {
  static displayName = 'Hello Card';
  @field greeting = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: HelloCard) {
      return this.greeting ?? 'Hello World';
    },
  });
  static isolated = class Isolated extends Component<typeof HelloCard> {
    <template>
      <h1 data-test-greeting>Placeholder</h1>
    </template>
  };
}
`;

// QUnit test for HelloCard
const HELLO_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard', function (hooks) {
    setupCardTest(hooks);

    test('greeting renders in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('Hello from smoke test');
    });
  });
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(): {
  scenario: string;
  debug: boolean;
  briefUrl: string;
} {
  let args = process.argv.slice(2);
  let scenario = 'all';
  let debug = false;
  let briefUrl = DEFAULT_BRIEF_URL;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--' && i === 0) continue;
    if (args[i] === '--scenario' && args[i + 1]) {
      scenario = args[++i];
    } else if (args[i] === '--debug') {
      debug = true;
    } else if (args[i] === '--brief-url' && args[i + 1]) {
      briefUrl = args[++i];
    }
  }

  return { scenario, debug, briefUrl };
}

async function writeFixture(
  realmUrl: string,
  path: string,
  content: string,
  client: BoxelCLIClient,
): Promise<void> {
  let result = await client.write(realmUrl, path, content);
  if (!result.ok) {
    throw new Error(`Failed to write ${path}: ${result.error}`);
  }
  log.info(`  Wrote ${path}`);
}

async function writeJsonFixture(
  realmUrl: string,
  path: string,
  document: unknown,
  client: BoxelCLIClient,
): Promise<void> {
  await writeFixture(realmUrl, path, JSON.stringify(document, null, 2), client);
  // Wait for the card to be indexed
  let cardPath = path.replace(/\.json$/, '');
  let readable = await client.waitForFile(realmUrl, cardPath, {
    timeoutMs: 15_000,
    pollMs: 500,
  });
  if (!readable) {
    log.warn(`  Warning: ${path} written but not readable after 15s`);
  }
}

function runFactory(
  realmUrl: string,
  briefUrl: string,
  extraArgs: string[],
  debug: boolean,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    let args = [
      '--silent',
      'factory:go',
      '--',
      '--brief-url',
      briefUrl,
      '--target-realm',
      realmUrl,
    ];
    if (debug) {
      args.push('--debug');
    }
    args.push(...extraArgs);

    log.info(`\n  Running: pnpm ${args.join(' ')}\n`);

    let child = spawn('pnpm', args, {
      cwd: packageRoot,
      env: process.env,
      // stderr streams live to terminal, stdout captured for JSON summary
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => {
      resolvePromise({ status, stdout, stderr: '' });
    });
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenario1(
  realmUrl: string,
  darkfactoryModuleUrl: string,
  briefUrl: string,
  debug: boolean,
  client: BoxelCLIClient,
): Promise<boolean> {
  log.info('');
  log.info('=== Scenario 1: Bootstrap Complete, No Code Yet ===');
  log.info('');
  log.info(
    'Setup: Project + Issues exist in realm but no card definitions or tests.',
  );
  log.info('Expected: Agent picks up backlog issue and implements the card.');
  log.info('');

  // Write fixture cards
  log.info('Writing fixture cards...');
  await writeJsonFixture(
    realmUrl,
    'Issues/bootstrap-seed.json',
    buildSeedIssueDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Projects/hello-card.json',
    buildProjectDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Knowledge Articles/hello-card-brief-context.json',
    buildKnowledgeArticleDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Issues/hello-card-define.json',
    buildIssueDocument(darkfactoryModuleUrl, {
      issueId: 'HELLO-1',
      summary: 'Create HelloCard definition with greeting field and tests',
      description:
        'Create a HelloCard with a `greeting` string field. ' +
        'The card should render the greeting in isolated view using `<h1 data-test-greeting>`. ' +
        'Default to "Hello World" when no greeting is set.\n\n' +
        'Write co-located QUnit tests in `hello.test.gts` and a catalog spec in `Spec/hello-card.json`.',
      status: 'backlog',
      priority: 'high',
      order: 1,
      acceptanceCriteria:
        '- [ ] hello.gts exists with HelloCard definition\n' +
        '- [ ] greeting field renders in isolated view\n' +
        '- [ ] hello.test.gts with passing QUnit tests\n' +
        '- [ ] Spec/hello-card.json catalog spec',
    }),
    client,
  );

  log.info('');
  log.info('Running factory...');
  let result = await runFactory(realmUrl, briefUrl, [], debug);

  log.info('');
  log.info(`Factory exited with status: ${result.status}`);
  let ok = result.status === 0;
  if (!ok) {
    log.info('Factory failed. Check the output above for details.');
  }

  log.info('');
  log.info('What to look for in the Boxel app:');
  log.info(`  Target realm: ${realmUrl}`);
  log.info('  - Issues/hello-card-define should be "done" or "in_progress"');
  log.info('  - hello.gts should exist with a HelloCard definition');
  log.info('  - hello.test.gts should exist with QUnit tests');
  log.info('  - Test Runs/ should have validation results');
  log.info('');

  return ok;
}

async function scenario2(
  realmUrl: string,
  darkfactoryModuleUrl: string,
  briefUrl: string,
  debug: boolean,
  client: BoxelCLIClient,
): Promise<boolean> {
  log.info('');
  log.info('=== Scenario 2: Blocked Issue with Validation Failures ===');
  log.info('');
  log.info(
    'Setup: Issue is blocked after max iterations. Buggy code + failing test exist.',
  );
  log.info(
    'Expected: Factory auto-resets the blocked issue. Agent reads failure context and fixes the bug.',
  );
  log.info('');

  // Write fixture cards
  log.info('Writing fixture cards...');
  await writeJsonFixture(
    realmUrl,
    'Issues/bootstrap-seed.json',
    buildSeedIssueDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Projects/hello-card.json',
    buildProjectDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Knowledge Articles/hello-card-brief-context.json',
    buildKnowledgeArticleDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Issues/hello-card-define.json',
    buildIssueDocument(darkfactoryModuleUrl, {
      issueId: 'HELLO-1',
      summary: 'Create HelloCard definition with greeting field and tests',
      description:
        'Create a HelloCard with a `greeting` string field. ' +
        'The card should render the greeting in isolated view using `<h1 data-test-greeting>`. ' +
        'Default to "Hello World" when no greeting is set.\n\n' +
        'Write co-located QUnit tests in `hello.test.gts` and a catalog spec in `Spec/hello-card.json`.',
      status: 'blocked',
      priority: 'high',
      order: 1,
      comments: [
        {
          body:
            '**Blocked: max iteration limit reached (5 turns) with failing validation.**\n\n' +
            'The agent was unable to resolve validation failures within the allowed number of iterations.\n\n' +
            '### Last Validation Results\n\n' +
            '**test**: FAILED\n' +
            '- HelloCard > greeting renders in isolated view: ' +
            "Expected 'Hello from smoke test' but got 'Placeholder'",
          author: 'orchestrator',
          datetime: '2026-04-14T01:00:00.000Z',
        },
      ],
    }),
    client,
  );

  // Write buggy code + test
  log.info('Writing buggy card definition and test...');
  await writeFixture(realmUrl, 'hello.gts', BUGGY_HELLO_GTS, client);
  await writeFixture(realmUrl, 'hello.test.gts', HELLO_TEST_GTS, client);

  log.info('');
  log.info('Running factory (blocked issues are auto-retried by default)...');
  let result = await runFactory(realmUrl, briefUrl, [], debug);

  log.info('');
  log.info(`Factory exited with status: ${result.status}`);
  let ok = result.status === 0;
  if (!ok) {
    log.info('Factory failed. Check the output above for details.');
  }

  log.info('');
  log.info('What to look for in the Boxel app:');
  log.info(`  Target realm: ${realmUrl}`);
  log.info('  - Issues/hello-card-define should show the retry comment');
  log.info(
    '  - hello.gts should be updated (greeting renders instead of "Placeholder")',
  );
  log.info('  - Test Runs/ should have new validation results');
  log.info('');

  return ok;
}

async function scenario3(
  realmUrl: string,
  darkfactoryModuleUrl: string,
  briefUrl: string,
  debug: boolean,
  client: BoxelCLIClient,
): Promise<boolean> {
  log.info('');
  log.info('=== Scenario 3: Completed Project, New Enhancement ===');
  log.info('');
  log.info(
    'Setup: All original work done. Working code + tests. New enhancement issue in backlog.',
  );
  log.info(
    'Expected: Agent picks up the new enhancement issue and implements it.',
  );
  log.info('');

  // Write fixture cards
  log.info('Writing fixture cards...');
  await writeJsonFixture(
    realmUrl,
    'Issues/bootstrap-seed.json',
    buildSeedIssueDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Projects/hello-card.json',
    buildProjectDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Knowledge Articles/hello-card-brief-context.json',
    buildKnowledgeArticleDocument(darkfactoryModuleUrl),
    client,
  );
  await writeJsonFixture(
    realmUrl,
    'Issues/hello-card-define.json',
    buildIssueDocument(darkfactoryModuleUrl, {
      issueId: 'HELLO-1',
      summary: 'Create HelloCard definition with greeting field and tests',
      description: 'Original implementation issue — completed.',
      status: 'done',
      priority: 'high',
      order: 1,
    }),
    client,
  );

  // Write working code + test + spec
  log.info('Writing working card definition, test, and spec...');
  await writeFixture(realmUrl, 'hello.gts', WORKING_HELLO_GTS, client);
  await writeFixture(realmUrl, 'hello.test.gts', HELLO_TEST_GTS, client);
  await writeJsonFixture(
    realmUrl,
    'Spec/hello-card.json',
    buildSpecDocument(),
    client,
  );

  // Write new enhancement issue
  await writeJsonFixture(
    realmUrl,
    'Issues/hello-card-enhance.json',
    buildIssueDocument(darkfactoryModuleUrl, {
      issueId: 'HELLO-2',
      summary: 'Add a color field to HelloCard',
      description:
        'Enhance the existing HelloCard by adding a `color` string field. ' +
        'The color should be applied as the text color of the greeting in isolated view. ' +
        'Use inline style: `style="color: {{@model.color}}"` on the `<h1>` element.\n\n' +
        'Update the existing QUnit tests to verify the color renders. ' +
        'Add new test assertions for the color field.',
      status: 'backlog',
      priority: 'high',
      order: 2,
      acceptanceCriteria:
        '- [ ] HelloCard has a color string field\n' +
        '- [ ] Color applies to greeting text in isolated view\n' +
        '- [ ] QUnit tests verify color rendering\n' +
        '- [ ] Existing greeting tests still pass',
    }),
    client,
  );

  log.info('');
  log.info('Running factory...');
  let result = await runFactory(realmUrl, briefUrl, [], debug);

  log.info('');
  log.info(`Factory exited with status: ${result.status}`);
  let ok = result.status === 0;
  if (!ok) {
    log.info('Factory failed. Check the output above for details.');
  }

  log.info('');
  log.info('What to look for in the Boxel app:');
  log.info(`  Target realm: ${realmUrl}`);
  log.info('  - Issues/hello-card-define should still be "done"');
  log.info('  - Issues/hello-card-enhance should be "done" or "in_progress"');
  log.info('  - hello.gts should have a color field added');
  log.info('  - hello.test.gts should have new color test assertions');
  log.info('');

  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let { scenario, debug, briefUrl } = parseArgs();

  let client = new BoxelCLIClient();
  let active = client.getActiveProfile();
  if (!active) {
    log.error(
      'No active Boxel profile found. Run `boxel profile add` to configure one.',
    );
    process.exit(1);
  }

  let username = active.matrixId.replace(/^@/, '').replace(/:.*$/, '');

  // No upfront API-key gate here — the factory itself validates credentials
  // for the chosen `--agent`. The default Claude path works with either a
  // `claude login` session or ANTHROPIC_API_KEY; `--agent openrouter` still
  // needs OPENROUTER_API_KEY.

  let realmServerUrl = active.realmServerUrl;
  if (!realmServerUrl.endsWith('/')) {
    realmServerUrl += '/';
  }

  log.info('=== Software Factory Smoke Test Scenarios ===');
  log.info('');
  log.info(`Realm server: ${realmServerUrl}`);
  log.info(`Brief URL: ${briefUrl}`);
  log.info(`Scenario: ${scenario}`);
  log.info(`Debug: ${debug}`);

  let scenarios = scenario === 'all' ? ['1', '2', '3'] : [scenario];
  let results: { name: string; ok: boolean }[] = [];

  for (let s of scenarios) {
    let realmEndpoint = `smoke-s${s}`;
    let realmDisplayName = `Smoke Test S${s}`;
    let targetRealm = `${realmServerUrl}${username}/${realmEndpoint}/`;

    log.info('');
    log.info(`--- Creating realm: ${realmEndpoint} ---`);
    await BoxelCLIClient.ensureProfile({ realmServerUrl });
    try {
      let createResult = await client.createRealm({
        realmName: realmEndpoint,
        displayName: realmDisplayName,
      });
      if (createResult.created) {
        log.info(`Created realm: ${createResult.realmUrl}`);
      } else {
        log.info(`Realm already exists: ${createResult.realmUrl}`);
      }
      targetRealm = createResult.realmUrl;
    } catch (err) {
      log.error(
        `Failed to create realm: ${err instanceof Error ? err.message : String(err)}`,
      );
      results.push({ name: `Scenario ${s}`, ok: false });
      continue;
    }

    let darkfactoryModuleUrl = inferDarkfactoryModuleUrl(targetRealm);

    let ok: boolean;
    if (s === '1') {
      ok = await scenario1(
        targetRealm,
        darkfactoryModuleUrl,
        briefUrl,
        debug,
        client,
      );
    } else if (s === '2') {
      ok = await scenario2(
        targetRealm,
        darkfactoryModuleUrl,
        briefUrl,
        debug,
        client,
      );
    } else if (s === '3') {
      ok = await scenario3(
        targetRealm,
        darkfactoryModuleUrl,
        briefUrl,
        debug,
        client,
      );
    } else {
      log.error(`Unknown scenario: ${s}. Use 1, 2, 3, or all.`);
      process.exit(1);
    }

    results.push({ name: `Scenario ${s}`, ok });
  }

  // Summary
  log.info('');
  log.info('=== Results ===');
  for (let r of results) {
    log.info(`  ${r.ok ? '\u2713' : '\u2717'} ${r.name}`);
  }
  log.info('');

  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
