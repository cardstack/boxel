import {
  click,
  fillIn,
  waitFor,
  type RenderingTestContext,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
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
  testRealmURL,
  provideConsumeContext,
  realmConfigCardJSON,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { serializeCard, setupBaseRealm } from '../helpers/base-realm';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef, FieldDef } from '@cardstack/base/card-api';

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

// A realm whose policy lets a teacher delete the classrooms they teach. The
// grant that fails comes first, so the answer shows a predicate that did not
// hold ahead of the one that admitted the delete.
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';
const leadsPredicate = '.leadTeacherIds | any(. == actor())';
const teachesPredicate = '.teacherIds | any(. == actor())';

const classroomModule = `
  import { containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Classroom extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field leadTeacherIds = containsMany(StringField);
  }
`;

function classroom(teacherIds: string[]): LooseSingleCardDocument {
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
  setupBaseRealm(hooks);
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

  test('a document shape assigned in code is refused rather than read as a predicate', async function (assert) {
    await setupPolicyRealm({ 'policies/education.json': educationPolicy });
    let policy = await loadPolicy('policies/education');

    let grant = policy.rules[0].grants[1];
    (grant as { where: unknown }).where = providerPredicate;
    assert.throws(
      () => serializeCard(policy),
      /a policy predicate in memory must be \{ source, snapshot \}/,
      'a bare string on the instance fails the save instead of being written',
    );

    (grant as { where: unknown }).where = {
      bxl: providerPredicate,
      snapshot: true,
    };
    assert.throws(
      () => serializeCard(policy),
      /a policy predicate in memory must be \{ source, snapshot \}/,
      'so does the annotated document shape',
    );

    grant.where = { source: providerPredicate, snapshot: true };
    let serialized = serializeCard(policy);
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

  test('the policy explains what it decides for one caller, one card and one operation', async function (assert) {
    await renderClassroomPolicy();

    assert.dom('[data-test-realm-policy-explain]').exists();
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
      .hasText('A grant in this policy admits it.');
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
        'Grants for this operation match the card, and none of their conditions holds.',
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
});
