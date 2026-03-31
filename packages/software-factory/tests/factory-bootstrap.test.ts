import { module, test } from 'qunit';

import { SupportedMimeType } from '../src/mime-types';

import {
  bootstrapProjectArtifacts,
  deriveProjectCode,
  deriveSlug,
  extractSections,
  inferDarkfactoryModuleUrl,
} from '../src/factory-bootstrap';
import type { FactoryBrief } from '../src/factory-brief';

const targetRealmUrl = 'https://realms.example.test/hassan/personal/';
const darkfactoryModuleUrl =
  'https://realms.example.test/software-factory/darkfactory';

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
    '- Updated by people or automation without losing provenance',
    '',
    '## Integration Points',
    '',
    '- **Document** -- Sticky Note can link to longer-form supporting content.',
    '- **Note** -- Note can provide adjacent context.',
    '- **Workflow Playbook** -- Sticky Note can be created as one step inside a repeatable workflow.',
  ].join('\n'),
  contentSummary:
    'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
  tags: ['documents-content', 'sticky', 'note'],
};

const minimalBrief: FactoryBrief = {
  title: 'My Widget',
  sourceUrl: 'https://briefs.example.test/Widget/my-widget',
  content: '',
  contentSummary: 'A simple widget card.',
  tags: [],
};

module('factory-bootstrap', function () {
  module('deriveSlug', function () {
    test('converts title to kebab-case', function (assert) {
      assert.strictEqual(deriveSlug('Sticky Note'), 'sticky-note');
    });

    test('handles special characters', function (assert) {
      assert.strictEqual(deriveSlug('My Cool App!'), 'my-cool-app');
      assert.strictEqual(
        deriveSlug('My App (v2.0) — Beta!'),
        'my-app-v2-0-beta',
      );
    });

    test('strips leading and trailing dashes', function (assert) {
      assert.strictEqual(deriveSlug('--hello--'), 'hello');
      assert.strictEqual(deriveSlug('  spaces  '), 'spaces');
    });

    test('handles single word', function (assert) {
      assert.strictEqual(deriveSlug('Widget'), 'widget');
    });
  });

  module('deriveProjectCode', function () {
    test('uses initials for multi-word titles', function (assert) {
      assert.strictEqual(deriveProjectCode('Sticky Note'), 'SN');
      assert.strictEqual(deriveProjectCode('My App'), 'MA');
    });

    test('uses first two characters for single word titles', function (assert) {
      assert.strictEqual(deriveProjectCode('Widget'), 'WI');
    });

    test('caps at 4 characters', function (assert) {
      assert.strictEqual(deriveProjectCode('One Two Three Four Five'), 'OTTF');
    });
  });

  module('inferDarkfactoryModuleUrl', function () {
    test('derives from target realm URL origin', function (assert) {
      assert.strictEqual(
        inferDarkfactoryModuleUrl(
          'https://realms.example.test/hassan/personal/',
        ),
        'https://realms.example.test/software-factory/darkfactory',
      );
    });

    test('works with localhost URLs', function (assert) {
      assert.strictEqual(
        inferDarkfactoryModuleUrl('http://localhost:4201/hassan/personal/'),
        'http://localhost:4201/software-factory/darkfactory',
      );
    });
  });

  module('extractSections', function () {
    test('extracts h2 sections from markdown', function (assert) {
      let sections = extractSections(stickyNoteBrief.content);
      assert.strictEqual(sections.length, 3);
      assert.strictEqual(sections[0].heading, 'Overview');
      assert.strictEqual(sections[1].heading, 'Core Mechanics');
      assert.strictEqual(sections[2].heading, 'Integration Points');
      assert.true(sections[1].body.includes('drafting, review, and reuse'));
    });

    test('returns single section for content without headings', function (assert) {
      let sections = extractSections('Just plain text content.');
      assert.strictEqual(sections.length, 1);
      assert.strictEqual(sections[0].heading, '');
      assert.strictEqual(sections[0].body, 'Just plain text content.');
    });

    test('handles empty content', function (assert) {
      let sections = extractSections('');
      assert.strictEqual(sections.length, 1);
      assert.strictEqual(sections[0].heading, '');
    });
  });

  module('bootstrapProjectArtifacts', function () {
    test('creates all starter artifacts when none exist', async function (assert) {
      let fetchCalls: { url: string; method: string }[] = [];

      let result = await bootstrapProjectArtifacts(
        stickyNoteBrief,
        targetRealmUrl,
        {
          darkfactoryModuleUrl,
          fetch: buildMockFetch(fetchCalls, { allMissing: true }),
        },
      );

      assert.strictEqual(result.project.id, 'Projects/sticky-note-mvp');
      assert.strictEqual(result.project.status, 'created');
      assert.strictEqual(result.knowledgeArticles.length, 2);
      assert.strictEqual(result.knowledgeArticles[0].status, 'created');
      assert.strictEqual(result.knowledgeArticles[1].status, 'created');
      assert.strictEqual(result.tickets.length, 3);
      assert.strictEqual(result.tickets[0].status, 'created');
      assert.strictEqual(result.tickets[1].status, 'created');
      assert.strictEqual(result.tickets[2].status, 'created');
      assert.strictEqual(
        result.activeTicket.id,
        'Tickets/sticky-note-define-core',
      );
    });

    test('created tickets have correct IDs and structure', async function (assert) {
      let writtenBodies: Record<string, unknown> = {};

      let result = await bootstrapProjectArtifacts(
        stickyNoteBrief,
        targetRealmUrl,
        {
          darkfactoryModuleUrl,
          fetch: buildMockFetch([], {
            allMissing: true,
            captureWrites: writtenBodies,
          }),
        },
      );

      assert.strictEqual(
        result.tickets[0].id,
        'Tickets/sticky-note-define-core',
      );
      assert.strictEqual(
        result.tickets[1].id,
        'Tickets/sticky-note-design-views',
      );
      assert.strictEqual(
        result.tickets[2].id,
        'Tickets/sticky-note-add-integration',
      );

      let ticket1 = writtenBodies['Tickets/sticky-note-define-core'] as {
        data: {
          attributes: { ticketId: string; status: string; summary: string };
        };
      };
      assert.strictEqual(ticket1.data.attributes.ticketId, 'SN-1');
      assert.strictEqual(ticket1.data.attributes.status, 'in_progress');
      assert.true(ticket1.data.attributes.summary.includes('Sticky Note'));

      let ticket2 = writtenBodies['Tickets/sticky-note-design-views'] as {
        data: { attributes: { ticketId: string; status: string } };
      };
      assert.strictEqual(ticket2.data.attributes.ticketId, 'SN-2');
      assert.strictEqual(ticket2.data.attributes.status, 'backlog');

      let ticket3 = writtenBodies['Tickets/sticky-note-add-integration'] as {
        data: { attributes: { ticketId: string; status: string } };
      };
      assert.strictEqual(ticket3.data.attributes.ticketId, 'SN-3');
      assert.strictEqual(ticket3.data.attributes.status, 'backlog');
    });

    test('created project has correct content from brief', async function (assert) {
      let writtenBodies: Record<string, unknown> = {};

      await bootstrapProjectArtifacts(stickyNoteBrief, targetRealmUrl, {
        darkfactoryModuleUrl,
        fetch: buildMockFetch([], {
          allMissing: true,
          captureWrites: writtenBodies,
        }),
      });

      let project = writtenBodies['Projects/sticky-note-mvp'] as {
        data: {
          attributes: {
            projectName: string;
            projectCode: string;
            objective: string;
            scope: string;
            technicalContext: string;
          };
          meta: { adoptsFrom: { module: string; name: string } };
        };
      };
      assert.strictEqual(
        project.data.attributes.projectName,
        'Sticky Note MVP',
      );
      assert.strictEqual(project.data.attributes.projectCode, 'SN');
      assert.strictEqual(
        project.data.attributes.objective,
        stickyNoteBrief.contentSummary,
      );
      assert.true(project.data.attributes.scope.includes('Core Mechanics'));
      assert.true(
        project.data.attributes.technicalContext.includes(
          stickyNoteBrief.sourceUrl,
        ),
      );
      assert.strictEqual(
        project.data.meta.adoptsFrom.module,
        darkfactoryModuleUrl,
      );
      assert.strictEqual(project.data.meta.adoptsFrom.name, 'Project');
    });

    test('created knowledge articles have correct content', async function (assert) {
      let writtenBodies: Record<string, unknown> = {};

      await bootstrapProjectArtifacts(stickyNoteBrief, targetRealmUrl, {
        darkfactoryModuleUrl,
        fetch: buildMockFetch([], {
          allMissing: true,
          captureWrites: writtenBodies,
        }),
      });

      let briefContext = writtenBodies[
        'Knowledge Articles/sticky-note-brief-context'
      ] as {
        data: {
          attributes: {
            articleTitle: string;
            articleType: string;
            content: string;
            tags: string[];
          };
        };
      };
      assert.strictEqual(
        briefContext.data.attributes.articleTitle,
        'Sticky Note — Brief Context',
      );
      assert.strictEqual(briefContext.data.attributes.articleType, 'context');
      assert.true(
        briefContext.data.attributes.content.includes('Core Mechanics'),
      );
      assert.true(briefContext.data.attributes.tags.includes('brief-context'));
      assert.true(
        briefContext.data.attributes.tags.includes('documents-content'),
      );

      let onboarding = writtenBodies[
        'Knowledge Articles/sticky-note-agent-onboarding'
      ] as {
        data: {
          attributes: {
            articleTitle: string;
            articleType: string;
            content: string;
          };
        };
      };
      assert.strictEqual(
        onboarding.data.attributes.articleTitle,
        'Sticky Note — Agent Onboarding',
      );
      assert.strictEqual(onboarding.data.attributes.articleType, 'onboarding');
      assert.true(
        onboarding.data.attributes.content.includes(stickyNoteBrief.sourceUrl),
      );
    });

    test('ticket descriptions derive from brief sections', async function (assert) {
      let writtenBodies: Record<string, unknown> = {};

      await bootstrapProjectArtifacts(stickyNoteBrief, targetRealmUrl, {
        darkfactoryModuleUrl,
        fetch: buildMockFetch([], {
          allMissing: true,
          captureWrites: writtenBodies,
        }),
      });

      let ticket1 = writtenBodies['Tickets/sticky-note-define-core'] as {
        data: { attributes: { description: string } };
      };
      assert.true(
        ticket1.data.attributes.description.includes(
          'drafting, review, and reuse',
        ),
        'first ticket description derived from Core Mechanics section',
      );

      let ticket3 = writtenBodies['Tickets/sticky-note-add-integration'] as {
        data: { attributes: { description: string } };
      };
      assert.true(
        ticket3.data.attributes.description.includes('Document'),
        'third ticket description derived from Integration Points section',
      );
    });

    test('skips existing artifacts on rerun', async function (assert) {
      let fetchCalls: { url: string; method: string }[] = [];

      let result = await bootstrapProjectArtifacts(
        stickyNoteBrief,
        targetRealmUrl,
        {
          darkfactoryModuleUrl,
          fetch: buildMockFetch(fetchCalls, {
            allExist: true,
            existingTicketStatus: 'in_progress',
          }),
        },
      );

      assert.strictEqual(result.project.status, 'existing');
      assert.strictEqual(result.knowledgeArticles[0].status, 'existing');
      assert.strictEqual(result.knowledgeArticles[1].status, 'existing');
      assert.strictEqual(result.tickets[0].status, 'existing');
      assert.strictEqual(result.tickets[1].status, 'existing');
      assert.strictEqual(result.tickets[2].status, 'existing');

      let writeCalls = fetchCalls.filter((c) => c.method === 'POST');
      assert.strictEqual(writeCalls.length, 0, 'no write calls made');
    });

    test('creates only missing artifacts on partial rerun', async function (assert) {
      let existingPaths = new Set([
        'Projects/sticky-note-mvp',
        'Knowledge Articles/sticky-note-brief-context',
      ]);

      let result = await bootstrapProjectArtifacts(
        stickyNoteBrief,
        targetRealmUrl,
        {
          darkfactoryModuleUrl,
          fetch: buildMockFetch([], { existingPaths }),
        },
      );

      assert.strictEqual(result.project.status, 'existing');
      assert.strictEqual(result.knowledgeArticles[0].status, 'existing');
      assert.strictEqual(result.knowledgeArticles[1].status, 'created');
      assert.strictEqual(result.tickets[0].status, 'created');
      assert.strictEqual(result.tickets[1].status, 'created');
      assert.strictEqual(result.tickets[2].status, 'created');
    });

    test('handles brief with minimal content gracefully', async function (assert) {
      let writtenBodies: Record<string, unknown> = {};

      let result = await bootstrapProjectArtifacts(
        minimalBrief,
        targetRealmUrl,
        {
          darkfactoryModuleUrl,
          fetch: buildMockFetch([], {
            allMissing: true,
            captureWrites: writtenBodies,
          }),
        },
      );

      assert.strictEqual(result.project.id, 'Projects/my-widget-mvp');
      assert.strictEqual(result.project.status, 'created');
      assert.strictEqual(result.tickets.length, 3);

      let project = writtenBodies['Projects/my-widget-mvp'] as {
        data: { attributes: { projectName: string; objective: string } };
      };
      assert.strictEqual(project.data.attributes.projectName, 'My Widget MVP');
      assert.strictEqual(
        project.data.attributes.objective,
        'A simple widget card.',
      );
    });

    test('handles brief with special characters in title', async function (assert) {
      let specialBrief: FactoryBrief = {
        title: 'My App (v2.0) — Beta!',
        sourceUrl: 'https://briefs.example.test/app',
        content: 'Some content.',
        contentSummary: 'A beta app.',
        tags: [],
      };

      let result = await bootstrapProjectArtifacts(
        specialBrief,
        targetRealmUrl,
        {
          darkfactoryModuleUrl,
          fetch: buildMockFetch([], { allMissing: true }),
        },
      );

      assert.strictEqual(result.project.id, 'Projects/my-app-v2-0-beta-mvp');
      assert.strictEqual(
        result.tickets[0].id,
        'Tickets/my-app-v2-0-beta-define-core',
      );
    });

    test('does not surface non-serialized response objects as [object Object]', async function (assert) {
      assert.expect(2);

      let failingFetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        let request = new Request(input, init);
        if (request.method === 'GET') {
          return new Response('Not found', { status: 404 });
        }

        return new Response({ errors: ['boom'] } as unknown as BodyInit, {
          status: 500,
        });
      }) as typeof globalThis.fetch;

      await assert.rejects(
        bootstrapProjectArtifacts(stickyNoteBrief, targetRealmUrl, {
          darkfactoryModuleUrl,
          fetch: failingFetch,
        }),
        (error: unknown) => {
          assert.false(String(error).includes('[object Object]'));
          return (
            error instanceof Error &&
            error.message.includes(
              'server returned a non-serialized object body',
            )
          );
        },
      );
    });
  });
});

type MockFetchOptions = {
  allMissing?: boolean;
  allExist?: boolean;
  existingPaths?: Set<string>;
  existingTicketStatus?: string;
  captureWrites?: Record<string, unknown>;
};

function buildMockFetch(
  calls: { url: string; method: string }[],
  options: MockFetchOptions,
): typeof globalThis.fetch {
  let initialExistingCards = new Set(options.existingPaths ?? []);
  let createdCards = new Set<string>();
  let storedBodies: Record<string, unknown> = {};

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let request = new Request(input, init);
    let url = request.url;
    let method = request.method;

    calls.push({ url, method });

    let cardPath = decodeURIComponent(url.replace(targetRealmUrl, '')).replace(
      /\.json$/,
      '',
    );

    if (method === 'GET') {
      let exists =
        options.allExist ||
        createdCards.has(cardPath) ||
        (!options.allMissing && initialExistingCards.has(cardPath));

      if (exists) {
        let existingBody = storedBodies[cardPath];
        let payload =
          existingBody ??
          ({
            data: {
              type: 'card',
              attributes: {
                status: options.existingTicketStatus ?? 'backlog',
              },
              meta: {
                adoptsFrom: {
                  module: darkfactoryModuleUrl,
                  name: 'Ticket',
                },
              },
            },
          } satisfies Record<string, unknown>);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSON },
        });
      }

      return new Response('Not found', { status: 404 });
    }

    if (method === 'POST') {
      createdCards.add(cardPath);
      let body = await request.text();
      storedBodies[cardPath] = JSON.parse(body);
      if (options.captureWrites) {
        options.captureWrites[cardPath] = storedBodies[cardPath];
      }
      return new Response(null, { status: 204 });
    }

    return new Response('Unexpected', { status: 500 });
  }) as typeof globalThis.fetch;
}
