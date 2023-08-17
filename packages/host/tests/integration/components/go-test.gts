import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
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
import { OpenFiles } from '@cardstack/host/controllers/code';
import type LoaderService from '@cardstack/host/services/loader-service';
import { Loader } from '@cardstack/runtime-common/loader';
import { formatRFC7231 } from 'date-fns';
const sourceContent = `
import { contains, field, Card } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Person extends Card {
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
    mockOpenFiles = new OpenFiles(new CodeController());
    await realm.ready;
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
      <Go
        @openFiles={{mockOpenFiles}}
        @monaco={{monacoContext}}
        @onEditorSetup={{onEditorSetup}}
      />
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
      <Go
        @openFiles={{mockOpenFiles}}
        @monaco={{monacoContext}}
        @onEditorSetup={{onEditorSetup}}
      />
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
      <Go
        @openFiles={{mockOpenFiles}}
        @monaco={{monacoContext}}
        @onEditorSetup={{onEditorSetup}}
      />
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
      <Go
        @openFiles={{mockOpenFiles}}
        @monaco={{monacoContext}}
        @onEditorSetup={{onEditorSetup}}
      />
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
