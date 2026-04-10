import { resolve } from 'node:path';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { createSeedIssue } from '../src/factory-seed';
import type { FactoryBrief } from '../src/factory-brief';
import { RealmIssueStore } from '../src/issue-scheduler';
import { expect, test } from './fixtures';
import { buildAuthenticatedFetch } from './helpers/matrix-auth';

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

test.use({ realmDir: bootstrapTargetDir });
test.use({ realmServerMode: 'isolated' });

function buildSeedContext(realm: { realmURL: URL; ownerBearerToken: string }) {
  let darkfactoryModuleUrl = new URL(
    '../software-factory/darkfactory',
    realm.realmURL,
  ).href;
  let authenticatedFetch = buildAuthenticatedFetch(
    realm.ownerBearerToken,
    fetch,
  );

  return {
    authenticatedFetch,
    darkfactoryModuleUrl,
    seedOptions: { fetch: authenticatedFetch, darkfactoryModuleUrl },
  };
}

test('creates bootstrap seed issue in a live realm', async ({ realm }) => {
  let { authenticatedFetch, darkfactoryModuleUrl, seedOptions } =
    buildSeedContext(realm);

  let result = await createSeedIssue(
    stickyNoteBrief,
    realm.realmURL.href,
    seedOptions,
  );

  expect(result.issueId).toBe('Issues/bootstrap-seed');
  expect(result.status).toBe('created');

  // Verify the card is readable with correct fields
  let issueResponse = await authenticatedFetch(
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
    options: { fetch: authenticatedFetch },
  });

  let issues = await issueStore.listIssues();
  expect(issues.length).toBe(1);
  expect(issues[0].id).toContain('Issues/bootstrap-seed');
  expect(issues[0].status).toBe('backlog');
  expect(issues[0].priority).toBe('critical');
});

test('seed issue creation is idempotent', async ({ realm }) => {
  let { seedOptions } = buildSeedContext(realm);

  let result1 = await createSeedIssue(
    stickyNoteBrief,
    realm.realmURL.href,
    seedOptions,
  );
  expect(result1.status).toBe('created');

  let result2 = await createSeedIssue(
    stickyNoteBrief,
    realm.realmURL.href,
    seedOptions,
  );
  expect(result2.status).toBe('existing');
  expect(result2.issueId).toBe(result1.issueId);
});
