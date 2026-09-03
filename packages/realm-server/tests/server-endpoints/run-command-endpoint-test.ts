import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmSecretSeed, insertUser } from '../helpers/index.ts';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';

// A realm-defined command that persists a card through SaveCardCommand and
// reports whether the save threw, so a test can tell a failed save apart from
// a failed invocation.
const saveNoteCommandSource = `
  import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
  import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
  import { Command } from '@cardstack/runtime-common';

  export class Note extends CardDef {
    static displayName = 'Note';
    @field body = contains(StringField);
  }

  export class SaveNoteInput extends CardDef {
    @field body = contains(StringField);
    @field realm = contains(StringField);
  }

  export class SaveNoteResult extends CardDef {
    @field savedId = contains(StringField);
    @field failure = contains(StringField);
  }

  export class SaveNoteCommand extends Command<
    typeof SaveNoteInput,
    typeof SaveNoteResult
  > {
    static actionVerb = 'Save';

    async getInputType() {
      return SaveNoteInput;
    }

    protected async run(input) {
      let note = new Note({ body: input.body });
      try {
        await new SaveCardCommand(this.commandContext).execute({
          card: note,
          realm: input.realm,
        });
        return new SaveNoteResult({ savedId: note.id });
      } catch (e) {
        return new SaveNoteResult({ failure: e?.message ?? String(e) });
      }
    }
  }
`;

// A realm-defined command that throws, to pin that a command's own failure
// reaches the caller as a reported result rather than as a transport error.
const throwingCommandSource = `
  import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
  import { Command } from '@cardstack/runtime-common';

  export class ThrowingInput extends CardDef {
    @field note = contains(StringField);
  }

  export class ThrowingCommand extends Command<typeof ThrowingInput, undefined> {
    static actionVerb = 'Throw';

    async getInputType() {
      return ThrowingInput;
    }

    protected async run() {
      throw new Error('deliberate failure from the command body');
    }
  }
`;

// Writes cards in the test realm. Distinct from the realm's own matrix user,
// whose requests bypass the permission comparison entirely.
const commandWriterUserId = '@cmd-writer:localhost';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('/_run-command endpoint', function (hooks) {
    let context = setupServerEndpointsTest(hooks, {
      fileSystem: {
        'save-note-command.gts': saveNoteCommandSource,
        'throwing-command.gts': throwingCommandSource,
      },
      // `'*'` is read-only so the save-card test's write has to present the
      // prerender JWT rather than short-circuiting on a world-write grant.
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
        [commandWriterUserId]: ['read', 'write'],
      },
    });

    test('requires auth', async function (assert) {
      let response = await context.request
        .post('/_run-command')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command: '@cardstack/boxel-host/commands/serialize-card/default',
            },
          },
        });
      assert.strictEqual(response.status, 401, 'HTTP 401 without auth');
    });

    test('rejects missing realmURL', async function (assert) {
      let matrixUserId = '@run-cmd-test:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_runcmd1',
        'runcmd@example.com',
      );

      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'run-command',
            attributes: {
              command: '@cardstack/boxel-host/commands/serialize-card/default',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing realmURL');
    });

    test('rejects missing command', async function (assert) {
      let matrixUserId = '@run-cmd-test2:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_runcmd2',
        'runcmd2@example.com',
      );

      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing command');
    });

    // Uses GetCardTypeSchemaCommand to verify end-to-end command execution
    test('can successfully run a command', async function (assert) {
      let matrixUserId = '@node-test_realm:localhost';

      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command:
                '@cardstack/boxel-host/commands/get-card-type-schema/default',
              commandInput: {
                codeRef: {
                  module: '@cardstack/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(attrs?.status, 'ready', 'command completed');
      assert.ok(attrs?.cardResultString, 'has result');

      let result = JSON.parse(attrs.cardResultString);
      let schema = result?.data?.attributes?.json ?? result;
      assert.ok(schema?.attributes, 'schema has attributes');
    });

    // A card write indexes synchronously, so the command waits on an
    // `incremental-index` job. Running the command from a worker job would
    // starve that job of the only worker and fail the invocation at its
    // timeout, past any `try`/`catch` the command wrote.
    test('a command that saves a card completes and the card is durable', async function (assert) {
      let matrixUserId = commandWriterUserId;

      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command: `${testRealmURL.href}save-note-command/SaveNoteCommand`,
              commandInput: {
                body: 'saved from a headless command',
                realm: testRealmURL.href,
              },
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(
        attrs?.status,
        'ready',
        `command completed (error: ${attrs?.error ?? 'none'})`,
      );

      let saveResult = JSON.parse(attrs.cardResultString)?.data?.attributes;
      assert.notOk(saveResult?.failure, 'the save did not throw');
      let savedId = String(saveResult?.savedId);
      assert.ok(
        savedId.startsWith(testRealmURL.href),
        `saved card id is in the test realm: ${savedId}`,
      );

      // The invocation held no queue job, which is what keeps it from waiting
      // on a worker it is also occupying.
      let [{ count }] = (await context.dbAdapter.execute(
        `SELECT count(*)::int AS count FROM jobs WHERE job_type = 'run-command'`,
      )) as { count: number }[];
      assert.strictEqual(count, 0, 'no run-command job was published');

      // The write indexed deferred, so the read-back has to wait for that
      // enqueued job rather than assume the POST already covered it.
      await context.testRealm.incrementalIndexing();
      let saved = await context.request
        .get(new URL(savedId).pathname)
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(saved.status, 200, 'the saved card is readable');
      assert.strictEqual(
        saved.body?.data?.attributes?.body,
        'saved from a headless command',
        'the saved card holds what the command wrote',
      );
    });

    // The ask behind the deadlock fix was that a command's failure be
    // reachable: a throw inside the command body has to come back as a
    // reported result the invoking code can branch on, not as a transport
    // error manufactured outside the browser.
    test('a command that throws reports a catchable error result', async function (assert) {
      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: commandWriterUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command: `${testRealmURL.href}throwing-command/ThrowingCommand`,
              commandInput: { note: 'anything' },
            },
          },
        });

      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(attrs?.status, 'error', 'reported as an error result');
      assert.ok(
        String(attrs?.error ?? '').includes(
          'deliberate failure from the command body',
        ),
        `error carries the command's message: ${attrs?.error}`,
      );
    });

    test('rejects invalid JSON body', async function (assert) {
      let matrixUserId = '@run-cmd-test3:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_runcmd3',
        'runcmd3@example.com',
      );

      let response = await context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send('not json');
      assert.strictEqual(response.status, 400, 'HTTP 400 for invalid body');
    });
  });
});
