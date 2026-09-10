import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import { setupCardLogs, setupLocalIndexing } from '../helpers';
import {
  setupBaseRealm,
  cardAPI,
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
let getDeclaredOperations: (typeof OperationsModule)['getDeclaredOperations'];
let params: (typeof OperationsModule)['params'];
let actor: (typeof OperationsModule)['actor'];
let instance: (typeof OperationsModule)['instance'];
let card: (typeof OperationsModule)['card'];
let bxl: (typeof OperationsModule)['bxl'];
let linkTo: (typeof OperationsModule)['linkTo'];

// The entry `getOperations` synthesizes for a base operation a def carries.
// The cast is load-bearing rather than convenience: `OperationDeclaration`
// deliberately cannot express `base: 'readSource'`, because nothing may
// declare one and the authoring types are the first place that is refused —
// while `getOperations` still reports the entry every card and file def
// carries. That asymmetry lives here rather than being spelled out at each
// expectation.
function implied(base: string): OperationsModule.OperationDeclaration {
  return { base } as OperationsModule.OperationDeclaration;
}

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
    ({
      operation,
      getOperations,
      getDeclaredOperations,
      params,
      actor,
      instance,
      card,
      bxl,
      linkTo,
    } = await loader.import<typeof OperationsModule>(
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
      Object.keys(getDeclaredOperations(Report)).sort(),
      ['addComment', 'escalate'],
      'a class sees the operations it declares',
    );
    assert.deepEqual(
      Object.keys(getDeclaredOperations(ExternalReport)).sort(),
      ['addComment', 'escalate', 'listMine'],
      'a subclass sees its own operations and the ones it inherits',
    );
    assert.deepEqual(
      Object.keys(getOperations(ExternalReport)).sort(),
      [
        'addComment',
        'create',
        'delete',
        'escalate',
        'listMine',
        'query',
        'read',
        'readSource',
        'transform',
        'update',
      ],
      'and reads them alongside the base operations its def type carries',
    );
    assert.deepEqual(
      getDeclaredOperations(Report).escalate,
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
  });

  test('the base operations a def type carries come back without being declared', function (assert) {
    assert.deepEqual(
      getOperations(CardDef),
      {
        read: implied('read'),
        readSource: implied('readSource'),
        create: implied('create'),
        update: implied('update'),
        delete: implied('delete'),
        query: implied('query'),
        transform: implied('transform'),
      },
      'a card def carries every base operation, implied by the def type',
    );
    assert.deepEqual(
      Object.keys(getDeclaredOperations(CardDef)),
      [],
      'none of which is written in author code',
    );
    assert.deepEqual(
      getOperations(FileDef),
      { read: implied('read'), readSource: implied('readSource') },
      "a file's metadata is read-only, so a file def carries only its two reads",
    );
    assert.deepEqual(
      getOperations(FieldDef),
      {},
      'a field has no URL, so nothing is invocable on one',
    );

    class Report extends CardDef {
      // Specializing a base operation is a matter of declaring it by name.
      @operation static read = {
        base: 'read',
        output: { title: true, comments: true },
      } satisfies OperationsModule.OperationDeclaration;
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(getOperations(Report).read)),
      { base: 'read', output: { title: true, comments: true } },
      'the declaration takes the place of the base operation it names',
    );
    assert.deepEqual(
      Object.keys(getOperations(Report)).sort(),
      [
        'create',
        'delete',
        'query',
        'read',
        'readSource',
        'transform',
        'update',
      ],
      'and adds no name, because it is that base operation',
    );

    class Archivable extends CardDef {
      // A base operation's name is the verb a caller invokes, so a
      // declaration by that name may carry it out with another behavior.
      @operation static delete = {
        base: 'transform',
        set: { archived: true },
      } satisfies OperationsModule.OperationDeclaration;
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(getOperations(Archivable).delete)),
      { base: 'transform', set: { archived: true } },
      'a delete declared on transform is a soft delete',
    );
    assert.deepEqual(
      Object.keys(getOperations(Archivable)).sort(),
      [
        'create',
        'delete',
        'query',
        'read',
        'readSource',
        'transform',
        'update',
      ],
      'which stands in for the removal rather than beside it',
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

  test('a file definition can only declare document reads', function (assert) {
    class Attachment extends FileDef {
      @operation static readRedacted = { base: 'read', output: { name: true } };
    }
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Attachment)),
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
      /carries only "read", "readSource"/,
      'file metadata is content-derived, so it has no mutation surface',
    );
  });

  test('a stored-bytes read takes no declaration at all', function (assert) {
    // The other half of the realm's definition-free dispatch: it answers a
    // `readSource` without consulting a definition, which is only safe while
    // no declaration can take that name. Refusing here is what makes it so.
    for (let Def of [CardDef, FileDef]) {
      assert.throws(
        () => {
          class Exported extends (Def as typeof CardDef) {
            @operation static exportBytes = { base: 'readSource' };
          }
          return Exported;
        },
        /serves the bytes stored at the def's URL/,
        `a ${Def.name} cannot build an operation on a stored-bytes read`,
      );
    }
    assert.throws(
      () => {
        class Redacted extends CardDef {
          // Not even under its own name: specializing it is the same ask as
          // rebinding a verb onto it, since there is no stage to specialize.
          @operation static readSource = {
            base: 'readSource',
            output: { redacted: true },
          };
        }
        return Redacted;
      },
      /reserved operation name/,
      'and it cannot be specialized under its own name either',
    );

    // The name is reserved independently of the base, because the two are
    // independent everywhere else: a declaration is invoked under its name and
    // carried out by its base. The realm answers this name without reading a
    // definition, so a declaration under it — whatever base it builds on —
    // would be dispatched straight past, and the built-in would run in place
    // of what the author wrote.
    assert.throws(
      () => {
        class Sneaky extends CardDef {
          @operation static readSource = {
            base: 'read',
            output: { redacted: true },
          };
        }
        return Sneaky;
      },
      /reserved operation name/,
      'a declaration cannot take the name by building on another base',
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
      /already resolves on this class/,
      'an operation name that shadows a system static is refused',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          // @ts-expect-error a declaration is not what Function#toString is
          @operation static toString = { base: 'read' };
        }
        return Report;
      },
      /already resolves on this class/,
      'nor one that shadows something every class inherits',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static __proto__ = { base: 'read' };
        }
        return Report;
      },
      /already resolves on this class/,
      'and least of all a name that would reset a prototype instead of keying a map',
    );

    class Report extends CardDef {
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField },
        append: { to: 'comments', value: { body: params('body') } },
      };
    }
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Report)),
      ['addComment'],
      'a rejected name leaves the store working',
    );
    for (let inherited of [
      'toString',
      'constructor',
      '__proto__',
      'valueOf',
      'hasOwnProperty',
    ]) {
      assert.false(
        inherited in getOperations(Report),
        `a name-keyed record does not answer for ${inherited}`,
      );
      assert.false(
        inherited in getDeclaredOperations(Report),
        `nor does the declared-only record answer for ${inherited}`,
      );
    }
    assert.true(
      'addComment' in getOperations(Report),
      'while still answering for the operations it holds',
    );
    assert.true(
      'read' in getOperations(Report),
      'and for the base operations its def type carries',
    );
  });

  test('the decorator installs the declaration on the class', function (assert) {
    class Report extends CardDef {
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField },
        append: { to: 'comments', value: { body: params('body') } },
      };
    }
    // The static is what `OperationsOf` types off, and what makes the
    // name-collision check see an inherited operation on a subclass override.
    // A decorator that recorded the declaration without returning a `value`
    // descriptor would leave every other assertion in this file passing.
    assert.strictEqual(
      Report.addComment as unknown,
      getDeclaredOperations(Report).addComment as unknown,
      'the class carries the very declaration the reader returns',
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

  test('a param is typed by a field class, and nothing else', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            params: { author: CardDef as never },
            append: { to: 'comments', value: { author: params('author') } },
          };
        }
        return Report;
      },
      /a card or file identity is a linkTo/,
      'a card class types a link param, which is what linkTo declares',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            params: { body: (() => StringField) as never },
            append: { to: 'comments', value: { body: params('body') } },
          };
        }
        return Report;
      },
      /param "body" must be a field class or linkTo/,
      'a scalar param takes the field class itself, not a thunk',
    );
  });

  test('a declaration carries only what survives as data', function (assert) {
    for (let [value, pattern, message] of [
      [
        () => 'escalated',
        /is a function; a declaration is data/,
        'a function would never reach the realm',
      ],
      [new Date(), /is a Date instance/, 'a date would flatten to a string'],
      [
        new Map(),
        /is a Map instance/,
        'a map would flatten to an empty object',
      ],
      [
        undefined,
        /omit an optional key rather than declaring it as undefined/,
        'an undefined value would be dropped',
      ],
      [1n, /is a bigint/, 'a bigint cannot be serialized at all'],
    ] as [never, RegExp, string][]) {
      assert.throws(
        () => {
          class Report extends CardDef {
            @operation static escalate = {
              base: 'transform',
              set: { status: value },
            };
          }
          return Report;
        },
        pattern,
        message,
      );
    }

    class Activity extends CardDef {}
    class Classroom extends CardDef {
      // The two slots a def class is expected in: the type a create names,
      // and the type a query filters on.
      @operation static createActivity = {
        base: 'create',
        of: Activity,
        params: { title: StringField },
        fill: { title: params('title') },
      };
      @operation static listActivities = {
        base: 'query',
        query: { filter: { on: Activity, eq: { classroom: instance('id') } } },
      };
    }
    let declarations = getOperations(Classroom);
    assert.strictEqual(
      (
        declarations.createActivity as OperationsModule.CreateOperationDeclaration
      ).of,
      Activity,
      'a create names the class it creates',
    );
    assert.strictEqual(
      (
        (
          declarations.listActivities as OperationsModule.QueryOperationDeclaration
        ).query as { filter: { on: unknown } }
      ).filter.on,
      Activity,
      'and a query names the class it filters on',
    );
  });

  test('a def class is legal only where a slot names a type', function (assert) {
    class Activity extends CardDef {}
    class Classroom extends CardDef {
      @operation static listActivities = {
        base: 'query',
        // A filter nests, so `on` names a type at any depth — and the thunk
        // form works there.
        query: {
          filter: { any: [{ on: () => Activity, eq: { status: 'open' } }] },
        },
      };
      @operation static makeActivity = {
        base: 'create',
        of: Activity,
        params: { title: StringField },
        // `of` names the type rather than the work, so it stands alongside a
        // raw program instead of competing with it.
        transformations: bxl`.title = params("title");`,
      };
    }
    let declarations = getDeclaredOperations(Classroom);
    assert.strictEqual(
      (declarations.makeActivity as OperationsModule.CreateOperationDeclaration)
        .of,
      Activity,
      'a program-driven create still names what it creates',
    );
    assert.strictEqual(
      typeof (
        (
          declarations.listActivities as OperationsModule.QueryOperationDeclaration
        ).query as { filter: { any: { on: unknown }[] } }
      ).filter.any[0].on,
      'function',
      'and a nested filter still names its type',
    );

    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: {
              filter: { on: Activity, eq: { owner: (() => 1) as never } },
            },
          };
        }
        return Report;
      },
      /is a function; a declaration is data/,
      'but a function anywhere else in a query would lower to nothing',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static makeOne = {
            base: 'create',
            of: StringField as never,
          };
        }
        return Report;
      },
      /must be a card class/,
      'and only a card can be created',
    );
    assert.throws(
      () => linkTo(StringField as never),
      /card or file class/,
      'while a link points at something that has a URL',
    );
  });

  test('a shared value is checked in every slot it appears', function (assert) {
    assert.throws(
      () => {
        let shared = { on: CardDef };
        class Report extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: shared },
            output: { leak: shared },
          };
        }
        return Report;
      },
      /is a function; a declaration is data/,
      'validation does not memoize, so it cannot depend on key order',
    );
  });

  test('a declaration must be a tree of finite values', function (assert) {
    assert.throws(
      () => {
        let value: Record<string, unknown> = { body: 'x' };
        value.self = value;
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            set: value as never,
          };
        }
        return Report;
      },
      /refers back to a value that contains it/,
      'a cycle would throw when the declaration is serialized, far from here',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            set: { score: NaN },
          };
        }
        return Report;
      },
      /serializes as null/,
      'and a non-finite number would quietly become null',
    );
  });

  test('a marker carries only its own key', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            transformations: { $bxl: '.a = 1;', hook: () => 1 } as never,
          };
        }
        return Report;
      },
      /is not a valid key/,
      'a program marker is not a place to smuggle a value past the walk',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addActivity = {
            base: 'transform',
            params: { activity: { $linkTo: CardDef, junk: 1 } as never },
            append: { to: 'activities', value: card(params('activity')) },
          };
        }
        return Report;
      },
      /is not a valid key/,
      'nor is a link param, which the reference walk skips',
    );
  });

  test('a named query is checked for the shape a search needs', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listSome = { base: 'query', query: {} };
        }
        return Report;
      },
      /at least one of/,
      'a query with no query names no search',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: { type: CardDef }, page: { size: 0 } },
          };
        }
        return Report;
      },
      /must be a positive integer/,
      'a page size is a count',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: { type: CardDef }, realms: 'https://x/' as never },
          };
        }
        return Report;
      },
      /non-empty array of realm URLs/,
      'and realms is the fan-out list, not one realm',
    );
  });

  test('a query names a type only where the filter grammar has one', function (assert) {
    class Activity extends CardDef {}
    class Classroom extends CardDef {
      // `type` is how the realm spells a pure card-type filter; `on` anchors a
      // filter that carries a predicate. Both nest through `any`/`every`/`not`,
      // and a sort entry names the type its `by` path is rooted in.
      @operation static listAll = {
        base: 'query',
        query: {
          filter: { any: [{ type: Activity }, { not: { type: Activity } }] },
          sort: [{ by: 'title', on: Activity }],
        },
      };
      @operation static listOpen = {
        base: 'query',
        query: { filter: { on: Activity, eq: { status: 'open' } } },
      };
      @operation static listEvery = {
        base: 'query',
        query: {
          filter: {
            every: [
              { on: Activity, eq: { status: 'open' } },
              { on: Activity, range: { views: { gt: 10 } } },
            ],
          },
        },
      };
      // A predicate holds field names, so a field genuinely called `on` is
      // data and survives.
      @operation static listRecent = {
        base: 'query',
        query: { filter: { on: Activity, range: { on: { gt: 1 } } } },
      };
    }
    let declarations = getDeclaredOperations(Classroom);
    let queryOf = (name: string) =>
      (declarations[name] as OperationsModule.QueryOperationDeclaration)
        .query as Record<string, never>;
    assert.strictEqual(
      (
        queryOf('listAll') as unknown as {
          filter: { any: { type: unknown }[] };
        }
      ).filter.any[0].type,
      Activity,
      'a pure card-type filter names the class itself',
    );
    assert.strictEqual(
      (
        queryOf('listEvery') as unknown as {
          filter: { every: { on: unknown }[] };
        }
      ).filter.every[0].on,
      Activity,
      'and `every` holds filter nodes the same way `any` does',
    );
    assert.strictEqual(
      (
        queryOf('listAll') as unknown as {
          sort: { on: unknown }[];
        }
      ).sort[0].on,
      Activity,
      'and so does a sort entry',
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          (queryOf('listRecent') as unknown as { filter: { range: unknown } })
            .filter.range,
        ),
      ),
      { on: { gt: 1 } },
      'a field named `on` under a predicate is data, not a type slot',
    );

    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: { eq: { on: Activity, status: 'open' } } },
          };
        }
        return Report;
      },
      /`query.filter.eq.on` is a function/,
      'a class under a predicate would lower to nothing and match everything',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: { on: StringField as never, eq: { a: 1 } } },
          };
        }
        return Report;
      },
      /must be a card or file class/,
      'and a type slot names something that has a type of its own',
    );
  });

  test('a declaration pins the page the realm implements', function (assert) {
    class Activity extends CardDef {}
    class Report extends CardDef {
      @operation static listRecent = {
        base: 'query',
        query: {
          filter: { type: Activity },
          page: { size: 20, number: 1 },
        },
      };
    }
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          (
            getDeclaredOperations(Report)
              .listRecent as OperationsModule.QueryOperationDeclaration
          ).query?.page,
        ),
      ),
      { size: 20, number: 1 },
      'a page is a length and a 0-based offset, which is how the realm pages',
    );
  });

  test('a declared query is checked against the realm grammar itself', function (assert) {
    class Activity extends CardDef {}
    class Report extends CardDef {
      @operation static search = {
        base: 'query',
        params: { term: StringField },
        query: {
          filter: { type: Activity },
          // A payload may supply the full-text term.
          queryString: params('term'),
        },
      };
    }
    assert.strictEqual(
      (
        (
          getDeclaredOperations(Report)
            .search as OperationsModule.QueryOperationDeclaration
        ).query as { queryString: { $ref: string } }
      ).queryString.$ref,
      'params',
      'a query carrying a reference is left to the placement rule',
    );

    // With no reference to stand in for a concrete value, the realm's own
    // validator sees the query — so a shape it would reject at invocation is
    // rejected where the class is defined.
    assert.throws(
      () => {
        class Listing extends CardDef {
          @operation static listSome = {
            base: 'query',
            // An `any` element is a filter node, so it needs a predicate.
            query: { filter: { any: [{ on: Activity }] } },
          };
        }
        return Listing;
      },
      /is not a query the realm accepts/,
      'a filter node with no predicate is not a filter',
    );
    assert.throws(
      () => {
        class Listing extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: { type: Activity }, sort: [{ by: 'title' }] },
          };
        }
        return Listing;
      },
      /is not a query the realm accepts/,
      'and a sort by a card field names the type it is rooted in',
    );
    assert.throws(
      () => {
        class Listing extends CardDef {
          @operation static listSome = {
            base: 'query',
            query: { filter: { type: Activity }, queryString: 42 as never },
          };
        }
        return Listing;
      },
      /`query.queryString` must be a search term/,
      'a full-text term is a string, or a reference to one',
    );
  });

  test('a create names what it creates whichever form its work takes', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static makeOne = {
            base: 'create',
            transformations: bxl`.title = "x";`,
          } as never;
        }
        return Report;
      },
      /needs `of` to name what it creates/,
      'a program computes fields without saying what kind of card to create',
    );
  });

  test('a marker is identified by a key of its own', function (assert) {
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            // Inherited rather than own, so it serializes as `{}`.
            set: { author: Object.create({ $ref: 'actor' }) as never },
          };
        }
        return Report;
      },
      /a declaration carries plain objects, arrays and primitives/,
      'a reference reached through a prototype is not a reference',
    );
    assert.throws(
      () => {
        let reference: Record<string, unknown> = { $ref: 'card' };
        reference.value = reference;
        class Report extends CardDef {
          @operation static escalate = {
            base: 'transform',
            set: { owner: reference as never },
          };
        }
        return Report;
      },
      /refers back to a value that contains it/,
      'and a reference that contains itself is refused, not recursed into',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addComment = {
            base: 'transform',
            params: { body: StringField },
            append: {
              to: 'comments',
              value: {
                body: { $ref: 'params', key: 'body', extra: 1 } as never,
              },
            },
          };
        }
        return Report;
      },
      /"extra" is not a valid key/,
      'a reference marker carries only what its constructor puts there',
    );
    assert.throws(
      () => {
        class Report extends CardDef {
          @operation static addActivity = {
            base: 'transform',
            params: { activity: { $linkTo: StringField } as never },
            append: { to: 'activities', value: card(params('activity')) },
          };
        }
        return Report;
      },
      /links to a card or file class/,
      'a hand-written link marker is held to what linkTo requires',
    );
  });

  test('the bxl tag reports being called as a function', function (assert) {
    assert.throws(
      () => (bxl as unknown as (parts: string[]) => unknown)(['.a = 1;']),
      /template tag/,
      'every reference constructor says what it wanted',
    );
  });

  test('every declaration guard reports what it wanted', function (assert) {
    let rejected: [string, unknown, RegExp][] = [
      [
        'optimistic',
        { base: 'read', optimistic: 'yes' },
        /`optimistic` must be a boolean/,
      ],
      [
        'input',
        { base: 'read', input: '.a = 1;' },
        /`input` must be a program written with the bxl tag/,
      ],
      [
        'output',
        { base: 'read', output: 'title' },
        /`output` must be a projection object or a bxl program/,
      ],
      [
        'append not an object',
        { base: 'transform', append: 'comments' },
        /`append` must be an object naming the field/,
      ],
      [
        'append.to empty',
        { base: 'transform', append: { to: '', value: 1 } },
        /`append.to` must name the collection field/,
      ],
      [
        'append with no value',
        { base: 'transform', append: { to: 'comments' } },
        /`append` must carry a `value` to append/,
      ],
      [
        'assert not an object',
        { base: 'transform', assert: 'unique' },
        /`assert` must be an object naming the collection/,
      ],
      [
        'assert.unique empty',
        { base: 'transform', assert: { unique: '', by: 1 } },
        /`assert.unique` must name the collection field/,
      ],
      [
        'assert with no by',
        { base: 'transform', assert: { unique: 'owners' } },
        /`assert` must carry a `by` value/,
      ],
      [
        'assert.message',
        { base: 'transform', assert: { unique: 'o', by: 1, message: 2 } },
        /`assert.message` must be a string/,
      ],
      [
        'set empty',
        { base: 'transform', set: {} },
        /`set` must be an object mapping field names to values/,
      ],
      [
        'fill empty',
        { base: 'create', of: CardDef, fill: {} },
        /`fill` must be an object mapping field names to values/,
      ],
      [
        'of not a function',
        { base: 'create', of: 'Activity' },
        /`of` must be the card class to create/,
      ],
      [
        'query not an object',
        { base: 'query', query: 'everything' },
        /`query` must be an object with at least one of/,
      ],
      [
        'query with an unknown key',
        { base: 'query', query: { filter: { type: CardDef }, junk: 1 } },
        /"junk" is not a valid key for `query`/,
      ],
      [
        'query.page not an object',
        { base: 'query', query: { filter: { type: CardDef }, page: 10 } },
        /`query.page` must be an object/,
      ],
      [
        'query.page with no size',
        {
          base: 'query',
          query: { filter: { type: CardDef }, page: { number: 1 } },
        },
        /`query.page.size` must be a positive integer/,
      ],
      [
        'query.page.number below zero',
        {
          base: 'query',
          query: { filter: { type: CardDef }, page: { size: 10, number: -1 } },
        },
        /`query.page.number` must be a whole number/,
      ],
      [
        'cursor is not a page key',
        {
          base: 'query',
          query: { filter: { type: CardDef }, page: { size: 10, cursor: 'x' } },
        },
        /"cursor" is not a valid key for `query.page`/,
      ],
      [
        'a params reference with a non-string key',
        {
          base: 'transform',
          params: { body: StringField },
          set: { x: { $ref: 'params', key: 1 } },
        },
        /must name a param/,
      ],
      [
        'an actor reference with an empty key',
        { base: 'transform', set: { x: { $ref: 'actor', key: '' } } },
        /must name a member, or none at all/,
      ],
      [
        'a card reference with a non-reference value',
        { base: 'transform', set: { x: { $ref: 'card', value: 1 } } },
        /must carry a card URL or a reference to one/,
      ],
    ];
    for (let [name, declaration, pattern] of rejected) {
      assert.throws(
        () => {
          class Report extends CardDef {
            @operation static candidate = declaration as never;
          }
          return Report;
        },
        pattern,
        `a declaration is refused for ${name}`,
      );
    }
  });

  test('every reference constructor reports what it wanted', function (assert) {
    let rejected: [string, () => unknown, RegExp][] = [
      [
        'params with no name',
        () => params(''),
        /takes the name of a param declared/,
      ],
      [
        'params with a non-string',
        () => params(1 as never),
        /takes the name of a param declared/,
      ],
      [
        'card with no URL',
        () => card(''),
        /takes a card URL or a typed reference to one/,
      ],
      [
        'card with a non-reference',
        () => card(1 as never),
        /takes a card URL or a typed reference to one/,
      ],
      [
        'linkTo with a non-class',
        () => linkTo('Activity' as never),
        /takes a card class/,
      ],
      [
        'actor with an empty key',
        () => actor(''),
        /takes the name of a member to read, or no argument at all/,
      ],
      [
        'instance with a non-string key',
        () => instance(1 as never),
        /takes the name of a member to read, or no argument at all/,
      ],
    ];
    for (let [name, build, pattern] of rejected) {
      assert.throws(build, pattern, `${name} is refused`);
    }
  });

  test('a def with no mutation surface carries only its reads', function (assert) {
    class Bare extends cardAPI.BaseDef {}
    assert.deepEqual(
      getOperations(Bare),
      { read: implied('read'), readSource: implied('readSource') },
      'the two reads are what every addressable def shares',
    );
    assert.throws(
      () => {
        class Mutable extends cardAPI.BaseDef {
          @operation static escalate = {
            base: 'transform',
            set: { status: 'escalated' },
          };
        }
        return Mutable;
      },
      /carries only "read", "readSource"/,
      'and a def that carries no mutation base cannot declare one',
    );
  });

  test('getOperations rejects a target that is not a card definition', function (assert) {
    assert.throws(
      () => getDeclaredOperations({} as never),
      /getDeclaredOperations\(\) takes a class that extends BaseDef/,
      'each reader names itself in its own error',
    );
    assert.throws(
      () => getOperations({} as never),
      /getOperations\(\) takes a class that extends BaseDef/,
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

    // A static that merely carries a string `base` is not an operation.
    class Themed extends CardDef {
      static theme = { base: 'dark', accent: '#fff' };
      @operation static ping = {
        base: 'read',
      } satisfies OperationsModule.OperationDeclaration;
    }
    expectTypeEquals<
      'ping',
      keyof OperationsModule.OperationsOf<typeof Themed>
    >();
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Themed)),
      ['ping'],
      'and the reader agrees with the type at run time',
    );

    class Classroom extends CardDef {
      @operation static addActivity = addActivity;
    }
    assert.deepEqual(
      Object.keys(
        (
          getDeclaredOperations(Classroom)
            .addActivity as OperationsModule.TransformOperationDeclaration
        ).params ?? {},
      ),
      ['note', 'activity'],
      'a scalar param and a link param sit in the same schema',
    );
    assert.deepEqual(
      bodyReference,
      { $ref: 'params', key: 'body' },
      'the key a reference names is carried in the marker and in its type',
    );
    assert.deepEqual(
      Object.keys(getDeclaredOperations(Report)),
      ['addComment'],
      'a declaration written against the exported types is recorded like any other',
    );
  });
});
