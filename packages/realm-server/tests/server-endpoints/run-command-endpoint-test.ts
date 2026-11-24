import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { randomBytes } from 'node:crypto';
import { realmSecretSeed, insertUser } from '../helpers/index.ts';
import { endGrant } from '../../lib/oauth-provider/grants.ts';
import { sha256Hex } from '../../lib/oauth-provider/objects.ts';
import { oauthIssuer } from '../../lib/oauth-provider/registry.ts';
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

// A realm-defined command that answers with every credential its tab holds:
// what code an OAuth app wrote could read and carry out of the tab.
const leakCredentialsCommandSource = `
  import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
  import { Command } from '@cardstack/runtime-common';

  export class LeakInput extends CardDef {
    @field note = contains(StringField);
  }

  export class LeakResult extends CardDef {
    @field inMemory = contains(StringField);
    @field stored = contains(StringField);
  }

  export class LeakCredentialsCommand extends Command<
    typeof LeakInput,
    typeof LeakResult
  > {
    static actionVerb = 'Leak';

    async getInputType() {
      return LeakInput;
    }

    protected async run() {
      return new LeakResult({
        inMemory: JSON.stringify(globalThis.__boxelInMemorySessions ?? null),
        stored: localStorage.getItem('boxel-session') ?? '',
      });
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

    // Pins that a command can persist a card and that the card is durable
    // afterwards. The harness runs a single worker and a single prerender
    // pool, so a write that waited on indexing would have nothing left to
    // run it and the invocation would fail at its timeout.
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

    // Pins that a throw inside the command body comes back as a reported
    // result the invoking code can branch on, rather than as a transport
    // error manufactured outside the browser where no `try`/`catch` in the
    // command can see it.
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

  // An OAuth app (ADR 021) runs a command with a Boxel API token. The command
  // runs code the app chose, so its tab holds tab tokens the app's grant
  // bounds (`runtime-common/oauth-tab-token.ts`), never the user's sessions.
  module('/_run-command with a Boxel API OAuth token', function (hooks) {
    let context = setupServerEndpointsTest(hooks, {
      fileSystem: {
        'save-note-command.gts': saveNoteCommandSource,
        'leak-credentials-command.gts': leakCredentialsCommandSource,
      },
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
        [commandWriterUserId]: ['read', 'write'],
      },
      oauthProvider: true,
    });

    const BOXEL_API = oauthIssuer(testRealmURL.origin);

    // An access token as the provider stores one, on a grant of its own.
    async function oauthToken(
      user: string,
      scope = 'boxel:read boxel:write',
    ): Promise<{ token: string; grantId: string }> {
      let [{ id: userId }] = (await context.dbAdapter.execute(
        `INSERT INTO users (matrix_user_id) VALUES ($1)
           ON CONFLICT (matrix_user_id)
           DO UPDATE SET matrix_user_id = EXCLUDED.matrix_user_id
           RETURNING id`,
        { bind: [user] },
      )) as { id: string }[];
      let grantId = randomBytes(16).toString('base64url');
      let token = randomBytes(32).toString('base64url');
      await context.dbAdapter.execute(
        `INSERT INTO oauth_provider_grants
           (id, user_id, client_id, resources, renewing, expires_at)
           VALUES ($1, $2::uuid, 'boxel-cli', $3::jsonb, false,
                   now() + interval '1 hour')`,
        {
          bind: [
            grantId,
            userId,
            JSON.stringify({ [BOXEL_API]: scope.split(' ') }),
          ],
        },
      );
      await context.dbAdapter.execute(
        `INSERT INTO oauth_provider_tokens
           (id_hash, kind, grant_id, resource, scope, payload, expires_at)
           VALUES (decode($1, 'hex'), 'AccessToken', $2, $3, $4, '{}'::jsonb,
                   now() + interval '10 minutes')`,
        { bind: [sha256Hex(token), grantId, BOXEL_API, scope] },
      );
      return { token, grantId };
    }

    function runCommand(
      token: string,
      command: string,
      commandInput: Record<string, unknown>,
    ) {
      return context.request
        .post('/_run-command')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'run-command',
            attributes: {
              realmURL: testRealmURL.href,
              command,
              commandInput,
            },
          },
        });
    }

    function claimsOf(token: string): Record<string, any> {
      return JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
    }

    test('runs a command that writes a card, as the grant’s user', async function (assert) {
      let { token } = await oauthToken(commandWriterUserId);
      let response = await runCommand(
        token,
        `${testRealmURL.href}save-note-command/SaveNoteCommand`,
        { body: 'saved by an OAuth app', realm: testRealmURL.href },
      );
      assert.strictEqual(response.status, 201, response.text);
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(
        attrs?.status,
        'ready',
        `command completed (error: ${attrs?.error ?? 'none'})`,
      );
      let saveResult = JSON.parse(attrs.cardResultString)?.data?.attributes;
      assert.notOk(saveResult?.failure, `the save did not throw`);

      await context.testRealm.incrementalIndexing();
      let saved = await context.request
        .get(new URL(String(saveResult?.savedId)).pathname)
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(saved.status, 200, 'the saved card is readable');
      assert.strictEqual(
        saved.body?.data?.attributes?.body,
        'saved by an OAuth app',
      );
    });

    test('its tab holds tab tokens its grant bounds, and nothing else', async function (assert) {
      let { token, grantId } = await oauthToken(commandWriterUserId);
      let response = await runCommand(
        token,
        `${testRealmURL.href}leak-credentials-command/LeakCredentialsCommand`,
        { note: 'anything' },
      );
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(
        attrs?.status,
        'ready',
        `command completed (error: ${attrs?.error ?? 'none'})`,
      );
      let leaked = JSON.parse(attrs.cardResultString)?.data?.attributes;
      assert.strictEqual(leaked?.stored, '', 'no session is kept in storage');
      let sessions = JSON.parse(leaked?.inMemory ?? 'null') as Record<
        string,
        string
      > | null;
      assert.ok(sessions, 'the tab holds its tokens in memory');
      let tabToken = sessions![testRealmURL.href];
      assert.ok(tabToken, 'it holds one for the command’s realm');
      for (let value of Object.values(sessions!)) {
        let claims = claimsOf(value);
        assert.strictEqual(claims.oauthTab?.grant, grantId);
        assert.strictEqual(claims.user, commandWriterUserId);
        assert.false(
          (claims.permissions ?? []).includes('realm-owner'),
          'nothing it holds claims to administer',
        );
      }

      // What the command could carry out works as the grant allows...
      let written = await context.request
        .post(`${testRealmURL.pathname}leaked.md`)
        .set('Accept', 'application/vnd.card+source')
        .set('Content-Type', 'application/vnd.card+source')
        .set('Authorization', tabToken)
        .send('# Written with a leaked tab token');
      let wrote = written.status >= 200 && written.status < 300;
      assert.true(
        wrote,
        `the tab token writes as the user: ${written.status} ${written.text}`,
      );

      // ...and nowhere a session goes.
      for (let [method, path] of [
        ['get', `${testRealmURL.pathname}_permissions`],
        ['post', '/_realm-auth'],
        ['get', '/_user'],
        ['post', '/_run-command'],
        ['post', '/_request-forward'],
      ] as ['get' | 'post', string][]) {
        let refused = await context.request[method](path)
          .set('Accept', 'application/json')
          .set('Authorization', tabToken);
        assert.true(
          [401, 403].includes(refused.status),
          `${method.toUpperCase()} ${path}: ${refused.status}`,
        );
      }
    });

    test('a tab token outlives neither its grant nor a disconnect', async function (assert) {
      let { token, grantId } = await oauthToken(commandWriterUserId);
      let response = await runCommand(
        token,
        `${testRealmURL.href}leak-credentials-command/LeakCredentialsCommand`,
        { note: 'anything' },
      );
      let leaked = JSON.parse(response.body.data.attributes.cardResultString)
        ?.data?.attributes;
      let tabToken = JSON.parse(leaked.inMemory)[testRealmURL.href];

      await endGrant(context.dbAdapter, grantId, 'user');
      let refused = await context.request
        .post(`${testRealmURL.pathname}after-disconnect.md`)
        .set('Accept', 'application/vnd.card+source')
        .set('Content-Type', 'application/vnd.card+source')
        .set('Authorization', tabToken)
        .send('# Written after the app was disconnected');
      assert.strictEqual(refused.status, 401, refused.text);
    });

    test('a boxel:read token can’t run a command', async function (assert) {
      let { token } = await oauthToken(commandWriterUserId, 'boxel:read');
      let response = await runCommand(
        token,
        `${testRealmURL.href}save-note-command/SaveNoteCommand`,
        { body: 'never saved', realm: testRealmURL.href },
      );
      assert.strictEqual(response.status, 403, response.text);
      assert.strictEqual(response.body?.error, 'insufficient_scope');
    });
  });
});
