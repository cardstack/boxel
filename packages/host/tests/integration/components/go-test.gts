import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, waitUntil, waitFor, click } from '@ember/test-helpers';
import Go from '@cardstack/host/components/editor/go';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealmAdapter,
  TestRealm,
  setupCardLogs,
  setupLocalIndexing,
  setupMockMessageService,
} from '../../helpers';
import CardPrerender from '@cardstack/host/components/card-prerender';
import { shimExternals } from '@cardstack/host/lib/externals';
import MonacoService from '@cardstack/host/services/monaco-service';
import type {
  MonacoSDK,
  IStandaloneCodeEditor,
} from '@cardstack/host/services/monaco-service';
import CodeController from '@cardstack/host/controllers/code';
import { OpenFiles } from '@cardstack/host/controllers/code';

const cardContent = `
import { contains, field, Card, linksTo } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Person extends Card {
  @field name = contains(StringCard);
  @field friend = linksTo(() => Person);
}
`;

module('Integration | Component | go', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  let monacoService: MonacoService;
  let mockController: CodeController;
  let mockOpenFiles: OpenFiles;
  let editor: IStandaloneCodeEditor;
  let monacoContext: MonacoSDK;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupMockMessageService(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  hooks.beforeEach(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    shimExternals();
  });

  module('with a working realm', function (hooks) {
    hooks.beforeEach(async function () {
      adapter = new TestRealmAdapter({ 'person.gts': cardContent });
      realm = await TestRealm.createWithAdapter(adapter, this.owner);
      monacoService = this.owner.lookup(
        'service:monaco-service'
      ) as MonacoService;
      mockController = new CodeController();
      mockOpenFiles = new OpenFiles(mockController);
      await realm.ready;
    });

    test('When no file is selected, displays file tree only', async function (assert) {
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
      assert.dom('[data-test-editor').doesNotExist();
      assert.dom('[data-test-card-id]').doesNotExist();
    });

    test('When a file is selected in the file tree, displays editor with contents and can save new content', async function (assert) {
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

      //click a file
      await click('[data-test-file="person.gts"]');

      assert.strictEqual(mockOpenFiles.path, 'person.gts');
      assert.strictEqual(mockOpenFiles.openDirs.length, 0);

      await waitUntil(() => find('[data-test-last-edit]'));
      await waitUntil(() => find('[data-test-editor-lang]'));
      await waitUntil(() =>
        find('[data-test-editor]')!.innerHTML?.includes('Person')
      );
      await waitFor('[data-test-card-id]');

      //sub components exists
      assert.dom('[data-test-editor').exists(); //monaco exists
      assert.dom('[data-test-file="person.gts"]').exists(); //file tree with file exists
      assert.dom('[data-test-card-id]').exists(); //schema editor exist

      // TODO: Need to find last modified test
      // assert
      //   .dom('[data-test-last-edit]')
      //   .hasText(`Last edit was ${moment(lastModified).fromNow()}`);
      assert.dom('[data-test-last-edit]').exists();
      assert.dom('[data-test-editor-lang]').hasText(`Lang: glimmerTS`);
      assert
        .dom('[data-test-editor]')
        .containsText('export')
        .containsText('class')
        .containsText('Person');
    });

    test('When a file is selected in the file tree, can update and save new content', async function (assert) {
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

      await waitUntil(() => find('[data-test-last-edit]'));
      await waitUntil(() => find('[data-test-editor-lang]'));
      await waitUntil(() =>
        find('[data-test-editor]')!.innerHTML?.includes('Person')
      );
      // TODO: Need to find last modified test
      // assert
      //   .dom('[data-test-last-edit]')
      //   .hasText(`Last edit was ${moment(lastModified).fromNow()}`);
      assert.dom('[data-test-last-edit]').exists();
      assert.dom('[data-test-editor-lang]').hasText(`Lang: glimmerTS`);
      assert
        .dom('[data-test-editor]')
        .containsText('export')
        .containsText('class')
        .containsText('Person');

      editor!.setValue(cardContent + '\n\n');

      await waitUntil(() => find('[data-test-saving]'));
      assert.dom('[data-test-saving]').exists();

      await waitUntil(() => find('[data-test-saved]'));
      assert.dom('[data-test-saved]').exists();

      await waitUntil(() =>
        find('[data-test-last-edit]')!.innerHTML?.includes('seconds')
      );
      assert
        .dom('[data-test-last-edit]')
        .hasText('Last edit was a few seconds ago');
    });
  });
});
