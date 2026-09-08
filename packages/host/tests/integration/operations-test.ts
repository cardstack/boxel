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
let getDeclaredOperations: (typeof OperationsModule)['getDeclaredOperations'];
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
        read: { base: 'read' },
        create: { base: 'create' },
        update: { base: 'update' },
        delete: { base: 'delete' },
        query: { base: 'query' },
        transform: { base: 'transform' },
      },
      'a card def carries all six, implied by the def type',
    );
    assert.deepEqual(
      Object.keys(getDeclaredOperations(CardDef)),
      [],
      'none of which is written in author code',
    );
    assert.deepEqual(
      getOperations(FileDef),
      { read: { base: 'read' } },
      "a file's metadata is read-only, so a file def carries only read",
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
      ['create', 'delete', 'query', 'read', 'transform', 'update'],
      'and adds no name, because it is that base operation',
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
      /carries only "read"/,
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
          filter: { any: [{ on: () => Activity }], eq: { status: 'open' } },
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
            query: { filter: { on: CardDef }, page: { size: 0 } },
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
            query: { filter: { on: CardDef }, realms: 'https://x/' as never },
          };
        }
        return Report;
      },
      /non-empty array of realm URLs/,
      'and realms is the fan-out list, not one realm',
    );
  });

  test('the bxl tag reports being called as a function', function (assert) {
    assert.throws(
      () => (bxl as unknown as (parts: string[]) => unknown)(['.a = 1;']),
      /template tag/,
      'every reference constructor says what it wanted',
    );
  });

  test('getOperations rejects a target that is not a card definition', function (assert) {
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
