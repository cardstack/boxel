import { prepareBxlMutation } from '@cardstack/bxl/mutation';
import { mutationSchemaForCardSource } from '@cardstack/bxl/mutation';

import { lowerOperationDeclarations } from '../card-operations/index.ts';
import type { CodeRef } from '../code-ref.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';
import type { SharedTests } from '../helpers/index.ts';

// ============================================================================
// Whether the BXL lowering emits can actually be carried out.
//
// The golden-output tests assert the program *text*, and a program can be
// perfectly well-formed text that no executor will run: a write to a field the
// executor treats as read-only, an assignment replacing a whole relationship
// collection, a path that indexes an array with a string. Each of those parses
// cleanly and then fails at plan time, which means the operation reaches the
// definition cache looking valid and fails on every invocation instead.
//
// So this suite closes the loop the other direction: build the executor's own
// mutation schema from the same `Definition` lowering was given, then hand it
// every program lowering produced. A form lowering emits has to plan *and*
// plan a change, since a write the executor silently drops is the quieter
// version of the same bug; a form lowering refuses has to be one the executor
// would have rejected or dropped. Nothing here asserts program text — that is
// the golden tests' job.
//
// The definitions are built by hand rather than from card classes: what the
// executor's schema is derived from is `fields` + `fieldDefs`, so a literal
// one exercises the same path without a loader, a realm, or a base realm.
// ============================================================================

const MODULE = 'http://example.com/cards/report';
const ref = (name: string) => ({ module: MODULE, name }) as CodeRef;
const refKey = (codeRef: any) => `${codeRef.module}/${codeRef.name}`;

function definition(
  name: string,
  fields: Record<string, FieldDefinition>,
): Definition {
  let fieldMap: Definition['fields'] = {};
  let fieldDefs: Definition['fieldDefs'] = {};
  let index = 0;
  for (let [fieldName, fieldDef] of Object.entries(fields)) {
    let id = `f${index++}`;
    fieldMap[fieldName] = id;
    fieldDefs[id] = fieldDef;
  }
  return {
    type: 'card-def',
    codeRef: ref(name),
    displayName: name,
    fields: fieldMap,
    fieldDefs,
  };
}

const scalar = (over: Partial<FieldDefinition> = {}): FieldDefinition => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: ref('StringField'),
  ...over,
});

const compound = (
  name: string,
  over: Partial<FieldDefinition> = {},
): FieldDefinition => ({
  type: 'contains',
  isPrimitive: false,
  isComputed: false,
  fieldOrCard: ref(name),
  ...over,
});

const Author = definition('Author', { name: scalar() });
const Comment = definition('Comment', {
  body: scalar(),
  author: compound('Author', { type: 'linksTo' }),
});

const Report = definition('Report', {
  id: scalar(),
  title: scalar(),
  status: scalar(),
  slug: scalar({ isComputed: true }),
  tags: scalar({ type: 'containsMany' }),
  comments: compound('Comment', { type: 'containsMany' }),
  owner: compound('Author', { type: 'linksTo' }),
  reviewers: compound('Author', { type: 'linksToMany', searchable: true }),
  // Query-backed: `isComputed` stays false, and the executor's schema still
  // marks it unwritable.
  featured: compound('Author', {
    type: 'linksTo',
    query: { filter: { type: ref('Author') } },
  }),
});

const graph = new Map<string, Definition>([
  [refKey(ref('Author')), Author],
  [refKey(ref('Comment')), Comment],
]);

const lookupDefinition = async (codeRef: CodeRef) => graph.get(refKey(codeRef));

// A field class stands in for the real one: lowering only ever asks
// `identifyCard` for its code ref.
const StringFieldClass = function StringField() {} as unknown as never;

const params = (key: string) => ({ $ref: 'params', key }) as never;
const actor = (key?: string) =>
  (key === undefined ? { $ref: 'actor' } : { $ref: 'actor', key }) as never;

async function lower(declarations: Record<string, unknown>) {
  return await lowerOperationDeclarations(declarations as never, {
    definition: Report,
    lookupDefinition,
    identifyCard: (def) =>
      (def as unknown) === StringFieldClass ? ref('StringField') : undefined,
  });
}

// The executor's view of `Report`, derived from the very same definition.
async function executorSchema() {
  return await mutationSchemaForCardSource(Report as never, {
    lookupDefinition: lookupDefinition as never,
  });
}

const SNAPSHOT = {
  title: 'a title',
  status: 'open',
  tags: ['already'],
  comments: [{ body: 'a comment', author: null }],
  owner: null,
  reviewers: [],
  featured: null,
};

const ACTOR_ID = 'http://example.com/cards/author/1';

const PLAN_CONTEXT = {
  programId: 'operation-lowering-test',
  targetId: 'http://example.com/cards/report/1',
  context: {
    params: {
      value: 'a value',
      who: ACTOR_ID,
    },
    actor: { id: ACTOR_ID },
  },
  cards: {
    [ACTOR_ID]: { id: ACTOR_ID },
  },
};

// What the executor does with `source`: the error it raises, the number of
// changes it plans, or the error text when planning throws.
async function planOutcome(
  source: string,
  snapshot: Record<string, unknown> = SNAPSHOT,
): Promise<{ rejected: string } | { affected: number }> {
  try {
    let prepared = prepareBxlMutation(source, {
      schema: await executorSchema(),
      targetKind: 'card',
      syntax: 'solidified',
    });
    let plan = prepared.plan(snapshot as never, PLAN_CONTEXT as never);
    return { affected: plan.affected };
  } catch (err: any) {
    return { rejected: `${err?.code ?? 'error'}: ${err?.message ?? err}` };
  }
}

// Every clause form whose lowered program the executor is expected to run.
// `writes` says whether the clause changes data: a `set` or an `append` has to
// plan a change, while an `assert` is a precondition and correctly plans
// none — so only the writes are held to changing something.
//
// A relationship nested inside an appended contained value is deliberately
// absent: that lowers to `card(…)` inside an object literal, and the planner
// recognizes that marker only as a whole value expression, so resolving it is
// the executor's remaining work rather than lowering's.
const EXECUTABLE_DECLARATIONS: {
  name: string;
  writes: boolean;
  declaration: unknown;
}[] = [
  {
    name: 'setScalar',
    writes: true,
    declaration: {
      base: 'transform',
      params: { value: StringFieldClass },
      set: { status: params('value') },
    },
  },
  {
    name: 'setLink',
    writes: true,
    declaration: { base: 'transform', set: { owner: actor() } },
  },
  {
    name: 'appendScalarItem',
    writes: true,
    declaration: {
      base: 'transform',
      params: { value: StringFieldClass },
      append: { to: 'tags', value: params('value') },
    },
  },
  {
    name: 'appendLinkItem',
    writes: true,
    declaration: {
      base: 'transform',
      params: { who: StringFieldClass },
      append: { to: 'reviewers', value: params('who') },
    },
  },
  {
    name: 'assertContained',
    writes: false,
    declaration: {
      base: 'transform',
      params: { value: StringFieldClass },
      assert: { unique: 'tags', by: params('value') },
    },
  },
  {
    name: 'assertLinked',
    writes: false,
    declaration: {
      base: 'transform',
      params: { who: StringFieldClass },
      assert: { unique: 'reviewers', by: params('who'), snapshot: true },
    },
  },
  {
    name: 'assertLinkedByActor',
    writes: false,
    declaration: {
      base: 'transform',
      assert: { unique: 'reviewers', by: actor(), snapshot: true },
    },
  },
];

// Each declaration lowering refuses, paired with the finding it records and
// with what the executor does to the program lowering would otherwise have
// emitted. `rejects` means planning throws; `no-ops` means planning succeeds
// and changes nothing, which is the worse of the two for an author — the
// operation reports success while the write they wrote never happened. Either
// way the finding is tracking a real restriction rather than a guess.
//
// `emitsProgram` separates the two places a refusal can happen. A clause the
// executor could not carry out at all is dropped whole, so no program comes
// out; a bad *value* inside an otherwise sound clause is recorded and the
// statement is still assembled, since one unusable value in a multi-key `set`
// is not a reason to discard the rest. Either way the operation is flagged
// `invalid` and so is never run — what the table pins down is that the
// program the executor would have been handed is one it refuses.
const REFUSED_DECLARATIONS: {
  name: string;
  code: string;
  declaration: unknown;
  wouldBe: string;
  executor: 'rejects' | 'no-ops';
  emitsProgram?: true;
}[] = [
  {
    name: 'set replacing a whole link collection',
    executor: 'rejects',
    code: 'link-collection-replace',
    declaration: {
      base: 'transform',
      params: { who: StringFieldClass },
      set: { reviewers: [params('who')] },
    },
    wouldBe: '.reviewers=[card(params("who"))];',
  },
  {
    name: 'set on a query-backed field',
    executor: 'rejects',
    code: 'read-only-write',
    declaration: { base: 'transform', set: { featured: actor() } },
    wouldBe: '.featured=card(actor("id"));',
  },
  {
    name: 'set on id',
    executor: 'rejects',
    code: 'read-only-write',
    declaration: {
      base: 'transform',
      set: { id: 'http://example.com/cards/report/2' },
    },
    wouldBe: '.id="http://example.com/cards/report/2";',
  },
  {
    name: 'set through a collection',
    executor: 'rejects',
    code: 'path-crosses-collection',
    declaration: { base: 'transform', set: { 'comments.body': 'z' } },
    wouldBe: '.comments.body="z";',
  },
  {
    name: 'set on a computed field',
    executor: 'no-ops',
    code: 'computed-write',
    declaration: { base: 'transform', set: { slug: 'z' } },
    wouldBe: '.slug="z";',
  },
  {
    name: 'set on a link to something that is not an identity',
    executor: 'rejects',
    code: 'link-requires-identity',
    emitsProgram: true,
    declaration: { base: 'transform', set: { owner: { name: 'Ada' } } },
    wouldBe: '.owner={name:"Ada"};',
  },
  {
    // Clearing a link: the executor removes an edge with `del`, which refuses
    // a link that is already empty, so there is no spelling that clears
    // idempotently and the declaration is reported rather than approximated.
    name: 'set clearing a link',
    executor: 'rejects',
    code: 'link-requires-identity',
    emitsProgram: true,
    declaration: { base: 'transform', set: { owner: null } },
    wouldBe: '.owner=null;',
  },
  {
    name: 'append of something that is not an identity to a link collection',
    executor: 'rejects',
    code: 'link-requires-identity',
    emitsProgram: true,
    declaration: {
      base: 'transform',
      append: { to: 'reviewers', value: { name: 'Ada' } },
    },
    wouldBe: 'append(.reviewers;{name:"Ada"});',
  },
];

const tests = Object.freeze({
  'every program lowering emits can be planned by the executor': async (
    assert,
  ) => {
    let { operations, issues } = await lower(
      Object.fromEntries(
        EXECUTABLE_DECLARATIONS.map(({ name, declaration }) => [
          name,
          declaration,
        ]),
      ),
    );
    assert.deepEqual(
      issues,
      [],
      'the declarations lower with no findings to begin with',
    );
    for (let { name, writes } of EXECUTABLE_DECLARATIONS) {
      let source = operations[name]?.program?.source;
      assert.ok(source, `${name} lowered to a program`);
      let outcome = await planOutcome(source!);
      assert.notOk(
        'rejected' in outcome && outcome.rejected,
        `${name} plans: ${source}`,
      );
      if (writes) {
        // A write that plans but changes nothing is the silent-no-op failure
        // this suite exists to catch, so every write has to do work.
        assert.true(
          'affected' in outcome && outcome.affected > 0,
          `${name} plans a change rather than a no-op: ${source}`,
        );
      }
    }
  },

  'every declaration lowering refuses is one the executor would reject': async (
    assert,
  ) => {
    for (let {
      name,
      code,
      declaration,
      wouldBe,
      executor,
      emitsProgram,
    } of REFUSED_DECLARATIONS) {
      let { operations } = await lower({ candidate: declaration });
      let operation = operations.candidate;
      assert.true(operation.invalid, `${name} is refused`);
      assert.deepEqual(
        operation.issues?.map((issue) => issue.code),
        [code],
        `${name} records ${code}`,
      );
      if (emitsProgram) {
        assert.strictEqual(
          operation.program?.source,
          wouldBe,
          `${name} still assembles its statement`,
        );
      } else {
        assert.strictEqual(
          operation.program,
          undefined,
          `${name} emits no program`,
        );
      }
      // The other half of the contract: had lowering emitted the obvious
      // program instead, the executor would either have thrown or done
      // nothing. Without this the finding could be guarding a restriction
      // that does not exist.
      let outcome = await planOutcome(wouldBe);
      if (executor === 'rejects') {
        assert.ok(
          'rejected' in outcome && outcome.rejected,
          `the executor rejects ${wouldBe}, so refusing it is right`,
        );
      } else {
        assert.deepEqual(
          outcome,
          { affected: 0 },
          `the executor silently changes nothing for ${wouldBe}, so refusing it is right`,
        );
      }
    }
  },
  // Planning without error proves only that a program is runnable. An
  // assertion that compares a value which can never equal what it is compared
  // against — a whole actor record against the id string `.id` holds — plans
  // just as cleanly, holds for every item, and lets the duplicate it exists
  // to reject go straight in. So the precondition is checked both ways round:
  // it has to fire on a duplicate and it has to stay out of the way when
  // there is none.
  'an assert over a link collection fires on a duplicate and not otherwise':
    async (assert) => {
      let { operations, issues } = await lower({
        addReviewer: {
          base: 'transform',
          assert: { unique: 'reviewers', by: actor(), snapshot: true },
        },
      });
      assert.deepEqual(issues, [], 'the declaration lowers with no findings');
      let source = operations.addReviewer.program!.source;

      let onDuplicate = await planOutcome(source, {
        ...SNAPSHOT,
        reviewers: [{ id: ACTOR_ID }],
      });
      assert.ok(
        'rejected' in onDuplicate &&
          onDuplicate.rejected.includes('assertion-failed'),
        `the assertion fires when the actor is already linked: ${source}`,
      );
      assert.deepEqual(
        await planOutcome(source, {
          ...SNAPSHOT,
          reviewers: [{ id: 'http://example.com/cards/author/2' }],
        }),
        { affected: 0 },
        'and holds when someone else is linked',
      );
      assert.deepEqual(
        await planOutcome(source, { ...SNAPSHOT, reviewers: [] }),
        { affected: 0 },
        'and holds when nothing is linked',
      );
      assert.true(
        operations.addReviewer.snapshot,
        'the gathering the assertion depends on travels with the operation, since a program reads the stored document and a link collection is not in it',
      );
    },
}) as SharedTests<Record<string, never>>;

export default tests;
