import { resolve } from 'node:path';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { createSeedIssue } from '../src/factory-seed.ts';
import type { FactoryBrief } from '../src/factory-brief.ts';
import { RealmIssueStore } from '../src/issue-scheduler.ts';
import { retryWithPoll } from '../src/retry-with-poll.ts';
import { expect, test } from './fixtures.ts';
import { buildTestClient } from './helpers/test-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const bootstrapTargetDir = resolve(
  process.cwd(),
  'test-fixtures',
  'bootstrap-target',
);

const stickyNoteBrief: FactoryBrief = {
  title: 'Sticky Note',
  sourceUrl: 'https://briefs.example.test/software-factory/Wiki/sticky-note',
  content: [
    '## Overview',
    '',
    'The Sticky Note card gives the workspace a structured home for colorful, short-form notes.',
    '',
    '## Core Mechanics',
    '',
    'Sticky Note usually evolves through drafting, review, and reuse.',
    '- The card keeps its core content structured',
    '- It can be surfaced in different views',
    '',
    '## Integration Points',
    '',
    '- **Document** -- link to longer-form content.',
    '- **Workflow Playbook** -- one step inside a repeatable workflow.',
  ].join('\n'),
  contentSummary:
    'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
  tags: ['documents-content', 'sticky', 'note'],
};

// Mirrors realm/Wiki/adjust-mortgage-test.json: a brief that carries a
// `sourceCardUrl`, which flips seed creation into the adjust flow.
const adjustMortgageBrief: FactoryBrief = {
  title: 'Adjust Mortgage Calculator',
  sourceUrl:
    'https://briefs.example.test/software-factory/Wiki/adjust-mortgage-test',
  sourceCardUrl:
    'http://localhost:4201/catalog/04868f-mortgage-calculator/mortgage-calculator',
  content: [
    '## Adjust the Mortgage Calculator card',
    '',
    'Add an extra-monthly-payment input and show its impact on the loan,',
    'and restyle it to look like a 90s-era corporate insurance app.',
  ].join('\n'),
  contentSummary:
    'Add an extra-monthly-payment input to the catalog Mortgage Calculator and restyle it as a 90s-era corporate insurance app.',
  tags: ['software-factory-brief', 'adjust', 'mortgage-calculator'],
};

test.use({ realmDir: bootstrapTargetDir });
test.use({ realmServerMode: 'isolated' });

function buildSeedContext(realm: {
  realmURL: URL;
  realmServerURL: URL;
  ownerBearerToken: string;
  serverToken: string;
}) {
  let darkfactoryModuleUrl = new URL(
    '../software-factory/darkfactory',
    realm.realmURL,
  ).href;
  let { client, cleanup: clientCleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  let workspace = createTestWorkspace();

  return {
    client,
    cleanup: () => {
      clientCleanup();
      workspace.cleanup();
    },
    darkfactoryModuleUrl,
    workspaceDir: workspace.dir,
    seedOptions: {
      darkfactoryModuleUrl,
      workspaceDir: workspace.dir,
    },
  };
}

test('creates bootstrap seed issue in a live realm', async ({ realm }) => {
  let { client, cleanup, darkfactoryModuleUrl, workspaceDir, seedOptions } =
    buildSeedContext(realm);

  try {
    let result = await createSeedIssue(stickyNoteBrief, seedOptions);

    expect(result.issueId).toBe('Issues/bootstrap-seed');
    expect(result.status).toBe('created');

    // The seed lives on local disk until we sync to the realm — mirrors
    // the entrypoint orchestration (createSeedIssue + post-seed sync).
    let syncResult = await client.sync(realm.realmURL.href, workspaceDir, {
      preferLocal: true,
    });
    expect(syncResult.hasError).toBe(false);
    let indexed = await client.waitForFile(
      realm.realmURL.href,
      'Issues/bootstrap-seed.json',
      {
        pollMs: 300,
        timeoutMs: 30_000,
      },
    );
    expect(indexed).toBe(true);

    // Verify the card is readable with correct fields
    let issueResponse = await client.authedFetch(
      realm.cardURL('Issues/bootstrap-seed'),
      { headers: { Accept: SupportedMimeType.CardSource } },
    );
    expect(issueResponse.ok).toBe(true);

    let issueJson = (await issueResponse.json()) as {
      data: {
        attributes: {
          issueId: string;
          issueType: string;
          status: string;
          priority: string;
          order: number;
          summary: string;
          description: string;
        };
        meta: { adoptsFrom: { module: string; name: string } };
      };
    };

    expect(issueJson.data.attributes.issueType).toBe('bootstrap');
    expect(issueJson.data.attributes.status).toBe('backlog');
    expect(issueJson.data.attributes.priority).toBe('critical');
    expect(issueJson.data.attributes.order).toBe(0);
    expect(issueJson.data.attributes.summary).toContain(
      'Process brief and create project artifacts',
    );
    expect(issueJson.data.attributes.description).toContain(
      stickyNoteBrief.sourceUrl,
    );
    expect(issueJson.data.attributes.description).toContain('Sticky Note');
    expect(issueJson.data.meta.adoptsFrom.module).toBe(darkfactoryModuleUrl);
    expect(issueJson.data.meta.adoptsFrom.name).toBe('Issue');

    // Verify RealmIssueStore can find the seed issue
    let issueStore = new RealmIssueStore({
      realmUrl: realm.realmURL.href,
      darkfactoryModuleUrl,
      client,
      workspaceDir,
    });

    // Realm-side source POST indexing is async, so the seed card may
    // not be in the search index yet. Bounded-poll until listIssues
    // sees the seed (or the deadline elapses). 30s allows the seed's
    // incremental indexing to drain even when it's queued behind the
    // realm's from-scratch index from test setup.
    let issues = await retryWithPoll(
      () => issueStore.listIssues(),
      (results) => !results.some((i) => i.id.includes('Issues/bootstrap-seed')),
      { totalWaitMs: 30_000 },
    );
    let seedIssue = issues.find((i) => i.id.includes('Issues/bootstrap-seed'));
    expect(seedIssue).toBeDefined();
    expect(seedIssue!.status).toBe('backlog');
    expect(seedIssue!.priority).toBe('critical');
  } finally {
    cleanup();
  }
});

test('creates an adjust-flavored bootstrap seed when the brief carries a sourceCardUrl', async ({
  realm,
}) => {
  let { client, cleanup, workspaceDir, seedOptions } = buildSeedContext(realm);

  try {
    let result = await createSeedIssue(adjustMortgageBrief, seedOptions);

    expect(result.issueId).toBe('Issues/bootstrap-seed');
    expect(result.status).toBe('created');

    let syncResult = await client.sync(realm.realmURL.href, workspaceDir, {
      preferLocal: true,
    });
    expect(syncResult.hasError).toBe(false);
    let indexed = await client.waitForFile(
      realm.realmURL.href,
      'Issues/bootstrap-seed.json',
      {
        pollMs: 300,
        timeoutMs: 30_000,
      },
    );
    expect(indexed).toBe(true);

    let issueResponse = await client.authedFetch(
      realm.cardURL('Issues/bootstrap-seed'),
      { headers: { Accept: SupportedMimeType.CardSource } },
    );
    expect(issueResponse.ok).toBe(true);

    let issueJson = (await issueResponse.json()) as {
      data: {
        attributes: { issueType: string; summary: string; description: string };
      };
    };

    // Still a bootstrap issue — the adjust/greenfield fork lives in the
    // seed's instructions, not in its issueType.
    expect(issueJson.data.attributes.issueType).toBe('bootstrap');

    // Adjust-specific summary (greenfield is "Process brief and create
    // project artifacts").
    expect(issueJson.data.attributes.summary).toBe(
      'Seed the source card and create adjustment issues',
    );

    // The seed instructions are the adjust flavor and carry the source card
    // through to the agent.
    let { description } = issueJson.data.attributes;
    expect(description).toContain('Mode: ADJUST EXISTING CARD');
    expect(description).toContain(
      `**Source card to adjust:** ${adjustMortgageBrief.sourceCardUrl}`,
    );
    expect(description).toContain(
      `boxel realm ingest-card "${adjustMortgageBrief.sourceCardUrl}"`,
    );
  } finally {
    cleanup();
  }
});

test('seed issue creation is idempotent', async ({ realm }) => {
  let { cleanup, seedOptions } = buildSeedContext(realm);

  try {
    let result1 = await createSeedIssue(stickyNoteBrief, seedOptions);
    expect(result1.status).toBe('created');

    let result2 = await createSeedIssue(stickyNoteBrief, seedOptions);
    expect(result2.status).toBe('existing');
    expect(result2.issueId).toBe(result1.issueId);
  } finally {
    cleanup();
  }
});
