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
import {
  describeDestination,
  registrableDomain,
} from '../lib/secure-window.ts';

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

    test('refuses a request it can’t make sense of', async function (assert) {
      for (let attributes of [
        {},
        { realm: 'not a url' },
        { operation: 'forecast' },
        { target: { kind: 'file', url: `${REALM.href}today` } },
        { destination: 'https://evil.example/' },
        {
          realm: 'http://127.0.0.1:4475/other/',
          target: { kind: 'instance', url: `${REALM.href}today` },
        },
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
