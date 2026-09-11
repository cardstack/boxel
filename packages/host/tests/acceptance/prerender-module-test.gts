import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealmRRI,
  rri,
  trimExecutableExtension,
  type OperationLoweringDiagnostic,
  type RenderRouteOptions,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  captureModuleResult,
  createPrerenderAuth,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';

module('Acceptance | prerender | module', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let adapter: TestRealmAdapter;
  let realm: Realm;

  const DEFAULT_MODULE_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({} as RenderRouteOptions),
  );
  const modulePath = (
    url: string,
    nonce = 0,
    optionsSegment = DEFAULT_MODULE_OPTIONS_SEGMENT,
  ) => `/module/${encodeURIComponent(url)}/${nonce}/${optionsSegment}`;
  const PERSON_MODULE = `
    import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';

    export class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
    }
  `;
  const PARENT_MODULE = `
    import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';

    export class Parent extends CardDef {
      static displayName = 'Parent';
      @field cardTitle = contains(StringField);
    }
  `;
  const CHILD_MODULE = `
    import { Parent } from './parent';
    import { field, contains, StringField } from '@cardstack/base/card-api';

    export class Child extends Parent {
      static displayName = 'Child';
      @field nickname = contains(StringField);
    }
  `;
  const BROKEN_MODULE = `export const Broken = ;`;
  // One resolvable `searchable` path (author → name) and one unresolvable one
  // (reviewer → bogus). Definition-build validation records only the bad path
  // on `meta.diagnostics.searchablePathIssues`, tagged with its owning def.
  const SEARCHABLE_MODULE = `
    import { CardDef, field, contains, linksTo, StringField } from '@cardstack/base/card-api';

    export class SearchAuthor extends CardDef {
      static displayName = 'SearchAuthor';
      @field name = contains(StringField);
    }

    export class SearchArticle extends CardDef {
      static displayName = 'SearchArticle';
      @field title = contains(StringField);
      @field author = linksTo(() => SearchAuthor, { searchable: 'name' });
      @field reviewer = linksTo(() => SearchAuthor, { searchable: 'bogus' });
    }
  `;
  // The three `BaseDef` families in one module, so a single visit shows how
  // definition build classifies each of them.
  const FAMILIES_MODULE = `
    import { CardDef, FieldDef, field, contains, StringField } from '@cardstack/base/card-api';
    import { FileDef } from '@cardstack/base/file-api';

    export class Caption extends FieldDef {
      static displayName = 'Caption';
      @field text = contains(StringField);
    }

    export class Photo extends CardDef {
      static displayName = 'Photo';
      @field caption = contains(Caption);
    }

    export class PhotoFile extends FileDef {
      static displayName = 'PhotoFile';
    }

    export class PlainFile extends FileDef {}
  `;
  // One declaration that lowers cleanly (Note.addTag) and one whose clause
  // names a field the type does not have (Note.addNote), so the same visit
  // covers both the captured `operations` and the recorded findings.
  const OPERATIONS_MODULE = `
    import { CardDef, field, contains, containsMany, StringField } from '@cardstack/base/card-api';
    import { operation, params } from '@cardstack/base/operations';

    export class Note extends CardDef {
      static displayName = 'Note';
      @field body = contains(StringField);
      @field tags = containsMany(StringField);

      @operation static addTag = {
        base: 'transform',
        params: { tag: StringField },
        append: { to: 'tags', value: params('tag') },
      };

      @operation static addNote = {
        base: 'transform',
        params: { text: StringField },
        set: { bdy: params('text') },
      };
    }
  `;

  hooks.beforeEach(async function () {
    ({ adapter, realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'person.gts': PERSON_MODULE,
          'parent.gts': PARENT_MODULE,
          'child.gts': CHILD_MODULE,
          'broken.gts': BROKEN_MODULE,
          'searchable-card.gts': SEARCHABLE_MODULE,
          'note.gts': OPERATIONS_MODULE,
          'families.gts': FAMILIES_MODULE,
        },
      }),
    ));
  });

  test('captures module metadata when module loads successfully', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;

    await visit(modulePath(moduleURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'ready', 'route reports ready status');
    assert.strictEqual(model.id, moduleURL, 'returns module id');
    assert.false(model.isShimmed, 'module is not marked shimmed');
    assert.ok(model.lastModified > 0, 'lastModified recorded');
    assert.ok(model.createdAt > 0, 'createdAt recorded');

    let personKey = `${trimExecutableExtension(rri(moduleURL))}/Person`;
    assert.ok(personKey in model.definitions, 'includes person definition');

    let personEntry = model.definitions[personKey];
    assert.strictEqual(
      personEntry.type,
      'definition',
      'person definition entry',
    );
    assert.strictEqual(
      personEntry.definition.type,
      'card-def',
      'captures definition details',
    );
    assert.strictEqual(
      personEntry.moduleURL,
      trimExecutableExtension(rri(moduleURL)),
      'moduleURL exposes trimmed module path',
    );
    assert.ok(
      personEntry.types.includes(personKey),
      'types include the card itself',
    );
    assert.ok(
      personEntry.types.includes(`${baseRealmRRI}card-api/CardDef`),
      'types include base card',
    );
  });

  test('classifies each of the three BaseDef families', async function (assert) {
    // A file is a sibling of a card under `BaseDef`, not a kind of field: it
    // has a URL and content-derived metadata, so the entry a consumer reads to
    // decide what a target supports has to tell it apart from a field.
    let moduleURL = `${testRealmURL}families.gts`;

    await visit(modulePath(moduleURL));
    let { model } = captureModuleResult();

    let moduleAlias = trimExecutableExtension(rri(moduleURL));
    let definitionFor = (name: string) => {
      let entry = model.definitions[`${moduleAlias}/${name}`];
      assert.strictEqual(entry?.type, 'definition', `${name} has a definition`);
      return entry?.type === 'definition' ? entry.definition : undefined;
    };
    let photo = definitionFor('Photo');
    let caption = definitionFor('Caption');
    let photoFile = definitionFor('PhotoFile');

    assert.strictEqual(photo?.type, 'card-def', 'a card def is a card def');
    assert.strictEqual(
      caption?.type,
      'field-def',
      'a field def is a field def',
    );
    assert.strictEqual(photoFile?.type, 'file-def', 'a file def is a file def');

    // Every family declares a display name on its class; the entry records one
    // only for the families a consumer can address by URL.
    assert.strictEqual(photo?.displayName, 'Photo', "a card's display name");
    assert.strictEqual(
      photoFile?.displayName,
      'PhotoFile',
      "a file's display name",
    );
    assert.strictEqual(
      caption?.displayName,
      null,
      'the entry for a field def records none',
    );
    // A file def that declares no name of its own still records one: the entry
    // carries whatever the class resolves to, inherited included.
    assert.strictEqual(
      definitionFor('PlainFile')?.displayName,
      'File',
      "an undeclared file def's inherited display name",
    );

    // A file def's own fields are captured the same way a card's are, so a
    // consumer reads a file's metadata off its entry without loading the
    // module.
    assert.ok(
      'contentType' in (photoFile?.fields ?? {}),
      "a file def's fields are captured",
    );

    // Ancestry is recorded for both families that have one to filter on, each
    // walked up to its own family's root. A field def has no URL, so none.
    let typesFor = (name: string) => {
      let entry = model.definitions[`${moduleAlias}/${name}`];
      return entry?.type === 'definition' ? entry.types : [];
    };
    assert.ok(
      typesFor('Photo').includes(`${baseRealmRRI}card-api/CardDef`),
      "a card's ancestry reaches CardDef",
    );
    assert.ok(
      typesFor('PhotoFile').includes(`${moduleAlias}/PhotoFile`),
      "a file's ancestry includes itself",
    );
    assert.ok(
      typesFor('PhotoFile').includes(`${baseRealmRRI}card-api/FileDef`),
      "a file's ancestry reaches FileDef",
    );
    assert.notOk(
      typesFor('PhotoFile').includes(`${baseRealmRRI}card-api/CardDef`),
      "a file's ancestry stops at its own family root",
    );
    assert.deepEqual(
      typesFor('Caption'),
      [],
      'a field def records no ancestry',
    );
  });

  test('surface a top-level error when module import fails', async function (assert) {
    let missingURL = `${testRealmURL}missing.gts`;

    await visit(modulePath(missingURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'error', 'capture reports error status');
    assert.strictEqual(model.status, 'error', 'model status is error');
    assert.ok(model.error, 'model contains error entry');
    assert.strictEqual(
      model.error.error.status,
      404,
      'error status is correct',
    );
  });

  test('surface a compile error when module has syntax error', async function (assert) {
    let brokenURL = `${testRealmURL}broken.gts`;

    await visit(modulePath(brokenURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'error', 'capture reports error status');
    assert.strictEqual(model.status, 'error', 'model status is error');
    assert.ok(model.error, 'model contains error entry');
    assert.strictEqual(
      model.error.error.status,
      406,
      'compile error surfaces as 406',
    );
    assert.strictEqual(
      model.error.error.message,
      `Parse Error at broken.gts:1:23: 1:24 (${testRealmURL}broken.gts)`,
      'message includes enough information for AI to fix the problem',
    );
    assert.ok(
      model.error.error.stack?.includes('at transpileJS'),
      `stack should include "at transpileJS" but was ${model.error.error.stack}`,
    );
    assert.strictEqual(
      model.error.error.additionalErrors,
      null,
      'error is primary and not nested in additionalErrors',
    );
    assert.strictEqual(
      Object.keys(model.definitions).length,
      0,
      'no definitions produced when module fails to compile',
    );
  });

  test('identifies shimmed modules', async function (assert) {
    let loaderService = getService('loader-service');
    let loader = loaderService.loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    cardApi = await loader.import('@cardstack/base/card-api');

    let { field, contains, CardDef, StringField } = cardApi;
    class Shimmed extends CardDef {
      static displayName = 'Shimmed';
      @field name = contains(StringField);
    }

    let shimURL = `${testRealmURL}shimmed.gts`;
    loader.shimModule(shimURL, { Shimmed });

    await visit(modulePath(shimURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'ready', 'shimmed module still resolves');
    assert.true(model.isShimmed, 'module flagged as shimmed');
    assert.strictEqual(
      model.lastModified,
      0,
      'shimmed module lastModified zeroed',
    );
    assert.strictEqual(model.createdAt, 0, 'shimmed module createdAt zeroed');
    assert.deepEqual(
      model.deps,
      [trimExecutableExtension(rri(shimURL))],
      'deps limited to shimmed file',
    );

    let shimKey = `${trimExecutableExtension(rri(shimURL))}/Shimmed`;
    let shimEntry = model.definitions[shimKey];
    assert.ok(shimEntry, 'definition generated for shimmed export');
    assert.strictEqual(shimEntry.type, 'definition', 'shim definition entry');
    assert.strictEqual(
      shimEntry.moduleURL,
      trimExecutableExtension(rri(shimURL)),
      'moduleURL always omits executable extension',
    );
  });

  test('card prerenderer can prerender modules', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;
    let prerenderer = getService('local-indexer').prerenderer;
    let permissions: RealmPermissions = {
      [testRealmURL]: ['read', 'write', 'realm-owner'],
    };
    let auth = createPrerenderAuth('@testuser:localhost', permissions);

    let response = await prerenderer.prerenderModule({
      affinityType: 'realm',
      affinityValue: testRealmURL,
      realm: testRealmURL,
      url: moduleURL,
      auth,
    });

    assert.strictEqual(
      response.status,
      'ready',
      'module prerender reports ready',
    );
    assert.strictEqual(response.id, moduleURL, 'module id echoed back');
    let key = `${trimExecutableExtension(rri(moduleURL))}/Person`;
    assert.ok(response.definitions[key], 'definition captured');
    assert.strictEqual(
      response.definitions[key]?.type,
      'definition',
      'definition entry returned',
    );
  });

  test('card prerenderer surfaces module errors', async function (assert) {
    let moduleURL = `${testRealmURL}broken.gts`;
    let prerenderer = getService('local-indexer').prerenderer;
    let permissions: RealmPermissions = {
      [testRealmURL]: ['read', 'write', 'realm-owner'],
    };
    let auth = createPrerenderAuth('@testuser:localhost', permissions);

    let response = await prerenderer.prerenderModule({
      affinityType: 'realm',
      affinityValue: testRealmURL,
      realm: testRealmURL,
      url: moduleURL,
      auth,
    });

    assert.strictEqual(
      response.status,
      'error',
      'module prerender reports error',
    );
    assert.ok(response.error, 'error payload present');
    assert.strictEqual(
      response.error?.error.status,
      406,
      'compile error status surfaced',
    );
  });

  test('module prerender captures updated definitions after clear cache', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;

    await visit(modulePath(moduleURL));
    let initial = captureModuleResult();

    let definitionKey = `${trimExecutableExtension(rri(moduleURL))}/Person`;
    let initialEntry = initial.model.definitions[definitionKey];
    assert.ok(initialEntry, 'initial definition exists');
    assert.strictEqual(
      initialEntry?.type,
      'definition',
      'initial definition entry present',
    );
    assert.strictEqual(
      initialEntry?.type === 'definition'
        ? initialEntry.definition.displayName
        : undefined,
      'Person',
      'initial display name recorded',
    );

    await adapter.write(
      'person.gts',
      `
      import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';

      export class Person extends CardDef {
        static displayName = 'Updated Person';
        @field name = contains(StringField);
      }
    `,
    );
    realm.__testOnlyClearCaches();

    await visit(modulePath(moduleURL));
    let cached = captureModuleResult();
    let cachedEntry = cached.model.definitions[definitionKey];
    assert.ok(cachedEntry, 'cached definition exists');
    assert.strictEqual(
      cachedEntry?.type,
      'definition',
      'cached definition entry present',
    );
    assert.strictEqual(
      cachedEntry?.type === 'definition'
        ? cachedEntry.definition.displayName
        : undefined,
      'Person',
      'cache retains original display name without clearCache flag',
    );

    let clearOptionsSegment = encodeURIComponent(
      JSON.stringify({ clearCache: true } as RenderRouteOptions),
    );

    await visit(modulePath(moduleURL, 1, clearOptionsSegment));
    let updated = captureModuleResult();
    let updatedEntry = updated.model.definitions[definitionKey];
    assert.ok(updatedEntry, 'updated definition exists');
    assert.strictEqual(
      updatedEntry?.type,
      'definition',
      'updated definition entry present',
    );
    assert.strictEqual(
      updatedEntry?.type === 'definition'
        ? updatedEntry.definition.displayName
        : undefined,
      'Updated Person',
      'updated display name observed after clearCache flag',
    );
  });

  test('records unresolvable searchable paths on meta.diagnostics, tagged with the owning def', async function (assert) {
    let moduleURL = `${testRealmURL}searchable-card.gts`;

    await visit(modulePath(moduleURL));
    let { status, model } = captureModuleResult();
    assert.strictEqual(status, 'ready', 'module loads');

    let articleKey = `${trimExecutableExtension(rri(moduleURL))}/SearchArticle`;
    assert.deepEqual(
      model.meta?.diagnostics?.searchablePathIssues,
      [{ codeRef: articleKey, fieldName: 'reviewer', path: 'bogus' }],
      'only the unresolvable path is recorded, tagged with its owning def — the resolvable author→name path is not',
    );
  });

  test('a module with no searchable annotations produces no diagnostics meta (inert)', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;

    await visit(modulePath(moduleURL));
    let { model } = captureModuleResult();
    assert.strictEqual(
      model.meta?.diagnostics?.searchablePathIssues,
      undefined,
      'no searchablePathIssues meta when nothing is annotated',
    );
  });

  test('captures lowered @operation declarations onto the definition entry', async function (assert) {
    let moduleURL = `${testRealmURL}note.gts`;

    await visit(modulePath(moduleURL));
    let { status, model } = captureModuleResult();
    assert.strictEqual(status, 'ready', 'module loads');

    let noteKey = `${trimExecutableExtension(rri(moduleURL))}/Note`;
    let entry = model.definitions[noteKey];
    assert.strictEqual(entry?.type, 'definition', 'the definition was built');
    let operations =
      entry?.type === 'definition' ? entry.definition.operations : undefined;
    assert.deepEqual(
      Object.keys(operations ?? {}).sort(),
      ['addNote', 'addTag'],
      'both declarations are captured — a declaration with findings is stored too, so invoking it reports them rather than reading as unknown',
    );
    assert.deepEqual(
      operations?.addTag.program,
      { source: 'append(.tags;params("tag"));', syntax: 'solidified' },
      'the convenience clause reaches the entry as canonical BXL',
    );
    assert.true(operations?.addNote.invalid, 'the bad declaration is flagged');
  });

  test('records operation-lowering findings on meta.diagnostics, tagged with the owning def', async function (assert) {
    let moduleURL = `${testRealmURL}note.gts`;

    await visit(modulePath(moduleURL));
    let { model } = captureModuleResult();

    let noteKey = `${trimExecutableExtension(rri(moduleURL))}/Note`;
    assert.deepEqual(
      model.meta?.diagnostics?.operationIssues?.map(
        (issue: OperationLoweringDiagnostic) => ({
          codeRef: issue.codeRef,
          code: issue.code,
          operation: issue.operation,
          path: issue.path,
        }),
      ),
      [
        {
          codeRef: noteKey,
          code: 'unknown-field',
          operation: 'addNote',
          path: 'set.bdy',
        },
      ],
      'only the bad clause is recorded, tagged with its owning def',
    );
  });

  test('a module that declares no operations produces no operations key and no findings', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;

    await visit(modulePath(moduleURL));
    let { model } = captureModuleResult();

    let personKey = `${trimExecutableExtension(rri(moduleURL))}/Person`;
    let entry = model.definitions[personKey];
    assert.strictEqual(entry?.type, 'definition', 'the definition was built');
    assert.notOk(
      entry?.type === 'definition'
        ? 'operations' in entry.definition
        : undefined,
      'the definition entry for every existing card is unchanged',
    );
    assert.strictEqual(
      model.meta?.diagnostics?.operationIssues,
      undefined,
      'and no operationIssues meta is emitted',
    );
  });
});
