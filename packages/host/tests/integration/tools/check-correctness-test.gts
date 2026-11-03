import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  delay,
  hasExecutableExtension,
  X_BOXEL_LINK_SHAPE_HEADER,
} from '@cardstack/runtime-common';
import type { CommandContext, Realm } from '@cardstack/runtime-common';

import CheckCorrectnessTool from '@cardstack/host/tools/check-correctness';
import PatchCardInstanceTool from '@cardstack/host/tools/patch-card-instance';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  createPrerenderAuth,
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

function petDocument(name: string, hasError: boolean) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { name, hasError },
        meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
      },
    },
    null,
    2,
  );
}

// A Ticket document whose defaults are fully valid; a test replaces the
// attributes or relationships bucket wholesale to introduce one mistake.
function ticketDocument(
  overrides: {
    attributes?: Record<string, any>;
    relationships?: Record<string, any>;
    metaFields?: Record<string, any>;
  } = {},
) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: overrides.attributes ?? {
          status: 'New',
          timers: [{ label: 'First response', hours: 4 }],
        },
        relationships: overrides.relationships ?? {
          customer: { links: { self: '../Pet/billy' } },
        },
        meta: {
          adoptsFrom: { module: '../ticket', name: 'Ticket' },
          ...(overrides.metaFields ? { fields: overrides.metaFields } : {}),
        },
      },
    },
    null,
    2,
  );
}

// A Milestone card module whose isolated template is `template`. A template
// that calls `isoDay` gets it defined: it reads a DateField value as an ISO
// date string, which it is not, so an instance with a date throws "Invalid
// time value" when it renders.
function milestoneModule(template: string) {
  let helper = template.includes('isoDay')
    ? `
function isoDay(value: unknown) {
  return new Date(value + 'T12:00:00Z').toISOString();
}
`
    : '';
  return `import { contains, field, CardDef, Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import DateField from '@cardstack/base/date';
${helper}
export class Milestone extends CardDef {
  static displayName = 'Milestone';
  @field title = contains(StringField);
  @field date = contains(DateField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      ${template}
    </template>
  };
}
`;
}

function milestoneDocument(title: string) {
  return {
    data: {
      type: 'card',
      attributes: { title, date: '2026-11-08' },
      meta: { adoptsFrom: { module: '../milestone', name: 'Milestone' } },
    },
  };
}

// Answers the realm server's module and card prerender endpoints with the
// in-browser prerenderer the test realm indexes with, and lists the cards it
// rendered.
function mountPrerenderEndpoints() {
  let localIndexer = getService('local-indexer');
  let realmServerURL = getService('realm-server').url;
  let renderedCards: string[] = [];
  getService('network').virtualNetwork.mount(
    async (request: Request) => {
      let { origin, pathname } = new URL(request.url);
      if (
        origin !== realmServerURL.origin ||
        (pathname !== '/_prerender-module' && pathname !== '/_prerender-card')
      ) {
        return null;
      }
      let { realm, url } = (await request.json()).data.attributes;
      let args = {
        affinityType: 'realm' as const,
        affinityValue: realm,
        realm,
        url,
        auth: createPrerenderAuth('@testuser:localhost', {}),
      };
      let attributes;
      if (pathname === '/_prerender-module') {
        attributes = await localIndexer.prerenderer.prerenderModule(args);
      } else {
        renderedCards.push(url);
        attributes = (
          await localIndexer.prerenderer.prerenderVisit({
            ...args,
            renderOptions: { cardRender: true },
          })
        ).card;
      }
      return new Response(
        JSON.stringify({
          data: { type: 'prerender-result', id: url, attributes },
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/vnd.api+json' },
        },
      );
    },
    { prepend: true },
  );
  return renderedCards;
}

// Answers the check's reads of the cards under `prefix` with a clean
// document indexed at a generation no render job announces, the way a realm
// serves instances its render job has not reached yet.
function serveUnrenderedInstances(prefix: string) {
  getService('network').virtualNetwork.mount(
    async (request: Request) => {
      if (
        !request.url.startsWith(prefix) ||
        request.headers.get(X_BOXEL_LINK_SHAPE_HEADER) !== 'links-only'
      ) {
        return null;
      }
      return new Response(
        JSON.stringify({
          data: {
            type: 'card',
            id: request.url,
            attributes: {},
            meta: {
              adoptsFrom: { module: '../milestone', name: 'Milestone' },
              generation: 1_000_000,
            },
          },
        }),
        { headers: { 'content-type': 'application/vnd.card+json' } },
      );
    },
    { prepend: true },
  );
}

// A realm server renders cards' formats in a render job of its own after the
// index pass, and announces the files it rendered in a `prerender_html`
// event. The test realm renders them inside the index pass, so this announces
// them when the index event arrives, the way that job would, and counts the
// announcements.
function announceRendersWithIndexEvents() {
  let messageService = getService('message-service');
  let renders = { announced: 0 };
  messageService.subscribe(testRealmURL, (event) => {
    if (
      event.eventName !== 'index' ||
      event.indexType !== 'incremental' ||
      event.generation === undefined
    ) {
      return;
    }
    let generation = event.generation;
    // the index event names a card without `.json`; the render job names it
    // by its file. These module edits invalidate only modules and instances.
    let invalidations = event.invalidations.map((href) =>
      hasExecutableExtension(href) ? href : `${href}.json`,
    );
    void Promise.resolve().then(() => {
      messageService.relayRealmEvent({
        eventName: 'prerender_html',
        invalidations,
        generation,
        realmURL: testRealmURL,
      });
      renders.announced++;
    });
  });
  return renders;
}

// A run-realm-code script that replaces the whole content of the existing
// file at `path`.
function overwriteScript(path: string, content: string) {
  let p = JSON.stringify(path);
  return `await realm.fs.replace(${p}, await realm.fs.readText(${p}), ${JSON.stringify(
    content,
  )});`;
}

// A run-realm-code script that creates the file at `path`.
function writeTextScript(path: string, content: string) {
  return `await realm.fs.writeText(${JSON.stringify(path)}, ${JSON.stringify(
    content,
  )});`;
}

module('Integration | tools | check-correctness', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    autostart: true,
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  setupRealmCacheTeardown(hooks);

  let testRealm: Realm;

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      ({ realm: testRealm } = await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'milestone.gts': milestoneModule('<h1>{{@model.title}}</h1>'),
          'Milestone/launch.json': milestoneDocument('Product launch'),
          'pet.gts': `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          import BooleanField from "@cardstack/base/boolean";
          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field name = contains(StringField);
            @field hasError = contains(BooleanField);
            @field boom = contains(StringField, {
              computeVia: function (this: Pet) {
                if (this.hasError) {
                  throw new Error('Name cannot be "Bill"');
                }
                return 'ok';
              },
            });
          }
        `,
          'ticket.gts': `
          import { contains, containsMany, field, linksTo, linksToMany, CardDef, FieldDef } from "@cardstack/base/card-api";
          import { FileDef } from "@cardstack/base/file-api";
          import StringField from "@cardstack/base/string";
          import NumberField from "@cardstack/base/number";
          import enumField from "@cardstack/base/enum";
          import { Pet } from "./pet";
          const StatusField = enumField(StringField, {
            options: ['New', 'Open', 'Pending', 'Resolved'],
          });
          export class SlaTimerField extends FieldDef {
            static displayName = 'SlaTimer';
            @field label = contains(StringField);
            @field hours = contains(NumberField);
          }
          export class TicketItemField extends FieldDef {
            static displayName = 'TicketItem';
            @field label = contains(StringField);
          }
          export class AssignedItemField extends TicketItemField {
            static displayName = 'AssignedItem';
            @field assignee = linksTo(Pet);
          }
          export class Ticket extends CardDef {
            static displayName = 'Ticket';
            @field status = contains(StatusField);
            @field customer = linksTo(Pet);
            @field reference = linksTo(CardDef);
            @field attachment = linksTo(FileDef);
            @field watchers = linksToMany(Pet);
            @field timers = containsMany(SlaTimerField);
            @field items = containsMany(TicketItemField);
          }
        `,
          'Ticket/t1.json': {
            data: {
              type: 'card',
              attributes: {
                status: 'New',
                timers: [{ label: 'First response', hours: 4 }],
              },
              relationships: {
                customer: { links: { self: '../Pet/billy' } },
              },
              meta: {
                adoptsFrom: {
                  module: '../ticket',
                  name: 'Ticket',
                },
              },
            },
          },
          'ticket-notes.txt': 'Ticket notes',
          'Pet/gone.json': {
            data: {
              type: 'card',
              attributes: { name: 'Gone', hasError: false },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
          'settings.json': {
            type: 'module',
            meta: { version: 1 },
            attributes: { enabled: true },
          },
          'Pet/billy.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'Billy',
                hasError: false,
              },
              meta: {
                adoptsFrom: {
                  module: '../pet',
                  name: 'Pet',
                },
              },
            },
          },
        },
      }));
    });
    let realmService = getService('realm');
    let messageService = getService('message-service');
    messageService.register();
    await realmService.login(testRealmURL);
  });

  test('reports card instance correctness when PatchCardInstanceTool is used', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let store = getService('store') as any;
    let loader = getService('loader-service').loader as any;
    let { Pet } = await loader.import(`${testRealmURL}pet`);

    let cardId = `${testRealmURL}Pet/billy`;
    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let command = new CheckCorrectnessTool(toolService.toolContext);
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let roomId = '!room:example.com';

    let firstResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(firstResult.correct, 'initial run reports no errors');
    assert.deepEqual(
      firstResult.warnings,
      [],
      'initial run reports no warnings',
    );

    let patchCommand = new PatchCardInstanceTool(toolService.toolContext, {
      cardType: Pet,
    });
    await patchCommand.execute({
      cardId,
      patch: {
        attributes: {
          name: 'Bill',
          hasError: true,
        },
      },
      roomId,
    });

    let secondResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.false(
      secondResult.correct,
      'second run reports errors after invalid change',
    );
    assert.ok(
      secondResult.errors.some((e: string) =>
        e.includes('Name cannot be "Bill"'),
      ),
      'reports the validation error from the card constructor',
    );

    // Put the card back to its working state. We can't use PatchCardInstanceTool, because the instance
    // is broken and patching won't work. Instead, we need to write the file directly.
    let revertResult = await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('Pet/billy.json', petDocument('Billy', false)),
    });

    assert.strictEqual(
      revertResult.files[0]?.status,
      'saved',
      'revert write is saved',
    );

    let thirdResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
    assert.deepEqual(thirdResult.warnings, [], 'third run reports no warnings');
  });

  test('reports card instance correctness when RunRealmCodeTool is used', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let store = getService('store') as any;

    let command = new CheckCorrectnessTool(toolService.toolContext);
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let cardId = `${testRealmURL}Pet/billy`;
    let roomId = '!room:example.com';

    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let firstResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });
    assert.true(firstResult.correct, 'initial run reports no errors');

    await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('Pet/billy.json', petDocument('Bill', true)),
    });

    let secondResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.false(secondResult.correct, 'second run reports errors');
    assert.ok(
      secondResult.errors.some((e: string) =>
        e.includes('Name cannot be "Bill"'),
      ),
      'reports the validation error from the card constructor',
    );

    // Put the card back to its working state
    let revertResult = await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('Pet/billy.json', petDocument('Billy', false)),
    });

    assert.strictEqual(
      revertResult.files[0]?.status,
      'saved',
      'revert write is saved',
    );

    let thirdResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
  });

  test('skips correctness checks for empty files', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let emptyFileUrl = `${testRealmURL}empty.gts`;
    let cardService = getService('card-service');

    await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: writeTextScript('empty.gts', ''),
    });

    await waitUntil(async () => {
      let { status, content } = await cardService.getSource(
        new URL(emptyFileUrl),
      );
      return status === 200 && content.trim() === '';
    });

    let result = await command.execute({
      targetType: 'file',
      targetRef: emptyFileUrl,
      roomId,
    });

    assert.true(result.correct, 'empty file reports as correct');
    assert.deepEqual(result.errors, [], 'no errors are reported');
  });

  test('checks a module file named by a prefix-form identifier', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let { virtualNetwork } = getService('network');
    let testRealmPrefix = '@test/correctness-realm/';
    virtualNetwork.addRealmMapping(testRealmPrefix, testRealmURL);
    try {
      await getService('card-service').saveSource(
        new URL(`${testRealmURL}prefixed-empty.gts`),
        '',
        'create-file',
      );

      let result = await new CheckCorrectnessTool(
        toolService.toolContext,
      ).execute({
        targetType: 'file',
        targetRef: `${testRealmPrefix}prefixed-empty.gts`,
        roomId: '!room:example.com',
      });

      assert.deepEqual(
        result.errors,
        [],
        'the module and its realm are found from the prefix-form identifier',
      );
      assert.true(result.correct, 'the empty module reports as correct');
    } finally {
      virtualNetwork.removeRealmMapping(testRealmPrefix);
    }
  });

  // Edits milestone.gts through run-realm-code and checks it, the way a
  // tool-written module is checked after the write. `afterWrite` runs between
  // the write and the check.
  async function checkMilestoneEdit(
    template: string,
    afterWrite?: () => Promise<void>,
  ) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let roomId = '!room:example.com';
    await new RunRealmCodeTool(toolService.toolContext).execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('milestone.gts', milestoneModule(template)),
    });
    await afterWrite?.();
    return await new CheckCorrectnessTool(toolService.toolContext).execute({
      targetType: 'file',
      targetRef: `${testRealmURL}milestone.gts`,
      roomId,
    });
  }

  test('reports an instance whose render a module edit breaks', async function (assert) {
    mountPrerenderEndpoints();
    announceRendersWithIndexEvents();

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
    );

    assert.false(result.correct, 'the broken render fails the check');
    assert.strictEqual(result.errors.length, 1, 'one error');
    assert.ok(
      result.errors[0].startsWith(`${testRealmURL}Milestone/launch: `),
      `the error names the instance: ${result.errors[0]}`,
    );
    assert.ok(
      result.errors[0].includes('Invalid time value'),
      'the error carries the render error message',
    );
    assert.ok(
      result.errors[0].endsWith(
        "(an instance of the edited module; the cause may be the edit or this card's own data)",
      ),
      'the error says the cause may be the edit or the instance',
    );
  });

  test('passes a module edit whose instances render', async function (assert) {
    let renderedCards = mountPrerenderEndpoints();
    announceRendersWithIndexEvents();

    let result = await checkMilestoneEdit('<h2>{{@model.title}}</h2>');

    assert.deepEqual(
      renderedCards,
      [],
      'the check renders nothing itself once the render job has',
    );
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.deepEqual(
      result.warnings,
      [],
      'the instance was rendered again, so it was checked',
    );
    assert.true(result.correct, 'the edit passes');
  });

  test('checks an instance whose name holds a dot', async function (assert) {
    mountPrerenderEndpoints();
    await testRealm.write(
      'Milestone/v1.2.json',
      JSON.stringify(milestoneDocument('Version 1.2')),
    );
    announceRendersWithIndexEvents();

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
    );

    assert.false(result.correct, 'the broken render fails the check');
    assert.ok(
      result.errors.some((error: string) =>
        error.startsWith(`${testRealmURL}Milestone/v1.2: `),
      ),
      `the instance named with a dot is checked: ${result.errors.join('; ')}`,
    );
  });

  test("reads an instance's document without fetching its source", async function (assert) {
    mountPrerenderEndpoints();
    let renders = announceRendersWithIndexEvents();
    let announcedBefore = renders.announced;
    let cardURL = `${testRealmURL}Milestone/launch`;
    let reads = { source: 0, document: 0 };

    let result = await checkMilestoneEdit(
      '<h2>{{@model.title}}</h2>',
      async () => {
        // counts from the write's index event on, after the indexer's own reads
        await waitUntil(() => renders.announced > announcedBefore, {
          timeout: 10_000,
        });
        getService('network').virtualNetwork.mount(
          async (request: Request) => {
            let accept = request.headers.get('Accept') ?? '';
            if (
              request.url === `${cardURL}.json` &&
              accept.includes('source')
            ) {
              reads.source++;
            } else if (
              request.url === cardURL &&
              accept.includes('card+json')
            ) {
              reads.document++;
            }
            return null;
          },
          { prepend: true },
        );
      },
    );

    assert.true(result.correct, 'the edit passes');
    assert.strictEqual(reads.source, 0, "the instance's source is not read");
    assert.ok(reads.document >= 1, "the instance's document is read");
    assert.ok(
      reads.document <= 2,
      `the instance's document is read at most twice (${reads.document})`,
    );
  });

  test('renders an instance itself when the render job has not reached it', async function (assert) {
    getService('tool-service').__setWaitsForTesting({ renderJobWaitMs: 100 });
    let renderedCards = mountPrerenderEndpoints();
    let cardURL = `${testRealmURL}Milestone/launch`;

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
      async () => serveUnrenderedInstances(`${testRealmURL}Milestone/`),
    );

    assert.deepEqual(
      renderedCards,
      [`${cardURL}.json`],
      'the check renders the instance',
    );
    assert.false(result.correct, 'the broken render fails the check');
    assert.strictEqual(result.errors.length, 1, 'one error');
    assert.ok(
      result.errors[0].startsWith(`${cardURL}: `),
      `the error names the instance: ${result.errors[0]}`,
    );
    assert.ok(
      result.errors[0].includes('Invalid time value'),
      'the error carries the render error message',
    );
    assert.deepEqual(result.warnings, [], 'the instance was checked');
  });

  test('renders at most three instances itself and says the rest were not checked', async function (assert) {
    getService('tool-service').__setWaitsForTesting({ renderJobWaitMs: 100 });
    let renderedCards = mountPrerenderEndpoints();
    let files = new Map<string, string>();
    for (let name of 'abcd') {
      files.set(
        `Milestone/${name}.json`,
        JSON.stringify(milestoneDocument(`Milestone ${name}`)),
      );
    }
    await testRealm.writeMany(files);

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
      async () => serveUnrenderedInstances(`${testRealmURL}Milestone/`),
    );

    assert.strictEqual(renderedCards.length, 3, 'three instances are rendered');
    assert.strictEqual(result.errors.length, 3, 'each rendered one fails');
    assert.strictEqual(
      result.warnings.length,
      2,
      'the two it did not render are named',
    );
    for (let warning of result.warnings) {
      assert.ok(
        warning.endsWith(
          ': not checked, because the indexer had not rendered it with the edited module yet, and a check renders at most 3 instances itself',
        ),
        warning,
      );
    }
    assert.false(result.correct, 'the check fails');
  });

  test('says an instance whose render request fails was not checked', async function (assert) {
    getService('tool-service').__setWaitsForTesting({ renderJobWaitMs: 100 });
    mountPrerenderEndpoints();
    let realmServerURL = getService('realm-server').url;
    getService('network').virtualNetwork.mount(
      async (request: Request) =>
        new URL(request.url).origin === realmServerURL.origin &&
        new URL(request.url).pathname === '/_prerender-card'
          ? new Response('{}', { status: 500 })
          : null,
      { prepend: true },
    );

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
      async () => serveUnrenderedInstances(`${testRealmURL}Milestone/`),
    );

    assert.deepEqual(result.errors, [], 'the failed render is not an error');
    assert.deepEqual(
      result.warnings,
      [
        `${testRealmURL}Milestone/launch: not checked, because rendering it failed`,
      ],
      'the instance is named as not checked',
    );
    assert.true(result.correct, 'the check passes');
  });

  test('does not check an instance deleted after the module write', async function (assert) {
    mountPrerenderEndpoints();
    announceRendersWithIndexEvents();

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
      async () => {
        await testRealm.delete('Milestone/launch.json');
      },
    );

    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.deepEqual(
      result.warnings,
      [],
      'the check does not wait on the deleted instance',
    );
    assert.true(result.correct, 'the edit passes');
  });

  test('passes a module edit with no instances', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    mountPrerenderEndpoints();
    announceRendersWithIndexEvents();
    let roomId = '!room:example.com';

    await new RunRealmCodeTool(toolService.toolContext).execute({
      realm: testRealmURL,
      roomId,
      code: writeTextScript(
        'listing.gts',
        milestoneModule('<h1>{{@model.title}}</h1>').replace(
          /Milestone/g,
          'Listing',
        ),
      ),
    });
    let result = await new CheckCorrectnessTool(
      toolService.toolContext,
    ).execute({
      targetType: 'file',
      targetRef: `${testRealmURL}listing.gts`,
      roomId,
    });

    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.deepEqual(result.warnings, [], 'no warnings are reported');
    assert.true(result.correct, 'the module passes');
  });

  test('checks the instances open in the workspace first', async function (assert) {
    mountPrerenderEndpoints();
    announceRendersWithIndexEvents();
    // Ten instances whose titles read as ISO dates, and one, open in the
    // workspace and last in the index event's order, whose title does not.
    let files = new Map<string, string>();
    for (let name of 'abcdefghij') {
      files.set(
        `Milestone/${name}.json`,
        JSON.stringify(milestoneDocument('2026-11-08')),
      );
    }
    files.set(
      'Milestone/z-open.json',
      JSON.stringify(milestoneDocument('Open milestone')),
    );
    await testRealm.writeMany(files);
    let openCardId = `${testRealmURL}Milestone/z-open`;
    getService('operator-mode-state-service').restore({
      stacks: [[{ id: openCardId, format: 'isolated' }]],
    });

    let result = await checkMilestoneEdit('<h1>{{isoDay @model.title}}</h1>');

    assert.false(result.correct, 'the open instance fails the check');
    assert.deepEqual(
      result.errors.map((error: string) => error.split(': ')[0]),
      [openCardId],
      'the open instance is checked and is the only one that fails',
    );
  });

  test('reports errors in the order the instances are ranked', async function (assert) {
    mountPrerenderEndpoints();
    let openCardURL = `${testRealmURL}Milestone/z-open`;
    await testRealm.write(
      'Milestone/z-open.json',
      JSON.stringify(milestoneDocument('Open milestone')),
    );
    let renders = announceRendersWithIndexEvents();
    let announcedBefore = renders.announced;
    getService('operator-mode-state-service').restore({
      stacks: [[{ id: openCardURL, format: 'isolated' }]],
    });
    // The open instance reads clean until a render at a later generation
    // records its error, so its error is read after the render wait, after
    // the other instance's.
    let laterGeneration = 1_000_000;
    let renderedLater = false;
    let document = () => ({
      data: {
        type: 'card',
        id: openCardURL,
        attributes: {},
        meta: {
          adoptsFrom: { module: '../milestone', name: 'Milestone' },
          generation: laterGeneration,
        },
      },
      ...(renderedLater
        ? {
            meta: {
              renderError: { status: 500, message: 'Invalid time value' },
            },
          }
        : {}),
    });

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
      async () => {
        await waitUntil(() => renders.announced > announcedBefore, {
          timeout: 10_000,
        });
        getService('network').virtualNetwork.mount(
          async (request: Request) => {
            if (
              request.url !== openCardURL ||
              !request.headers.get('Accept')?.includes('card+json')
            ) {
              return null;
            }
            let response = new Response(JSON.stringify(document()), {
              headers: { 'content-type': 'application/vnd.card+json' },
            });
            if (!renderedLater) {
              setTimeout(() => {
                renderedLater = true;
                getService('message-service').relayRealmEvent({
                  eventName: 'prerender_html',
                  invalidations: [`${openCardURL}.json`],
                  generation: laterGeneration,
                  realmURL: testRealmURL,
                });
              }, 100);
            }
            return response;
          },
          { prepend: true },
        );
      },
    );

    assert.deepEqual(
      result.errors.map((error: string) => error.split(': ')[0]),
      [openCardURL, `${testRealmURL}Milestone/launch`],
      'the open instance is reported first',
    );
  });

  test('does not report an instance whose document cannot be read', async function (assert) {
    mountPrerenderEndpoints();
    let renders = announceRendersWithIndexEvents();
    let announcedBefore = renders.announced;
    let cardURL = `${testRealmURL}Milestone/launch`;

    let result = await checkMilestoneEdit(
      '<h1>{{@model.title}}</h1><p>{{isoDay @model.date}}</p>',
      async () => {
        await waitUntil(() => renders.announced > announcedBefore, {
          timeout: 10_000,
        });
        getService('network').virtualNetwork.mount(
          async (request: Request) =>
            request.url === cardURL &&
            request.headers.get('Accept')?.includes('card+json')
              ? new Response('{}', { status: 500 })
              : null,
          { prepend: true },
        );
      },
    );

    assert.deepEqual(result.errors, [], 'the failed read is not an error');
    assert.true(result.correct, 'the check passes');
  });

  test('waits for the render of an instance indexed again after the module write', async function (assert) {
    mountPrerenderEndpoints();
    let renders = announceRendersWithIndexEvents();
    let announcedBefore = renders.announced;
    let cardURL = `${testRealmURL}Milestone/launch`;
    // The instance reads as indexed at a generation past the module write's,
    // the way it would after a later write; its render at that generation
    // records an error and is announced a moment after the first read.
    let laterGeneration = 1_000_000;
    let renderedLater = false;
    let document = () => ({
      data: {
        type: 'card',
        id: cardURL,
        attributes: {},
        meta: {
          adoptsFrom: { module: '../milestone', name: 'Milestone' },
          generation: laterGeneration,
        },
      },
      ...(renderedLater
        ? {
            meta: {
              renderError: { status: 500, message: 'Invalid time value' },
            },
          }
        : {}),
    });

    let result = await checkMilestoneEdit(
      '<h2>{{@model.title}}</h2>',
      async () => {
        await waitUntil(() => renders.announced > announcedBefore, {
          timeout: 10_000,
        });
        getService('network').virtualNetwork.mount(
          async (request: Request) => {
            if (
              request.url !== cardURL ||
              !request.headers.get('Accept')?.includes('card+json')
            ) {
              return null;
            }
            let response = new Response(JSON.stringify(document()), {
              headers: { 'content-type': 'application/vnd.card+json' },
            });
            if (!renderedLater) {
              setTimeout(() => {
                renderedLater = true;
                getService('message-service').relayRealmEvent({
                  eventName: 'prerender_html',
                  invalidations: [`${cardURL}.json`],
                  generation: laterGeneration,
                  realmURL: testRealmURL,
                });
              }, 100);
            }
            return response;
          },
          { prepend: true },
        );
      },
    );

    assert.deepEqual(
      result.errors,
      [
        `${cardURL}: Invalid time value (an instance of the edited module; the cause may be the edit or this card's own data)`,
      ],
      'the error from the later render is reported',
    );
    assert.false(result.correct, 'the check fails');
  });

  test("a render wait counts only renders at or past each file's generation", async function (assert) {
    let toolService = getService('tool-service');
    let messageService = getService('message-service');
    // tracking a module write starts the realm's render watch
    toolService.trackAiAssistantCardRequest({
      action: 'test',
      roomId: '!room:example.com',
      fileUrl: `${testRealmURL}milestone.gts`,
    });
    let a = `${testRealmURL}Milestone/a.json`;
    let b = `${testRealmURL}Milestone/b.json`;
    let announce = (generation: number, invalidations: string[]) =>
      messageService.relayRealmEvent({
        eventName: 'prerender_html',
        invalidations,
        generation,
        realmURL: testRealmURL,
      });
    let wait = async (files: [string, number][], timeoutMs: number) => [
      ...(await toolService.waitForRenderedHTML(
        testRealmURL,
        new Map(files),
        timeoutMs,
      )),
    ];

    announce(4, [a]);
    assert.deepEqual(
      await wait([[a, 5]], 50),
      [],
      "a render below the file's generation does not count",
    );

    announce(5, [a]);
    let start = Date.now();
    assert.deepEqual(
      await wait([[a, 5]], 10_000),
      [a],
      "a render at the file's generation counts",
    );
    assert.ok(
      Date.now() - start < 1_000,
      'a wait already satisfied returns at once',
    );

    assert.deepEqual(
      await wait(
        [
          [a, 5],
          [b, 5],
        ],
        50,
      ),
      [a],
      'a wait that times out returns the files rendered so far',
    );

    let waiting = wait([[b, 6]], 10_000);
    announce(6, [b]);
    assert.deepEqual(
      await waiting,
      [b],
      'a render announced during the wait ends it',
    );
  });

  test("a realm's render watch ends once its module write's time is up and no wait holds it", async function (assert) {
    let toolService = getService('tool-service');
    let messageService = getService('message-service');
    toolService.__setWaitsForTesting({ renderedHTMLWatchMs: 50 });
    let a = `${testRealmURL}Milestone/a.json`;
    let trackModuleWrite = () =>
      toolService.trackAiAssistantCardRequest({
        action: 'test',
        roomId: '!room:example.com',
        fileUrl: `${testRealmURL}milestone.gts`,
      });
    let announce = () =>
      messageService.relayRealmEvent({
        eventName: 'prerender_html',
        invalidations: [a],
        generation: 1,
        realmURL: testRealmURL,
      });
    let wait = async () => [
      ...(await toolService.waitForRenderedHTML(
        testRealmURL,
        new Map([[a, 1]]),
        10_000,
      )),
    ];

    trackModuleWrite();
    await delay(150);
    announce();
    assert.deepEqual(
      await wait(),
      [],
      "a render announced after the write's time is up is not recorded",
    );

    trackModuleWrite();
    let waiting = wait();
    await delay(150);
    announce();
    assert.deepEqual(
      await waiting,
      [a],
      "a wait under way keeps the watch past the write's time",
    );
    assert.deepEqual(
      await wait(),
      [],
      'the watch ends with the last wait on it',
    );
  });

  test('a wait that a newer write to its target replaces leaves the newer write tracked', async function (assert) {
    let toolService = getService('tool-service');
    let roomId = '!room:example.com';
    let fileUrl = `${testRealmURL}milestone.gts`;
    toolService.trackAiAssistantCardRequest({
      action: 'test',
      roomId,
      fileUrl,
    });
    let first = toolService.waitForInvalidationAfterAIAssistantRequest(
      roomId,
      fileUrl,
      10_000,
    );
    let clientRequestId = toolService.trackAiAssistantCardRequest({
      action: 'test',
      roomId,
      fileUrl,
    });
    assert.strictEqual(
      await first,
      undefined,
      'the replaced wait ends without an index event',
    );

    let second = toolService.waitForInvalidationAfterAIAssistantRequest(
      roomId,
      fileUrl,
      10_000,
    );
    getService('message-service').relayRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [],
      generation: 7,
      clientRequestId,
      realmURL: testRealmURL,
    });
    assert.deepEqual(
      await second,
      { invalidations: [], generation: 7 },
      "the newer write's wait gets its index event",
    );
  });

  test('does not treat ordinary JSON configuration as a malformed card', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let command = new CheckCorrectnessTool(toolService.toolContext);

    let result = await command.execute({
      targetType: 'file',
      targetRef: `${testRealmURL}settings.json`,
      roomId: '!room:example.com',
    });

    assert.true(result.correct, 'ordinary JSON is not treated as a card');
    assert.deepEqual(result.errors, [], 'no card-document errors are reported');
  });

  test('reports size limit errors for file writes', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let fileUrl = `${testRealmURL}notes.txt`;

    let originalMaxSize = environmentService.fileSizeLimitBytes;
    environmentService.fileSizeLimitBytes = 20;

    try {
      await assert.rejects(
        runRealmCodeCommand.execute({
          realm: testRealmURL,
          roomId,
          code: writeTextScript('notes.txt', 'x'.repeat(21)),
        }),
        'the oversized write is refused',
      );

      let result = await command.execute({
        targetType: 'file',
        targetRef: fileUrl,
        roomId,
      });

      assert.false(result.correct, 'size limit error reports incorrect');
      assert.ok(
        result.errors[0]?.includes('exceeds maximum allowed size (20 bytes)'),
        'error mentions size limit',
      );
    } finally {
      environmentService.fileSizeLimitBytes = originalMaxSize;
    }
  });

  test('reports size limit errors for card writes via PatchCardInstanceTool', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let loader = getService('loader-service').loader as any;
    let store = getService('store') as any;
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let { Pet } = await loader.import(`${testRealmURL}pet`);
    let cardId = `${testRealmURL}Pet/billy`;

    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let originalMaxSize = environmentService.cardSizeLimitBytes;
    environmentService.cardSizeLimitBytes = 1000;

    try {
      let patchCommand = new PatchCardInstanceTool(toolService.toolContext, {
        cardType: Pet,
      });

      await patchCommand.execute({
        cardId,
        patch: {
          attributes: {
            name: 'x'.repeat(2000),
          },
        },
        roomId,
      });

      let result = await command.execute({
        targetType: 'card',
        targetRef: cardId,
        roomId,
      });
      assert.false(result.correct, 'size limit error reports incorrect');
      assert.ok(
        result.errors[0]?.includes('exceeds maximum allowed size (1000 bytes)'),
        'error mentions size limit',
      );
    } finally {
      environmentService.cardSizeLimitBytes = originalMaxSize;
    }
  });

  // Writes Ticket/t1.json (when overrides are given) and runs the correctness
  // check against it through the inferred-card file path.
  async function checkTicket(overrides?: Parameters<typeof ticketDocument>[0]) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    if (overrides) {
      let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
      await runRealmCodeCommand.execute({
        realm: testRealmURL,
        roomId,
        code: overwriteScript('Ticket/t1.json', ticketDocument(overrides)),
      });
    }
    return command.execute({
      targetType: 'file',
      targetRef: `${testRealmURL}Ticket/t1.json`,
      roomId,
    });
  }

  test('a valid instance passes with no warnings', async function (assert) {
    let result = await checkTicket();

    assert.true(result.correct, 'valid instance is correct');
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.deepEqual(result.warnings, [], 'no warnings are reported');
  });

  test('warns about attributes and relationships the card type does not declare', async function (assert) {
    let result = await checkTicket({
      attributes: {
        status: 'New',
        responseTimer: { hours: 4 },
        resolutionTimer: { hours: 24 },
      },
      relationships: {
        requester: { links: { self: '../Pet/billy' } },
      },
    });

    assert.true(result.correct, 'undeclared fields do not fail the check');
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.strictEqual(result.warnings.length, 3, 'three warnings');
    assert.ok(
      result.warnings.some((w: string) =>
        w.includes('"responseTimer" is not a field of Ticket'),
      ),
      'warns about the undeclared responseTimer attribute',
    );
    assert.ok(
      result.warnings.some((w: string) =>
        w.includes('"resolutionTimer" is not a field of Ticket'),
      ),
      'warns about the undeclared resolutionTimer attribute',
    );
    assert.ok(
      result.warnings.some(
        (w: string) =>
          w.includes('relationships.requester') &&
          w.includes('"requester" is not a field of Ticket'),
      ),
      'warns about the undeclared requester relationship',
    );
  });

  test('warns about an enum value outside the allowed options (card target)', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let cardId = `${testRealmURL}Ticket/t1`;

    await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript(
        'Ticket/t1.json',
        ticketDocument({ attributes: { status: 'open' } }),
      ),
    });

    let result = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(
      result.correct,
      'an out-of-range enum value does not fail the check',
    );
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.strictEqual(result.warnings.length, 1, 'one warning');
    assert.ok(
      result.warnings[0].includes(
        '"status" value "open" is not one of the allowed options',
      ),
      'warning names the field and the rejected value',
    );
    assert.ok(
      result.warnings[0].includes('"New", "Open", "Pending", "Resolved"'),
      'warning lists the allowed options',
    );
  });

  test('warns about values written in the wrong bucket', async function (assert) {
    let result = await checkTicket({
      attributes: {
        customer: { links: { self: '../Pet/billy' } },
        watchers: [{ links: { self: '../Pet/billy' } }],
      },
      relationships: {
        status: { links: { self: null } },
      },
    });

    assert.true(result.correct, 'bucket mismatches do not fail the check');
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.ok(
      result.warnings.some((w: string) =>
        w.includes(
          '"customer" is a linksTo relationship of Ticket but was written under "attributes"',
        ),
      ),
      'warns about the relationship written under attributes',
    );
    assert.ok(
      result.warnings.some((w: string) =>
        w.includes(
          '"status" is a contains attribute of Ticket but was written under "relationships"',
        ),
      ),
      'warns about the attribute written under relationships',
    );
    assert.ok(
      result.warnings.some(
        (w: string) =>
          w.includes(
            '"watchers" is a linksToMany relationship of Ticket but was written under "attributes"',
          ) && w.includes('"watchers.0": { "links"'),
      ),
      'tells the AI to move a linksToMany as indexed keys',
    );
  });

  test('warns about a relationship link whose target does not exist', async function (assert) {
    let result = await checkTicket({
      relationships: {
        customer: { links: { self: '../Pet/missing' } },
      },
    });

    assert.true(result.correct, 'a dangling link does not fail the check');
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.strictEqual(result.warnings.length, 1, 'one warning');
    assert.ok(
      result.warnings[0].includes(
        `"customer" links to ${testRealmURL}Pet/missing, which does not exist`,
      ),
      'warning names the field and the resolved target',
    );
  });

  test('does not flag a prefix-form link to a card that exists', async function (assert) {
    let result = await checkTicket({
      relationships: {
        customer: { links: { self: '../Pet/billy' } },
        reference: {
          links: { self: '@cardstack/base/cards/welcome-to-boxel' },
        },
      },
    });

    assert.true(result.correct, 'the instance is correct');
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.deepEqual(
      result.warnings,
      [],
      'the prefix-form link resolves to an existing card',
    );
  });

  test('checks a link to a file as a file', async function (assert) {
    let result = await checkTicket({
      relationships: {
        customer: { links: { self: '../Pet/billy' } },
        attachment: { links: { self: '../ticket-notes.txt' } },
      },
    });
    assert.true(result.correct, 'the instance is correct');
    assert.deepEqual(
      result.warnings,
      [],
      'an existing file target is not reported as missing',
    );

    result = await checkTicket({
      relationships: {
        customer: { links: { self: '../Pet/billy' } },
        attachment: { links: { self: '../missing.txt' } },
      },
    });
    assert.deepEqual(
      result.warnings.map((w: string) => w.replace(/^.*?: /, '')),
      [
        `"attachment" links to ${testRealmURL}missing.txt, which does not exist; create it or correct the link`,
      ],
      'a missing file target is reported',
    );
  });

  test('warns about a link to a card deleted after it was loaded', async function (assert) {
    let goneId = `${testRealmURL}Pet/gone`;
    await getService('store').get(goneId);
    await testRealm.delete('Pet/gone.json');

    let result = await checkTicket({
      relationships: {
        customer: { links: { self: '../Pet/gone' } },
      },
    });

    assert.true(result.correct, 'a dangling link does not fail the check');
    assert.strictEqual(result.warnings.length, 1, 'one warning');
    assert.ok(
      result.warnings[0].includes(
        `"customer" links to ${goneId}, which does not exist`,
      ),
      'the deleted target is reported even though the store loaded it',
    );
  });

  test('follows links given as relationship data', async function (assert) {
    let result = await checkTicket({
      relationships: {
        customer: { data: { type: 'card', id: '../Pet/missing' } },
        watchers: {
          data: [
            { type: 'card', id: '../Pet/billy' },
            { type: 'card', id: '../Pet/nobody' },
          ],
        },
      },
    });

    assert.true(result.correct, 'dangling links do not fail the check');
    assert.deepEqual(
      result.warnings.map((w: string) => w.replace(/^.*?: /, '')),
      [
        `"customer" links to ${testRealmURL}Pet/missing, which does not exist; create it or correct the link`,
        `"watchers.1" links to ${testRealmURL}Pet/nobody, which does not exist; create it or correct the link`,
      ],
      'targets named by data.id and by a data array are checked',
    );
  });

  test('does not judge a relationship inside a polymorphic element', async function (assert) {
    let result = await checkTicket({
      attributes: {
        status: 'New',
        items: [{ label: 'Escalation' }],
      },
      relationships: {
        customer: { links: { self: '../Pet/billy' } },
        'items.0.assignee': { links: { self: '../Pet/billy' } },
      },
      metaFields: {
        items: [
          { adoptsFrom: { module: '../ticket', name: 'AssignedItemField' } },
        ],
      },
    });

    assert.true(result.correct, 'the instance is correct');
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.deepEqual(
      result.warnings,
      [],
      'a field declared only on the element subtype is not reported',
    );
  });

  test('warns about an undeclared key inside a compound containsMany field', async function (assert) {
    let result = await checkTicket({
      attributes: {
        status: 'New',
        timers: [{ label: 'First response', minutes: 5 }],
      },
    });

    assert.true(
      result.correct,
      'the undeclared nested key does not fail the check',
    );
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.strictEqual(result.warnings.length, 1, 'one warning');
    assert.ok(
      result.warnings[0].includes(
        '"timers.0.minutes" is not a field of SlaTimer',
      ),
      'warning names the nested path and the field type',
    );
  });

  test('warns about a value written to a computed field', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';

    await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript(
        'Pet/billy.json',
        JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: { name: 'Billy', hasError: false, boom: 'written' },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
          null,
          2,
        ),
      ),
    });

    let result = await command.execute({
      targetType: 'file',
      targetRef: `${testRealmURL}Pet/billy.json`,
      roomId,
    });

    assert.true(
      result.correct,
      'a computed-field write does not fail the check',
    );
    assert.deepEqual(result.errors, [], 'no errors are reported');
    assert.strictEqual(result.warnings.length, 1, 'one warning');
    assert.ok(
      result.warnings[0].includes('"boom" is a computed field of Pet'),
      'warning names the computed field',
    );
  });
});
