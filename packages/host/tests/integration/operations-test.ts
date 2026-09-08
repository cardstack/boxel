import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import { setupCardLogs, setupLocalIndexing } from '../helpers';
import {
  setupBaseRealm,
  CardDef,
  FieldDef,
  FileDef,
  StringField,
  DateField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type * as OperationsModule from '@cardstack/base/operations';

let loader: Loader;
let operation: (typeof OperationsModule)['operation'];
let getOperations: (typeof OperationsModule)['getOperations'];
let params: (typeof OperationsModule)['params'];
let actor: (typeof OperationsModule)['actor'];
let instance: (typeof OperationsModule)['instance'];
let card: (typeof OperationsModule)['card'];
let bxl: (typeof OperationsModule)['bxl'];
let linkTo: (typeof OperationsModule)['linkTo'];

// Compile-time assertions. The call does nothing at run time; it fails to
// type-check unless the two types are identical, so the call is the assertion.
type Identical<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? true
    : false;

function expectTypeEquals<Expected, Actual>(
  ..._assertion: Identical<Expected, Actual> extends true
    ? []
    : ['the two types are not identical']
) {}

module('Integration | operations', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );
  setupLocalIndexing(hooks);
  setupMockMatrix(hooks);

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ operation, getOperations, params, actor, instance, card, bxl, linkTo } =
      await loader.import<typeof OperationsModule>(
        '@cardstack/base/operations',
      ));
  });

  test('getOperations merges declarations up the prototype chain, subclass winning per name', function (assert) {
    class Report extends CardDef {
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField },
        append: {
          to: 'comments',
          value: { body: params('body'), author: actor() },
        },
      };
      // Annotated rather than inferred: a subclass's static has to stay
      // assignable to the one it shadows, and the override below is a
      // differently-shaped declaration.
      @operation static escalate: OperationsModule.OperationDeclaration = {
        base: 'transform',
        transformations: bxl`.status = "escalated";`,
      };
    }
    class ExternalReport extends Report {
      // Overrides the inherited declaration wholesale, by name. `satisfies`
      // keeps `base` a literal, which is what makes the override assignable
      // to the declaration it shadows.
      @operation static escalate = {
        base: 'transform',
        params: { reason: StringField },
        set: { status: 'escalated', escalationReason: params('reason') },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static listMine = {
        base: 'query',
        // The thunk form: this class's binding is still uninitialized while
        // its own statics are being built.
        query: {
          filter: { on: () => ExternalReport, eq: { author: actor('id') } },
        },
      };
    }

    assert.deepEqual(
      Object.keys(getOperations(Report)).sort(),
      ['addComment', 'escalate'],
      'a class sees the operations it declares',
    );
    assert.deepEqual(
      Object.keys(getOperations(ExternalReport)).sort(),
      ['addComment', 'escalate', 'listMine'],
      'a subclass sees its own operations and the ones it inherits',
    );
    assert.deepEqual(
      getOperations(Report).escalate,
      {
        base: 'transform',
        transformations: { $bxl: '.status = "escalated";' },
      },
      'the ancestor keeps its own declaration',
    );

    let overridden = getOperations(ExternalReport)
      .escalate as OperationsModule.TransformOperationDeclaration;
    assert.deepEqual(
      Object.keys(overridden.params ?? {}),
      ['reason'],
      'the subclass declaration replaces the inherited one of the same name',
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(overridden.set)),
      {
        status: 'escalated',
        escalationReason: { $ref: 'params', key: 'reason' },
      },
      'the overriding declaration is the one that comes back',
    );

    assert.deepEqual(
      Object.keys(getOperations(new ExternalReport())).sort(),
      Object.keys(getOperations(ExternalReport)).sort(),
      'an instance reads the same operations as its class',
    );
    assert.strictEqual(
      getOperations(new ExternalReport()).escalate,
      getOperations(ExternalReport).escalate,
      'and reads the very declarations the class holds',
    );
    assert.deepEqual(
      getOperations(CardDef),
      {},
      'the built-in base operations are implied by the def type, not declared',
    );
  });

  test('typed references are JSON-serializable markers', function (assert) {
    class ClassroomActivity extends CardDef {}
    class Classroom extends CardDef {
      @operation static createActivity = {
        base: 'create',
        of: ClassroomActivity,
        params: { title: StringField, dueOn: DateField },
        fill: {
          title: params('title'),
          dueOn: params('dueOn'),
          author: actor(),
          classroom: instance('id'),
        },
      };
      @operation static addActivity = {
        base: 'transform',
        params: { activity: linkTo(ClassroomActivity) },
        append: { to: 'activities', value: card(params('activity')) },
      };
      @operation static addOwner = {
        base: 'transform',
        assert: {
          unique: 'owners',
          by: actor('id'),
          message: 'This person already owns the classroom',
        },
        append: { to: 'owners', value: card('https://example.test/people/1') },
      };
    }

    let declarations = getOperations(Classroom);
    let createActivity =
      declarations.createActivity as OperationsModule.CreateOperationDeclaration;
    let addActivity =
      declarations.addActivity as OperationsModule.TransformOperationDeclaration;
    let addOwner =
      declarations.addOwner as OperationsModule.TransformOperationDeclaration;

    assert.deepEqual(
      JSON.parse(JSON.stringify(createActivity.fill)),
      {
        title: { $ref: 'params', key: 'title' },
        dueOn: { $ref: 'params', key: 'dueOn' },
        author: { $ref: 'actor' },
        classroom: { $ref: 'instance', key: 'id' },
      },
      'params, actor and instance references survive JSON round-tripping',
    );
    assert.strictEqual(
      createActivity.of,
      ClassroomActivity,
      'a create carries the class it creates',
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(addActivity.append)),
      {
        to: 'activities',
        value: { $ref: 'card', value: { $ref: 'params', key: 'activity' } },
      },
      'a card reference carries the reference that resolves to the card',
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(addOwner.assert)),
      {
        unique: 'owners',
        by: { $ref: 'actor', key: 'id' },
        message: 'This person already owns the classroom',
      },
      'an assertion keys its uniqueness check on a reference',
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(bxl`assert(.status == "open"; "not open");`)),
      { $bxl: 'assert(.status == "open"; "not open");' },
      'a raw program is a marker carrying its source',
    );
  });

  test('the bxl tag rejects interpolation', function (assert) {
    let fieldName = 'status';
    assert.throws(
      () => bxl`.${fieldName} = "escalated";`,
      /does not interpolate values/,
      'a program reads the operation context through builtins, not spliced text',
    );
  });

  test('the decorator rejects a target that is not a card definition', function (assert) {
    assert.throws(
      () => {
        class NotADef {
          @operation static addComment = { base: 'read' };
        }
        return NotADef;
      },
      /can only be used on static properties of classes that extend BaseDef/,
      'a plain class cannot carry operations',
    );
  });

  test('the decorator rejects a symbol operation name', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          // A computed key written as a bare identifier is compiled to that
          // identifier's name, so a symbol only reaches the decorator from a
          // key expression that is not an identifier. TypeScript wants a
          // `unique symbol` for a computed class member, which this is not.
          // @ts-expect-error the point of the case is the symbol that arrives
          @operation static [Symbol.for('cardstack-test-operation')] = {
            base: 'read',
          };
        }
        return Report;
      },
      /only supports string operation names, not symbols/,
      'an operation is addressed by name on the wire, so it needs a string',
    );
  });

  test('the decorator rejects a declaration that is not an object', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = 'transform' as never;
        }
        return Report;
      },
      /must be a declaration object/,
      'a declaration is plain data, not a value of some other kind',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment: never;
        }
        return Report;
      },
      /must be assigned a declaration object/,
      'an operation with no declaration names no behavior at all',
    );
  });

  test('a field cannot declare operations', function (assert) {
    assert.throws(
      () => {
        class Comment extends FieldDef {
          @operation static addReply = { base: 'read' };
        }
        return Comment;
      },
      /a field has no URL of its own/,
      'field data is reached through the operations of the card that contains it',
    );
  });

  test('a file definition can only declare read operations', function (assert) {
    class Attachment extends FileDef {
      @operation static readRedacted = { base: 'read', output: { name: true } };
    }
    assert.deepEqual(
      Object.keys(getOperations(Attachment)),
      ['readRedacted'],
      'a read operation is declarable on a file definition',
    );
    assert.throws(
      () => {
        class Mutable extends FileDef {
          @operation static rename = {
            base: 'transform',
            set: { name: 'renamed' },
          };
        }
        return Mutable;
      },
      /metadata is read-only/,
      'file metadata is content-derived, so it has no mutation surface',
    );
  });

  test('the decorator rejects an operation name that is already a static', function (assert) {
    assert.throws(
      () => {
        // TypeScript rejects the shadowing too (a static's type has to stay
        // assignable to the one it shadows); the decorator is what catches a
        // collision whose types happen to line up.
        // @ts-expect-error an operation declaration is not a display name
        class Report extends CardDef {
          @operation static displayName = { base: 'read' };
        }
        return Report;
      },
      /is already a static on this class/,
      'an operation name that shadows a system static is refused',
    );
  });

  test('the decorator validates the declaration against its base operation', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = { base: 'append' as never };
        }
        return Report;
      },
      /must name the built-in behavior/,
      'a declaration builds on one of the built-in behaviors',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'read',
            append: { to: 'comments', value: 'hello' },
          };
        }
        return Report;
      },
      /"append" is not a valid key for a "read" operation/,
      'a clause is only legal on the base that can express it',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static createComment = {
            base: 'create',
            fill: { body: 'x' },
          };
        }
        return Report;
      },
      /a "create" operation needs/,
      'a create names the type it creates',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            set: { status: 'escalated' },
            transformations: bxl`.status = "escalated";`,
          };
        }
        return Report;
      },
      /either with clauses .* or with a raw/,
      'the declarative clauses and a raw program are alternatives',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            transformations: '.status = "escalated";' as never,
          };
        }
        return Report;
      },
      /must be a program written with the bxl tag/,
      'a raw program comes from the bxl tag, not a bare string',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listMine = { base: 'query' };
        }
        return Report;
      },
      /a "query" operation needs/,
      'a named query is the query it saves',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            append: {
              to: 'comments',
              value: 'hello',
              into: 'comments',
            } as never,
          };
        }
        return Report;
      },
      /"into" is not a valid key/,
      'a clause accepts only the keys it is made of',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            append: {
              to: 'comments',
              value: { body: { $ref: 'payload' } },
            } as never,
          };
        }
        return Report;
      },
      /is not a typed reference/,
      'a reference comes from one of the reference constructors',
    );
  });

  test('getOperations rejects a target that is not a card definition', function (assert) {
    assert.throws(
      () => getOperations({} as never),
      /takes a class that extends BaseDef/,
      'operations hang off a definition, so a plain object reads none',
    );
  });

  test('a params reference must name a declared param', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            params: { body: StringField },
            append: { to: 'comments', value: { body: params('title') } },
          };
        }
        return Report;
      },
      /references the param "title"/,
      'the declared schema is the single source for what the payload carries',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            params: { body: 'string' as never },
            append: { to: 'comments', value: { body: params('body') } },
          };
        }
        return Report;
      },
      /param "body" must be a field class or linkTo/,
      'a param names the field class that types it',
    );
  });

  test('the declared params schema types the operation payload', function (assert) {
    class ClassroomActivity extends CardDef {}
    let addActivity = {
      base: 'transform',
      params: { note: StringField, activity: linkTo(ClassroomActivity) },
      append: { to: 'activities', value: card(params('activity')) },
    } satisfies OperationsModule.OperationDeclaration;

    expectTypeEquals<
      { note: string; activity: OperationsModule.LinkParamValue },
      OperationsModule.ParamsOf<typeof addActivity>
    >();
    expectTypeEquals<
      Record<string, never>,
      OperationsModule.ParamsOf<{ base: 'delete' }>
    >();

    let bodyReference = params('body');
    expectTypeEquals<
      OperationsModule.ParamsReference<'body'>,
      typeof bodyReference
    >();

    class Report extends CardDef {
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField },
        append: { to: 'comments', value: { body: params('body') } },
      } satisfies OperationsModule.OperationDeclaration;
    }
    expectTypeEquals<
      'addComment',
      keyof OperationsModule.OperationsOf<typeof Report>
    >();

    assert.deepEqual(
      Object.keys(addActivity.params),
      ['note', 'activity'],
      'a scalar param and a link param sit in the same schema',
    );
    assert.deepEqual(
      bodyReference,
      { $ref: 'params', key: 'body' },
      'the key a reference names is carried in the marker and in its type',
    );
    assert.deepEqual(
      Object.keys(getOperations(Report)),
      ['addComment'],
      'a declaration written against the exported types is recorded like any other',
    );
  });
});
