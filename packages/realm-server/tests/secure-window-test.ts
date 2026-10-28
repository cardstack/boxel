import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';

import { rri } from '@cardstack/runtime-common';
import type {
  DBAdapter,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { VirtualNetwork } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  describeDestination,
  registrableDomain,
  secureWindowContext,
  validateContextRequest,
  writableRealms,
} from '../lib/secure-window.ts';
import { UserKeyError } from '../lib/user-keys.ts';

// What the secure window asks about what it was opened for: a realm, a card
// or type, and an operation on it, answered from the server's own records,
// and only to the window's own session.

const REALM = new URL('http://127.0.0.1:4475/test/');
const WRITER = '@writer:localhost';
const READER = '@reader:localhost';
const STRANGER = '@stranger:localhost';
const OWNER = '@node-test_realm:localhost';
const WEATHER = { module: rri(`${REALM.href}weather`), name: 'Weather' };

function makeFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'realm.json': {
      data: {
        type: 'card',
        attributes: { cardInfo: { name: 'Team Workspace' } },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
    'weather.gts': `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { operation, params } from "@cardstack/base/operations";

      export class Weather extends CardDef {
        static displayName = 'Weather Report';
        @field city = contains(StringField);

        @operation static forecast = {
          base: 'callApi',
          label: 'Get the forecast',
          params: { day: StringField },
          url: 'https://API.Weather.co.uk:443/v2/../v3/forecast/{day}',
          path: { day: params('day') },
          headers: { authorization: 'Bearer {{userKey}}' },
        };

        @operation static listCities = {
          base: 'callApi',
          url: 'https://api.github.com/repos/cities',
        };
      }
    `,
    'today.json': {
      data: {
        type: 'card',
        attributes: { city: 'Leeds' },
        meta: { adoptsFrom: WEATHER },
      },
    },
  };
}

module(basename(import.meta.filename), function () {
  module('registrable domains', function () {
    test('a host is shown by the part a person recognizes', function (assert) {
      assert.strictEqual(registrableDomain('api.github.com'), 'github.com');
      assert.strictEqual(registrableDomain('github.com'), 'github.com');
      assert.strictEqual(registrableDomain('foo.co.uk'), 'foo.co.uk');
      assert.strictEqual(registrableDomain('api.foo.co.uk'), 'foo.co.uk');
      assert.strictEqual(registrableDomain('eu.api.openai.com'), 'openai.com');
      assert.strictEqual(
        registrableDomain('alice.github.io'),
        'alice.github.io',
        'a name anyone may register under a hosting suffix is its own',
      );
      assert.strictEqual(registrableDomain('localhost'), 'localhost');
      assert.strictEqual(registrableDomain('127.0.0.1'), '127.0.0.1');
    });

    test('a destination is described by its domain, host and path', function (assert) {
      assert.deepEqual(describeDestination('https://api.github.com/graphql/'), {
        href: 'https://api.github.com/graphql/',
        host: 'api.github.com',
        path: '/graphql/',
        registrableDomain: 'github.com',
      });
      assert.deepEqual(
        describeDestination('http://localhost:4519/v1/'),
        {
          href: 'http://localhost:4519/v1/',
          host: 'localhost:4519',
          path: '/v1/',
          registrableDomain: 'localhost',
        },
        'a port is part of the host',
      );
    });
  });

  module('the read boundary', function () {
    // Realms on one server: one the user may read, one they may not, and one
    // they may read that this process hasn't mounted yet, as a deployed
    // server leaves every realm until its first request. A prefix names the
    // readable one. The database answers only the questions the context asks.
    const OPEN = 'https://realms.example.test/open/';
    const CLOSED = 'https://realms.example.test/closed/';
    const LAZY = 'https://realms.example.test/lazy/';
    const USER = '@someone:example.test';
    const PERMISSIONS: Record<string, Record<string, [boolean, boolean]>> = {
      [OPEN]: { [USER]: [true, true] },
      [CLOSED]: { '@owner:example.test': [true, true] },
      [LAZY]: { [USER]: [true, true] },
      // A permission row left behind by a realm the server no longer serves.
      ['https://realms.example.test/removed/']: { [USER]: [true, true] },
    };
    const NAMES: Record<string, string> = {
      [OPEN]: 'Open',
      [CLOSED]: 'Closed',
      [LAZY]: 'Lazy',
    };

    function fakeRealm(url: string) {
      return {
        url,
        getRealmInfo: async () => ({ name: NAMES[url] }),
      } as unknown as Realm;
    }

    let dbAdapter = {
      kind: 'pg',
      async execute(sql: string, opts?: { bind?: unknown[] }) {
        let bind = (opts?.bind ?? []) as string[];
        if (sql.includes('SELECT username, read, write, realm_owner')) {
          return Object.entries(PERMISSIONS[bind[0]] ?? {}).map(
            ([username, [read, write]]) => ({
              username,
              read,
              write,
              realm_owner: false,
            }),
          );
        }
        if (sql.includes('SELECT write FROM realm_user_permissions')) {
          let row = PERMISSIONS[bind[0]]?.[bind[1]];
          return row ? [{ write: row[1] }] : [];
        }
        if (sql.includes('SELECT rup.realm_url, rup.username, rup.write')) {
          return Object.entries(PERMISSIONS)
            .filter(([, users]) => users[bind[0]]?.[1])
            .map(([realm_url]) => ({
              realm_url,
              username: bind[0],
              write: true,
              name: NAMES[realm_url] ?? null,
            }));
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    } as unknown as DBAdapter;

    let looked: string[] = [];
    let mounted: string[] = [];
    let deps = () => {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addRealmMapping('@example/open/', OPEN);
      mounted = [OPEN, CLOSED];
      return {
        dbAdapter,
        findRealm: async (url: URL) => {
          let realmURL = [OPEN, CLOSED, LAZY].find((r) =>
            url.href.startsWith(r),
          );
          return realmURL
            ? {
                url: realmURL,
                mount: async () => {
                  if (!mounted.includes(realmURL)) {
                    mounted.push(realmURL);
                  }
                  return fakeRealm(realmURL);
                },
              }
            : undefined;
        },
        virtualNetwork,
        definitionLookup: {
          forRealm: () => ({
            lookupDefinition: async (ref: { module: string; name: string }) => {
              looked.push(ref.module);
              return {
                displayName: 'Weather Report',
                operations: { forecast: { base: 'callApi' } },
              };
            },
          }),
        } as any,
      };
    };

    async function refusal(promise: Promise<unknown>) {
      try {
        await promise;
      } catch (e) {
        if (e instanceof UserKeyError) {
          return `${e.status} ${e.message}`;
        }
        throw e;
      }
      return 'answered';
    }

    test('a type whose module is in a realm the user can’t read answers as one that doesn’t exist', async function (assert) {
      looked = [];
      let hidden = await refusal(
        secureWindowContext(
          deps(),
          USER,
          validateContextRequest({
            target: {
              kind: 'type',
              module: `${CLOSED}weather`,
              name: 'Weather',
              realm: OPEN,
            },
            operation: 'forecast',
          }),
        ),
      );
      let missing = await refusal(
        secureWindowContext(
          deps(),
          USER,
          validateContextRequest({
            realm: 'https://realms.example.test/gone/',
          }),
        ),
      );
      assert.strictEqual(hidden, missing, 'the two refusals read alike');
      assert.true(hidden.startsWith('404'), hidden);
      assert.deepEqual(looked, [], 'the definition is never read');
    });

    test('a realm named beside a target in another realm answers as one that doesn’t exist', async function (assert) {
      let ask = (realm: string) =>
        refusal(
          secureWindowContext(
            deps(),
            USER,
            validateContextRequest({
              realm,
              target: {
                kind: 'type',
                module: `${OPEN}weather`,
                name: 'Weather',
                realm: OPEN,
              },
            }),
          ),
        );
      let unreadable = await ask(CLOSED);
      let missing = await ask('https://realms.example.test/gone/');
      assert.strictEqual(unreadable, missing, 'the two refusals read alike');
      assert.true(unreadable.startsWith('404'), unreadable);
    });

    test('a realm this process hasn’t mounted yet is found, and mounted only for a reader', async function (assert) {
      let context = await secureWindowContext(
        deps(),
        USER,
        validateContextRequest({ realm: LAZY }),
      );
      assert.strictEqual(context.realm.name, 'Lazy');
      assert.true(mounted.includes(LAZY), 'mounted once the user may read it');

      let stranger = await refusal(
        secureWindowContext(
          deps(),
          '@stranger:example.test',
          validateContextRequest({ realm: LAZY }),
        ),
      );
      assert.true(stranger.startsWith('404'), stranger);
      assert.false(mounted.includes(LAZY), 'never mounted for a stranger');
    });

    test('a type in a readable realm is described', async function (assert) {
      let context = await secureWindowContext(
        deps(),
        USER,
        validateContextRequest({
          target: {
            kind: 'type',
            module: `${OPEN}weather`,
            name: 'Weather',
            realm: OPEN,
          },
          operation: 'forecast',
        }),
      );
      assert.strictEqual(context.card?.name, 'Weather Report');
      assert.strictEqual(context.operation?.label, 'Forecast');
    });

    test('takes prefix-form ids, resolved through the virtual network', async function (assert) {
      let context = await secureWindowContext(
        deps(),
        USER,
        validateContextRequest({
          target: {
            kind: 'type',
            module: '@example/open/weather',
            name: 'Weather',
            realm: '@example/open/',
          },
        }),
      );
      assert.strictEqual(context.realm.url, OPEN);
      assert.strictEqual(context.realm.name, 'Open');
      assert.strictEqual(context.card?.module, '@example/open/weather');
      let byPrefix = await secureWindowContext(
        deps(),
        USER,
        validateContextRequest({ realm: '@example/open/' }),
      );
      assert.true(byPrefix.realm.directWriter);
    });

    test('lists only the realms the user is a direct writer of', async function (assert) {
      assert.deepEqual(
        await writableRealms(deps(), USER),
        [
          { url: LAZY, name: 'Lazy' },
          { url: OPEN, name: 'Open' },
        ],
        'a realm not mounted yet is listed; one no longer served is not',
      );
      assert.deepEqual(mounted, [OPEN, CLOSED], 'listing mounts nothing');
      assert.deepEqual(
        await writableRealms(deps(), '@node-test_realm:example.test'),
        [],
        'a bot account writes nowhere a key could be shared',
      );
    });
  });

  module('POST /_secure-window/context', function (hooks) {
    let request: SuperTest<Test>;
    let dbAdapter: DBAdapter;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: REALM,
      permissions: {
        [WRITER]: ['read', 'write'],
        [READER]: ['read'],
        [OWNER]: ['read', 'write', 'realm-owner'],
      },
      fileSystem: makeFileSystem(),
      onRealmSetup(args) {
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    async function ask(
      user: string,
      attributes: Record<string, unknown>,
      authorization?: string,
    ) {
      return await request
        .post('/_secure-window/context')
        .set(
          'Authorization',
          authorization ?? (await secureSessionAuth(dbAdapter, user)),
        )
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'secure-window-context', attributes } });
    }

    test('describes a realm, and whether the user is one of its direct writers', async function (assert) {
      let writer = await ask(WRITER, { realm: REALM.href });
      assert.strictEqual(writer.status, 200, writer.text);
      assert.deepEqual(writer.body.data.attributes, {
        realm: { url: REALM.href, name: 'Team Workspace', directWriter: true },
      });

      let reader = await ask(READER, {
        // Named without its trailing slash, as a person might.
        realm: REALM.href.replace(/\/$/, ''),
      });
      assert.strictEqual(reader.status, 200, reader.text);
      assert.false(reader.body.data.attributes.realm.directWriter);
    });

    test('describes an operation on a card, with where it sends a key', async function (assert) {
      let response = await ask(READER, {
        target: { kind: 'instance', url: `${REALM.href}today` },
        operation: 'forecast',
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data.attributes, {
        realm: {
          url: REALM.href,
          name: 'Team Workspace',
          directWriter: false,
        },
        card: {
          name: 'Weather Report',
          module: `${REALM.href}weather`,
          exportName: 'Weather',
        },
        operation: {
          name: 'forecast',
          label: 'Get the forecast',
          base: 'callApi',
          method: 'GET',
          destination: {
            href: 'https://api.weather.co.uk/v3/forecast/',
            host: 'api.weather.co.uk',
            path: '/v3/forecast/',
            registrableDomain: 'weather.co.uk',
          },
          slots: [{ name: 'userKey', key: 'userKey' }],
        },
      });
    });

    test('describes an operation on a type, labelled by its name when it has no label', async function (assert) {
      let response = await ask(WRITER, {
        target: {
          kind: 'type',
          module: `${REALM.href}weather`,
          name: 'Weather',
          realm: REALM.href,
        },
        operation: 'listCities',
      });
      assert.strictEqual(response.status, 200, response.text);
      let { operation } = response.body.data.attributes;
      assert.strictEqual(operation.label, 'List cities');
      assert.strictEqual(operation.destination.host, 'api.github.com');
      assert.strictEqual(operation.destination.registrableDomain, 'github.com');
      assert.deepEqual(operation.slots, []);
    });

    test('answers a realm, card or operation the user can’t read as one that doesn’t exist', async function (assert) {
      let stranger = await ask(STRANGER, { realm: REALM.href });
      assert.strictEqual(stranger.status, 404);
      let unknownRealm = await ask(WRITER, {
        realm: 'http://127.0.0.1:4475/elsewhere/',
      });
      assert.strictEqual(unknownRealm.status, 404);
      assert.strictEqual(
        stranger.body.errors[0].detail,
        unknownRealm.body.errors[0].detail,
        'the two refusals read alike',
      );
      let strangerCard = await ask(STRANGER, {
        target: { kind: 'instance', url: `${REALM.href}today` },
        operation: 'forecast',
      });
      assert.strictEqual(strangerCard.status, 404);
      let noCard = await ask(WRITER, {
        target: { kind: 'instance', url: `${REALM.href}nowhere` },
      });
      assert.strictEqual(noCard.status, 404);
      let noOperation = await ask(WRITER, {
        target: { kind: 'instance', url: `${REALM.href}today` },
        operation: 'toString',
      });
      assert.strictEqual(noOperation.status, 404);
      let otherRealm = await ask(WRITER, {
        realm: 'http://127.0.0.1:4475/other/',
        target: { kind: 'instance', url: `${REALM.href}today` },
      });
      assert.strictEqual(
        otherRealm.status,
        404,
        'a realm named beside a target in another realm',
      );
    });

    test('answers only the window’s own session', async function (assert) {
      let appSession = `Bearer ${createRealmServerJWT(
        { user: WRITER, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      let response = await ask(WRITER, { realm: REALM.href }, appSession);
      assert.strictEqual(response.status, 403);
      let none = await request
        .post('/_secure-window/context')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'secure-window-context',
            attributes: { realm: REALM.href },
          },
        });
      assert.strictEqual(none.status, 401);
    });

    test('GET /_secure-window/realms lists the realms the user writes, to the window’s own session', async function (assert) {
      let realms = async (user: string, authorization?: string) =>
        await request
          .get('/_secure-window/realms')
          .set(
            'Authorization',
            authorization ?? (await secureSessionAuth(dbAdapter, user)),
          );
      let writer = await realms(WRITER);
      assert.strictEqual(writer.status, 200, writer.text);
      assert.deepEqual(writer.body.data, [
        {
          type: 'secure-window-realm',
          id: REALM.href,
          attributes: { name: 'Team Workspace' },
        },
      ]);
      let reader = await realms(READER);
      assert.deepEqual(reader.body.data, [], 'a reader writes nowhere');
      let appSession = await realms(
        WRITER,
        `Bearer ${createRealmServerJWT(
          { user: WRITER, sessionRoom: 'test-session' },
          realmSecretSeed,
        )}`,
      );
      assert.strictEqual(appSession.status, 403);
    });

    test('refuses a request it can’t make sense of', async function (assert) {
      for (let attributes of [
        {},
        { realm: 'not a url' },
        { realm: 'ftp://example.test/realm/' },
        { operation: 'forecast' },
        { target: { kind: 'file', url: `${REALM.href}today` } },
        { destination: 'https://evil.example/' },
      ]) {
        let response = await ask(WRITER, attributes);
        assert.strictEqual(
          response.status,
          400,
          `${JSON.stringify(attributes)}: ${response.text}`,
        );
      }
    });
  });
});
