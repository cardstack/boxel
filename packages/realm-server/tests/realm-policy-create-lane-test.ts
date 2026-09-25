import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { readdirSync, readFileSync } from 'fs';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  newOperationScope,
  resolveGatedOperation,
  scopeCallerFor,
} from '@cardstack/runtime-common/card-operations';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A create is the one operation whose type comes from the caller: an envelope
// entry with no href names the type it mints in `data.meta.adoptsFrom`. These
// tests pin that the policy gate judges such a create by the definition the
// realm resolved for that type, and by nothing the payload claims.
//
// The Shop realm holds its own policy cards, so a create that could mint over
// one is reachable. A teacher holds no permission on the Shop realm, and a
// reader may read it but not write it, so every create either makes reaches
// the gate.
const SHOP = 'http://127.0.0.1:4444/shop/';
const OTHER = 'http://127.0.0.1:4444/other/';
const POLICY_CARD = `${SHOP}RealmPolicy/shop`;
const OPEN_POLICY_CARD = `${SHOP}RealmPolicy/open`;
// The same policy, stored where a create of a Bulletin with the local id
// `policy` would be minted.
const MINTABLE_POLICY_CARD = `${SHOP}Bulletin/policy`;
const ADMIN = '@shop-admin:localhost';
const OTHER_ADMIN = '@other-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

const BULLETIN = { module: rri(`${SHOP}bulletin`), name: 'Bulletin' };
const ANNOUNCEMENT = { module: rri(`${SHOP}bulletin`), name: 'Announcement' };
const CLASSROOM = { module: rri(`${SHOP}classroom`), name: 'Classroom' };
const HOMEROOM = { module: rri(`${SHOP}classroom`), name: 'Homeroom' };
const ACTIVITY = {
  module: rri(`${SHOP}classroom`),
  name: 'ClassroomActivity',
};
// `Bulletin` through a module that re-exports it as `Notice`.
const NOTICE = { module: rri(`${SHOP}notices`), name: 'Notice' };
// `Classroom` through a module that re-exports it as `Bulletin`, the name of
// the type the policy grants creates of.
const LOOKALIKE = { module: rri(`${SHOP}lookalike`), name: 'Bulletin' };

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
  export class Announcement extends Bulletin {}
`;

const CLASSROOM_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, actor } from "@cardstack/base/operations";

  export class ClassroomActivity extends CardDef {
    @field note = contains(StringField);
    @field author = contains(StringField);
  }

  export class Classroom extends CardDef {
    @field title = contains(StringField);

    @operation static appendActivity = {
      base: 'create',
      of: () => ClassroomActivity,
      params: { note: StringField },
      fill: { note: params('note'), author: actor() },
    };
  }

  export class Homeroom extends Classroom {}
`;

const NOTICES_MODULE = `
  export { Bulletin as Notice } from "./bulletin";
`;

const LOOKALIKE_MODULE = `
  export { Classroom as Bulletin } from "./classroom";
`;

// A type that a relative module names from inside the directory a create
// mints a `Bulletin` into. `./bulletin` names the granted `Bulletin` from the
// realm root and this one from a card stored under `Bulletin/`.
const NESTED_BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// `Bulletin` takes creates outright, and so does `Homeroom`, a subtype of
// `Classroom`. `Classroom` itself grants only its named create,
// `appendActivity`, which mints a `ClassroomActivity` that no rule names.
const RULES: Rule[] = [
  { targetType: BULLETIN, grants: [{ operation: 'create' }] },
  { targetType: HOMEROOM, grants: [{ operation: 'create' }] },
  { targetType: CLASSROOM, grants: [{ operation: 'appendActivity' }] },
];

// A realm-wide grant of plain creates.
const OPEN_RULES: Rule[] = [
  { targetType: CARD_DEF, grants: [{ operation: 'create' }] },
];

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

// A plain create of a card of `type`, which the entry names as the type it
// runs against.
function create(
  type: { module: string; name: string },
  attributes: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    op: 'invoke',
    'boxel:name': 'create',
    data: { type: 'card', attributes, meta: { adoptsFrom: type, ...meta } },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let shop: Realm;
  let other: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let realmsRootPath: string;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    realmsRootPath = join(dirSync().name, 'realm_server_1');
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath,
      realms: [
        {
          realmURL: new URL(SHOP),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Shop',
              policy: POLICY_CARD,
            }),
            'bulletin.gts': BULLETIN_MODULE,
            'classroom.gts': CLASSROOM_MODULE,
            'notices.gts': NOTICES_MODULE,
            'lookalike.gts': LOOKALIKE_MODULE,
            'Bulletin/bulletin.gts': NESTED_BULLETIN_MODULE,
            'RealmPolicy/shop.json': policyCard(RULES),
            'RealmPolicy/open.json': policyCard(OPEN_RULES),
            'Bulletin/policy.json': policyCard(RULES),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
          },
        },
        {
          realmURL: new URL(OTHER),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Other' }),
          },
          permissions: {
            [OTHER_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    shop = result.realms.find((realm) => realm.url === SHOP)!;
    other = result.realms.find((realm) => realm.url === OTHER)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      for (let realm of [shop, other]) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(shop, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    reader: () => bearer(READER, ['read']),
    teacher: () => bearer(TEACHER),
  };

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(`${new URL(SHOP).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function createdId(response: Response): string {
    return (
      JSON.parse(response.text) as {
        'atomic:results': { data: { id: string } }[];
      }
    )['atomic:results'][0].data.id;
  }

  async function storedCard(id: string) {
    let response = await request
      .get(new URL(id).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', AUTH.admin());
    return response.body as {
      data: {
        attributes: Record<string, unknown>;
        meta: { adoptsFrom: { module: string; name: string } };
      };
    };
  }

  // The bytes stored at a path in the Shop realm, the only realm holding it.
  function storedBytes(path: string) {
    let found = (
      readdirSync(realmsRootPath, { recursive: true }) as string[]
    ).find((entry) => entry.endsWith(`/${path}`));
    return found ? readFileSync(join(realmsRootPath, found), 'utf8') : found;
  }

  // How many card documents are on disk across both realms.
  function storedCount() {
    return (
      readdirSync(realmsRootPath, { recursive: true }) as string[]
    ).filter((path) => path.endsWith('.json')).length;
  }

  function assertNotPermitted(
    assert: Assert,
    response: Response,
    label: string,
  ) {
    assert.strictEqual(response.status, 403, `${label}: status`);
    assert.true(
      /is not permitted on/.test(response.text),
      `${label}: the gate's refusal`,
    );
  }

  function gateStats() {
    return shop.__testOnlyPolicyGateStats();
  }

  async function pointAt(card: string) {
    await shop.write(
      'realm.json',
      realmConfigCardJSON({ name: 'Shop', policy: card }),
    );
    await shop.indexing();
  }

  module('the type a create is judged by', function () {
    test('a grant on one type admits creates of that type and of no other', async function (assert) {
      let granted = await operations(
        AUTH.teacher(),
        create(BULLETIN, { body: 'Picture day is Friday' }),
      );
      assert.strictEqual(granted.status, 200, 'the Bulletin rule admits it');
      let stored = await storedCard(createdId(granted));
      assert.strictEqual(
        stored.data.attributes.body,
        'Picture day is Friday',
        'and the bulletin is stored',
      );

      let before = storedCount();
      assertNotPermitted(
        assert,
        await operations(AUTH.teacher(), create(CLASSROOM, { title: 'Lab' })),
        'a create of a type no rule grants creates of',
      );
      assert.strictEqual(storedCount(), before, 'and nothing is stored');
    });

    test('a grant on a type covers creates of its subtypes and never of its ancestors', async function (assert) {
      assert.strictEqual(
        (await operations(AUTH.teacher(), create(ANNOUNCEMENT))).status,
        200,
        'the Bulletin rule admits a create of an Announcement',
      );
      assert.strictEqual(
        (await operations(AUTH.teacher(), create(HOMEROOM))).status,
        200,
        'the Homeroom rule admits a create of a Homeroom',
      );
      assertNotPermitted(
        assert,
        await operations(AUTH.teacher(), create(CLASSROOM)),
        'the Homeroom rule does not reach Classroom, which Homeroom descends from',
      );
    });

    test('a grant on CardDef covers a create of any card type', async function (assert) {
      await pointAt(OPEN_POLICY_CARD);
      let response = await operations(
        AUTH.teacher(),
        create(CLASSROOM, { title: 'Lab' }),
      );
      assert.strictEqual(response.status, 200, 'the CardDef rule admits it');
      assert.strictEqual(
        (await storedCard(createdId(response))).data.attributes.title,
        'Lab',
      );
    });

    test('a type is judged as the definition its ref resolves to, whatever name the ref gives it', async function (assert) {
      let viaAlias = await operations(
        AUTH.teacher(),
        create(NOTICE, { body: 'Early dismissal' }),
      );
      assert.strictEqual(
        viaAlias.status,
        200,
        'Notice resolves to Bulletin, which the Bulletin rule grants creates of',
      );
      assert.strictEqual(
        (await storedCard(createdId(viaAlias))).data.attributes.body,
        'Early dismissal',
      );

      assertNotPermitted(
        assert,
        await operations(AUTH.teacher(), create(LOOKALIKE)),
        'a ref naming its type "Bulletin" that resolves to Classroom is judged as a Classroom',
      );
    });

    test('a named create is judged by the type it is declared on, and does not grant creating what it mints', async function (assert) {
      let appended = await operations(AUTH.teacher(), {
        op: 'invoke',
        'boxel:name': 'appendActivity',
        data: { note: 'Field trip', meta: { adoptsFrom: CLASSROOM } },
      });
      assert.strictEqual(
        appended.status,
        200,
        'the Classroom rule grants appendActivity, declared on Classroom',
      );
      let activity = await storedCard(createdId(appended));
      assert.deepEqual(
        [activity.data.attributes.note, activity.data.attributes.author],
        ['Field trip', TEACHER],
        'and the activity it mints is filled from its declaration',
      );

      assertNotPermitted(
        assert,
        await operations(AUTH.teacher(), create(ACTIVITY, { note: 'Raw' })),
        'no rule grants a plain create of the ClassroomActivity it mints',
      );
    });

    test('a create names its type by a module that means the same thing wherever the card is stored', async function (assert) {
      // From the realm root, `./bulletin` is the granted Bulletin. From the
      // `Bulletin/` directory a Bulletin is minted into, it is a different
      // type, which no rule grants creates of.
      let relative = { module: './bulletin', name: 'Bulletin' };
      let before = storedCount();
      for (let [label, auth] of [
        ['a caller the policy admits', AUTH.teacher()],
        ['a caller the realm ACL allows', AUTH.admin()],
      ] as const) {
        let response = await operations(auth, create(relative));
        assert.strictEqual(
          response.status,
          400,
          `${label}: status: ${response.text}`,
        );
        assert.true(
          /relative module/.test(response.body.errors?.[0]?.detail ?? ''),
          `${label}: the refusal names the relative module: ${response.text}`,
        );
      }
      assert.strictEqual(storedCount(), before, 'nothing is stored');
    });
  });

  module('what refuses a create before the policy is consulted', function () {
    test('a type the realm cannot resolve is not found, for any caller', async function (assert) {
      let nowhere = { module: rri(`${SHOP}nowhere`), name: 'Nothing' };
      let fromReader = await operations(AUTH.reader(), create(nowhere));
      assert.strictEqual(fromReader.status, 404, 'status');
      assert.strictEqual(
        fromReader.body.errors[0].code,
        'target-not-found',
        'a caller who may read the realm is told the type is not found',
      );
      assertNotPermitted(
        assert,
        await operations(AUTH.teacher(), create(nowhere)),
        'a caller who may not read the realm gets the refusal every declined invocation gets',
      );
      assert.deepEqual(
        gateStats(),
        { policyLoads: 0, predicateEvaluations: 0 },
        'neither reached the policy',
      );
    });

    test('a create naming another realm is refused before the policy is consulted', async function (assert) {
      let fromReader = await operations(
        AUTH.reader(),
        create(BULLETIN, {}, { realmURL: OTHER }),
      );
      assert.strictEqual(fromReader.status, 400, 'status');
      assert.true(
        /target realm .* is not/.test(fromReader.body.errors[0].detail),
        `a caller who may read the realm is told the realm is not this one: ${fromReader.body.errors[0].detail}`,
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.teacher(),
          create(BULLETIN, {}, { realmURL: OTHER }),
        ),
        'a caller who may not read the realm',
      );
      assert.deepEqual(
        gateStats(),
        { policyLoads: 0, predicateEvaluations: 0 },
        'neither reached the policy',
      );
      assert.strictEqual(
        (
          await operations(
            AUTH.teacher(),
            create(BULLETIN, {}, { realmURL: SHOP }),
          )
        ).status,
        200,
        'while one naming this realm is judged as any other',
      );
    });

    test('a type target scoped to another realm is refused where the realm is asserted', async function (assert) {
      let scope = newOperationScope(shop.operationCore, {
        caller: scopeCallerFor(TEACHER),
        coarseDeclined: 'all',
      });
      await assert.rejects(
        resolveGatedOperation(
          shop.operationCore,
          { kind: 'type', codeRef: BULLETIN, realm: OTHER },
          'create',
          scope,
        ),
        /is not permitted on/,
        'the refusal a declined caller gets',
      );
      let readerScope = newOperationScope(shop.operationCore, {
        caller: scopeCallerFor(READER),
        coarseDeclined: 'writes',
      });
      await assert.rejects(
        resolveGatedOperation(
          shop.operationCore,
          { kind: 'type', codeRef: BULLETIN, realm: OTHER },
          'create',
          readerScope,
        ),
        /target realm .* is not/,
        'the realm refusal a caller who may read gets',
      );
      assert.deepEqual(
        gateStats(),
        { policyLoads: 0, predicateEvaluations: 0 },
        'and no policy was loaded for either',
      );
    });

    test('a create never replaces the policy card', async function (assert) {
      await pointAt(MINTABLE_POLICY_CARD);
      let response = await operations(AUTH.teacher(), {
        op: 'invoke',
        'boxel:name': 'create',
        data: {
          type: 'card',
          lid: 'policy',
          attributes: { body: 'Everyone may do anything' },
          meta: { adoptsFrom: BULLETIN },
        },
      });
      assert.strictEqual(
        response.status,
        409,
        `a granted create minting a card at the policy card's path: ${response.text}`,
      );
      assert.true(/already stored/.test(response.text), 'is told it is taken');
      assert.strictEqual(
        storedBytes('Bulletin/policy.json'),
        policyCard(RULES),
        'and the policy card is untouched',
      );
    });
  });
});
