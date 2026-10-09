import {
  click,
  fillIn,
  settled,
  waitFor,
  waitUntil,
  type RenderingTestContext,
} from '@ember/test-helpers';

import { serializeCard } from '@cardstack/base/card-api';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  DEFAULT_ANONYMOUS_RATE_LIMIT,
  IndexWriter,
  PermissionsContextName,
  rri,
  type LooseSingleCardDocument,
  type Permissions,
  type PolicyPredicate,
  type Realm,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type StoreService from '@cardstack/host/services/store';

import {
  getDbAdapter,
  testRealmURL,
  provideConsumeContext,
  realmConfigCardJSON,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef, FieldDef } from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// The policy definitions live in the catalog realm and reach this suite
// through the catalog test subset, so their shapes are described here rather
// than imported.
type OperationGrant = FieldDef & {
  operation: string;
  where: PolicyPredicate | null;
};
type PolicyRule = FieldDef & {
  targetType: { module: string; name: string };
  grants: OperationGrant[];
};
type RealmPolicy = CardDef & { rules: PolicyRule[] };

const policyRef = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// Deliberately irregular whitespace: the predicate is stored as written, so
// the source that comes back must be byte-for-byte the source that went in.
const teacherPredicate = '  actor() in .teacherIds  ';
const rosterPredicate = '.roster.providerIds contains actor()';
const providerPredicate = '.providerId == actor()';

function policyDocument(
  rules: Record<string, unknown>[],
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name: 'Education' },
        rules,
      },
      meta: { adoptsFrom: policyRef },
    },
  };
}

// Two rules, four grants: one grant with no condition, two with a bare-string
// predicate, and one with the annotated snapshot form.
const educationPolicy = policyDocument([
  {
    targetType: { module: '../classroom', name: 'Classroom' },
    grants: [
      { operation: 'read' },
      { operation: 'appendActivity', where: teacherPredicate },
    ],
  },
  {
    targetType: { module: '../schedule', name: 'Schedule' },
    grants: [
      {
        operation: 'read',
        where: { bxl: rosterPredicate, snapshot: true },
      },
      { operation: 'listMySchedules', where: providerPredicate },
    ],
  },
]);

// The character a policy issue's message marks its code spans with.
const BACKTICK = '`';

// What a grant's condition says to open it to callers who aren't signed in.
const ANONYMOUS = 'actor() == "anonymous"';
// How a grant that sets no limit of its own reads in a listing: the rate
// limit the realm reports as the platform's.
const PLATFORM_LIMIT_LINE = `${DEFAULT_ANONYMOUS_RATE_LIMIT.requests}/${DEFAULT_ANONYMOUS_RATE_LIMIT.windowSeconds} (platform default where unset)`;

// A realm whose policy lets a teacher delete the classrooms they teach. The
// grant that fails comes first, so the answer shows a predicate that did not
// hold ahead of the one that admitted the delete.
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';
const leadsPredicate = '.leadTeacherIds | any(. == actor())';
const teachesPredicate = '.teacherIds | any(. == actor())';

const classroomModule = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field leadTeacherIds = containsMany(StringField);
  }
`;

// A roster links to its students, so a grant that serves a roster's document
// hands over the students it links to.
const rosterModule = `
  import { contains, containsMany, field, linksToMany, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Student extends CardDef {
    @field name = contains(StringField);
  }

  export class Roster extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field students = linksToMany(() => Student);
  }
`;

function classroom(teacherIds: string[]) {
  return {
    data: {
      type: 'card',
      attributes: { teacherIds, leadTeacherIds: [] },
      meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
    },
  };
}

const classroomPolicy = policyDocument([
  {
    targetType: { module: '../classroom', name: 'Classroom' },
    grants: [
      { operation: 'delete', where: leadsPredicate },
      { operation: 'delete', where: teachesPredicate },
      { operation: 'update' },
    ],
  },
]);

module('Integration | realm policy', function (hooks) {
  setupRenderingTest(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  async function setupPolicyRealm(
    contents: Record<string, LooseSingleCardDocument>,
  ): Promise<Realm> {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents,
    });
    return realm;
  }

  async function loadPolicy(path: string) {
    let store = getService('store') as StoreService;
    return (await store.get(`${testRealmURL}${path}`)) as RealmPolicy;
  }

  test('an authored policy indexes and reads back with its predicates as written', async function (assert) {
    let realm = await setupPolicyRealm({
      'policies/education.json': educationPolicy,
    });

    let doc = await realm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealmURL}policies/education`),
    );
    assert.strictEqual(
      doc?.type,
      'doc',
      `the policy indexes cleanly: ${JSON.stringify(
        doc?.type === 'error' ? doc.error : undefined,
      )}`,
    );
    let rules = (doc?.type === 'doc' ? doc.doc.data.attributes?.rules : []) as {
      grants: { operation: string; where: unknown }[];
    }[];

    assert.deepEqual(
      rules.map((rule) => rule.grants.map((grant) => grant.operation)),
      [
        ['read', 'appendActivity'],
        ['read', 'listMySchedules'],
      ],
      'both rules and all four grants survive indexing, in order',
    );
    assert.strictEqual(
      rules[0].grants[1].where,
      teacherPredicate,
      'a bare-string predicate reads back as the same bare string',
    );
    assert.deepEqual(
      rules[1].grants[0].where,
      { bxl: rosterPredicate, snapshot: true },
      'the annotated snapshot form reads back as the annotated form',
    );
    assert.strictEqual(
      rules[1].grants[1].where,
      providerPredicate,
      'a second bare-string predicate is unaffected by its annotated sibling',
    );
    assert.strictEqual(
      rules[0].grants[0].where,
      null,
      'a grant authored with no predicate reads back with none, not an empty string',
    );
  });

  test('a loaded policy resolves each target type relative to the policy card', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');

    assert.deepEqual(
      policy.rules.map((rule) => rule.targetType),
      [
        { module: `${testRealmURL}classroom`, name: 'Classroom' },
        { module: `${testRealmURL}schedule`, name: 'Schedule' },
      ],
      'targetType is a code ref resolved against the policy card',
    );
    assert.deepEqual(
      policy.rules.flatMap((rule) => rule.grants.map((grant) => grant.where)),
      [
        null,
        { source: teacherPredicate, snapshot: false },
        { source: rosterPredicate, snapshot: true },
        { source: providerPredicate, snapshot: false },
      ],
      'both stored shapes read as one representation, told apart only by snapshot',
    );
  });

  test('a predicate that is present but malformed fails the policy instead of reading as unconditional', async function (assert) {
    let realm = await setupPolicyRealm({
      'policies/typo.json': policyDocument([
        {
          targetType: { module: '../classroom', name: 'Classroom' },
          grants: [
            {
              operation: 'update',
              where: { bxl: rosterPredicate, snapshop: true },
            },
          ],
        },
      ]),
      'policies/number.json': policyDocument([
        {
          targetType: { module: '../classroom', name: 'Classroom' },
          grants: [{ operation: 'update', where: 42 }],
        },
      ]),
    });

    for (let [path, reason] of [
      ['policies/typo', "accepts only 'bxl' and 'snapshot'"],
      ['policies/number', 'must be a string of BXL source'],
    ]) {
      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealmURL}${path}`),
      );
      assert.strictEqual(
        entry?.type,
        'instance-error',
        `${path} is an index error rather than a policy with an unconditional grant`,
      );
      let error = entry?.type === 'instance-error' ? entry.error : undefined;
      assert.true(
        JSON.stringify(error ?? null).includes(reason),
        `${path} fails because its predicate is malformed: ${JSON.stringify(
          error?.message,
        )}`,
      );
    }
  });

  test('the policy lists its rules and grants in isolated format', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');
    await renderCard(loader, policy, 'isolated');

    assert.dom('[data-test-realm-policy-isolated]').exists();
    assert.dom('[data-test-policy-rule]').exists({ count: 2 });
    assert
      .dom('[data-test-policy-rule-type-name]')
      .exists({ count: 2 })
      .hasText('Classroom', 'rules are listed by the type they govern');
    assert
      .dom('[data-test-operation-grant]')
      .exists({ count: 4 }, 'every grant is listed');
    assert
      .dom('[data-test-policy-rule-type-module]')
      .hasText(`${testRealmURL}classroom`, 'with the module that defines it');
    assert
      .dom('[data-test-operation-grant-unconditional]')
      .exists({ count: 1 }, 'the grant with no predicate reads as always');
    assert
      .dom('[data-test-policy-predicate-source]')
      .exists({ count: 3 }, 'each predicate is shown');
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-policy-predicate-source]')].map(
        (el) => el.textContent,
      ),
      [teacherPredicate, rosterPredicate, providerPredicate],
      'each predicate is shown exactly as written, with no added whitespace',
    );
    assert
      .dom('[data-test-policy-predicate-snapshot]')
      .exists({ count: 1 }, 'only the annotated predicate is marked snapshot');
  });

  test('the policy lists its rules and grants in embedded format', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');
    await renderCard(loader, policy, 'embedded');

    assert.dom('[data-test-realm-policy-embedded]').exists();
    assert.dom('[data-test-policy-rule]').exists({ count: 2 });
    assert.dom('[data-test-operation-grant]').exists({ count: 4 });
    assert
      .dom('[data-test-operation-grant-operation]')
      .hasText('read', 'grants are listed by operation name');
    assert.dom('[data-test-policy-predicate-snapshot]').exists({ count: 1 });
  });

  test('a grant opened to callers who are not signed in says so, and a write names the setting it acts as', async function (assert) {
    await setupPolicyRealm({
      'policies/public.json': policyDocument([
        {
          targetType: { module: '../classroom', name: 'Classroom' },
          grants: [
            { operation: 'read', where: ANONYMOUS },
            {
              operation: 'update',
              where: ANONYMOUS,
              actingUser: 'realmConfig("feedbackWriter")',
            },
            { operation: 'delete' },
          ],
        },
      ]),
    });
    let policy = await loadPolicy('policies/public');
    await renderCard(loader, policy, 'embedded');

    assert.dom('[data-test-operation-grant]').exists({ count: 3 });
    assert
      .dom('[data-test-operation-grant-anonymous]')
      .exists({ count: 2 }, 'only the grants that opt in are marked')
      .hasText('anyone');
    assert
      .dom('[data-test-operation-grant-acting-user]')
      .exists({ count: 1 }, 'only the write names who it acts as')
      .hasText('realmConfig("feedbackWriter")');
    assert
      .dom('[data-test-operation-grant-rate-limit]')
      .exists(
        { count: 2 },
        'and each grant opened to them says what it limits them to',
      );
  });

  test('a policy with no rules says it grants nothing', async function (assert) {
    await setupPolicyRealm({ 'policies/empty.json': policyDocument([]) });
    let policy = await loadPolicy('policies/empty');
    await renderCard(loader, policy, 'isolated');

    assert.dom('[data-test-realm-policy-no-rules]').exists();
    assert.dom('[data-test-policy-rule]').doesNotExist();
  });

  test('an empty predicate and an unannotated object are kept as present predicates', async function (assert) {
    let realm = await setupPolicyRealm({
      'policies/edge.json': policyDocument([
        {
          targetType: { module: '../classroom', name: 'Classroom' },
          grants: [
            { operation: 'read', where: '' },
            {
              operation: 'update',
              where: { bxl: providerPredicate, snapshot: false },
            },
            { operation: 'delete', where: { bxl: providerPredicate } },
          ],
        },
      ]),
    });

    let doc = await realm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealmURL}policies/edge`),
    );
    let rules = (doc?.type === 'doc' ? doc.doc.data.attributes?.rules : []) as {
      grants: { where: unknown }[];
    }[];
    assert.deepEqual(
      rules[0]?.grants.map((grant) => grant.where),
      ['', providerPredicate, providerPredicate],
      'an empty source stays an empty string, and an object without snapshot: true is stored as the bare string',
    );

    let policy = await loadPolicy('policies/edge');
    assert.deepEqual(
      policy.rules[0].grants.map((grant) => grant.where),
      [
        { source: '', snapshot: false },
        { source: providerPredicate, snapshot: false },
        { source: providerPredicate, snapshot: false },
      ],
      'none of them reads as an unconditional grant',
    );
  });

  test('emptying a predicate while editing keeps it, and removing it is explicit', async function (assert) {
    await setupPolicyRealm({
      'policies/one.json': policyDocument([
        {
          targetType: { module: '../schedule', name: 'Schedule' },
          grants: [
            {
              operation: 'read',
              where: { bxl: rosterPredicate, snapshot: true },
            },
          ],
        },
      ]),
    });
    let policy = await loadPolicy('policies/one');
    let grant = policy.rules[0].grants[0];
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    await renderCard(loader, grant, 'edit');

    await fillIn('[data-test-policy-predicate-input]', '');
    assert.deepEqual(
      grant.where,
      { source: '', snapshot: true },
      'an emptied predicate is still a predicate, and keeps its snapshot flag',
    );
    assert
      .dom('[data-test-policy-predicate-input]')
      .hasAttribute(
        'placeholder',
        'Empty condition',
        'an emptied predicate does not read as always allowed',
      );

    await fillIn('[data-test-policy-predicate-input]', providerPredicate);
    assert.deepEqual(
      grant.where,
      { source: providerPredicate, snapshot: true },
      'retyping the source keeps the snapshot flag',
    );

    await click('[data-test-policy-predicate-remove]');
    assert.strictEqual(
      grant.where,
      null,
      'removing the condition makes the grant unconditional',
    );
    assert
      .dom('[data-test-policy-predicate-remove]')
      .doesNotExist('an unconditional grant has no condition to remove');
    assert
      .dom('[data-test-policy-predicate-input]')
      .hasAttribute(
        'placeholder',
        'Always allowed',
        'an unconditional grant reads as always allowed',
      );
  });

  // The line each grant's editor opens with, as a reader sees it.
  function grantLinesInEditor() {
    return [
      ...document.querySelectorAll(
        '[data-test-policy-rule-grant] [data-test-operation-grant]',
      ),
    ].map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
  }

  function ruleEditor(index: number) {
    return `[data-test-contains-many="rules"] [data-test-item="${index}"]`;
  }

  test('editing a policy shows each grant as its view does, and adds, changes and removes grants', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    await renderCard(loader, policy, 'edit');

    assert.dom('[data-test-policy-rule-edit]').exists({ count: 2 });
    assert.deepEqual(
      grantLinesInEditor(),
      [
        'read always',
        `appendActivity where ${teacherPredicate.trim()}`,
        `read where ${rosterPredicate} snapshot`,
        `listMySchedules where ${providerPredicate}`,
      ],
      'each grant is shown by its operation and condition, in order',
    );
    assert
      .dom('[data-test-contains-many="rules"]')
      .doesNotIncludeText('Untitled', 'no grant is shown as an untitled field');
    assert
      .dom('[data-test-policy-rule-target-type] input')
      .exists({ count: 2 }, "every rule's target type can be edited");
    assert
      .dom('[data-test-policy-rule-grant] [data-test-policy-predicate-input]')
      .exists({ count: 4 }, "every grant's condition can be edited");
    assert
      .dom('[data-test-policy-rule-grant] [data-test-field="actingUser"]')
      .exists(
        { count: 4 },
        'every grant says who a write by a caller who is not signed in is made as',
      );
    assert
      .dom('[data-test-policy-rule-grant] [data-test-field="blocklist"]')
      .exists({ count: 4 }, 'and which addresses it refuses them from');
    assert
      .dom(`${ruleEditor(0)} [data-test-rate-limit-requests-default]`)
      .includesText(
        `${DEFAULT_ANONYMOUS_RATE_LIMIT.requests}`,
        'the rate-limit fields say what applies when they are left empty',
      );
    assert
      .dom(`${ruleEditor(0)} [data-test-rate-limit-window-default]`)
      .includesText(`${DEFAULT_ANONYMOUS_RATE_LIMIT.windowSeconds}`);
    assert
      .dom(`${ruleEditor(1)} [data-test-policy-rule-remove-grant="0"]`)
      .hasAttribute(
        'aria-label',
        'Remove grant 1 (read)',
        'each remove button names the grant it removes',
      );

    let studentPredicate = '.studentIds | any(. == actor())';
    await fillIn(
      `${ruleEditor(0)} [data-test-policy-rule-grant="1"] [data-test-policy-predicate-input]`,
      studentPredicate,
    );
    await click(`${ruleEditor(0)} [data-test-policy-rule-add-grant]`);
    await fillIn(
      `${ruleEditor(0)} [data-test-policy-rule-grant="2"] [data-test-field="operation"] input`,
      'update',
    );
    await click(`${ruleEditor(1)} [data-test-policy-rule-remove-grant="0"]`);

    await fillIn(
      `${ruleEditor(0)} [data-test-policy-rule-grant="2"] [data-test-policy-predicate-input]`,
      ANONYMOUS,
    );
    await fillIn(
      `${ruleEditor(0)} [data-test-policy-rule-grant="2"] [data-test-field="actingUser"] input`,
      'realmConfig("feedbackWriter")',
    );

    assert.deepEqual(
      grantLinesInEditor(),
      [
        'read always',
        `appendActivity where ${studentPredicate}`,
        `update where ${ANONYMOUS} anyone as realmConfig("feedbackWriter") limit ${PLATFORM_LIMIT_LINE}`,
        `listMySchedules where ${providerPredicate}`,
      ],
      'each grant reads as it now stands',
    );

    let rules = serializeCard(policy, {}).data.attributes?.rules as {
      grants: {
        operation: string;
        where: unknown;
        actingUser?: string | null;
      }[];
    }[];
    assert.deepEqual(
      rules.map((rule) =>
        rule.grants.map(({ operation, where, actingUser }) => ({
          operation,
          where,
          actingUser: actingUser ?? null,
        })),
      ),
      [
        [
          {
            operation: 'read',
            where: null,
            actingUser: null,
          },
          {
            operation: 'appendActivity',
            where: studentPredicate,
            actingUser: null,
          },
          {
            operation: 'update',
            where: ANONYMOUS,
            actingUser: 'realmConfig("feedbackWriter")',
          },
        ],
        [
          {
            operation: 'listMySchedules',
            where: providerPredicate,
            actingUser: null,
          },
        ],
      ],
      'the saved policy holds the added, changed and remaining grants',
    );
  });

  test('a policy edited without write permission shows its grants but cannot add or remove them', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');
    let permissions: Permissions = { canWrite: false, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    await renderCard(loader, policy, 'edit');

    assert.strictEqual(
      grantLinesInEditor().length,
      4,
      'every grant is still shown',
    );
    assert.dom('[data-test-policy-rule-add-grant]').doesNotExist();
    assert.dom('[data-test-policy-rule-remove-grant]').doesNotExist();
  });

  test('a document shape assigned in code is refused rather than read as a predicate', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');

    let grant = policy.rules[0].grants[1];
    (grant as { where: unknown }).where = providerPredicate;
    assert.throws(
      () => serializeCard(policy, {}),
      /a policy predicate in memory must be \{ source, snapshot \}/,
      'a bare string on the instance fails the save instead of being written',
    );

    (grant as { where: unknown }).where = {
      bxl: providerPredicate,
      snapshot: true,
    };
    assert.throws(
      () => serializeCard(policy, {}),
      /a policy predicate in memory must be \{ source, snapshot \}/,
      'so does the annotated document shape',
    );

    grant.where = { source: providerPredicate, snapshot: true };
    let serialized = serializeCard(policy, {});
    assert.deepEqual(
      (
        serialized.data.attributes?.rules as {
          grants: { where: unknown }[];
        }[]
      )[0].grants[1].where,
      { bxl: providerPredicate, snapshot: true },
      'an in-memory predicate serializes to its document shape',
    );
  });

  // The in-browser realm serves the test's requests without vouching for a
  // session, so an explain is asked by nobody, and nobody may ask one only in
  // a realm anyone may read. The teacher reads it like anyone else and holds
  // no write, so only the policy can let them delete a classroom.
  async function renderClassroomPolicy() {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          policy: `${testRealmURL}policies/classrooms`,
        }),
        'classroom.gts': classroomModule,
        'classrooms/room-204.json': classroom([TEACHER]),
        'classrooms/room-205.json': classroom([COLLEAGUE]),
        'policies/classrooms.json': classroomPolicy,
      },
    });
    await getService('realm').login(testRealmURL);
    // Looking the service up arms the transport the card's own
    // `operations()` call sends its explain through.
    getService('operations');
    let policy = await loadPolicy('policies/classrooms');
    await renderCard(loader, policy, 'isolated');
  }

  async function ask(actor: string, target: string, operation: string) {
    await fillIn('[data-test-explain-actor]', actor);
    await fillIn('[data-test-explain-target]', target);
    await fillIn('[data-test-explain-operation]', operation);
    await click('[data-test-explain-submit]');
    await waitFor('[data-test-explanation], [data-test-explain-refusal]', {
      timeout: 10_000,
    });
  }

  function grantsShown() {
    return [...document.querySelectorAll('[data-test-explanation-grant]')].map(
      (el) => [
        el.querySelector('[data-test-explanation-grant-where]')?.textContent,
        el.getAttribute('data-test-explanation-grant'),
      ],
    );
  }

  test('an explanation for someone who is not signed in shows what each grant opened to them limits, blocks and writes as', async function (assert) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          policy: `${testRealmURL}policies/classrooms`,
          config: {
            submitter: '@testuser:localhost',
            blockedIps: 'not an address',
          },
        }),
        'classroom.gts': classroomModule,
        'classrooms/room-204.json': classroom([TEACHER]),
        'policies/classrooms.json': policyDocument([
          {
            targetType: { module: '../classroom', name: 'Classroom' },
            grants: [
              {
                operation: 'update',
                where: ANONYMOUS,
                actingUser: 'realmConfig("submitter")',
                blocklist: 'realmConfig("blockedIps")',
                rateLimitRequests: '7',
                rateLimitWindowSeconds: '30',
              },
              {
                operation: 'update',
                where: ANONYMOUS,
                actingUser: 'realmConfig("missing")',
              },
              // Names an acting user without opening to such callers, so it
              // is warned about.
              {
                operation: 'update',
                where: teachesPredicate,
                actingUser: 'realmConfig("submitter")',
              },
            ],
          },
        ]),
      },
    });
    await getService('realm').login(testRealmURL);
    getService('operations');
    let policy = await loadPolicy('policies/classrooms');
    await renderCard(loader, policy, 'isolated');

    await ask('', `${testRealmURL}classrooms/room-204`, 'update');
    assert.dom('[data-test-explanation-actor]').hasText('not signed in');
    assert
      .dom('[data-test-explanation-anonymous-limit]')
      .hasText(
        `${DEFAULT_ANONYMOUS_RATE_LIMIT.requests} requests per ${DEFAULT_ANONYMOUS_RATE_LIMIT.windowSeconds} seconds from one address, the platform default, for a grant that sets none`,
      );
    assert.deepEqual(
      [
        ...document.querySelectorAll('[data-test-explanation-grant-anonymous]'),
      ].map((el) => el.textContent?.trim()),
      [
        "Open to people who aren't signed in.",
        'Their writes are made as @testuser:localhost.',
        'Limit: 7 requests (set by this grant) per 30 seconds (set by this grant) from one address.',
        "Its blocklist has entries that aren't an address or a range (\"not an address\"), so it turns away everyone who isn't signed in until it's fixed.",
        "Open to people who aren't signed in.",
        'Their writes: its "Write as" expression produced nothing, so this grant admits none of their writes.',
        `Limit: ${DEFAULT_ANONYMOUS_RATE_LIMIT.requests} requests (the platform default) per ${DEFAULT_ANONYMOUS_RATE_LIMIT.windowSeconds} seconds (the platform default) from one address.`,
      ],
      'only the grants opened to them carry these lines',
    );
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-explanation-grant-issue]')].map(
        (el) => el.getAttribute('data-test-explanation-grant-issue'),
      ),
      ['acting-user-never-used'],
      'the grant that names an acting user it can never use carries its warning',
    );
  });

  test('the policy explains what it decides for one caller, one card and one operation', async function (assert) {
    await renderClassroomPolicy();

    assert.dom('[data-test-realm-policy-explain]').exists();
    assert
      .dom('[data-test-explain-actor-hint]')
      .hasText(
        "Leave this empty to check what someone who isn't signed in can do.",
        'the person field says how to ask about someone who is not signed in',
      );
    assert.dom('[data-test-explain-submit]').isDisabled('nothing to ask yet');
    await ask(TEACHER, `${testRealmURL}classrooms/room-204`, 'delete');

    assert.strictEqual(
      document
        .querySelector('[data-test-explain-refusal]')
        ?.textContent?.trim(),
      undefined,
      'the realm answers the question rather than refusing it',
    );
    assert.dom('[data-test-explanation-decision]').hasText('allowed');
    assert
      .dom('[data-test-explanation-reason]')
      .hasText('A grant in this policy allows it.');
    assert.dom('[data-test-explanation-actor]').hasText(TEACHER);
    assert
      .dom('[data-test-explanation-acl]')
      .hasText('read', "the realm's own permissions let the teacher only read");
    assert
      .dom('[data-test-explanation-refusal]')
      .doesNotExist('an allowed invocation has no refusal to report');
    assert
      .dom('[data-test-explanation-rule]')
      .exists({ count: 1 }, 'the one rule governing a classroom');
    assert.deepEqual(
      grantsShown(),
      [
        [leadsPredicate, 'did-not-hold'],
        [teachesPredicate, 'held'],
      ],
      'each delete grant is listed with its predicate and what it said, and the update grant is not',
    );
    assert
      .dom(
        '[data-test-explanation-grant="held"] [data-test-explanation-admitting]',
      )
      .exists('the grant that admitted the delete is marked');
    assert
      .dom('[data-test-explanation-admitting]')
      .exists({ count: 1 }, 'and no other grant is');
  });

  test('the policy explains a refusal, and says when a question is refused', async function (assert) {
    await renderClassroomPolicy();

    await ask(TEACHER, `${testRealmURL}classrooms/room-205`, 'delete');
    assert.dom('[data-test-explanation-decision]').hasText('denied');
    assert
      .dom('[data-test-explanation-reason]')
      .hasText(
        'This policy has grants for this operation on this card, but none of their conditions is met.',
      );
    assert
      .dom('[data-test-explanation-refusal]')
      .hasText(
        '403 operation-not-permitted',
        'the teacher may read the realm, so they would be told the gate refused them',
      );
    assert.deepEqual(
      grantsShown(),
      [
        [leadsPredicate, 'did-not-hold'],
        [teachesPredicate, 'did-not-hold'],
      ],
      'neither delete grant holds for a classroom the teacher does not teach',
    );
    assert
      .dom('[data-test-explanation-admitting]')
      .doesNotExist('no grant admitted the delete');

    await ask(TEACHER, `${testRealmURL}classrooms/room-999`, 'delete');
    assert
      .dom('[data-test-explain-refusal]')
      .hasText(
        'no such target',
        'a card that is not there is refused the way the realm refuses one',
      );
    assert
      .dom('[data-test-explanation]')
      .doesNotExist('and the earlier answer is not left on the page');
  });

  // Does not parse: the comparison has nothing on its right.
  const MISTYPED = `${teachesPredicate} and .title ==`;
  // Parses under the `policy` profile, and the `predicate` profile refuses it,
  // so a grant on a query with it compiles no search filter.
  const UNFILTERABLE = '(.title | tonumber) > 0';

  async function renderPolicyNamed(
    path: string,
    rules: Record<string, unknown>[],
    modules: Record<string, string> = {},
  ) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'classroom.gts': classroomModule,
        ...modules,
        [`${path}.json`]: policyDocument(rules),
      },
    });
    // Looking the service up arms the transport the card's own
    // `operations()` call sends its validate through.
    getService('operations');
    let policy = await loadPolicy(path);
    await renderCard(loader, policy, 'isolated');
    return realm;
  }

  // What the card says of each grant once the realm has answered, in order.
  async function grantStatuses() {
    await waitFor('[data-test-policy-grant-status]', { timeout: 10_000 });
    return [
      ...document.querySelectorAll('[data-test-policy-grant-status]'),
    ].map((el) => el.getAttribute('data-test-policy-grant-status'));
  }

  test('a grant that does not compile is marked inactive among the live ones, and its issue names its rule and grant', async function (assert) {
    await renderPolicyNamed('policies/mistyped', [
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [
          { operation: 'read' },
          { operation: 'delete', where: MISTYPED },
          { operation: 'update' },
        ],
      },
    ]);

    assert.deepEqual(
      await grantStatuses(),
      ['live', 'inactive', 'live'],
      'the grant that does not compile is inactive, and the others are live',
    );
    assert
      .dom('[data-test-policy-grant-inactive]')
      .exists({ count: 1 }, 'and it is marked where it is listed');
    assert
      .dom(
        '[data-test-policy-grant-status="inactive"] [data-test-operation-grant-operation]',
      )
      .hasText('delete', 'the marked grant is the delete');
    assert.dom('[data-test-realm-policy-uncompilable]').doesNotExist();

    assert.dom('[data-test-realm-policy-issues]').exists();
    assert
      .dom('[data-test-policy-issue]')
      .exists({ count: 1 })
      .hasAttribute('data-test-policy-issue', 'invalid-predicate');
    assert
      .dom('[data-test-policy-issue-rule]')
      .hasText('Classroom', "the issue names its rule's type");
    assert
      .dom('[data-test-policy-issue-operation]')
      .hasText('delete', "and its grant's operation");
    assert
      .dom('[data-test-policy-issue-message]')
      .includesText('has a syntax error', 'and says what is wrong');
  });

  test('a query grant whose predicate compiles no search filter is inactive, and its issue says why', async function (assert) {
    await renderPolicyNamed('policies/unfilterable', [
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [
          { operation: 'read' },
          { operation: 'query', where: UNFILTERABLE },
        ],
      },
    ]);

    assert.deepEqual(
      await grantStatuses(),
      ['live', 'inactive'],
      'a query is authorized only through a filter, so the grant admits nothing',
    );
    assert
      .dom(
        '[data-test-policy-grant-status="inactive"] [data-test-operation-grant-operation]',
      )
      .hasText('query', 'the marked grant is the query');
    assert
      .dom('[data-test-policy-grant-inactive]')
      .exists({ count: 1 }, 'and it is marked where it is listed');
    assert
      .dom('[data-test-policy-issue]')
      .exists({ count: 1 })
      .hasAttribute('data-test-policy-issue', 'policy-not-filterable');
    assert.dom('[data-test-policy-issue-operation]').hasText('query');
  });

  test('a grant whose condition is annotated as reading a snapshot is live', async function (assert) {
    await renderPolicyNamed('policies/snapshot', [
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [
          {
            operation: 'read',
            where: { bxl: teachesPredicate, snapshot: true },
          },
          { operation: 'update', where: teachesPredicate },
        ],
      },
    ]);

    assert.deepEqual(
      await grantStatuses(),
      ['live', 'live'],
      'the gate evaluates an annotated condition, so the annotation leaves the read in force',
    );
    assert
      .dom('[data-test-realm-policy-issues]')
      .doesNotExist('compiling recorded no issue');
  });

  test('a rule whose type does not resolve is marked inactive with its grants', async function (assert) {
    await renderPolicyNamed('policies/unresolved', [
      {
        targetType: { module: '../no-such-module', name: 'Nope' },
        grants: [{ operation: 'read' }],
      },
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [{ operation: 'read' }],
      },
    ]);

    assert.deepEqual(await grantStatuses(), ['inactive', 'live']);
    assert
      .dom('[data-test-policy-rule-inactive]')
      .exists({ count: 1 }, 'the rule is marked, once');
    assert
      .dom('[data-test-policy-grant-inactive]')
      .doesNotExist('rather than each grant in it');
    assert
      .dom('[data-test-policy-issue]')
      .hasAttribute('data-test-policy-issue', 'unresolved-type');
    assert.dom('[data-test-policy-issue-rule]').hasText('Nope');
    assert
      .dom('[data-test-policy-issue-operation]')
      .doesNotExist('a rule-level issue names no grant');
  });

  test('a policy that does not compile at all says so apart from any one grant', async function (assert) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'classroom.gts': classroomModule,
        'policies/broken.json': classroomPolicy,
      },
    });
    getService('operations');
    let policy = await loadPolicy('policies/broken');

    // The visit that indexes an edit to the card fails for a reason outside
    // it. The index keeps such a failure off the row, which still holds the
    // earlier document, so the card still loads.
    let batch = await new IndexWriter(await getDbAdapter()).createBatch(
      new URL(testRealmURL),
      getService('network').virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}policies/broken.json`), {
      type: 'instance-error',
      error: { message: 'Bad Gateway', status: 502, additionalErrors: null },
      diagnostics: { gatewayFailure: ['instance'] },
    });
    await batch.done();

    await renderCard(loader, policy, 'isolated');
    await waitFor('[data-test-realm-policy-uncompilable]', { timeout: 10_000 });
    assert
      .dom('[data-test-realm-policy-uncompilable]')
      .includesText('Not in force', 'the whole policy is out of force')
      .includesText(
        "This card couldn't be indexed this time",
        'and says why of the card itself',
      );
    assert
      .dom('[data-test-policy-rule-inactive]')
      .doesNotExist('which is said once, not on each rule');
    assert
      .dom('[data-test-policy-issue]')
      .hasAttribute('data-test-policy-issue', 'policy-card-unloadable');
    assert
      .dom('[data-test-policy-issue-rule]')
      .doesNotExist('a card-level issue names no rule');
  });

  test('fixing a grant clears its issue', async function (assert) {
    let realm = await renderPolicyNamed('policies/fixable', [
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [{ operation: 'delete', where: MISTYPED }],
      },
    ]);
    assert.deepEqual(await grantStatuses(), ['inactive']);

    await realm.write(
      'policies/fixable.json',
      JSON.stringify(
        policyDocument([
          {
            targetType: { module: '../classroom', name: 'Classroom' },
            grants: [{ operation: 'delete', where: teachesPredicate }],
          },
        ]),
      ),
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-policy-grant-status]')
          ?.getAttribute('data-test-policy-grant-status') === 'live',
      { timeout: 10_000 },
    );
    await settled();
    assert.deepEqual(await grantStatuses(), ['live'], 'the grant is live');
    assert
      .dom('[data-test-realm-policy-issues]')
      .doesNotExist('and the issue is gone');
  });

  test('a policy with no issues shows no issue affordance', async function (assert) {
    await renderPolicyNamed('policies/clean', [
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [
          { operation: 'read', where: teachesPredicate },
          { operation: 'update' },
        ],
      },
    ]);

    assert.deepEqual(
      await grantStatuses(),
      ['live', 'live'],
      'the realm has answered',
    );
    assert.dom('[data-test-realm-policy-issues]').doesNotExist();
    assert.dom('[data-test-realm-policy-uncompilable]').doesNotExist();
    assert.dom('[data-test-policy-grant-inactive]').doesNotExist();
    assert.dom('[data-test-policy-rule-inactive]').doesNotExist();
    assert.dom('[data-test-realm-policy-validate-failure]').doesNotExist();
  });

  // The grant a warning mark is beside, as the card lists it.
  function grantMarkedWithWarning() {
    return document
      .querySelector('[data-test-policy-grant-warning]')
      ?.closest('[data-test-policy-grant-status]');
  }

  test('a live grant that hands over cards of a type no rule grants is marked live with its warning beside it', async function (assert) {
    await renderPolicyNamed(
      'policies/reaching',
      [
        {
          targetType: { module: '../roster', name: 'Roster' },
          grants: [
            { operation: 'read', where: teachesPredicate },
            { operation: 'update', where: teachesPredicate },
          ],
        },
      ],
      { 'roster.gts': rosterModule },
    );

    assert.deepEqual(
      await grantStatuses(),
      ['live', 'live'],
      'a warning leaves its grant live',
    );
    assert
      .dom('[data-test-policy-grant-inactive]')
      .doesNotExist('and marks nothing inactive');
    assert
      .dom('[data-test-policy-grant-warning]')
      .exists({ count: 1 }, 'one grant is marked with a warning');
    let marked = grantMarkedWithWarning();
    assert.strictEqual(
      marked?.getAttribute('data-test-policy-grant-status'),
      'live',
      'the marked grant is live',
    );
    assert
      .dom('[data-test-operation-grant-operation]', marked ?? undefined)
      .hasText('read', 'it is the read, whose document carries the students');

    await click('[data-test-policy-grant-warning] summary');
    assert
      .dom(
        '[data-test-policy-grant-warning-message="grant-reaches-ungranted-type"]',
      )
      .exists({ count: 1 })
      .isVisible('opening the mark shows the warning')
      .includesText(
        'no rule lets anyone read Student cards',
        'which says what the grant hands over',
      );

    assert
      .dom('[data-test-policy-issue]')
      .exists({ count: 1 })
      .hasAttribute('data-test-policy-issue', 'grant-reaches-ungranted-type');
    assert
      .dom('[data-test-policy-issue-rule]')
      .hasText('Roster', 'the warning is listed with its rule');
    assert
      .dom('[data-test-policy-issue-operation]')
      .hasText('read', 'and its grant');
    assert
      .dom('[data-test-policy-issue] [data-test-policy-issue-warning]')
      .exists('and is marked there as a warning');
    assert
      .dom('[data-test-policy-issue-message]')
      .includesText('no rule lets anyone read Student cards');

    // The compiler marks the identifiers in a message as code with backticks,
    // as markdown does. The card renders each one as code, so no backtick
    // shows, in the issue list and in the grant's warning alike.
    assert
      .dom('[data-test-policy-issue-message] code')
      .exists('the identifiers in the message render as code')
      .hasText('read', 'the first is the grant’s operation');
    assert
      .dom('[data-test-policy-issue-message] .message-paragraph')
      .exists(
        { count: 4 },
        'the message is laid out one idea per paragraph, as the compiler writes it',
      );
    assert
      .dom('[data-test-policy-issue-message]')
      .doesNotIncludeText(BACKTICK, 'and no backtick shows')
      .includesText(
        'read on Roster sends',
        'and the text reads on across a span, spaces kept',
      );
    assert
      .dom(
        '[data-test-policy-grant-warning-message="grant-reaches-ungranted-type"] code',
      )
      .exists('the grant’s warning renders them as code too');
    assert
      .dom(
        '[data-test-policy-grant-warning-message="grant-reaches-ungranted-type"]',
      )
      .doesNotIncludeText(BACKTICK);
  });

  test('a policy whose issues only leave grants inactive marks no warning', async function (assert) {
    await renderPolicyNamed('policies/inactive-only', [
      {
        targetType: { module: '../classroom', name: 'Classroom' },
        grants: [
          { operation: 'read' },
          { operation: 'delete', where: MISTYPED },
          { operation: 'query', where: UNFILTERABLE },
        ],
      },
    ]);

    assert.deepEqual(await grantStatuses(), ['live', 'inactive', 'inactive']);
    assert
      .dom('[data-test-policy-grant-inactive]')
      .exists(
        { count: 2 },
        'each grant an issue leaves out is marked inactive',
      );
    assert
      .dom('[data-test-policy-issue]')
      .exists({ count: 2 }, 'and each issue is listed');
    assert
      .dom('[data-test-policy-grant-warning]')
      .doesNotExist('no grant is marked with a warning');
    assert
      .dom('[data-test-policy-issue-warning]')
      .doesNotExist('and no listed issue is marked as one');
  });

  test('a view created in an index render never asks what the policy compiles to', async function (assert) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'classroom.gts': classroomModule,
        'policies/mistyped.json': policyDocument([
          {
            targetType: { module: '../classroom', name: 'Classroom' },
            grants: [
              { operation: 'read' },
              { operation: 'delete', where: MISTYPED },
            ],
          },
        ]),
      },
    });
    let { operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    );
    // Looking the service up arms the transport both the card's validate
    // and the test's own are sent through.
    getService('operations');
    let policy = await loadPolicy('policies/mistyped');

    // Every validate the page sends on to the realm.
    let validates = 0;
    let network = getService('network');
    let spy = async (request: Request) => {
      if (
        new URL(request.url).pathname.endsWith('/_operations') &&
        (await request.clone().text()).includes('"validate"')
      ) {
        validates++;
      }
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });
    let context = globalThis as Record<string, unknown>;
    try {
      // The render context is what marks an index render.
      context.__boxelRenderContext = true;
      try {
        await renderCard(loader, policy, 'isolated');
      } finally {
        context.__boxelRenderContext = undefined;
      }
      assert
        .dom('[data-test-policy-rule]')
        .exists({ count: 1 }, 'the index render lists the rules');
      assert
        .dom('[data-test-policy-grant-status]')
        .doesNotExist('with no grant marked');
      assert
        .dom('[data-test-realm-policy-issues]')
        .doesNotExist('and no issues');

      // The test asks once itself, through the same transport. Once that
      // answer is back, an ask the view made while it rendered would have
      // reached the realm too.
      let validation = await (
        operations(policy) as unknown as {
          validate(): Promise<{ issues: { code: string }[] }>;
        }
      ).validate();
      assert.deepEqual(
        validation.issues.map(({ code }) => code),
        ['invalid-predicate'],
        'the realm answers a validate of this card',
      );
      assert.strictEqual(
        validates,
        1,
        "the only validate sent is the test's own",
      );
    } finally {
      network.virtualNetwork.unmount(spy);
    }
  });
});

// The explain panel's draft, search and listing forms, asked of a realm that
// judges the host's requests by its ACL. The signed-in user owns the realm and
// asks the questions. The teacher they ask about holds no realm permissions,
// so the policy decides every answer. The classroom definition lives in a
// realm anyone may read, which a draft naming it needs of whoever asks.
//
// The policy lets a teacher read and delete the classrooms they teach, and run
// `listMine` over them. Its grant on an ad-hoc search has a condition a search
// can't use.
const DEFINITIONS = 'http://test-realm/classroom-definitions/';
const CLASSROOM = { module: `${DEFINITIONS}classroom`, name: 'Classroom' };
const OWNER = '@testuser:localhost';
const MISTYPED_PREDICATE = `${teachesPredicate} and .title ==`;
const UNFILTERABLE_PREDICATE = '(.title | tonumber) > 0';

const classroomQueryModule = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);

    @operation static listMine = {
      base: 'query',
      query: { filter: { type: () => Classroom } },
    };
  }
`;

const askedPolicyRules = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: teachesPredicate },
      { operation: 'delete', where: teachesPredicate },
      { operation: 'listMine', where: teachesPredicate },
      { operation: 'query', where: UNFILTERABLE_PREDICATE },
    ],
  },
];

// Eleven classrooms, one more than a page of a listing. The teacher teaches
// the first three.
const ROOMS = Array.from({ length: 11 }, (_, i) => `room-${201 + i}`);

function definedClassroom(teacherIds: string[]) {
  return {
    data: {
      type: 'card',
      attributes: { teacherIds },
      meta: { adoptsFrom: CLASSROOM },
    },
  };
}

module('Integration | realm policy explain forms', function (hooks) {
  setupRenderingTest(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: OWNER,
    activeRealms: [DEFINITIONS, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  async function renderAskedPolicy() {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: DEFINITIONS,
      permissions: { '*': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Classroom definitions' }),
        'classroom.gts': classroomQueryModule,
      },
    });
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      enforcePermissions: true,
      permissions: { [OWNER]: ['read', 'write', 'realm-owner'] },
      contents: {
        'realm.json': realmConfigCardJSON({
          policy: `${testRealmURL}policies/classrooms`,
        }),
        ...Object.fromEntries(
          ROOMS.map((room, i) => [
            `classrooms/${room}.json`,
            definedClassroom(i < 3 ? [TEACHER] : [COLLEAGUE]),
          ]),
        ),
        'policies/classrooms.json': policyDocument(askedPolicyRules),
      },
    });
    // Looking the service up arms the transport the card's own
    // `operations()` call sends its explain through.
    getService('operations');
    let store = getService('store') as StoreService;
    let policy = (await store.get(
      `${testRealmURL}policies/classrooms`,
    )) as RealmPolicy;
    await renderCard(loader, policy, 'isolated');
  }

  async function chooseMode(mode: 'card' | 'search' | 'listing') {
    await click(`[data-test-explain-mode="${mode}"] input`);
  }

  async function submitAndWait(answer: string) {
    await click('[data-test-explain-submit]');
    await waitFor(`${answer}, [data-test-explain-refusal]`, {
      timeout: 10_000,
    });
  }

  function draftRules(grants: Record<string, unknown>[]) {
    return JSON.stringify({ rules: [{ targetType: CLASSROOM, grants }] });
  }

  test('the policy answers a question against a draft, and the policy in force is unchanged', async function (assert) {
    await renderAskedPolicy();
    let room205 = `${testRealmURL}classrooms/room-205`;

    await fillIn('[data-test-explain-actor]', TEACHER);
    await fillIn('[data-test-explain-target]', room205);
    await fillIn('[data-test-explain-operation]', 'delete');
    await submitAndWait('[data-test-explanation]');
    assert
      .dom('[data-test-explanation-decision]')
      .hasText(
        'denied',
        'the policy in force lets a teacher delete only their own classrooms',
      );
    assert.dom('[data-test-explanation-draft]').doesNotExist();

    await click('[data-test-explain-use-draft]');
    let started = JSON.parse(
      (
        document.querySelector(
          '[data-test-explain-draft]',
        ) as HTMLTextAreaElement
      ).value,
    ) as { rules: { grants: { operation: string }[] }[] };
    assert.deepEqual(
      started.rules.map((rule) => rule.grants.map((g) => g.operation)),
      [['read', 'delete', 'listMine', 'query']],
      "the draft starts from this card's rules",
    );

    await fillIn(
      '[data-test-explain-draft]',
      draftRules([{ operation: 'delete' }]),
    );
    await submitAndWait('[data-test-explanation]');
    assert
      .dom('[data-test-explanation-decision]')
      .hasText('allowed', 'the draft lets the teacher delete any classroom');
    assert
      .dom('[data-test-explanation-reason]')
      .hasText('A grant in this policy allows it.');
    assert
      .dom('[data-test-explanation-draft]')
      .exists('the answer says it was answered against the draft');
    assert.dom('[data-test-explanation-draft-clean]').exists();

    await fillIn(
      '[data-test-explain-draft]',
      draftRules([{ operation: 'delete', where: MISTYPED_PREDICATE }]),
    );
    await submitAndWait('[data-test-explanation]');
    assert.dom('[data-test-explanation-decision]').hasText('denied');
    assert
      .dom('[data-test-explanation-draft-issue]')
      .exists({ count: 1 })
      .hasAttribute('data-test-explanation-draft-issue', 'invalid-predicate')
      .includesText('rules[0].grants[0].where', 'the issue names where it is');

    // A draft the realm refuses: valid JSON, but not a policy document.
    await fillIn(
      '[data-test-explain-draft]',
      JSON.stringify({ attributes: { rules: [] } }),
    );
    await submitAndWait('[data-test-explain-refusal]');
    assert
      .dom('[data-test-explain-refusal]')
      .includesText(
        'a policy document',
        "the realm's refusal of the draft is shown in place of an answer",
      );
    assert.dom('[data-test-explanation]').doesNotExist();

    await fillIn('[data-test-explain-draft]', '{ "rules": ');
    await submitAndWait('[data-test-explain-refusal]');
    assert
      .dom('[data-test-explain-refusal]')
      .includesText(
        "The draft isn't valid JSON",
        'a draft that does not parse is never sent',
      );

    await click('[data-test-explain-use-draft]');
    await submitAndWait('[data-test-explanation]');
    assert
      .dom('[data-test-explanation-decision]')
      .hasText(
        'denied',
        'and without the draft, the policy in force answers as before',
      );
    assert.dom('[data-test-explanation-draft]').doesNotExist();
  });

  test('the policy says what it composes into a search, and how far behind the index is', async function (assert) {
    await renderAskedPolicy();

    await chooseMode('search');
    assert
      .dom('[data-test-explain-realm]')
      .hasValue(
        testRealmURL,
        "a search runs in this card's realm unless another is named",
      );
    assert.dom('[data-test-explain-target]').doesNotExist();
    await fillIn('[data-test-explain-actor]', TEACHER);
    await fillIn('[data-test-explain-operation]', 'listMine');
    await fillIn('[data-test-explain-type-module]', CLASSROOM.module);
    await fillIn('[data-test-explain-type-name]', CLASSROOM.name);
    await submitAndWait('[data-test-explanation]');

    assert.dom('[data-test-explanation-decision]').hasText('allowed');
    assert
      .dom('[data-test-explanation-reason]')
      .hasText(
        'Grants in this policy let this search return the cards their conditions match, and no others.',
      );
    assert.dom('[data-test-explanation-search-operation]').hasText('listMine');
    assert.dom('[data-test-explanation-search-types]').hasText('Classroom');
    assert
      .dom('[data-test-explanation-search-fragment]')
      .includesText(TEACHER, 'what the policy composes names the teacher');
    assert
      .dom('[data-test-explanation-search-index]')
      .hasText('Up to date.', 'the index has every write');
    assert
      .dom('[data-test-explanation-grant]')
      .exists({ count: 1 }, 'the one grant on the named query')
      .hasAttribute('data-test-explanation-grant-filterable', 'true');
    assert
      .dom('[data-test-explanation-grant-label]')
      .hasText('narrows the search');
    assert
      .dom('[data-test-explanation-grant] .tier')
      .doesNotExist(
        'a search runs the condition over the index, so no copy of one card is named',
      );

    await fillIn('[data-test-explain-operation]', 'listTheirs');
    await submitAndWait('[data-test-explanation]');
    assert
      .dom('[data-test-explanation-reason]')
      .includesText(
        "This search couldn't be resolved",
        'a search the type does not declare is said to be one',
      );

    await fillIn('[data-test-explain-operation]', 'query');
    assert
      .dom('[data-test-explain-type-module]')
      .doesNotExist('an ad-hoc search names its types in its filter');
    await fillIn(
      '[data-test-explain-search-filter]',
      JSON.stringify({ 'item.on': CLASSROOM }),
    );
    await submitAndWait('[data-test-explanation]');
    assert.dom('[data-test-explanation-decision]').hasText('denied');
    assert
      .dom('[data-test-explanation-reason]')
      .includesText('No grant in this policy can narrow this search');
    assert.dom('[data-test-explanation-search-operation]').hasText('query');
    assert
      .dom('[data-test-explanation-search-no-fragment]')
      .exists('the policy composes nothing');
    assert
      .dom('[data-test-explanation-grant]')
      .hasAttribute('data-test-explanation-grant-filterable', 'false');
    assert
      .dom('[data-test-explanation-grant-label]')
      .hasText(
        "a search can't use its condition, so it adds nothing",
        'the grant whose condition a search cannot use is shown as adding nothing',
      );

    await click('[data-test-explain-use-draft]');
    await fillIn('[data-test-explain-draft]', JSON.stringify({ grants: [] }));
    await submitAndWait('[data-test-explain-refusal]');
    assert
      .dom('[data-test-explain-refusal]')
      .includesText(
        'a policy document',
        'a search asked of a draft the realm refuses shows the refusal',
      );

    await fillIn(
      '[data-test-explain-draft]',
      draftRules([{ operation: 'query', where: teachesPredicate }]),
    );
    await submitAndWait('[data-test-explanation]');
    assert
      .dom('[data-test-explanation-decision]')
      .hasText('allowed', 'a draft whose grant a search can use admits it');
    assert
      .dom('[data-test-explanation-search-fragment]')
      .includesText(TEACHER, 'and composes a fragment naming the teacher');
    assert
      .dom('[data-test-explanation-grant]')
      .hasAttribute('data-test-explanation-grant-filterable', 'true');
    assert.dom('[data-test-explanation-draft-clean]').exists();
  });

  test('the policy explains a page of the cards in a realm at a time', async function (assert) {
    await renderAskedPolicy();

    await chooseMode('listing');
    await fillIn('[data-test-explain-actor]', TEACHER);
    await fillIn('[data-test-explain-operation]', 'read');
    await fillIn('[data-test-explain-type-module]', CLASSROOM.module);
    await fillIn('[data-test-explain-type-name]', CLASSROOM.name);
    await submitAndWait('[data-test-explanation-listing]');

    let listed = () =>
      [...document.querySelectorAll('[data-test-explanation-listed]')].map(
        (el) => [
          el.getAttribute('data-test-explanation-listed'),
          el
            .querySelector('[data-test-explanation-listed-decision]')
            ?.textContent?.trim(),
        ],
      );
    assert
      .dom('[data-test-explanation-listing-page]')
      .hasText('Cards 1 to 10 of 11');
    assert.deepEqual(
      listed(),
      ROOMS.slice(0, 10).map((room, i) => [
        `${testRealmURL}classrooms/${room}`,
        i < 3 ? 'allowed' : 'denied',
      ]),
      'each card on the page is explained for the teacher',
    );
    assert.dom('[data-test-explanation-listing-previous]').isDisabled();
    assert.dom('[data-test-explanation-listing-next]').isEnabled();

    // Paging asks the question the listing shows, whatever has been typed
    // since: room-211 is the colleague's, so the teacher is still refused it.
    await fillIn('[data-test-explain-actor]', COLLEAGUE);
    await click('[data-test-explanation-listing-next]');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-explanation-listing-page]')
          ?.textContent?.trim() === 'Cards 11 to 11 of 11',
      { timeout: 10_000 },
    );
    assert.deepEqual(listed(), [
      [`${testRealmURL}classrooms/room-211`, 'denied'],
    ]);
    assert
      .dom('[data-test-explanation-listed] [data-test-explanation-actor]')
      .hasText(
        TEACHER,
        'the next page answers for the teacher it was asked for',
      );
    assert.dom('[data-test-explanation-listing-previous]').isEnabled();
    assert.dom('[data-test-explanation-listing-next]').isDisabled();

    await click('[data-test-explain-use-draft]');
    await fillIn(
      '[data-test-explain-draft]',
      draftRules([{ operation: 'read' }]),
    );
    await submitAndWait('[data-test-explanation-listing]');
    assert
      .dom('[data-test-explanation-listing-page]')
      .hasText(
        'Cards 1 to 10 of 11',
        'a new question starts at the first page',
      );
    assert.deepEqual(
      listed().map(([, decision]) => decision),
      Array(10).fill('allowed'),
      'the draft lets the teacher read every classroom',
    );
    assert.dom('[data-test-explanation-draft-clean]').exists();
  });
});
