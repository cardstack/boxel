import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  noteRealmIndexMoved,
  realmPolicyRef,
  rri,
  type CodeRef,
  type CompiledOperationGrant,
  type Filter,
  type CompiledRealmPolicy,
  type Definition,
  type FieldDefinition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  lowerQueryOperation,
  RealmPolicyCache,
  withoutMisreadings,
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
// The realm the policy governs, apart from the realms the policy card and the
// types live in, so that only its move can tell the policy that the cards it
// holds changed.
const GOVERNED = 'http://policy-filter.test/governed/';
// Types descending from `Classroom`.
const SUBTYPES_MODULE = rri(`${EDUCATION}subtypes`);
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
const TEXT_AREA_FIELD = {
  module: rri('@cardstack/base/card-api'),
  name: 'TextAreaField',
};

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

function subtype(name: string): ResolvedCodeRef {
  return { module: SUBTYPES_MODULE, name };
}

// A type descending from `Classroom` that declares every field `Classroom`
// does, apart from those it redeclares here: in the way given, or not at all
// where given `null`.
function classroomSubtype(
  name: string,
  redeclared: Record<string, FieldDefinition | null> = {},
): Definition {
  let classroom = classroomDefinition();
  let fields: Record<string, FieldDefinition> = {};
  for (let [fieldName, id] of Object.entries(classroom.fields)) {
    fields[fieldName] = classroom.fieldDefs[id];
  }
  for (let [fieldName, redeclaration] of Object.entries(redeclared)) {
    if (redeclaration) {
      fields[fieldName] = redeclaration;
    } else {
      delete fields[fieldName];
    }
  }
  return definition(subtype(name), fields, {
    operations: classroom.operations,
  });
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
// swaps a definition through `definitions`, or a type's adoption chain
// through `chains`, and reads what the cache compiled. The governed realm
// holds cards of `Classroom`, of each type in `held`, of each type recorded
// under a key in `heldKeys`, and of each type in `unrelated`, which descend
// from something else; a test can change any of them. `state.asked` counts
// the times the cache read what the realm holds under `Classroom`.
function setup(grants: Grant[]) {
  let definitions = new Map<string, Definition>([
    [CLASSROOM.name, classroomDefinition()],
    [ADDRESS.name, addressDefinition()],
  ]);
  let chains = new Map<string, string[]>();
  let held: ResolvedCodeRef[] = [];
  let heldKeys: string[] = [];
  let unrelated: string[] = [];
  let state = { asked: 0 };
  let typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;
  let policyKey = typeKey(realmPolicyRef);
  let cache = new RealmPolicyCache({
    policyCard: async () => POLICY_CARD,
    readCard: async (): Promise<IndexedInstanceSource> => ({
      url: `${POLICY_CARD}.json`,
      realmURL: ORG,
      generation: 1,
      sourceContentHash: 'v1',
      types: [policyKey],
      error: null,
      failureWithheld: false,
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
      codeRef.module === CLASSROOM.module
        ? CLASSROOM
        : codeRef.module === SUBTYPES_MODULE
          ? subtype(codeRef.name)
          : undefined,
    lookupDefinitionEntry: async (codeRef) => {
      let found = definitions.get(codeRef.name);
      if (!found) {
        throw new FilterRefersToNonexistentTypeError(
          codeRef as ResolvedCodeRef,
        );
      }
      let chain =
        chains.get(codeRef.name) ??
        (codeRef.module === SUBTYPES_MODULE
          ? [typeKey(codeRef), typeKey(CLASSROOM)]
          : [typeKey(codeRef)]);
      return { definition: found, types: chain };
    },
    toURL: (identifier) => new URL(identifier),
    isPolicyCard: (types) => types.includes(policyKey),
    typeKey,
    revisitCard: async () => {},
    realmURL: GOVERNED,
    instanceTypesUnder: async (codeRef) => {
      state.asked++;
      return typeKey(codeRef) === typeKey(CLASSROOM)
        ? [...[CLASSROOM, ...held].map(typeKey), ...heldKeys].sort()
        : [];
    },
    instanceTypeKeys: async () =>
      [...[CLASSROOM, ...held].map(typeKey), ...heldKeys, ...unrelated].sort(),
  });
  return { cache, definitions, chains, held, heldKeys, unrelated, state };
}

async function compile(grants: Grant[]): Promise<CompiledRealmPolicy> {
  let policy = await setup(grants).cache.get();
  if (!policy) {
    throw new Error('the realm has no policy');
  }
  return policy;
}

// What a grant records as misreading each path: each type by name, with the
// descendants it keeps in parentheses, sorted.
function misreadings(
  grant: CompiledOperationGrant,
): Record<string, string[]> | undefined {
  return grant.misreadingTypes
    ? Object.fromEntries(
        grant.misreadingTypes.map(({ path, types }) => [
          path,
          types
            .map(
              ({ type, except }) =>
                `${nameOf(type)}${except ? ` (keeping ${except.map(nameOf).sort().join(', ')})` : ''}`,
            )
            .sort(),
        ]),
      )
    : undefined;
}

function nameOf(ref: CodeRef): string {
  return 'name' in ref ? ref.name : `ancestorOf ${nameOf(ref.card)}`;
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
    let where = `.teachers | any(.id == "${person}")`;
    let { filter, issues } = await filterFor(where);
    assert.deepEqual(issues, [], where);
    assert.deepEqual(filter, { ...ANCHOR, eq: { 'item.teachers.id': person } });
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
    let { filter, issues, grant } = await filterFor({
      bxl: '.summary == actor()',
      snapshot: true,
    });
    assert.deepEqual(issues, []);
    assert.deepEqual(filter, { ...ANCHOR, eq: { 'item.summary': ACTOR } });
    assert.true(grant?.where?.snapshot, 'the grant is judged as a snapshot');
  });

  test('a field the stored source does not hold records `unsnapshotted-policy-read` rather than `policy-not-filterable`, and compiles no grant', async function (assert) {
    for (let [where, reason] of [
      ['.summary == actor()', /computed.*snapshot: true/],
      ['.roster | any(.id == actor())', /filled in by a search/],
    ] as [string, RegExp][]) {
      let { grant, issues, messages } = await filterFor(where);
      assert.deepEqual(
        issues,
        [
          {
            code: 'unsnapshotted-policy-read',
            path: 'rules[0].grants[0].where',
          },
        ],
        where,
      );
      assert.strictEqual(grant, undefined, `${where}: no grant compiles`);
      assert.true(reason.test(messages[0] ?? ''), `${where}: ${messages[0]}`);
    }
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
      {
        operation: 'query',
        path: 'rules[0].grants[0]',
        filter: { 'item.on': CLASSROOM },
      },
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
        messages[0].includes("it uses something a search filter can't use"),
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
      // Membership inside a `not`, which the index answers element by element.
      [
        '.teacherIds | any(. == actor()) | not',
        /does not include something \(inside `not`\)/,
      ],
      // An id inside a `not`, which the index can spell differently.
      [
        `.lead.id != "${EDUCATION}people/1"`,
        /can write the same id two different ways/,
      ],
      // An id compared with anything but an absolute URL: the index can hold
      // an unfollowed reference as written, and the predicate reads the URL.
      ['.lead.id == "@cardstack/catalog/people/1"', /only with a full URL/],
      ['.lead.id == "../people/1"', /only with a full URL/],
      ['.lead.id == actor()', /only with a full URL/],
      ['.teachers | any(.id == actor())', /only with a full URL/],
      ['.id == "@cardstack/catalog/classrooms/1"', /only with a full URL/],
      // A field the index holds in a form the stored source does not.
      ['.published == true', /stores an empty yes\/no field as `false`/],
      ['.published == null', /compare only plain text and number fields/],
      [
        '.startsOn == "2026-09-01"',
        /compare only plain text and number fields/,
      ],
      // `JsonField` indexes nothing, so every card would satisfy `== null`.
      ['.payload == null', /compare only plain text and number fields/],
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
      path: 'rules[0].grants[0]',
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

  // A grant that is only not filterable is kept, and judges one card at a
  // time. One that matches a value only in part would judge that card wrongly
  // too, so it is left out.
  test('a query grant whose predicate matches a value only in part compiles no grant at all, so it neither scopes a search nor judges a card', async function (assert) {
    for (let where of [
      '.teacherIds | contains([actor()])',
      '.teacherIds | any(test(actor()))',
      '.teacherIds | any(startswith(actor()))',
      '.teacherIds | any(_strindices(actor()) | length > 0)',
    ]) {
      let { grant, issues } = await filterFor(where);
      assert.deepEqual(
        issues,
        [{ code: 'partial-match', path: 'rules[0].grants[0].where' }],
        where,
      );
      assert.strictEqual(grant, undefined, `${where}: no grant compiles`);
    }
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

  module('a type descending from the rule type', function () {
    const COMPUTED = subtype('ComputedProviderClassroom');
    const ELECTIVE = subtype('ElectiveClassroom');
    const OWN = '.providerId == actor()';
    const COMPUTED_PROVIDER = field('contains', { isComputed: true });

    // The policy `setup` compiles, once the governed realm holds cards of
    // each of `held`, whose definitions are the ones given.
    async function compileHolding(
      grants: Grant[],
      held: Record<string, Definition | undefined>,
    ): Promise<CompiledRealmPolicy> {
      let { cache, definitions, held: holding } = setup(grants);
      for (let [name, found] of Object.entries(held)) {
        holding.push(subtype(name));
        if (found) {
          definitions.set(name, found);
        }
      }
      let policy = await cache.get();
      if (!policy) {
        throw new Error('the realm has no policy');
      }
      return policy;
    }

    test("a descendant the realm holds cards of that computes a path a grant's filter compares is recorded against that path, and against no other", async function (assert) {
      let policy = await compileHolding(
        [
          { operation: 'query', where: OWN },
          { operation: 'query', where: '.roomNumber > 200' },
        ],
        {
          [COMPUTED.name]: classroomSubtype(COMPUTED.name, {
            providerId: COMPUTED_PROVIDER,
          }),
          [ELECTIVE.name]: classroomSubtype(ELECTIVE.name, {
            elective: field('contains'),
          }),
        },
      );
      assert.deepEqual(policy.issues, []);
      let [own, room] = grantsOf(policy);
      assert.deepEqual(
        misreadings(own),
        { providerId: [COMPUTED.name] },
        'the grant comparing `providerId` records the descendant that computes it, and not the one that declares it as `Classroom` does',
      );
      assert.strictEqual(
        misreadings(room),
        undefined,
        'the grant comparing `roomNumber` records nothing: both descendants declare it as `Classroom` does',
      );
    });

    test('a descendant that declares a compared field in any way that decides what the index holds differently from the rule type is recorded, and one differing only in `searchable` is not', async function (assert) {
      let ways: [string, FieldDefinition | null][] = [
        ['Computed', COMPUTED_PROVIDER],
        [
          'QueryBacked',
          field('contains', { query: { filter: { type: PERSON } } }),
        ],
        ['Retyped', field('contains', { fieldOrCard: TEXT_AREA_FIELD })],
        ['Listed', field('containsMany')],
        ['Absent', null],
        ['Searchable', field('contains', { searchable: true })],
      ];
      let policy = await compileHolding(
        [{ operation: 'query', where: OWN }],
        Object.fromEntries(
          ways.map(([name, redeclaration]) => [
            name,
            classroomSubtype(name, { providerId: redeclaration }),
          ]),
        ),
      );
      let [grant] = grantsOf(policy);
      assert.deepEqual(misreadings(grant), {
        providerId: ['Absent', 'Computed', 'Listed', 'QueryBacked', 'Retyped'],
      });
    });

    test('a path through a contained value is compared field by field in the two types, and a link read for its id reads alike whatever it links to', async function (assert) {
      let { cache, definitions, held } = setup([
        { operation: 'query', where: '.address.city == "Springfield"' },
        { operation: 'query', where: `.lead.id == "${EDUCATION}people/p1"` },
      ]);
      let postal = { module: ADDRESS.module, name: 'PostalAddress' };
      let computedCity = {
        module: ADDRESS.module,
        name: 'ComputedCityAddress',
      };
      definitions.set(postal.name, {
        ...definition(postal, {
          city: field('contains'),
          postcode: field('contains'),
        }),
        type: 'field-def',
      });
      definitions.set(computedCity.name, {
        ...definition(computedCity, {
          city: field('contains', { isComputed: true }),
        }),
        type: 'field-def',
      });
      let redeclaring: [string, Record<string, FieldDefinition>][] = [
        [
          'PostalClassroom',
          {
            address: field('contains', {
              isPrimitive: false,
              fieldOrCard: postal,
            }),
          },
        ],
        [
          'ComputedCityClassroom',
          {
            address: field('contains', {
              isPrimitive: false,
              fieldOrCard: computedCity,
            }),
          },
        ],
        [
          'RelinkedClassroom',
          {
            lead: field('linksTo', {
              isPrimitive: false,
              fieldOrCard: CLASSROOM,
            }),
          },
        ],
        [
          'QueriedLeadClassroom',
          {
            lead: field('linksTo', {
              isPrimitive: false,
              fieldOrCard: PERSON,
              query: { filter: { type: PERSON } },
            }),
          },
        ],
      ];
      for (let [name, fields] of redeclaring) {
        definitions.set(name, classroomSubtype(name, fields));
        held.push(subtype(name));
      }
      let [city, lead] = grantsOf((await cache.get())!);
      assert.deepEqual(
        misreadings(city),
        { 'address.city': ['ComputedCityClassroom'] },
        'an address of another type that stores `city` as `Address` does reads alike, and one that computes it does not',
      );
      assert.deepEqual(
        misreadings(lead),
        { 'lead.id': ['QueriedLeadClassroom'] },
        'a link to another type reads its id alike, and a link filled by a query does not',
      );
    });

    test('a grant judged against the snapshot reads a field computed in one type and stored in the other alike, and an annotated grant that reads only stored fields is judged as the stored source is', async function (assert) {
      let policy = await compileHolding(
        [
          { operation: 'query', where: { bxl: OWN, snapshot: true } },
          {
            operation: 'query',
            where: { bxl: '.summary == "open"', snapshot: true },
          },
          { operation: 'query', where: OWN },
        ],
        {
          [COMPUTED.name]: classroomSubtype(COMPUTED.name, {
            providerId: COMPUTED_PROVIDER,
          }),
          StoredSummaryClassroom: classroomSubtype('StoredSummaryClassroom', {
            summary: field('contains'),
          }),
          RetypedClassroom: classroomSubtype('RetypedClassroom', {
            providerId: field('contains', { fieldOrCard: TEXT_AREA_FIELD }),
          }),
        },
      );
      assert.deepEqual(policy.issues, []);
      let [annotatedOwn, snapshotSummary, own] = grantsOf(policy);
      assert.deepEqual(
        [annotatedOwn.where?.snapshot, snapshotSummary.where?.snapshot],
        [false, true],
        '`Classroom` stores `providerId` and computes `summary`, so only the grant reading `summary` is judged against the snapshot',
      );
      assert.deepEqual(
        misreadings(annotatedOwn),
        { providerId: [COMPUTED.name, 'RetypedClassroom'] },
        'the annotated grant reading only a stored field records the descendant that computes `providerId`, as the unannotated grant does',
      );
      assert.strictEqual(
        misreadings(snapshotSummary),
        undefined,
        'a descendant that stores what `Classroom` computes is read alike by the grant judged against the snapshot',
      );
      assert.deepEqual(
        misreadings(own),
        { providerId: [COMPUTED.name, 'RetypedClassroom'] },
        'and the same predicate unannotated records both',
      );
    });

    test('a comparison is kept from judging the cards of a type that misreads its path, and every other comparison of the filter still judges them', async function (assert) {
      let policy = await compileHolding(
        [{ operation: 'query', where: `${OWN} or .roomNumber > 200` }],
        {
          [COMPUTED.name]: classroomSubtype(COMPUTED.name, {
            providerId: COMPUTED_PROVIDER,
          }),
        },
      );
      let [grant] = grantsOf(policy);
      assert.deepEqual(misreadings(grant), { providerId: [COMPUTED.name] });

      let computed = { type: COMPUTED };
      let filter: Filter = {
        on: CLASSROOM,
        any: [
          { eq: { providerId: TEACHER } },
          { not: { eq: { providerId: 'nobody' } } },
          { range: { roomNumber: { gt: 200 } } },
        ],
      };
      assert.deepEqual(
        withoutMisreadings(filter, grant),
        {
          on: CLASSROOM,
          any: [
            {
              every: [
                { eq: { providerId: TEACHER } },
                { not: { any: [computed] } },
              ],
            },
            {
              not: {
                any: [{ eq: { providerId: 'nobody' } }, { any: [computed] }],
              },
            },
            { range: { roomNumber: { gt: 200 } } },
          ],
        },
        'where the comparison would admit a card it admits none of the type, under a `not` it refuses all of them, and the `roomNumber` branch judges them as before',
      );
      assert.strictEqual(
        withoutMisreadings(filter, {}),
        filter,
        'a grant with nothing misread leaves its filter untouched',
      );
    });

    test('a descendant that redeclares a path back as the rule type declares it keeps its cards, though a type it descends from misreads the path', async function (assert) {
      let { cache, definitions, chains, held } = setup([
        { operation: 'query', where: OWN },
      ]);
      let typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;
      let computing = subtype('ComputingClassroom');
      let restoring = subtype('RestoringClassroom');
      definitions.set(
        computing.name,
        classroomSubtype(computing.name, { providerId: COMPUTED_PROVIDER }),
      );
      definitions.set(restoring.name, classroomSubtype(restoring.name));
      chains.set(restoring.name, [
        typeKey(restoring),
        typeKey(computing),
        typeKey(CLASSROOM),
      ]);
      held.push(computing, restoring);
      let [grant] = grantsOf((await cache.get())!);
      assert.deepEqual(misreadings(grant), {
        providerId: ['ComputingClassroom (keeping RestoringClassroom)'],
      });
      assert.deepEqual(
        withoutMisreadings(
          { on: CLASSROOM, eq: { providerId: TEACHER } },
          grant,
        ),
        {
          every: [
            { on: CLASSROOM, eq: { providerId: TEACHER } },
            {
              not: {
                any: [
                  {
                    every: [
                      { type: computing },
                      { not: { any: [{ type: restoring }] } },
                    ],
                  },
                ],
              },
            },
          ],
        },
      );
    });

    test('a descendant whose definition cannot be read is recorded against every path a filter compares', async function (assert) {
      let policy = await compileHolding(
        [{ operation: 'query', where: OWN }, { operation: 'query' }],
        { UnreadableClassroom: undefined },
      );
      let [own, unconditional] = grantsOf(policy);
      assert.deepEqual(misreadings(own), {
        providerId: ['UnreadableClassroom'],
      });
      assert.strictEqual(
        misreadings(unconditional),
        undefined,
        'a filter comparing no field reads nothing a descendant could declare differently',
      );
    });

    test('a descendant whose key names it in a shape the index-key parser refuses is recorded all the same', async function (assert) {
      let { cache, definitions, heldKeys } = setup([
        { operation: 'query', where: OWN },
        { operation: 'query' },
      ]);
      // A module under a `fields/` directory, and an unexported class named
      // through the type it adopts from.
      let underFields = {
        module: rri(`${EDUCATION}fields/subtypes`),
        name: COMPUTED.name,
      };
      definitions.set(
        COMPUTED.name,
        classroomSubtype(COMPUTED.name, { providerId: COMPUTED_PROVIDER }),
      );
      heldKeys.push(
        `${underFields.module}/${underFields.name}`,
        `${SUBTYPES_MODULE}/HiddenClassroom/ancestor`,
      );
      let policy = (await cache.get())!;
      assert.deepEqual(policy.issues, []);
      let [own, unconditional] = grantsOf(policy);
      assert.deepEqual(own.misreadingTypes, [
        {
          path: 'providerId',
          types: [
            { type: underFields },
            {
              type: {
                type: 'ancestorOf',
                card: { module: SUBTYPES_MODULE, name: 'HiddenClassroom' },
              },
            },
          ],
        },
      ]);
      assert.strictEqual(unconditional.misreadingTypes, undefined);
    });

    test('a descendant no type filter can name leaves the grants whose filters compare a field scoping no search', async function (assert) {
      let { cache, heldKeys } = setup([
        { operation: 'query', where: OWN },
        { operation: 'query' },
      ]);
      heldKeys.push('unnamed');
      let policy = (await cache.get())!;
      assert.deepEqual(
        policy.issues.map(({ code, path }) => ({ code, path })),
        [{ code: 'policy-not-filterable', path: 'rules[0].grants[0].where' }],
      );
      let [own, unconditional] = grantsOf(policy);
      assert.strictEqual(own.filter, undefined, 'the grant has no filter');
      assert.ok(own.where, 'and keeps its predicate');
      assert.ok(
        unconditional.filter,
        'a grant whose filter compares no field keeps its filter',
      );
    });

    test('a revalidation reads what the realm holds under the rule type again only once the types the realm holds cards of have changed', async function (assert) {
      let { cache, held, unrelated, state } = setup([
        { operation: 'query', where: OWN },
      ]);
      await cache.get();
      assert.strictEqual(state.asked, 1, 'compiling reads it once');

      // An edit to a card leaves the realm holding cards of the same types.
      noteRealmIndexMoved(GOVERNED);
      await until(
        () => cache.stats.revalidations === 1,
        'the move revalidates',
      );
      assert.strictEqual(
        state.asked,
        1,
        'an unchanged set of types is not read past',
      );

      unrelated.push(`${rri(`${EDUCATION}notices`)}/Notice`);
      noteRealmIndexMoved(GOVERNED);
      await until(
        () => cache.stats.revalidations === 2,
        'the next move revalidates',
      );
      assert.strictEqual(state.asked, 2, 'a changed one is');
      assert.strictEqual(
        cache.stats.compiles,
        1,
        'and nothing it holds changed',
      );

      noteRealmIndexMoved(GOVERNED);
      await until(
        () => cache.stats.revalidations === 3,
        'the last move revalidates',
      );
      assert.strictEqual(
        state.asked,
        2,
        'the set it read is kept, so the same set is not read past again',
      );

      held.push(COMPUTED);
      noteRealmIndexMoved(GOVERNED);
      await until(() => cache.stats.compiles === 2, 'the change recompiles');
    });

    test("a grant comparing the card's own id reads it as every card type does", async function (assert) {
      let policy = await compileHolding(
        [{ operation: 'query', where: `.id == "${EDUCATION}classrooms/1"` }],
        {
          [COMPUTED.name]: classroomSubtype(COMPUTED.name, {
            providerId: COMPUTED_PROVIDER,
          }),
        },
      );
      assert.deepEqual(policy.issues, []);
      let [grant] = grantsOf(policy);
      assert.strictEqual(
        misreadings(grant),
        undefined,
        'a descendant inherits `id` as `Classroom` declares it, so nothing is recorded',
      );
    });

    test('a grant whose rule type has no descendant declaring its paths differently compiles as it would with no descendant at all, and a policy whose filters compare no field never asks what the realm holds', async function (assert) {
      let alone = await compile([{ operation: 'query', where: OWN }]);
      let withElective = await compileHolding(
        [{ operation: 'query', where: OWN }],
        {
          [ELECTIVE.name]: classroomSubtype(ELECTIVE.name, {
            elective: field('contains'),
          }),
        },
      );
      assert.deepEqual(grantsOf(withElective), grantsOf(alone));
      assert.false(
        'misreadingTypes' in grantsOf(withElective)[0],
        'the grant carries no record of misreading types at all',
      );

      let { cache, state } = setup([
        { operation: 'read', where: OWN },
        { operation: 'query' },
      ]);
      await cache.get();
      assert.strictEqual(state.asked, 0);
    });

    test("what a grant records follows the governed realm's cards and its descendants' definitions", async function (assert) {
      let { cache, definitions, held } = setup([
        { operation: 'query', where: OWN },
      ]);
      definitions.set(COMPUTED.name, classroomSubtype(COMPUTED.name));
      let [before] = grantsOf((await cache.get())!);
      assert.strictEqual(misreadings(before), undefined, 'nothing to record');

      // A card of a descendant appears in the governed realm. Only that
      // realm's move can reach the policy: its card and its types live in other
      // realms.
      held.push(COMPUTED);
      noteRealmIndexMoved(GOVERNED);
      await until(() => cache.stats.compiles === 2, 'the move recompiles');
      let [added] = grantsOf((await cache.get())!);
      assert.strictEqual(
        misreadings(added),
        undefined,
        'a descendant declaring `providerId` as `Classroom` does is not recorded',
      );

      definitions.set(
        COMPUTED.name,
        classroomSubtype(COMPUTED.name, { providerId: COMPUTED_PROVIDER }),
      );
      noteRealmIndexMoved(EDUCATION);
      await until(() => cache.stats.compiles === 3, 'the next move recompiles');
      let [redeclared] = grantsOf((await cache.get())!);
      assert.deepEqual(
        misreadings(redeclared),
        { providerId: [COMPUTED.name] },
        'once it computes `providerId`, it is',
      );

      held.length = 0;
      noteRealmIndexMoved(GOVERNED);
      await until(() => cache.stats.compiles === 4, 'the last move recompiles');
      let [emptied] = grantsOf((await cache.get())!);
      assert.strictEqual(
        misreadings(emptied),
        undefined,
        'and once the realm holds none of its cards, nothing is recorded',
      );
    });
  });
});
