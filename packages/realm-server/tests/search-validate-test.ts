import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// `QUERY <realm>/_search?validate`: the body is lowered and checked as a
// search would check it, and not run. The answer is the query the engine
// would receive (older spelling, type references resolved) or the refusal a
// search gives, so an app's captured bodies can be checked before an upgrade.

const realmURL = testRealmURLFor('validate/');

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'talk.gts': `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class Talk extends CardDef {
        @field name = contains(StringField);
      }
    `,
    'talk-1.json': {
      data: {
        attributes: { name: 'One' },
        meta: { adoptsFrom: { module: rri('./talk'), name: 'Talk' } },
      },
    } as LooseSingleCardDocument,
  };
}

module(basename(import.meta.filename), function () {
  module('_search?validate', function (hooks) {
    let request: SuperTest<Test>;
    let realmHref: string;
    let searchPath: string;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup(args: { testRealm: Realm; request: SuperTest<Test> }) {
        request = args.request;
        realmHref = new URL(args.testRealm.url).href;
        searchPath = `${new URL(args.testRealm.url).pathname}_search`;
      },
    });

    const validate = (body: object) =>
      request
        .post(`${searchPath}?validate`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send(body);

    test('a valid query answers with the query the engine would run, and runs nothing', async function (assert) {
      let response = await validate({
        type: '$REALM/talk#Talk',
        filter: { eq: { 'item.name': 'One' } },
        sort: [{ by: 'item.name' }],
        page: { size: 5 },
      });
      assert.strictEqual(response.status, 200, response.text);
      let talk = { module: `${realmHref}talk`, name: 'Talk' };
      assert.deepEqual(response.body.meta, {
        valid: true,
        query: {
          filter: { on: talk, every: [{ eq: { name: 'One' } }] },
          sort: [{ by: 'name', on: talk }],
          page: { size: 5, total: 'capped' },
        },
      });
      assert.strictEqual(response.body.data, undefined, 'no rows');
    });

    test('a query a search would refuse gets the same refusal', async function (assert) {
      let response = await validate({
        type: '$REALM/talk#Talk',
        filter: { eq: { 'item.name': 'One' }, note: 'x' },
      });
      assert.strictEqual(response.status, 400, response.text);
      assert.strictEqual(response.body.errors[0].code, 'unknown-key');
      let searched = await request
        .post(searchPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          type: '$REALM/talk#Talk',
          filter: { eq: { 'item.name': 'One' }, note: 'x' },
        });
      assert.strictEqual(searched.status, 400);
      assert.deepEqual(
        response.body.errors,
        searched.body.errors,
        'the refusal a search gives',
      );
    });
  });
});
