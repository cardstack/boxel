import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  FilterRefersToNonexistentTypeError,
  realmPolicyRef,
  rri,
  type CompiledOperationGrant,
  type CompiledRealmPolicy,
  type Definition,
  type FieldDefinition,
  type IndexedInstanceSource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { RealmPolicyCache } from '@cardstack/runtime-common/card-operations';
import { classifiedFilterBuiltins } from '@cardstack/runtime-common/card-operations/policy-tiers';
import { BXL_REGISTRY } from '@cardstack/bxl/bxl/registry/index';
import { loadAllFormulaExtensions } from '@cardstack/bxl/bxl/bridge/lazy-formulas';

// Which tier a grant's predicate reads, decided when the policy compiles:
// driven through the compiled-policy cache over an environment held in
// memory, with no realm, no database and no prerender.
const ORG = 'http://policy-tiers.test/org/';
const EDUCATION = 'http://policy-tiers.test/education/';
const POLICY_CARD = `${ORG}policies/education`;

const CLASSROOM: ResolvedCodeRef = {
  module: rri(`${EDUCATION}classroom`),
  name: 'Classroom',
};
const ADDRESS: ResolvedCodeRef = {
  module: rri(`${EDUCATION}address`),
  name: 'Address',
};
const FLAGS: ResolvedCodeRef = {
  module: rri(`${EDUCATION}flags`),
  name: 'Flags',
};
const ACTIVITY: ResolvedCodeRef = {
  module: rri(`${EDUCATION}activity`),
  name: 'Activity',
};
const PERSON: ResolvedCodeRef = {
  module: rri(`${EDUCATION}person`),
  name: 'Person',
};
const SCHOOL: ResolvedCodeRef = {
  module: rri(`${EDUCATION}school`),
  name: 'School',
};
const STRING_FIELD = {
  module: rri('@cardstack/base/card-api'),
  name: 'StringField',
};

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

function compound(fieldOrCard: ResolvedCodeRef) {
  return field('contains', { isPrimitive: false, fieldOrCard });
}

function link(
  fieldOrCard: ResolvedCodeRef,
  type: 'linksTo' | 'linksToMany',
  overrides: Partial<FieldDefinition> = {},
) {
  return field(type, { isPrimitive: false, fieldOrCard, ...overrides });
}

function definition(
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldDefinition>,
  type: Definition['type'] = 'card-def',
): Definition {
  let names: Definition['fields'] = {};
  let fieldDefs: Definition['fieldDefs'] = {};
  for (let [name, def] of Object.entries(fields)) {
    names[name] = name;
    fieldDefs[name] = def;
  }
  return {
    type,
    codeRef,
    displayName: codeRef.name,
    fields: names,
    fieldDefs,
    operations: { listMine: { base: 'query', deterministic: true } },
  };
}

// A classroom stores its status, its roster of teacher ids, an address, its
// flags and a list of activities, and links to a lead teacher (searchable), a
// mentor (not searchable), a coach (annotated `searchable` with no route), its
// teachers (a list of links) and a query-filled roll. Its summary is
// computed, as is a line of its address, the first of its flags and a label
// on each activity. A person links to their school.
const DEFINITIONS = new Map<string, Definition>([
  [
    CLASSROOM.name,
    definition(CLASSROOM, {
      id: field('contains'),
      status: field('contains'),
      teacherIds: field('containsMany'),
      summary: field('contains', { isComputed: true }),
      address: compound(ADDRESS),
      activities: field('containsMany', {
        isPrimitive: false,
        fieldOrCard: ACTIVITY,
      }),
      flags: compound(FLAGS),
      lead: link(PERSON, 'linksTo', { searchable: true }),
      mentor: link(PERSON, 'linksTo'),
      coach: link(PERSON, 'linksTo', { searchable: [] }),
      teachers: link(PERSON, 'linksToMany', { searchable: true }),
      honorRoll: link(PERSON, 'linksToMany', {
        query: { filter: { type: PERSON } },
      }),
    }),
  ],
  [
    ADDRESS.name,
    definition(
      ADDRESS,
      {
        street: field('contains'),
        line: field('contains', { isComputed: true }),
      },
      'field-def',
    ),
  ],
  [
    FLAGS.name,
    definition(
      FLAGS,
      {
        verified: field('contains', { isComputed: true }),
        note: field('contains'),
      },
      'field-def',
    ),
  ],
  [
    ACTIVITY.name,
    definition(
      ACTIVITY,
      {
        note: field('contains'),
        label: field('contains', { isComputed: true }),
      },
      'field-def',
    ),
  ],
  [
    PERSON.name,
    definition(PERSON, {
      id: field('contains'),
      name: field('contains'),
      fullName: field('contains', { isComputed: true }),
      school: link(SCHOOL, 'linksTo', { searchable: true }),
    }),
  ],
  [
    SCHOOL.name,
    definition(SCHOOL, { id: field('contains'), name: field('contains') }),
  ],
]);

type Where = string | { bxl: string; snapshot: boolean };
type Grant = { operation: string; where?: Where };

async function compile(grants: Grant[]): Promise<CompiledRealmPolicy> {
  let typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;
  let policyKey = typeKey(realmPolicyRef);
  let cache = new RealmPolicyCache({
    policyCard: async () => POLICY_CARD,
    readCard: async (): Promise<IndexedInstanceSource> => ({
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
      codeRef.module === CLASSROOM.module ? CLASSROOM : undefined,
    lookupDefinitionEntry: async (codeRef) => {
      let found = DEFINITIONS.get(codeRef.name);
      if (!found) {
        throw new FilterRefersToNonexistentTypeError(
          codeRef as ResolvedCodeRef,
        );
      }
      return { definition: found, types: [typeKey(codeRef)] };
    },
    toURL: (identifier) => new URL(identifier),
    isPolicyCard: (types) => types.includes(policyKey),
    typeKey,
  });
  let policy = await cache.get();
  if (!policy) {
    throw new Error('the realm has no policy');
  }
  return policy;
}

// What one `read` grant with `where` compiles to.
async function compiled(where: Where) {
  let policy = await compile([{ operation: 'read', where }]);
  let [grant] = policy.rules.flatMap((rule) => rule.grants) as (
    | CompiledOperationGrant
    | undefined
  )[];
  return {
    grant,
    issues: policy.issues.map(({ code, path }) => ({ code, path })),
    message: policy.issues[0]?.message ?? '',
  };
}

const ISSUE = [
  { code: 'unsnapshotted-policy-read', path: 'rules[0].grants[0].where' },
];

// Predicates that read only the card's stored source: its own values, its
// contained values, and the ids its links hold.
const STORED = [
  '.teacherIds | any(. == actor())',
  '.status == "open"',
  '.address.street == "Main"',
  '.activities | any(.note == "field trip")',
  '.lead.id == actor()',
  '.mentor.id == actor()',
  '.teachers | any(.id == actor())',
  '.teachers | length > 0',
  '.lead == null',
  'instance().teacherIds | length > 0',
  'instance("status") == "open"',
  '. as $room | .teachers | any(.id == $room.lead.id)',
  'IF(.status == "open"; true; false)',
  '.status | ascii_downcase == "open"',
  'has("status")',
  '.teacherIds[0] == realmConfig("approver")',
  '.status | IN("open", "closed")',
  '.flags.note',
];

// Predicates that read a computed value or a linked card's field, each of
// which the snapshot holds.
const SNAPSHOT: [string, RegExp][] = [
  ['.summary == actor()', /`\.summary` is computed/],
  ['.address.line == "1 Main St"', /`\.address\.line` is computed/],
  ['.lead.name == "Ada"', /`\.lead\.name` is a field of the card `\.lead`/],
  [
    '.lead.fullName == "Ada Lovelace"',
    /`\.lead\.fullName` is a field of the card `\.lead`/,
  ],
  ['.lead.school.id == "x"', /`\.lead\.school` is a field of the card/],
  ['. as $room | $room.summary == actor()', /`\.summary` is computed/],
  ['{ s: .summary } | .s == actor()', /`\.summary` is computed/],
  ['has("summary")', /`\.summary` is computed/],
  // Read whole, a value is read with everything beneath it.
  ['.address == {}', /`\.address` is read whole/],
  ['.lead | tostring | length > 0', /`\.lead` is read whole/],
  ['tostring | length > 0', /`\.` is read whole/],
  ['[.[]] | length > 0', /`\.` is read whole/],
  ['with_entries(select(.value == 1)) | length > 0', /`\.` is read whole/],
  // A predicate holds where its output is `true`, so its output is read.
  ['first(.flags[])', /`\.flags` is read whole/],
  ['.flags | first(.[])', /`\.flags` is read whole/],
  ['[.flags[]][0]', /`\.flags` is read whole/],
  ['.flags.verified', /`\.flags\.verified` is computed/],
  // `IN` compares its input whole with each value it is given.
  ['.flags | IN({ verified: null, note: null })', /`\.flags` is read whole/],
  ['.lead | IN({ id: "x" })', /`\.lead` is read whole/],
];

// Predicates that read a value outside the stored source that no snapshot
// holds, so the annotation cannot supply it.
const UNHELD: [string, RegExp][] = [
  ['.mentor.name == "Ada"', /`\.mentor` is not marked `searchable`/],
  ['.coach.name == "Ada"', /`\.coach` is not marked `searchable`/],
  ['.teachers | any(.name == "Ada")', /`\.teachers` is a list of links/],
  ['.activities | any(.label == "trip")', /computed inside a list/],
  ['.honorRoll | length > 0', /`\.honorRoll` is filled by a query/],
  ['.lead.school.name == "x"', /`\.lead\.school` is a link of a linked card/],
  ['instance().summary == actor()', /`instance\(\)` holds the card's stored/],
];

module(basename(import.meta.filename), function () {
  test('a predicate that reads the stored source compiles with no issue, and is judged against the stored source even where it is annotated', async function (assert) {
    for (let source of STORED) {
      for (let where of [source, { bxl: source, snapshot: true }]) {
        let { grant, issues } = await compiled(where);
        assert.deepEqual(issues, [], `${source}: no issue`);
        assert.deepEqual(
          { snapshot: grant?.where?.snapshot },
          { snapshot: false },
          `${source}${typeof where === 'string' ? '' : ' (annotated)'}: judged against the stored source`,
        );
      }
    }
  });

  test('a predicate that reads a computed value or a linked card’s field without the annotation records `unsnapshotted-policy-read`, and compiles no grant', async function (assert) {
    for (let [source, reason] of SNAPSHOT) {
      let { grant, issues, message } = await compiled(source);
      assert.deepEqual(issues, ISSUE, source);
      assert.strictEqual(grant, undefined, `${source}: no grant compiles`);
      assert.true(reason.test(message), `${source}: ${message}`);
      assert.true(
        /\{ bxl, snapshot: true \}/.test(message),
        `${source}: the message names the annotation`,
      );
    }
  });

  test('annotated, the same predicate compiles, and is judged against the snapshot', async function (assert) {
    for (let [source] of SNAPSHOT) {
      let { grant, issues } = await compiled({ bxl: source, snapshot: true });
      assert.deepEqual(issues, [], `${source}: no issue`);
      assert.deepEqual(
        grant?.where,
        { source, canonical: grant?.where?.canonical, snapshot: true },
        `${source}: judged against the snapshot`,
      );
    }
  });

  test('a predicate that reads a value no snapshot holds records `unsnapshotted-policy-read`, annotated or not', async function (assert) {
    for (let [source, reason] of UNHELD) {
      for (let where of [source, { bxl: source, snapshot: true }]) {
        let { grant, issues, message } = await compiled(where);
        assert.deepEqual(issues, ISSUE, source);
        assert.strictEqual(grant, undefined, `${source}: no grant compiles`);
        assert.true(reason.test(message), `${source}: ${message}`);
        assert.true(
          /no snapshot holds/.test(message),
          `${source}: the message says no snapshot holds it`,
        );
      }
    }
  });

  test('a grant whose predicate reads the index without saying so is left out, and the rest of the policy applies', async function (assert) {
    let policy = await compile([
      { operation: 'read', where: '.teacherIds | any(. == actor())' },
      { operation: 'update', where: '.summary == actor()' },
      {
        operation: 'delete',
        where: { bxl: '.lead.name == "Ada"', snapshot: true },
      },
      { operation: 'readSource' },
    ]);
    assert.deepEqual(
      policy.issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'unsnapshotted-policy-read', path: 'rules[0].grants[1].where' }],
    );
    assert.deepEqual(
      policy.rules[0].grants.map(({ operation, path, where }) => ({
        operation,
        path,
        snapshot: where?.snapshot,
      })),
      [
        { operation: 'read', path: 'rules[0].grants[0]', snapshot: false },
        { operation: 'delete', path: 'rules[0].grants[2]', snapshot: true },
        {
          operation: 'readSource',
          path: 'rules[0].grants[3]',
          snapshot: undefined,
        },
      ],
    );
  });

  test('a create grant judged against the snapshot records `unsnapshotted-policy-read`, since the card a create mints has no index row', async function (assert) {
    let policy = await compile([
      {
        operation: 'create',
        where: { bxl: '.summary == actor()', snapshot: true },
      },
      { operation: 'create', where: '.status == "open"' },
    ]);
    assert.deepEqual(
      policy.issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'unsnapshotted-policy-read', path: 'rules[0].grants[0].where' }],
    );
    assert.true(
      /judged by the card it would mint/.test(policy.issues[0]?.message ?? ''),
      policy.issues[0]?.message,
    );
    assert.deepEqual(
      policy.rules[0].grants.map(({ path }) => path),
      ['rules[0].grants[1]'],
      'a create grant that reads the stored source compiles',
    );
  });

  test('a query grant that reads the index without the annotation records `unsnapshotted-policy-read`, never `policy-not-filterable`, and contributes no filter', async function (assert) {
    for (let source of ['.summary == actor()', '.lead.name == "Ada"']) {
      let policy = await compile([{ operation: 'query', where: source }]);
      assert.deepEqual(
        policy.issues.map(({ code }) => code),
        ['unsnapshotted-policy-read'],
        source,
      );
      assert.deepEqual(policy.rules[0].grants, [], `${source}: no grant`);
    }
    let annotated = await compile([
      {
        operation: 'query',
        where: { bxl: '.lead.name == "Ada"', snapshot: true },
      },
    ]);
    assert.deepEqual(
      annotated.issues.map(({ code }) => code),
      ['policy-not-filterable'],
      'annotated, a read the filter cannot say is `policy-not-filterable`, as ever',
    );
  });

  test('every jq-defined builtin with a filter argument is one the walk knows where its arguments run', async function (assert) {
    await loadAllFormulaExtensions();
    let known = classifiedFilterBuiltins();
    let unknown: string[] = [];
    let seen = 0;
    for (let [library, { jq }] of Object.entries(BXL_REGISTRY)) {
      for (let [name, def] of Object.entries(jq)) {
        let args = (def as { args?: { type: string }[] }).args ?? [];
        if (!args.some((arg) => arg.type === 'filterArg')) {
          continue;
        }
        seen++;
        if (!known.has(name)) {
          unknown.push(`${library}: ${name}`);
        }
      }
    }
    assert.true(
      seen > 0,
      `the registry has builtins with filter arguments (${seen})`,
    );
    assert.deepEqual(
      unknown,
      [],
      'a builtin missing here would have its filter arguments read over its own input',
    );
  });
});
