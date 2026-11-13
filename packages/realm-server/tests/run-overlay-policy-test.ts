import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import { stageRunOverlayFile } from '@cardstack/runtime-common/run-overlay';
import type { Realm } from '@cardstack/runtime-common';
import {
  createAutomationRunToken,
  createJWT,
  realmConfigCardJSON,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// ============================================================================
// A run whose person the realm ACL lets only read has its operations decided
// by the realm's policy, and the policy judges the card the run staged: the
// rule that matches is the staged card's type's, and a predicate reads the
// staged card's fields.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/run-overlay-policy-test/');
const READER = '@reader:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// A reader may close a notice that is open, and nothing else.
const RULES = [
  {
    targetType: { module: `${realmURL.href}notice`, name: 'Notice' },
    grants: [{ operation: 'close', where: '.status == "open"' }],
  },
];

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;

  setupCatalogTestSubset(hooks);

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [READER]: ['read'],
      '@node-test_realm:localhost': ['read', 'realm-owner'],
    },
    fileSystem: {
      'realm.json': realmConfigCardJSON({
        name: 'Run overlay policy',
        policy: `${realmURL.href}policies/run`,
      }),
      'policies/run.json': {
        data: {
          type: 'card',
          attributes: { rules: RULES },
          meta: { adoptsFrom: REALM_POLICY },
        },
      },
      'person.gts': `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
export class Person extends CardDef {
  @field name = contains(StringField);
}`,
      'notice.gts': `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { operation } from 'https://cardstack.com/base/operations';
export class Notice extends CardDef {
  @field body = contains(StringField);
  @field status = contains(StringField);
  @operation static close = { base: 'transform', set: { status: 'closed' } };
}`,
      'people/ada.json': {
        data: {
          type: 'card',
          attributes: { name: 'Ada' },
          meta: { adoptsFrom: { module: rri('../person'), name: 'Person' } },
        },
      },
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
    },
  });

  async function operations(token: string, entries: unknown[]) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.BoxelOperations,
          'Content-Type': SupportedMimeType.BoxelOperations,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 'boxel:operations': entries }),
      }),
    ))!;
    let text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  }

  async function readCard(token: string, path: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        headers: {
          Accept: SupportedMimeType.CardJson,
          Authorization: `Bearer ${token}`,
        },
      }),
    ))!;
    let text = await response.text();
    return {
      status: response.status,
      text,
      data: response.status === 200 ? JSON.parse(text).data : undefined,
    };
  }

  // Stages `people/ada.json` for the run as a Notice with `status`.
  async function stageAdaAsNotice(
    run: { id: string; attempt?: number | null },
    status: string,
  ) {
    let staged = await stageRunOverlayFile(
      dbAdapter,
      { runId: run.id, attempt: run.attempt! },
      'people/ada.json',
      new TextEncoder().encode(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { body: 'Ada, as a notice', status },
            meta: { adoptsFrom: { module: '../notice', name: 'Notice' } },
          },
        }),
      ),
      100,
    );
    if (staged.kind !== 'staged') {
      throw new Error(`expected people/ada.json to stage, got ${staged.kind}`);
    }
  }

  const close = { op: 'invoke', 'boxel:name': 'close', href: './people/ada' };

  test('the policy admits a run’s operation by the type and fields of the card it staged', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      READER,
    );
    await stageAdaAsNotice(run, 'open');

    let closed = await operations(token, [close]);
    assert.strictEqual(closed.status, 200, closed.text);
    let staged = await readCard(token, 'people/ada');
    assert.strictEqual(staged.status, 200, staged.text);
    assert.strictEqual(staged.data.attributes.status, 'closed');

    let reader = createJWT(realm, READER, ['read']);
    let outside = await operations(reader, [close]);
    assert.strictEqual(
      outside.status,
      403,
      'outside the run the card is a Person, which no rule grants anything on',
    );
    assert.strictEqual(
      (await readCard(reader, 'people/ada')).data.attributes.name,
      'Ada',
    );
  });

  test('a policy predicate reads the fields of the card a run staged', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      READER,
    );
    await stageAdaAsNotice(run, 'draft');

    let refused = await operations(token, [close]);
    assert.strictEqual(
      refused.status,
      403,
      'the staged notice is a draft, which the grant’s predicate refuses',
    );
    let staged = await readCard(token, 'people/ada');
    assert.strictEqual(staged.data.attributes.status, 'draft');
  });
});
