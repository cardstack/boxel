import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  fillIn,
  find,
  render,
  waitUntil,
  waitFor,
  click,
  RenderingTestContext,
} from '@ember/test-helpers';
import Go from '@cardstack/host/components/editor/go';
import { Realm } from '@cardstack/runtime-common/realm';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealmAdapter,
  TestRealm,
  setupCardLogs,
  setupLocalIndexing,
  testRealmURL,
  MockResponse,
} from '../../helpers';
import CardPrerender from '@cardstack/host/components/card-prerender';
import MonacoService from '@cardstack/host/services/monaco-service';
import type {
  MonacoSDK,
  IStandaloneCodeEditor,
} from '@cardstack/host/services/monaco-service';
import CodeController from '@cardstack/host/controllers/code';
import CodeService from '@cardstack/host/services/code-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import { Loader } from '@cardstack/runtime-common/loader';
import { formatRFC7231 } from 'date-fns';
import GlimmerComponent from '@glimmer/component';
import { renderComponent } from '../../helpers/render-component';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import { shimExternals } from '@cardstack/host/lib/externals';
import { isScopedCSSRequest } from 'glimmer-scoped-css';

const sourceContent = `
import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Person extends CardDef {
  @field name = contains(StringCard);
}
`;

export const setupLoaderWithHandler = (
  loader: Loader,
  realm: Realm,
  moduleMap: Record<string, string>,
  opts: { lastModified: string } = {
    lastModified: formatRFC7231(new Date(Date.now())),
  },
) => {
  let customHandler = async (r: Request) => {
    console.log('custom handler');
    console.log(r.url);
    for (let k of Object.keys(moduleMap)) {
      if (r.url == `${testRealmURL}${k}` && r.method === 'GET')
        return new MockResponse(
          moduleMap[k],
          {
            headers: {
              'Content-Type': 'application/vnd.card+source',
              'Last-Modified': opts.lastModified,
              'X-Boxel-Realm-Url': testRealmURL,
            },
          },
          r.url,
        );
    }
    return null;
  };
  loader.setURLHandlers([customHandler, realm.maybeHandle.bind(realm)]);
};

const jsonContent = {
  data: {
    type: 'card',
    id: `${testRealmURL}Person/hassan`,
    attributes: {
      name: 'Hassan',
    },
    meta: {
      adoptsFrom: {
        module: `${testRealmURL}person`,
        name: 'Person',
      },
    },
  },
};

let moduleMap: Record<string, string> = {
  'person.gts': sourceContent,
  'Person/hassan.json': JSON.stringify(jsonContent, null, 2),
};

module('Integration | Component | go', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  let monacoService: MonacoService;
  let mockOpenFiles: OpenFiles;
  let editor: IStandaloneCodeEditor;
  let monacoContext: MonacoSDK;
  let loader: Loader;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
  });
  hooks.beforeEach(async function () {
    adapter = new TestRealmAdapter(moduleMap);
    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;
    let codeController = new CodeController();
    codeController.codeService = new CodeService();
    await realm.ready;
  });
  hooks.afterEach(async function () {
    await waitFor('[data-test-isLoadIdle]');
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('When no file is selected, displays file tree only', async function (assert) {
    monacoContext = await monacoService.getMonacoContext();
    let onEditorSetup = function (receivedEditor: IStandaloneCodeEditor) {
      editor = receivedEditor;
    };
    setupLoaderWithHandler(loader, realm, moduleMap);
    await render(<template>
      <Go @monaco={{monacoContext}} @onEditorSetup={{onEditorSetup}} />
      <CardPrerender />
    </template>);

    await waitFor('[data-test-file]');
    assert.dom('[data-test-file="person.gts"]').exists();
    assert.dom('[data-test-editor').doesNotExist();
    assert.dom('[data-test-card-id]').doesNotExist();
  });

  test('When a source file is selected in the file tree, can update and save new content', async function (assert) {
    monacoContext = await monacoService.getMonacoContext();

    let onEditorSetup = function (receivedEditor: IStandaloneCodeEditor) {
      editor = receivedEditor;
    };
    await render(<template>
      <Go @monaco={{monacoContext}} @onEditorSetup={{onEditorSetup}} />
      <CardPrerender />
    </template>);
    await waitFor('[data-test-file]');
    assert.dom('[data-test-file="person.gts"]').exists();
    await click('[data-test-file="person.gts"]');

    assert.strictEqual(mockOpenFiles.path, 'person.gts');
    assert.strictEqual(mockOpenFiles.openDirs.length, 0);

    await waitUntil(() => find('[data-test-editor'));

    //sub components exists
    assert.dom('[data-test-editor').exists(); //monaco exists
    assert.dom('[data-test-file="person.gts"]').exists(); //file tree with file exists
    assert.dom('[data-test-card-id]').exists(); //schema editor exist

    await waitUntil(() => find('[data-test-last-edit]'));
    await waitUntil(() => find('[data-test-editor-lang]'));
    await waitUntil(() =>
      find('[data-test-editor]')!.innerHTML?.includes('Person'),
    );
    assert.dom('[data-test-last-edit]').exists();
    assert.dom('[data-test-editor-lang]').hasText(`Lang: glimmerTS`);
    assert
      .dom('[data-test-editor]')
      .containsText('export')
      .containsText('class')
      .containsText('Person');

    editor!.setValue(sourceContent + '\n\n');

    await waitUntil(() => find('[data-test-saving]'));
    assert.dom('[data-test-saving]').exists();

    await waitUntil(() => find('[data-test-saved]'));
    assert.dom('[data-test-saved]').exists();

    await waitUntil(() =>
      find('[data-test-last-edit]')!.innerHTML?.includes('seconds'),
    );
    assert
      .dom('[data-test-last-edit]')
      .hasText('Last edit was a few seconds ago');
  });
  test('When a json file is selected, can update and save new content. Isolated render also updates', async function (assert) {
    monacoContext = await monacoService.getMonacoContext();

    let onEditorSetup = function (receivedEditor: IStandaloneCodeEditor) {
      editor = receivedEditor;
    };
    await render(<template>
      <Go @monaco={{monacoContext}} @onEditorSetup={{onEditorSetup}} />
      <CardPrerender />
    </template>);
    await waitFor('[data-test-file]');
    assert.dom('[data-test-directory="Person/"]').exists();
    await click('[data-test-directory="Person/"]');
    assert.strictEqual(mockOpenFiles.openDirs.length, 1);
    assert.strictEqual(mockOpenFiles.openDirs[0], 'Person/');
    await waitFor('[data-test-file="Person/hassan.json"]');
    assert.dom('[data-test-file="Person/hassan.json"]').exists();
    await click('[data-test-file="Person/hassan.json"]');
    await waitUntil(() => find('[data-test-editor]'));
    assert.strictEqual(mockOpenFiles.path, 'Person/hassan.json');
    assert
      .dom('[data-test-editor]')
      .containsText('data')
      .containsText('Person/hassan');
    await waitUntil(() => find('[data-test-field="name"]'));
    assert.dom('[data-test-field="name"]').containsText('Hassan');
    let newJsonContent = {
      ...jsonContent,
    };
    newJsonContent.data.attributes.name = 'Abdel-Rahman';
    editor!.setValue(JSON.stringify(newJsonContent, null, 2));
    await waitUntil(() => find('[data-test-saving]'));
    assert.dom('[data-test-saving]').exists();

    await waitUntil(() => find('[data-test-saved]'));
    assert.dom('[data-test-saved]').exists();
    await waitUntil(() => find('[data-test-field="name"]'));
    assert.dom('[data-test-field="name"]').containsText('Abdel-Rahman');
  });
  test('Last modified updates when updating content. This is a very specific test manufactured to update assumptions of time', async function (assert) {
    let tenMinutesAgo = formatRFC7231(new Date(Date.now() - 10 * 60 * 1000));
    setupLoaderWithHandler(
      loader,
      realm,
      { 'person.gts': sourceContent },
      {
        lastModified: tenMinutesAgo,
      },
    );
    monacoContext = await monacoService.getMonacoContext();
    let onEditorSetup = function (receivedEditor: IStandaloneCodeEditor) {
      editor = receivedEditor;
    };
    await render(<template>
      <Go @monaco={{monacoContext}} @onEditorSetup={{onEditorSetup}} />
      <CardPrerender />
    </template>);
    await waitFor('[data-test-file]');
    assert.dom('[data-test-file="person.gts"]').exists();
    await click('[data-test-file="person.gts"]');
    assert.strictEqual(mockOpenFiles.path, 'person.gts');
    await waitUntil(() => find('[data-test-last-edit]'));
    assert.dom('[data-test-last-edit]').hasText(`Last edit was 10 minutes ago`);
  });
});

module('Integration | Component | go | new card', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  let mockController = new CodeController();
  let monacoService: MonacoService;
  let loader;
  let editor: IStandaloneCodeEditor;
  let monacoContext: MonacoSDK;
  mockController.codeService = new CodeService();
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(async function () {
    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
    shimExternals(loader);
    adapter = new TestRealmAdapter({
      'person.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringCard);
          @field nickName = contains(StringCard, { computeVia: function() { return this.firstName + '-poo'; }});
          @field title =  contains(StringCard, {
            computeVia: function (this: Item) {
              return this.nickName;
            },
          });
          @field description = contains(StringCard, { computeVia: () => 'Person' });
          @field thumbnailURL = contains(StringCard, { computeVia: () => null });
          static isolated = class Isolated extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template><h3>Person: <@fields.firstName/></h3></template>
          }
        }
      `,
      'post.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Post extends CardDef {
          @field title = contains(StringCard);
          static isolated = class Isolated extends Component<typeof this> {
            <template><h1><@fields.title/></h1></template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template><h3>Person: <@fields.title/></h3></template>
          }
        }
      `,
      'person-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
      'post-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Post',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
    });
    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
    await realm.ready;
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;
  });

  test('can create a new card', async function (assert) {
    monacoContext = await monacoService.getMonacoContext();

    let onEditorSetup = function (receivedEditor: IStandaloneCodeEditor) {
      editor = receivedEditor;
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Go @monaco={{monacoContext}} @onEditorSetup={{onEditorSetup}} />
          <CreateCardModal />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      },
    );
    await click('[data-test-create-new-card-button]');

    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');

    assert
      .dom('[data-test-card-catalog] li')
      .exists({ count: 3 }, 'number of catalog items is correct');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"]`,
      )
      .exists('first item is correct');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}post-entry"]`,
      )
      .exists('second item is correct');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/string-field`,
      )
      .doesNotExist('primitive field cards are not displayed');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Jackie');
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));
    assert.strictEqual(mockController.openFile, 'Person/1.json');
    assert.strictEqual(mockController.openDirs, undefined);

    let entry = await realm.searchIndex.card(
      new URL(`${testRealmURL}Person/1`),
    );
    assert.ok(entry, 'the new person card was created');

    let fileRef = await adapter.openFile('Person/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Jackie',
          },
          meta: {
            adoptsFrom: {
              module: `../person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct',
    );
  });
});
