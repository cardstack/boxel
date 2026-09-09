import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  fetcher,
  getFieldDefinitions,
  identifyCard,
  loadCardDef,
  maybeHandleScopedCSSRequest,
  type CodeRef,
  type Definition,
  type LowerOperationDeclarationsResult,
} from '@cardstack/runtime-common';
import { lowerOperationDeclarations } from '@cardstack/runtime-common/card-operations';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

import { testRealmURL } from '../helpers';

import type { BaseDef, CardDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

let { resolvedBaseRealmURL } = ENV;

// Lowering turns an `@operation` declaration — which references classes and
// spells its work in convenience clauses — into the base-operation data plus
// BXL the realm executes. The BXL is asserted verbatim: the program text is
// the contract with the executor, and a canonicalization change that alters
// it is exactly what these assertions exist to catch.
module('Unit | operation lowering', function (hooks) {
  let loader: Loader;
  let api: typeof CardAPI;
  let operations: typeof OperationsModule;
  let virtualNetwork: VirtualNetwork;
  let StringField: typeof CardAPI.FieldDef;
  let NumberField: typeof CardAPI.FieldDef;
  // Shared shapes the per-test card classes link to and contain.
  let fixtures: {
    Author: typeof CardDef;
    Comment: typeof CardAPI.FieldDef;
    Activity: typeof CardDef;
  };

  hooks.beforeEach(async function () {
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${ENV.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    shimExternals(virtualNetwork);
    let fetch = fetcher(virtualNetwork.fetch, [
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
    ]);
    loader = new Loader(fetch, virtualNetwork.resolveImport, {
      virtualNetwork,
    });

    api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    operations = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    );
    ({ default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string'));
    ({ default: NumberField } = await loader.import<
      typeof import('@cardstack/base/number')
    >('@cardstack/base/number'));

    let { field, contains, linksTo, CardDef, FieldDef } = api;

    class Author extends CardDef {
      static displayName = 'Author';
      @field name = contains(StringField);
    }
    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
    }
    class Comment extends FieldDef {
      static displayName = 'Comment';
      @field body = contains(StringField);
      @field author = linksTo(() => Author);
      @field where = contains(Address);
    }
    class Activity extends CardDef {
      static displayName = 'Activity';
      @field label = contains(StringField);
      @field owner = linksTo(() => Author);
    }
    shim({ Author, Address, Comment, Activity });
    fixtures = {
      Author: Author as unknown as typeof CardDef,
      Comment: Comment as unknown as typeof CardAPI.FieldDef,
      Activity: Activity as unknown as typeof CardDef,
    };
  });

  // Register a class under `${testRealmURL}<name>` so `identifyCard` names it
  // and `lookupDefinition` can load it back.
  function shim(exports: Record<string, typeof BaseDef>) {
    for (let [name, def] of Object.entries(exports)) {
      loader.shimModule(`${testRealmURL}${name.toLowerCase()}`, {
        [name]: def,
      });
    }
  }

  function buildDefinition(def: typeof BaseDef): Definition {
    let { fields, fieldDefs } = getFieldDefinitions(api, def);
    return {
      codeRef: identifyCard(def)!,
      displayName: (def as typeof CardDef).displayName ?? null,
      fields,
      fieldDefs,
      type: 'card-def',
    };
  }

  // Resolve a code ref through the loader, the way the module-prerender route
  // does — so a path may reach a base-realm type (`cardInfo`) as readily as a
  // shimmed one.
  async function lookupDefinition(
    codeRef: CodeRef,
  ): Promise<Definition | undefined> {
    try {
      return buildDefinition(await loadCardDef(codeRef, { loader }));
    } catch {
      return undefined;
    }
  }

  // Lower every operation declared on `def`, the way the module-prerender
  // route does when it builds the def's definition-cache entry.
  async function lower(
    def: typeof BaseDef,
  ): Promise<LowerOperationDeclarationsResult> {
    return await lowerOperationDeclarations(
      operations.getDeclaredOperations(def),
      {
        definition: buildDefinition(def),
        lookupDefinition,
        identifyCard: (target) => identifyCard(target),
      },
    );
  }

  function codes(result: LowerOperationDeclarationsResult): string[] {
    return result.issues.map((issue) => issue.code);
  }

  // -------------------------------------------------------------------------
  // The convenience forms
  // -------------------------------------------------------------------------

  test('append lowers to an append statement, with a link-typed member as a card identity', async function (assert) {
    let { field, contains, containsMany, CardDef } = api;
    let { operation, params, actor } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field comments = containsMany(fixtures.Comment);
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField },
        append: {
          to: 'comments',
          value: { body: params('body'), author: actor() },
        },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered, issues } = await lower(Report);
    assert.deepEqual(issues, [], 'the declaration lowers cleanly');
    assert.deepEqual(
      lowered.addComment,
      {
        base: 'transform',
        params: {
          body: { kind: 'field', codeRef: identifyCard(StringField)! },
        },
        program: {
          source:
            'append(.comments;{body:params("body"),author:card(actor("id"))});',
          syntax: 'solidified',
        },
        deterministic: true,
      },
      "`author: actor()` on a linksTo member becomes the actor's card identity",
    );
  });

  test('set lowers to one assignment per field, and a scalar reference stays a bare builtin', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, params, actor } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field status = contains(StringField);
      @field closedBy = contains(StringField);
      @field owner = api.linksTo(() => fixtures.Author);
      @operation static close = {
        base: 'transform',
        params: { note: StringField },
        set: {
          status: 'closed',
          closedBy: actor('id'),
          owner: actor(),
          'cardInfo.notes': params('note'),
        },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered, issues } = await lower(Report);
    assert.deepEqual(issues, [], 'the declaration lowers cleanly');
    assert.strictEqual(
      lowered.close.program?.source,
      [
        '.status="closed";',
        '.closedBy=actor("id");',
        '.owner=card(actor("id"));',
        '.cardInfo.notes=params("note");',
      ].join('\n'),
      'a scalar field reads the builtin directly, a link wraps it in card()',
    );
  });

  test('assert lowers to a uniqueness precondition keyed by the collection kind', async function (assert) {
    let { field, contains, containsMany, linksToMany, CardDef } = api;
    let { operation, params, actor } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field tags = containsMany(StringField);
      @field reviewers = linksToMany(() => fixtures.Author, {
        searchable: true,
      });
      @field title = contains(StringField);
      @operation static addTag = {
        base: 'transform',
        params: { tag: StringField },
        assert: {
          unique: 'tags',
          by: params('tag'),
          message: 'already tagged',
        },
        append: { to: 'tags', value: params('tag') },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static addReviewer = {
        base: 'transform',
        params: { who: StringField },
        assert: { unique: 'reviewers', by: params('who'), snapshot: true },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static claimReview = {
        base: 'transform',
        assert: { unique: 'reviewers', by: actor(), snapshot: true },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered, issues } = await lower(Report);
    assert.deepEqual(issues, [], 'both declarations lower cleanly');
    assert.strictEqual(
      lowered.addTag.program?.source,
      [
        'assert(all(.tags[];.!=params("tag"));"already tagged");',
        'append(.tags;params("tag"));',
      ].join('\n'),
      'a contained collection compares the item itself, and the precondition runs before the write',
    );
    assert.strictEqual(
      lowered.addReviewer.program?.source,
      'assert(all(.reviewers[];.id!=params("who"));"reviewers already holds this value");',
      'a link collection compares the linked card id against the identity itself — not against a card() projection — and an omitted message gets a default',
    );
    assert.strictEqual(
      lowered.claimReview.program?.source,
      'assert(all(.reviewers[];.id!=actor("id"));"reviewers already holds this value");',
      'a keyless actor() being compared narrows to the id it is compared against, the way it does on its way into a link — the whole record would never equal an id string, so the check would hold for every item',
    );
    assert.true(
      lowered.addReviewer.snapshot,
      'the gathering the author opted into travels with the program that needs it',
    );
    assert.strictEqual(
      lowered.addTag.snapshot,
      undefined,
      'while an assert the stored document can answer asks for none',
    );
  });

  test('a create lowers `of` to a code ref and keeps `fill` a marker-carrying template', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, params, actor, linkTo } = operations;
    class Classroom extends CardDef {
      static displayName = 'Classroom';
      @field name = contains(StringField);
      @operation static addActivity = {
        base: 'create',
        params: { label: StringField, teacher: linkTo(() => fixtures.Author) },
        of: () => fixtures.Activity,
        fill: { label: params('label'), owner: actor() },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Classroom });

    let { operations: lowered, issues } = await lower(Classroom);
    assert.deepEqual(issues, [], 'the declaration lowers cleanly');
    assert.deepEqual(
      lowered.addActivity,
      {
        base: 'create',
        params: {
          label: { kind: 'field', codeRef: identifyCard(StringField)! },
          teacher: { kind: 'link', codeRef: identifyCard(fixtures.Author)! },
        },
        of: identifyCard(fixtures.Activity),
        fill: {
          label: { $ref: 'params', key: 'label' },
          owner: { $ref: 'actor' },
        },
        deterministic: true,
      },
      'a linkTo param is a link entry and fill stays data for the coordinator to substitute',
    );
  });

  test('a query lowers to an entry-wire query template with code refs in the type slots', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, actor, params } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @operation static mine = {
        base: 'query',
        params: { term: StringField },
        query: {
          filter: {
            on: () => fixtures.Author,
            eq: { name: actor('id') },
          },
          sort: [{ by: 'name', on: () => fixtures.Author, direction: 'desc' }],
          page: { size: 20, number: 0 },
          queryString: params('term'),
          realms: [testRealmURL],
        },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered, issues } = await lower(Report);
    assert.deepEqual(issues, [], 'the declaration lowers cleanly');
    assert.deepEqual(
      lowered.mine.query,
      {
        filter: {
          every: [
            {
              'item.on': identifyCard(fixtures.Author),
              eq: { 'item.name': { $ref: 'actor', key: 'id' } },
            },
            { matches: { $ref: 'params', key: 'term' } },
          ],
        },
        sort: [
          {
            by: 'item.name',
            'item.on': identifyCard(fixtures.Author),
            direction: 'desc',
          },
        ],
        page: { size: 20, number: 0 },
        realms: [testRealmURL],
      },
      'the type anchors resolve to code refs, field paths gain item. addressing, and the declared term becomes a matches conjunct',
    );
  });

  test('a raw program is canonicalized rather than stored as written', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, bxl } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field status = contains(StringField);
      @field revision = contains(NumberField);
      @operation static escalate = {
        base: 'transform',
        transformations: bxl`.status = "escalated"; .revision = IF(.revision = null; 1; .revision + 1);`,
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered, issues } = await lower(Report);
    assert.deepEqual(issues, [], 'the program parses');
    assert.deepEqual(
      lowered.escalate.program,
      {
        source:
          '.status="escalated";\n.revision=IF(.revision==null;1;.revision+1);',
        syntax: 'solidified',
      },
      "the author's Excel-style comparison is stored in canonical form",
    );
  });

  test('an output projection lowers to the program it describes', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, actor } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @operation static read: OperationsModule.OperationDeclaration = {
        base: 'read',
        output: { label: actor('id') },
      };
    }
    shim({ Report });

    let { operations: lowered, issues } = await lower(Report);
    assert.deepEqual(issues, [], 'the projection lowers cleanly');
    assert.deepEqual(
      lowered.read,
      {
        base: 'read',
        output: { source: '{label:actor("id")}', syntax: 'solidified' },
        deterministic: true,
      },
      'a declarative projection and a raw program reach the realm in one form',
    );
  });

  test('an author-supplied optimistic flag is carried through', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field status = contains(StringField);
      @operation static close = {
        base: 'transform',
        optimistic: false,
        set: { status: 'closed' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered } = await lower(Report);
    assert.false(
      lowered.close.optimistic,
      "the author's override reaches the client unchanged",
    );
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------

  test('a volatile call makes an operation non-deterministic; the request context does not', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, params, actor, bxl } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @operation static stamped: OperationsModule.OperationDeclaration = {
        base: 'read',
        output: bxl`{ label: .title, at: TODAY() }`,
      };
      @operation static contextual = {
        base: 'transform',
        params: { note: StringField },
        set: { title: params('note') },
        output: { who: actor('id') },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered } = await lower(Report);
    assert.false(
      lowered.stamped.deterministic,
      'TODAY() yields a different value on every run, so the ledger cannot replay it locally',
    );
    assert.true(
      lowered.contextual.deterministic,
      'params(), actor() and instance() are fixed for a given request',
    );
  });

  test('a field named after a volatile builtin is not read as a call', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field today = contains(StringField);
      @operation static touch = {
        base: 'transform',
        set: { today: 'noted' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let { operations: lowered } = await lower(Report);
    assert.strictEqual(lowered.touch.program?.source, '.today="noted";');
    assert.true(
      lowered.touch.deterministic,
      'a field access is not a volatile call',
    );
  });

  // -------------------------------------------------------------------------
  // Issues — recorded, never thrown, and the operation is still stored
  // -------------------------------------------------------------------------

  test('a clause naming a field the type does not have is recorded', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @operation static close = {
        base: 'transform',
        set: { staus: 'closed' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['unknown-field']);
    assert.strictEqual(result.issues[0].operation, 'close');
    assert.strictEqual(result.issues[0].path, 'set.staus');
    assert.strictEqual(
      result.issues[0].message,
      '"staus" is not a field of this type',
    );
    let lowered = result.operations.close;
    assert.true(
      lowered.invalid,
      'the operation is stored flagged invalid, so invoking it reports the problem rather than reading as unknown',
    );
    assert.deepEqual(lowered.issues, result.issues);
    assert.strictEqual(
      lowered.program,
      undefined,
      'and carries no program, since the statement it would have emitted names nothing',
    );
  });

  test('an unknown field inside an appended value is recorded at whatever depth it sits', async function (assert) {
    let { field, contains, containsMany, CardDef } = api;
    let { operation, params } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field comments = containsMany(fixtures.Comment);
      @field title = contains(StringField);
      @operation static addComment = {
        base: 'transform',
        params: { body: StringField, city: StringField },
        append: {
          to: 'comments',
          value: {
            body: params('body'),
            bdy: 'x',
            // A contained value inside the appended item: its keys belong to
            // Address, and the walk resolves that type to check them.
            where: { city: params('city'), citty: 'x' },
          },
        },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['unknown-field', 'unknown-field']);
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ['append.value.bdy', 'append.value.where.citty'],
    );
    assert.true(
      result.issues[0].message.includes('Comment'),
      'the message names the item type the key was checked against',
    );
    assert.true(
      result.issues[1].message.includes('Address'),
      'and the nested key is checked against the type that actually holds it',
    );
  });

  test('params() for a key the schema does not declare is refused in a clause and recorded in a program', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, params, bxl } = operations;

    // The two layers divide the work by what each can see. A clause value is
    // structure the declaration API reads, so it resolves the reference and
    // refuses the declaration where the class is defined — earlier than
    // lowering, and pointing at the line the author wrote.
    assert.throws(
      () => {
        class Flawed extends CardDef {
          static displayName = 'Flawed';
          @field status = contains(StringField);
          @operation static close = {
            base: 'transform',
            params: { note: StringField },
            set: { status: params('reason' as 'note') },
          } satisfies OperationsModule.OperationDeclaration;
        }
        return Flawed;
      },
      /references the param "reason", which the `params` schema does not declare/,
      'an undeclared param in a clause never reaches lowering',
    );

    // Raw program text is what lowering has to catch on its own: the
    // declaration API leaves the references inside a `bxl` program to BXL, so
    // nothing before lowering has read this key.
    class Report extends CardDef {
      static displayName = 'Report';
      @field status = contains(StringField);
      @operation static raw: OperationsModule.OperationDeclaration = {
        base: 'transform',
        params: { note: StringField },
        transformations: bxl`.status = params("reason");`,
      };
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['undeclared-param']);
    assert.deepEqual(
      result.issues.map((issue) => issue.operation),
      ['raw'],
    );
    assert.strictEqual(
      result.issues[0].path,
      'transformations',
      'the finding points at the program rather than at a clause',
    );
  });

  test('a value in a link position that is not a card identity is recorded', async function (assert) {
    let { field, contains, linksTo, linksToMany, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field owner = linksTo(() => fixtures.Author);
      @field reviewers = linksToMany(() => fixtures.Author, {
        searchable: true,
      });
      @operation static misassign = {
        base: 'transform',
        set: { owner: { name: 'Ada' } },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static unassign = {
        base: 'transform',
        set: { owner: null },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static misappend = {
        base: 'transform',
        append: { to: 'reviewers', value: 7 },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), [
      'link-requires-identity',
      'link-requires-identity',
      'link-requires-identity',
    ]);
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ['set.owner', 'set.owner', 'append.value'],
    );
    assert.true(
      result.issues[1].message.includes('already empty'),
      'clearing a link is called out as its own missing spelling rather than as a bad value',
    );
    for (let name of ['misassign', 'unassign', 'misappend']) {
      assert.true(
        result.operations[name].invalid,
        `${name} is flagged rather than stored as though it would run`,
      );
    }
  });

  test('a write into a computed field is recorded', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field slug = contains(StringField, {
        computeVia: function (this: Report) {
          return this.title;
        },
      });
      @operation static rename = {
        base: 'transform',
        set: { slug: 'x' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['computed-write']);
    assert.strictEqual(result.issues[0].path, 'set.slug');
  });

  test('a write through a link is recorded', async function (assert) {
    let { field, contains, linksTo, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field owner = linksTo(() => fixtures.Author, { searchable: true });
      @operation static rename = {
        base: 'transform',
        set: { 'owner.name': 'x' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['write-through-link']);
    assert.strictEqual(
      result.issues[0].path,
      'set.owner.name',
      'an operation binds to its target card, not to the cards it links to',
    );
  });

  test('a read through a link that is not searchable is recorded', async function (assert) {
    let { field, containsMany, linksTo, CardDef } = api;
    let { operation, params } = operations;
    // `Tagger` holds the collection the assertion reads, so the path
    // resolves and the only finding is the link it reads through.
    class Tagger extends CardDef {
      static displayName = 'Tagger';
      @field tags = containsMany(StringField);
    }
    shim({ Tagger });
    class Report extends CardDef {
      static displayName = 'Report';
      @field owner = linksTo(() => Tagger);
      @operation static claim = {
        base: 'transform',
        params: { who: StringField },
        assert: { unique: 'owner.tags', by: params('who'), snapshot: true },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['unsearchable-read']);
    assert.true(
      result.issues[0].message.includes('searchable'),
      "the message says what makes a linked card's values reachable",
    );
  });

  test('an assert over computed or linked values without a snapshot is recorded', async function (assert) {
    let { field, contains, linksToMany, CardDef } = api;
    let { operation, params } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field reviewers = linksToMany(() => fixtures.Author, {
        searchable: true,
      });
      @operation static addReviewer = {
        base: 'transform',
        params: { who: StringField },
        assert: { unique: 'reviewers', by: params('who') },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['unsnapshotted-assert']);
    assert.true(
      result.issues[0].message.includes('snapshot: true'),
      'the message names the clause that resolves it',
    );
    assert.strictEqual(
      result.operations.addReviewer.program?.source,
      'assert(all(.reviewers[];.id!=params("who"));"reviewers already holds this value");',
      'the program is still emitted, so the operation says what it would do',
    );
  });

  test('replacing a whole link collection is recorded — a relationship changes one edge at a time', async function (assert) {
    let { field, contains, linksToMany, CardDef } = api;
    let { operation, params } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field reviewers = linksToMany(() => fixtures.Author);
      @operation static reassign = {
        base: 'transform',
        params: { who: StringField },
        set: { reviewers: [params('who')] },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['link-collection-replace']);
    assert.true(
      result.issues[0].message.includes('append'),
      'the message names the clause that does express the change',
    );
    assert.strictEqual(
      result.operations.reassign.program,
      undefined,
      'and no program is emitted, since an assignment here is not executable',
    );
  });

  test('a write into a query-backed field or into `id` is recorded', async function (assert) {
    let { field, contains, linksTo, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field featured = linksTo(() => fixtures.Author, {
        query: {
          filter: { type: { module: `${testRealmURL}author`, name: 'Author' } },
        },
      } as never);
      @operation static feature = {
        base: 'transform',
        set: { featured: 'http://example.com/a' },
      } satisfies OperationsModule.OperationDeclaration;
      @operation static rename = {
        base: 'transform',
        set: { id: 'http://example.com/r' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['read-only-write', 'read-only-write']);
    assert.true(
      result.issues[0].message.includes('query'),
      'a query-backed field holds no stored value to write',
    );
    assert.true(
      result.issues[1].message.includes('identity'),
      "and `id` is the card's identity rather than its data",
    );
  });

  test('a path that continues past a collection is recorded — no item is named', async function (assert) {
    let { field, contains, containsMany, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @field comments = containsMany(fixtures.Comment);
      @operation static editComment = {
        base: 'transform',
        set: { 'comments.body': 'z' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['path-crosses-collection']);
    assert.true(
      result.issues[0].message.includes('which item'),
      'the message says what the declaration cannot express',
    );
  });

  test('appending to a field that holds one value is recorded', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @operation static addTitle = {
        base: 'transform',
        append: { to: 'title', value: 'x' },
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['not-a-collection']);
  });

  test('a raw program that does not parse is recorded', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation, bxl } = operations;
    class Report extends CardDef {
      static displayName = 'Report';
      @field status = contains(StringField);
      @operation static broken: OperationsModule.OperationDeclaration = {
        base: 'transform',
        transformations: bxl`.status = ;`,
      };
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['invalid-program']);
    assert.strictEqual(result.issues[0].path, 'transformations');
    assert.true(
      result.operations.broken.invalid,
      'the operation is stored so invoking it reports the parse failure',
    );
  });

  test('a class no module exports has no code ref to store', async function (assert) {
    let { field, contains, CardDef } = api;
    let { operation } = operations;
    // Never shimmed, so `identifyCard` cannot name it.
    class Unexported extends CardDef {
      static displayName = 'Unexported';
      @field name = contains(StringField);
    }
    class Report extends CardDef {
      static displayName = 'Report';
      @field title = contains(StringField);
      @operation static make = {
        base: 'create',
        of: () => Unexported as unknown as typeof CardDef,
      } satisfies OperationsModule.OperationDeclaration;
    }
    shim({ Report });

    let result = await lower(Report);
    assert.deepEqual(codes(result), ['unresolved-type']);
    assert.strictEqual(result.issues[0].path, 'of');
    assert.strictEqual(result.operations.make.of, undefined);
  });

  test('a def that declares nothing lowers to nothing', async function (assert) {
    let { field, contains, CardDef } = api;
    class Plain extends CardDef {
      static displayName = 'Plain';
      @field title = contains(StringField);
    }
    shim({ Plain });

    let result = await lower(Plain);
    assert.deepEqual(
      result,
      { operations: {}, issues: [] },
      'the base operations a def type carries are not declarations, so there is nothing to lower',
    );
  });
});
