import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { CommandContext, Realm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import CheckCorrectnessTool from '@cardstack/host/tools/check-correctness';
import PatchCardInstanceTool from '@cardstack/host/tools/patch-card-instance';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BaseCommandModule from '@cardstack/base/command';

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

  async function targetFields(targets: { type: string; ref: string }[]) {
    let { CorrectnessTargetField } = await getService(
      'loader-service',
    ).loader.import<typeof BaseCommandModule>('@cardstack/base/command');
    return targets.map((target) => new CorrectnessTargetField(target));
  }

  test('checks several targets in one call and names the one that fails', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let roomId = '!room:example.com';
    await new RunRealmCodeTool(toolService.toolContext).execute({
      realm: testRealmURL,
      roomId,
      code: writeTextScript('Pet/bill.json', petDocument('Bill', true)),
    });

    let result = await new CheckCorrectnessTool(
      toolService.toolContext,
    ).execute({
      roomId,
      targets: await targetFields([
        { type: 'card', ref: `${testRealmURL}Pet/billy` },
        { type: 'card', ref: `${testRealmURL}Pet/bill` },
        { type: 'file', ref: `${testRealmURL}ticket-notes.txt` },
        { type: 'file', ref: `${testRealmURL}settings.json` },
      ]),
    });

    assert.false(result.correct, 'the check fails');
    assert.strictEqual(result.checkedCount, 4, 'every target was checked');
    assert.strictEqual(result.passedCount, 3, 'the other three passed');
    assert.deepEqual(
      result.targetResults.map((entry) => entry.targetRef),
      [`${testRealmURL}Pet/bill`],
      'only the failing card has an entry',
    );
    assert.ok(
      result.targetResults[0]?.errors.some((error) =>
        error.includes('Name cannot be "Bill"'),
      ),
      'with its error',
    );
    assert.ok(
      result.errors.some((error) => error.includes('Name cannot be "Bill"')),
      'the error is also among the result’s errors',
    );
  });

  test('a check of several targets settles each target on its own', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let roomId = '!room:example.com';
    let originalMaxSize = environmentService.fileSizeLimitBytes;
    environmentService.fileSizeLimitBytes = 20;
    try {
      await assert.rejects(
        new RunRealmCodeTool(toolService.toolContext).execute({
          realm: testRealmURL,
          roomId,
          code: writeTextScript('notes.txt', 'x'.repeat(21)),
        }),
        'the oversized write is refused',
      );

      let result = await new CheckCorrectnessTool(
        toolService.toolContext,
      ).execute({
        roomId,
        targets: await targetFields([
          { type: 'file', ref: `${testRealmURL}notes.txt` },
          { type: 'card', ref: `${testRealmURL}Pet/billy` },
        ]),
      });

      assert.deepEqual(
        result.targetResults.map((entry) => entry.targetRef),
        [`${testRealmURL}notes.txt`],
        'the size limit fails only the oversized file',
      );
      assert.ok(
        result.targetResults[0]?.errors[0]?.includes(
          'exceeds maximum allowed size (20 bytes)',
        ),
        'with the size limit error',
      );
      assert.strictEqual(result.passedCount, 1, 'the card is still checked');
    } finally {
      environmentService.fileSizeLimitBytes = originalMaxSize;
    }
  });

  test('a one-target check answers as it always has', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let result = await new CheckCorrectnessTool(
      toolService.toolContext,
    ).execute({
      targetType: 'card',
      targetRef: `${testRealmURL}Pet/billy`,
      roomId: '!room:example.com',
    });

    assert.true(result.correct);
    assert.deepEqual(result.targetResults, [], 'no per-target entries');
    assert.notOk(result.checkedCount, 'no counts');
  });

  test('a check of many targets gets more time', async function (assert) {
    let cards = Array.from({ length: 20 }, (_, n) => ({
      type: 'card',
      ref: `${testRealmURL}Pet/${n}`,
    }));
    assert.strictEqual(
      CheckCorrectnessTool.extraExecuteTimeMsFor({
        targets: cards.slice(0, 8),
      }),
      0,
      'one round fits the standard timeout',
    );
    assert.strictEqual(
      CheckCorrectnessTool.extraExecuteTimeMsFor({
        targets: [...cards, { type: 'file', ref: `${testRealmURL}pet.gts` }],
      }),
      3 * ENV.cardRenderTimeout,
      'three cards rounds and one module round: three more render timeouts',
    );
    assert.strictEqual(
      CheckCorrectnessTool.extraExecuteTimeMsFor({
        targetType: 'card',
        targetRef: `${testRealmURL}Pet/billy`,
      }),
      0,
      'a one-target check needs no more',
    );
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
