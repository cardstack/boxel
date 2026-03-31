import { resolve } from 'node:path';

import { SupportedMimeType } from '@cardstack/runtime-common';

import { bootstrapProjectArtifacts } from '../src/factory-bootstrap';
import type { FactoryBrief } from '../src/factory-brief';
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

function buildBootstrapContext(realm: {
  realmURL: URL;
  ownerBearerToken: string;
}) {
  let darkfactoryModuleUrl = new URL(
    '../software-factory/darkfactory',
    realm.realmURL,
  ).href;
  let authenticatedFetch = buildAuthenticatedFetch(
    realm.ownerBearerToken,
    fetch,
  );
  let bootstrapOptions = { fetch: authenticatedFetch, darkfactoryModuleUrl };

  return {
    authenticatedFetch,
    bootstrapOptions,
    darkfactoryModuleUrl,
  };
}

test('bootstrap creates card instances and reruns idempotently in a live realm', async ({
  realm,
}) => {
  let { authenticatedFetch, bootstrapOptions, darkfactoryModuleUrl } =
    buildBootstrapContext(realm);

  let result1 = await bootstrapProjectArtifacts(
    stickyNoteBrief,
    realm.realmURL.href,
    bootstrapOptions,
  );

  expect(result1.project.id).toBe('Projects/sticky-note-mvp');
  expect(result1.project.status).toBe('created');
  expect(result1.knowledgeArticles).toHaveLength(2);
  expect(result1.tickets).toHaveLength(3);
  expect(result1.activeTicket.id).toBe('Tickets/sticky-note-define-core');

  let projectResponse = await authenticatedFetch(
    realm.cardURL('Projects/sticky-note-mvp'),
    { headers: { Accept: SupportedMimeType.CardSource } },
  );
  expect(projectResponse.ok).toBe(true);
  let projectJson = (await projectResponse.json()) as {
    data: {
      attributes: { projectName: string; projectCode: string };
      meta: { adoptsFrom: { module: string; name: string } };
    };
  };
  expect(projectJson.data.attributes.projectName).toBe('Sticky Note MVP');
  expect(projectJson.data.attributes.projectCode).toBe('SN');
  expect(projectJson.data.meta.adoptsFrom.module).toBe(darkfactoryModuleUrl);
  expect(projectJson.data.meta.adoptsFrom.name).toBe('Project');

  let ticketResponse = await authenticatedFetch(
    realm.cardURL('Tickets/sticky-note-define-core'),
    { headers: { Accept: SupportedMimeType.CardSource } },
  );
  expect(ticketResponse.ok).toBe(true);
  let ticketJson = (await ticketResponse.json()) as {
    data: {
      attributes: { ticketId: string; status: string; summary: string };
      meta: { adoptsFrom: { module: string; name: string } };
    };
  };
  expect(ticketJson.data.attributes.ticketId).toBe('SN-1');
  expect(ticketJson.data.attributes.status).toBe('in_progress');
  expect(ticketJson.data.attributes.summary).toContain('Sticky Note');
  expect(ticketJson.data.meta.adoptsFrom.name).toBe('Ticket');

  let ticket2Response = await authenticatedFetch(
    realm.cardURL('Tickets/sticky-note-design-views'),
    { headers: { Accept: SupportedMimeType.CardSource } },
  );
  expect(ticket2Response.ok).toBe(true);
  let ticket2Json = (await ticket2Response.json()) as {
    data: { attributes: { status: string } };
  };
  expect(ticket2Json.data.attributes.status).toBe('backlog');

  let contextResponse = await authenticatedFetch(
    realm.cardURL('Knowledge Articles/sticky-note-brief-context'),
    { headers: { Accept: SupportedMimeType.CardSource } },
  );
  expect(contextResponse.ok).toBe(true);
  let contextJson = (await contextResponse.json()) as {
    data: { attributes: { articleTitle: string; articleType: string } };
  };
  expect(contextJson.data.attributes.articleTitle).toBe(
    'Sticky Note — Brief Context',
  );
  expect(contextJson.data.attributes.articleType).toBe('context');

  let result2 = await bootstrapProjectArtifacts(
    stickyNoteBrief,
    realm.realmURL.href,
    bootstrapOptions,
  );
  expect(result2.project.status).toBe('existing');
  expect(result2.knowledgeArticles[0].status).toBe('existing');
  expect(result2.knowledgeArticles[1].status).toBe('existing');
  expect(result2.tickets[0].status).toBe('existing');
  expect(result2.tickets[1].status).toBe('existing');
  expect(result2.tickets[2].status).toBe('existing');
});

test('bootstrapped project card renders correctly in the browser', async ({
  realm,
  authedPage,
}) => {
  let { bootstrapOptions } = buildBootstrapContext(realm);

  await bootstrapProjectArtifacts(
    stickyNoteBrief,
    realm.realmURL.href,
    bootstrapOptions,
  );

  await authedPage.goto(realm.cardURL('Projects/sticky-note-mvp'), {
    waitUntil: 'commit',
  });

  await expect(
    authedPage.getByRole('heading', { name: 'Sticky Note MVP' }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    authedPage.getByRole('heading', { name: 'Objective' }),
  ).toBeVisible();
});
