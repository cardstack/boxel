import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { existsSync, readFileSync } from 'fs';

import { lowerOperationDeclarations } from '@cardstack/runtime-common/card-operations';
import type {
  OperationErrorCode,
  OperationLoweringIssueCode,
} from '@cardstack/runtime-common/card-operations';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type {
  Definition,
  FieldDefinition,
} from '@cardstack/runtime-common/definitions';

// Drift guard for the card-operations authoring skill.
//
// The skill teaches card authors a surface they cannot run the engine to
// check: which base operations a def type carries, which markers resolve
// where, and which declarations the realm refuses when it indexes the module.
// Each claim is pinned twice — the snippet the skill shows must still be on
// the page, and the behavior that snippet claims must still hold against the
// real lowering — so a rewrite that changes an example has to come through
// this file.
//
// The closed lists are held to the engine's own unions rather than to the
// cases below, because a doc checked only against the tests that describe it
// is a closed loop. `OperationLoweringIssueCode` and `OperationErrorCode` are
// types with no runtime table, so the exhaustiveness is a compile-time
// assignability check in both directions and the set equality against the
// skill's tables is asserted at run time from those same lists.
//
// What this does not cover, because a guard trusted past its reach is worse
// than none: prose. A snippet assertion proves the example is on the page,
// not that the sentence around it still says the right thing. The posture
// section and the guidance paragraphs are read by people, not by this file.

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const SKILL_PATH = join(
  REPO_ROOT,
  'packages/boxel-cli/plugin/skills/card-operations-authoring/SKILL.md',
);

// Paths the skill points an author at. A worked reference that has moved is a
// dead end for the reader, so the skill naming one is what requires it here.
const CITED_PATHS = [
  'packages/experiments-realm/clinical',
  'packages/experiments-realm/clinical/patient-record.gts',
];

// ---------------------------------------------------------------------------
// Exhaustiveness against the engine's own unions
// ---------------------------------------------------------------------------

// Checked in both directions, because either way round is a defect: a code the
// engine can record that the skill does not document leaves an author with an
// unexplained refusal, and a code the skill documents that the engine cannot
// record teaches a refusal that never happens. One alias per direction — a
// single two-sided constraint is circular by construction.
type Assignable<To, From extends To> = From;

const DOCUMENTED_LOWERING_CODES = [
  'unknown-field',
  'not-a-collection',
  'undeclared-param',
  'computed-write',
  'read-only-write',
  'link-collection-replace',
  'path-crosses-collection',
  'link-requires-identity',
  'write-through-link',
  'unsearchable-read',
  'unsnapshotted-assert',
  'unresolved-type',
  'actor-not-a-card',
  'invalid-program',
  'invalid-query',
  'reserved-name',
  'base-not-carried',
  'unrunnable-program',
  'incomplete-append',
  'instance-out-of-scope',
] as const;

const DOCUMENTED_ERROR_CODES = [
  'unknown-operation',
  'operation-not-allowed',
  'invalid-operation',
  'invalid-params',
  'target-not-found',
  'target-not-indexed',
  'target-errored',
  'assertion-failed',
  'version-conflict',
  'precondition-unverifiable',
  'actor-required',
  'payload-too-large',
  'wrong-entry-point',
  'conflicting-targets',
  'internal-error',
] as const;

export type EveryDocumentedLoweringCodeIsReal = Assignable<
  OperationLoweringIssueCode,
  (typeof DOCUMENTED_LOWERING_CODES)[number]
>;
export type EveryLoweringCodeIsDocumented = Assignable<
  (typeof DOCUMENTED_LOWERING_CODES)[number],
  OperationLoweringIssueCode
>;
export type EveryDocumentedErrorCodeIsReal = Assignable<
  OperationErrorCode,
  (typeof DOCUMENTED_ERROR_CODES)[number]
>;
export type EveryErrorCodeIsDocumented = Assignable<
  (typeof DOCUMENTED_ERROR_CODES)[number],
  OperationErrorCode
>;

// ---------------------------------------------------------------------------
// Reading the skill
// ---------------------------------------------------------------------------

const skill = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, 'utf8') : '';

// Runs of whitespace collapse, so rewrapping a paragraph or realigning a table
// column is not a failure — only changing what an example says is.
const flatten = (text: string) => text.replace(/\s+/g, ' ');
const skillFlat = flatten(skill);

/** The skill still shows this snippet. */
function shows(assert: Assert, snippet: string) {
  assert.true(
    skillFlat.includes(flatten(snippet)),
    `the skill no longer shows \`${snippet.split('\n')[0]}…\` — update this case with it`,
  );
}

/**
 * The first backticked token of every row of the markdown table whose header
 * cell is `heading`. Exact tokens rather than substrings, so a name cannot
 * count as listed because it appears inside a neighbouring code span.
 */
function tableTokens(heading: string): string[] {
  const start = skill.indexOf(`| ${heading}`);
  if (start === -1) {
    return [];
  }
  const rest = skill.slice(start);
  const end = rest.indexOf('\n\n');
  const body = end === -1 ? rest : rest.slice(0, end);
  return body
    .split('\n')
    .slice(2)
    .map((row) => /`([^`]+)`/.exec(row)?.[1])
    .filter((token): token is string => Boolean(token));
}

// ---------------------------------------------------------------------------
// Definitions the behavioral cases lower against
// ---------------------------------------------------------------------------

const MODULE = 'http://example.com/cards/report';
const ref = (name: string) => ({ module: MODULE, name }) as CodeRef;
const refKey = (codeRef: CodeRef) =>
  `${(codeRef as { module: string }).module}/${(codeRef as { name: string }).name}`;

function definition(
  name: string,
  fields: Record<string, FieldDefinition>,
  type: Definition['type'] = 'card-def',
): Definition {
  const fieldMap: Definition['fields'] = {};
  const fieldDefs: Definition['fieldDefs'] = {};
  let index = 0;
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    const id = `f${index++}`;
    fieldMap[fieldName] = id;
    fieldDefs[id] = fieldDef;
  }
  return {
    type,
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

const Clinician = definition('Clinician', {
  userId: scalar(),
  activeCaseload: scalar({ type: 'containsMany' }),
});

const VitalsReading = definition('VitalsReading', {
  heartRate: scalar(),
  recordedBy: scalar(),
});

// A card carrying one field of each shape the skill's rules talk about.
const Record_ = definition('PatientRecord', {
  status: scalar(),
  severity: scalar(),
  // Computed, so a write into it is refused.
  cardTitle: scalar({ isComputed: true }),
  tags: scalar({ type: 'containsMany' }),
  vitals: compound('VitalsReading', { type: 'containsMany' }),
  // Not searchable, so reading across it is refused.
  facility: compound('Clinician', { type: 'linksTo' }),
  // Searchable, so reading across it is allowed.
  attending: compound('Clinician', { type: 'linksTo', searchable: true }),
  consultTeam: compound('Clinician', { type: 'linksToMany' }),
});

const graph = new Map<string, Definition>([
  [refKey(ref('Clinician')), Clinician],
  [refKey(ref('VitalsReading')), VitalsReading],
]);

const lookupDefinition = async (codeRef: CodeRef) => graph.get(refKey(codeRef));

const StringFieldClass = function StringField() {} as unknown as never;

const params = (key: string) => ({ $ref: 'params', key }) as never;
const actor = () => ({ $ref: 'actor' }) as never;
const instance = (key?: string) =>
  (key === undefined
    ? { $ref: 'instance' }
    : { $ref: 'instance', key }) as never;
const card = (value: unknown) => ({ $ref: 'card', value }) as never;

async function lower(
  declarations: Record<string, unknown>,
  target: Definition = Record_,
) {
  return await lowerOperationDeclarations(declarations as never, {
    definition: target,
    lookupDefinition,
    identifyCard: (def) =>
      (def as unknown) === StringFieldClass ? ref('StringField') : undefined,
  });
}

/** The findings lowering recorded, as codes. */
async function codesFor(
  declarations: Record<string, unknown>,
  target?: Definition,
): Promise<string[]> {
  const result = await lower(declarations, target);
  return result.issues.map((issue) => issue.code);
}

module(basename(import.meta.filename), function () {
  module('the skill is where the plugin ships it', function () {
    test('the copied skill exists and carries its frontmatter', function (assert) {
      assert.true(
        existsSync(SKILL_PATH),
        `the authoring skill is not at ${SKILL_PATH}`,
      );
      assert.true(
        skill.startsWith('---\nname: card-operations-authoring\n'),
        'the skill leads with its own name in frontmatter',
      );
      assert.true(
        /^boxel:\n {2}kind: skill$/m.test(skill),
        '`kind: skill` is nested under `boxel:`, which is what makes the file a skill',
      );
    });

    test('every path the skill points an author at exists', function (assert) {
      for (const cited of CITED_PATHS) {
        assert.true(
          skillFlat.includes(cited),
          `the skill no longer cites ${cited} — drop it from CITED_PATHS`,
        );
        assert.true(
          existsSync(join(REPO_ROOT, cited)),
          `the skill points at ${cited}, which does not exist`,
        );
      }
    });
  });

  module('the closed lists match the engine', function () {
    test('the lowering-findings table lists exactly the codes lowering can record', function (assert) {
      assert.deepEqual(
        tableTokens('Finding').sort(),
        [...DOCUMENTED_LOWERING_CODES].sort(),
        "the skill's findings table and the engine's issue codes have diverged",
      );
    });

    test('the refusals table lists exactly the codes a caller can see', function (assert) {
      assert.deepEqual(
        tableTokens('Code').sort(),
        [...DOCUMENTED_ERROR_CODES].sort(),
        "the skill's refusals table and the engine's error codes have diverged",
      );
    });

    test('the base-operations table lists exactly the nine behaviors', function (assert) {
      assert.deepEqual(tableTokens('Base').sort(), [
        'appendContainsMany',
        'appendLine',
        'create',
        'delete',
        'query',
        'read',
        'readSource',
        'transform',
        'update',
      ]);
    });
  });

  module('the declaration the skill opens with', function () {
    test('it lowers with no findings', async function (assert) {
      shows(
        assert,
        `append: {
        to: 'comments',
        value: { body: params('body'), postedBy: actor() },
      },`,
      );
      assert.deepEqual(
        await codesFor({
          addComment: {
            base: 'transform',
            params: { body: StringFieldClass },
            append: { to: 'tags', value: params('body') },
          },
        }),
        [],
        'the shape the skill opens with is one the realm accepts',
      );
    });
  });

  module('the rules the skill states', function () {
    test('a write into a computed field is refused', async function (assert) {
      shows(
        assert,
        '| `computed-write`          | A write into a computed field — the next read overwrites it         |',
      );
      assert.deepEqual(
        await codesFor({
          rename: {
            base: 'transform',
            params: { title: StringFieldClass },
            set: { cardTitle: params('title') },
          },
        }),
        ['computed-write'],
      );
    });

    test('a write whose path crosses a link is refused', async function (assert) {
      shows(
        assert,
        '**An operation binds only to the target card’s own stored values.**'.replace(
          '’',
          "'",
        ),
      );
      assert.deepEqual(
        await codesFor({
          renameAttending: {
            base: 'transform',
            params: { name: StringFieldClass },
            set: { 'attending.userId': params('name') },
          },
        }),
        ['write-through-link'],
      );
    });

    test('reading across a link needs that link to be searchable', async function (assert) {
      shows(
        assert,
        '@field attending = linksTo(Clinician, { searchable: true });',
      );
      assert.deepEqual(
        await codesFor({
          claimUnsearchable: {
            base: 'transform',
            params: { who: StringFieldClass },
            assert: {
              unique: 'facility.activeCaseload',
              by: params('who'),
              snapshot: true,
            },
          },
        }),
        ['unsearchable-read'],
        'a path through a link that is not searchable reads nothing',
      );
      assert.deepEqual(
        await codesFor({
          claimSearchable: {
            base: 'transform',
            params: { who: StringFieldClass },
            assert: {
              unique: 'attending.activeCaseload',
              by: params('who'),
              snapshot: true,
            },
          },
        }),
        [],
        'and the same path through a searchable link is accepted',
      );
    });

    test('an assert over a linked value requires a snapshot', async function (assert) {
      shows(
        assert,
        '**An `assert` over a computed or linked value needs `{ snapshot: true }`.**',
      );
      assert.deepEqual(
        await codesFor({
          addConsultant: {
            base: 'transform',
            params: { clinician: StringFieldClass },
            assert: { unique: 'consultTeam', by: card(params('clinician')) },
          },
        }),
        ['unsnapshotted-assert'],
      );
    });

    test('an undeclared param reference is refused', async function (assert) {
      shows(
        assert,
        "| `undeclared-param`        | `params('x')` for a key `params` does not declare                   |",
      );
      assert.deepEqual(
        await codesFor({
          setStatus: {
            base: 'transform',
            set: { status: params('missing') },
          },
        }),
        ['undeclared-param'],
      );
    });

    test('an actor where a card identity belongs is refused', async function (assert) {
      shows(assert, '`actor()` takes no argument and **is not a card**.');
      assert.deepEqual(
        await codesFor({
          claimSelf: {
            base: 'transform',
            append: { to: 'consultTeam', value: card(actor()) },
          },
        }),
        ['actor-not-a-card'],
      );
    });

    test('an instance marker in a declared append is refused when the module is indexed', async function (assert) {
      shows(
        assert,
        'Writing one is `instance-out-of-scope`, caught when the module is indexed rather than at invocation.',
      );
      assert.deepEqual(
        await codesFor({
          recordVitals: {
            base: 'appendContainsMany',
            field: 'vitals',
            item: { heartRate: '60', recordedBy: instance('id') },
          },
        }),
        ['instance-out-of-scope'],
        'an append never assembles the document, so it has no instance to read',
      );
      assert.deepEqual(
        await codesFor({
          recordVitals: {
            base: 'appendContainsMany',
            field: 'vitals',
            item: { heartRate: '60', recordedBy: actor() },
          },
        }),
        [],
        'while the markers an append can resolve are accepted',
      );
    });

    test('a base the def type does not carry is refused', async function (assert) {
      shows(
        assert,
        '| `appendLine`          | Appends one newline-terminated line to a text file                   | files      |',
      );
      assert.deepEqual(
        await codesFor({ appendAudit: { base: 'appendLine' } }),
        ['base-not-carried'],
        'a card carries no appendLine',
      );
    });

    test('an operation named for a definition-free base operation is refused', async function (assert) {
      shows(
        assert,
        '`readSource` is **not declarable** under any name or as any `base`',
      );
      assert.deepEqual(await codesFor({ readSource: { base: 'read' } }), [
        'reserved-name',
      ]);
    });

    test('an appendContainsMany that says nothing to append is refused', async function (assert) {
      shows(
        assert,
        '| `incomplete-append`       | An `appendContainsMany` that does not say what to append where      |',
      );
      assert.deepEqual(
        await codesFor({ recordVitals: { base: 'appendContainsMany' } }),
        ['incomplete-append'],
      );
    });
  });
});
