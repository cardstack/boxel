import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  noteRealmIndexMoved,
  realmPolicyRef,
  rri,
  type CompiledOperationGrant,
  type CompiledRealmPolicy,
  type Definition,
  type FieldDefinition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  lowerQueryOperation,
  RealmPolicyCache,
} from '@cardstack/runtime-common/card-operations';
import { runBxlTransform } from '@cardstack/bxl/transform';

// A query grant's predicate compiled to a search filter, driven through the
// compiled-policy cache over an environment held in memory: no realm, no
// database, no prerender.
const ORG = 'http://policy-filter.test/org/';
const EDUCATION = 'http://policy-filter.test/education/';
const SHARED = 'http://policy-filter.test/shared/';
const POLICY_CARD = `${ORG}policies/education`;
const TEACHER = '@teacher:localhost';

const CLASSROOM: ResolvedCodeRef = {
  module: rri(`${EDUCATION}classroom`),
  name: 'Classroom',
};
// In a realm of its own, so that only the address's realm moving can tell the
// policy its definition changed.
const ADDRESS: ResolvedCodeRef = {
  module: rri(`${SHARED}address`),
  name: 'Address',
};
const PERSON: ResolvedCodeRef = {
  module: rri(`${EDUCATION}person`),
  name: 'Person',
};
// Field types as a definition names them.
const STRING_FIELD = {
  module: rri('@cardstack/base/card-api'),
  name: 'StringField',
};
const NUMBER_FIELD = {
  module: rri('@cardstack/base/number'),
  name: 'default',
};
const BOOLEAN_FIELD = {
  module: rri('@cardstack/base/boolean'),
  name: 'default',
};
const DATE_FIELD = { module: rri('@cardstack/base/date'), name: 'default' };
const JSON_FIELD = {
  module: rri('@cardstack/base/json-field'),
  name: 'JsonField',
};
// A string field of the realm's own, which can index what it likes.
const SLUG_FIELD = { module: rri(`${EDUCATION}slug`), name: 'Slug' };

async function until(done: () => boolean, what: string) {
  let started = Date.now();
  while (!done()) {
    if (Date.now() - started > 3_000) {
      throw new Error(`timed out waiting until ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function field(
  type: FieldDefinition['type'],
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    type,
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: STRING_FIELD,
    ...overrides,
  };
}

function definition(
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldDefinition>,
  extra: Partial<Definition> = {},
): Definition {
  let names: Definition['fields'] = {};
  let fieldDefs: Definition['fieldDefs'] = {};
  for (let [name, def] of Object.entries(fields)) {
    names[name] = name;
    fieldDefs[name] = def;
  }
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: names,
    fieldDefs,
    ...extra,
  };
}

function classroomDefinition(): Definition {
  return definition(
    CLASSROOM,
    {
      id: field('contains'),
      providerId: field('contains'),
      teacherIds: field('containsMany'),
      roomNumber: field('contains', {
        fieldOrCard: NUMBER_FIELD,
        serializerName: 'number',
      }),
      scores: field('containsMany', {
        fieldOrCard: NUMBER_FIELD,
        serializerName: 'number',
      }),
      published: field('contains', {
        fieldOrCard: BOOLEAN_FIELD,
        serializerName: 'boolean',
      }),
      startsOn: field('contains', {
        fieldOrCard: DATE_FIELD,
        serializerName: 'date',
      }),
      payload: field('contains', { fieldOrCard: JSON_FIELD }),
      slug: field('contains', { fieldOrCard: SLUG_FIELD }),
      summary: field('contains', { isComputed: true }),
      address: field('contains', { isPrimitive: false, fieldOrCard: ADDRESS }),
      lead: field('linksTo', { isPrimitive: false, fieldOrCard: PERSON }),
      teachers: field('linksToMany', {
        isPrimitive: false,
        fieldOrCard: PERSON,
      }),
      roster: field('linksToMany', {
        isPrimitive: false,
        fieldOrCard: PERSON,
        query: { filter: { type: PERSON } },
      }),
    },
    {
      operations: {
        listMine: { base: 'query', deterministic: true },
        appendActivity: { base: 'create', deterministic: true },
      },
    },
  );
}

function addressDefinition(fields: string[] = ['city']): Definition {
  return {
    ...definition(
      ADDRESS,
      Object.fromEntries(fields.map((name) => [name, field('contains')])),
    ),
    type: 'field-def',
  };
}

type Grant = { operation: string; where?: unknown };
type Where = string | { bxl: string; snapshot: boolean };

// A cache whose policy has one rule, on `Classroom`, holding `grants`. A test
// swaps a definition through `definitions` and reads what the cache compiled.
function setup(grants: Grant[]) {
  let definitions = new Map<string, Definition>([
    [CLASSROOM.name, classroomDefinition()],
    [ADDRESS.name, addressDefinition()],
  ]);
  let policyKey = `${realmPolicyRef.module}/${realmPolicyRef.name}`;
  let cache = new RealmPolicyCache({
    policyCard: async () => POLICY_CARD,
    readCard: async (): Promise<IndexedInstanceSource> => ({
      realmURL: ORG,
      generation: 1,
      sourceContentHash: 'v1',
      types: [policyKey],
      error: null,
      instance: {
        id: rri(POLICY_CARD),
        type: 'card',
        attributes: {
          rules: [
            {
              targetType: { module: CLASSROOM.module, name: CLASSROOM.name },
              grants,
            },
          ],
        },
        meta: { adoptsFrom: realmPolicyRef },
      },
    }),
    resolveCodeRef: (codeRef) =>
      codeRef.module === CLASSROOM.module ? CLASSROOM : undefined,
    lookupDefinition: async (codeRef): Promise<Definition> => {
      let found = definitions.get(codeRef.name);
      if (!found) {
        throw new FilterRefersToNonexistentTypeError(
          codeRef as ResolvedCodeRef,
        );
      }
      return found;
    },
    toURL: (identifier) => new URL(identifier),
    isPolicyCard: (types) => types.includes(policyKey),
  });
  return { cache, definitions };
}

async function compile(grants: Grant[]): Promise<CompiledRealmPolicy> {
  let policy = await setup(grants).cache.get();
  if (!policy) {
    throw new Error('the realm has no policy');
  }
  return policy;
}

function grantsOf(policy: CompiledRealmPolicy): CompiledOperationGrant[] {
  return policy.rules.flatMap((rule) => rule.grants);
}

// The filter one query grant compiles to, or the problem recorded for it.
async function filterFor(where: Where, operation = 'query') {
  let policy = await compile([{ operation, where }]);
  let [grant] = grantsOf(policy);
  return {
    filter: grant?.filter,
    issues: policy.issues.map(({ code, path }) => ({ code, path })),
    messages: policy.issues.map(({ message }) => message),
    grant,
  };
}

// A compiled filter with the caller filled in, the way a search fills in a
// declared query's markers.
function bind(
  filter: CompiledOperationGrant['filter'],
  invocation: { actor?: string } = { actor: TEACHER },
) {
  return lowerQueryOperation({ base: 'query', query: { filter } }, invocation)
    .filter;
}

const ANCHOR = { 'item.on': CLASSROOM };
const ACTOR = { $ref: 'actor' };

module(basename(import.meta.filename), function () {
  test('equality with the caller compiles to an `eq`, which a search fills in with the caller', async function (assert) {
    let { filter, issues } = await filterFor('.providerId == actor()');
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, {
      ...ANCHOR,
      eq: { 'item.providerId': ACTOR },
    });
    assert.deepEqual(bind(filter), {
      ...ANCHOR,
      eq: { 'item.providerId': TEACHER },
    });
  });

  test('a filter that reads the caller is refused to a search nobody signed in to', async function (assert) {
    let { filter } = await filterFor('.providerId == actor()');
    assert.throws(
      () => bind(filter, {}),
      (e: any) => e.error?.status === 401 && e.error?.code === 'actor-required',
    );
  });

  test('membership in a list of strings compiles to an `eq` on the list, which matches when any element does', async function (assert) {
    for (let where of [
      '.teacherIds | any(. == actor())',
      '.teacherIds | any(actor() == .)',
      // BXL's `contains` matches substrings, so its filter, which matches the
      // whole value, is narrower than the predicate.
      '.teacherIds | contains([actor()])',
    ]) {
      let { filter, issues } = await filterFor(where);
      assert.deepEqual(issues, [], where);
      assert.deepEqual(
        filter,
        { ...ANCHOR, eq: { 'item.teacherIds': ACTOR } },
        where,
      );
    }
  });

  test('membership in a list of links compiles to an `eq` on the ids of the cards they link to', async function (assert) {
    let person = `${EDUCATION}people/1`;
    for (let where of [
      `.teachers | any(.id == "${person}")`,
      `.teachers | contains([{id: "${person}"}])`,
    ]) {
      let { filter, issues } = await filterFor(where);
      assert.deepEqual(issues, [], where);
      assert.deepEqual(
        filter,
        { ...ANCHOR, eq: { 'item.teachers.id': person } },
        where,
      );
    }
  });

  test('a link compiles to an `eq` on the id of the card it links to', async function (assert) {
    let { filter, issues } = await filterFor(
      `.lead.id == "${EDUCATION}people/1"`,
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, {
      ...ANCHOR,
      eq: { 'item.lead.id': `${EDUCATION}people/1` },
    });
  });

  test("the card's own id compiles to an `eq` on `id`", async function (assert) {
    let { filter, issues } = await filterFor(
      `.id == "${EDUCATION}classrooms/1"`,
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, {
      ...ANCHOR,
      eq: { 'item.id': `${EDUCATION}classrooms/1` },
    });
  });

  test('a computed field compiles for a predicate annotated as reading a snapshot, whose values are what the index holds', async function (assert) {
    let { filter, issues } = await filterFor({
      bxl: '.summary == actor()',
      snapshot: true,
    });
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, { ...ANCHOR, eq: { 'item.summary': ACTOR } });
  });

  test('a field of a contained value compiles to an `eq` on its dotted path', async function (assert) {
    let { filter, issues } = await filterFor('.address.city == "Springfield"');
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, {
      ...ANCHOR,
      eq: { 'item.address.city': 'Springfield' },
    });
  });

  test('`or` compiles inside one predicate to `any`, and `and` to `every`', async function (assert) {
    let { filter, issues } = await filterFor(
      // `|` binds more loosely than `or`, so a membership test inside an `or`
      // is parenthesized.
      '.providerId == actor() or (.teacherIds | any(. == actor())) or .roomNumber == 204',
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, {
      ...ANCHOR,
      any: [
        { eq: { 'item.providerId': ACTOR } },
        { eq: { 'item.teacherIds': ACTOR } },
        { eq: { 'item.roomNumber': 204 } },
      ],
    });
    assert.deepEqual(bind(filter), {
      ...ANCHOR,
      any: [
        { eq: { 'item.providerId': TEACHER } },
        { eq: { 'item.teacherIds': TEACHER } },
        { eq: { 'item.roomNumber': 204 } },
      ],
    });

    ({ filter } = await filterFor(
      '.providerId == actor() and (.roomNumber > 100 or .address.city == "Springfield")',
    ));
    assert.deepEqual(filter, {
      ...ANCHOR,
      every: [
        { eq: { 'item.providerId': ACTOR } },
        {
          any: [
            { range: { 'item.roomNumber': { gt: 100 } } },
            { eq: { 'item.address.city': 'Springfield' } },
          ],
        },
      ],
    });
  });

  test('a range comparison on a number field compiles to a `range`, whichever side the number is written on', async function (assert) {
    let cases: [string, object][] = [
      ['.roomNumber > 200', { gt: 200 }],
      ['.roomNumber >= 200', { gte: 200 }],
      ['.roomNumber < -1', { lt: -1 }],
      ['200 >= .roomNumber', { lte: 200 }],
      ['200 < .roomNumber', { gt: 200 }],
    ];
    for (let [where, range] of cases) {
      let { filter, issues } = await filterFor(where);
      assert.deepEqual(issues, [], where);
      assert.deepEqual(
        filter,
        { ...ANCHOR, range: { 'item.roomNumber': range } },
        where,
      );
    }
  });

  test('`not` and `!=` compile to `not` around a comparison of a single value', async function (assert) {
    let { filter, issues } = await filterFor('.providerId != actor()');
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, {
      ...ANCHOR,
      not: { eq: { 'item.providerId': ACTOR } },
    });

    ({ filter } = await filterFor(
      '(.roomNumber > 200 or .providerId == null) | not',
    ));
    assert.deepEqual(filter, {
      ...ANCHOR,
      not: {
        any: [
          { range: { 'item.roomNumber': { gt: 200 } } },
          { eq: { 'item.providerId': null } },
        ],
      },
    });
  });

  test('a grant with no condition compiles to a filter on the rule type alone', async function (assert) {
    let policy = await compile([{ operation: 'query' }]);
    assert.deepEqual(policy.issues, []);
    assert.deepEqual(grantsOf(policy), [
      { operation: 'query', filter: { 'item.on': CLASSROOM } },
    ]);
  });

  test('a named query the rule type declares compiles a filter, and no other grant does', async function (assert) {
    let where = '.providerId == actor()';
    let policy = await compile([
      { operation: 'listMine', where },
      { operation: 'read', where },
      { operation: 'appendActivity', where },
      { operation: 'update' },
    ]);
    assert.deepEqual(policy.issues, []);
    let [listMine, read, appendActivity, update] = grantsOf(policy);
    assert.deepEqual(listMine.filter, {
      ...ANCHOR,
      eq: { 'item.providerId': ACTOR },
    });
    assert.strictEqual(
      read.filter,
      undefined,
      'a read grant never contributes a filter, even when its predicate has one',
    );
    assert.strictEqual(appendActivity.filter, undefined);
    assert.strictEqual(update.filter, undefined);
    assert.strictEqual(read.where?.canonical, where);
  });

  test('a predicate the `predicate` profile refuses records `policy-not-filterable`', async function (assert) {
    for (let where of [
      // String manipulation.
      '(.providerId | ascii_downcase) == actor()',
      '.providerId | startswith("@")',
      // A realm setting, which a search does not resolve.
      '.providerId == realmConfig("approver")',
      // Crossing a list the filter cannot address, element by element.
      'any(.teacherIds[]; . == actor())',
    ]) {
      let { filter, issues, messages } = await filterFor(where);
      assert.strictEqual(filter, undefined, where);
      assert.deepEqual(
        issues,
        [{ code: 'policy-not-filterable', path: 'rules[0].grants[0].where' }],
        where,
      );
      assert.true(
        messages[0].includes('the `predicate` profile refuses it'),
        `${where}: ${messages[0]}`,
      );
    }
  });

  test('a predicate the filter cannot say, or would say more widely than the predicate, records `policy-not-filterable`', async function (assert) {
    let cases: [string, RegExp][] = [
      // Arithmetic.
      ['.roomNumber + 1 > 200', /is arithmetic/],
      // One element of a list by its position.
      ['.teacherIds[0] == actor()', /by its position/],
      // `==` on a list compares the whole list, while a filter's `eq` on a
      // list matches any one element.
      ['.teacherIds == actor()', /compares a whole list/],
      // BXL's `contains` with a string on a list holds for no list at all.
      ['.teacherIds | contains(actor())', /predicate. profile refuses/],
      // Membership inside a `not`, which the index answers element by element.
      ['.teacherIds | any(. == actor()) | not', /inside a `not`/],
      // An id inside a `not`, which the index can spell differently.
      [`.lead.id != "${EDUCATION}people/1"`, /can spell one id two ways/],
      // An id compared with anything but an absolute URL: the index can hold
      // an unfollowed reference as written, and the predicate reads the URL.
      [
        '.lead.id == "@cardstack/catalog/people/1"',
        /only with an absolute URL/,
      ],
      ['.lead.id == "../people/1"', /only with an absolute URL/],
      ['.lead.id == actor()', /only with an absolute URL/],
      ['.teachers | any(.id == actor())', /only with an absolute URL/],
      ['.id == "@cardstack/catalog/classrooms/1"', /only with an absolute URL/],
      // A field the stored source does not hold.
      ['.summary == actor()', /computed.*snapshot: true/],
      ['.roster | any(.id == actor())', /filled by a query/],
      // A field the index holds in a form the stored source does not.
      ['.published == true', /boolean field holds its unset value/],
      ['.published == null', /compares only the base string and number/],
      ['.startsOn == "2026-09-01"', /compares only the base string and number/],
      // `JsonField` indexes nothing, so every card would satisfy `== null`.
      ['.payload == null', /compares only the base string and number/],
      // A field type of the realm's own can index anything.
      ['.slug == actor()', /Slug field/],
      // A link compared as a whole.
      [
        `.lead == "${EDUCATION}people/1"`,
        /only the id of the card it links to/,
      ],
      // A value of the wrong kind for its field.
      ['.roomNumber == actor()', /holds a number/],
      ['.roomNumber > "200"', /only between a number field and a number/],
      ['.scores | any(. == 3)', /list of numbers/],
      // Two fields, or a field alone.
      ['.providerId == .lead.id', /both sides are fields/],
      ['.published', /is a field, not a condition/],
      // A field the type does not have.
      ['.principalId == actor()', /not a field of Classroom/],
    ];
    for (let [where, reason] of cases) {
      let { filter, issues, messages } = await filterFor(where);
      assert.strictEqual(filter, undefined, where);
      assert.deepEqual(
        issues,
        [{ code: 'policy-not-filterable', path: 'rules[0].grants[0].where' }],
        where,
      );
      assert.true(reason.test(messages[0] ?? ''), `${where}: ${messages[0]}`);
    }
  });

  test('a query grant with no filter is kept with its predicate, which still evaluates on one card', async function (assert) {
    let { grant, issues } = await filterFor('.roomNumber + 1 > 200');
    assert.deepEqual(issues, [
      { code: 'policy-not-filterable', path: 'rules[0].grants[0].where' },
    ]);
    assert.deepEqual(grant, {
      operation: 'query',
      where: {
        source: '.roomNumber + 1 > 200',
        canonical: '.roomNumber + 1 > 200',
        snapshot: false,
      },
    });
    let evaluate = (roomNumber: number) =>
      runBxlTransform(
        grant!.where!.canonical,
        { roomNumber },
        { actor: TEACHER, instance: {} },
        { syntax: 'solidified' },
      );
    assert.true(evaluate(204));
    assert.false(evaluate(104));
  });

  test("a filter reading a contained value is recompiled when the contained type's realm moves", async function (assert) {
    let { cache, definitions } = setup([
      { operation: 'query', where: '.address.city == "Springfield"' },
    ]);
    let before = await cache.get();
    assert.deepEqual(before?.issues, []);

    // The address lives in a realm the rule's own type does not, so only that
    // realm's move can reach the compiled policy.
    definitions.set(ADDRESS.name, addressDefinition(['town']));
    noteRealmIndexMoved(SHARED);
    await until(() => cache.stats.compiles === 2, 'the move recompiles');
    let after = await cache.get();
    assert.deepEqual(
      after?.issues.map(({ code }) => code),
      ['policy-not-filterable'],
      'with `city` renamed, the filter that read it is gone',
    );

    definitions.set(ADDRESS.name, addressDefinition(['city']));
    noteRealmIndexMoved(SHARED);
    await until(() => cache.stats.compiles === 3, 'the next move recompiles');
    assert.deepEqual((await cache.get())?.issues, [], 'and it is back');
  });
});
