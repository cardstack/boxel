import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  find,
  render,
  resetOnerror,
  setupOnerror,
  waitUntil,
  RenderingTestContext,
} from '@ember/test-helpers';
import Go from '@cardstack/host/components/editor/go';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { baseRealm } from '@cardstack/runtime-common';
import {
  delay,
  getFileResource,
  TestRealmAdapter,
  TestRealm,
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupMockMessageService,
} from '../../helpers';
import moment from 'moment';
import CardPrerender from '@cardstack/host/components/card-prerender';
import type * as monaco from 'monaco-editor';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import MonacoService from '@cardstack/host/services/monaco-service';
import type LoaderService from '@cardstack/host/services/loader-service';

const cardContent = `
import { contains, field, Card, linksTo } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Person extends Card {
  @field name = contains(StringCard);
  @field friend = linksTo(() => Person);
}
`;

class FailingTestRealmAdapter extends TestRealmAdapter {
  writeCalled = false;

  async write(
    path: LocalPath,
    contents: string | object
  ): Promise<{ lastModified: number }> {
    if (this.writeCalled) {
      return super.write(path, contents);
    } else {
      this.writeCalled = true;
      await delay(10);
      throw new Error('Something has gone horribly wrong on purpose');
    }
  }
}

let loader: Loader;

module('Integration | Component | go', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  let monacoService: MonacoService;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupMockMessageService(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`)
  );

  module('with a working realm', function (hooks) {
    hooks.beforeEach(async function () {
      adapter = new TestRealmAdapter({ 'person.gts': cardContent });
      realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
      monacoService = this.owner.lookup(
        'service:monaco-service'
      ) as MonacoService;
      await monacoService.ready;
      await realm.ready;
    });

    test('it shows the editor, last modified date, and save status', async function (assert) {
      let lastModified = new Date(2020, 4, 5).toISOString();

      let path = 'boolean-field.json';

      let openFile = await getFileResource(this, adapter, {
        module: `${testRealmURL}person`,
        name: 'Person',
        lastModified,
      });

      let openDirs: string[] = [];

      let editor: monaco.editor.IStandaloneCodeEditor;

      let onEditorSetup = function (
        receivedEditor: monaco.editor.IStandaloneCodeEditor
      ) {
        editor = receivedEditor;
      };
      let monacoContext = {
        sdk: monacoService.sdk,
        language: 'plaintext',
        onEditorSetup,
      };

      await render(<template>
        <Go
          @path={{path}}
          @openFile={{openFile}}
          @openDirs={{openDirs}}
          @monacoContext={{monacoContext}}
        />
        <CardPrerender />
      </template>);

      assert
        .dom('[data-test-last-edit]')
        .hasText(`Last edit was ${moment(lastModified).fromNow()}`);
      assert
        .dom('[data-test-editor-lang]')
        .hasText(`Lang: ${monacoContext.language}`);

      waitUntil(() =>
        find('[data-test-editor]')!.innerHTML?.includes('Person')
      );
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

  module('with a broken realm', function (hooks) {
    hooks.beforeEach(async function () {
      loader = (this.owner.lookup('service:loader-service') as LoaderService)
        .loader;
      adapter = new FailingTestRealmAdapter({ 'person.gts': cardContent });
      realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
      monacoService = this.owner.lookup(
        'service:monaco-service'
      ) as MonacoService;
      await monacoService.ready;
      await realm.ready;
      await realm.ready;
    });

    test('it shows last modified date and save status', async function (assert) {
      setupOnerror(function (err: unknown) {
        assert.ok(err, 'expected an error saving');
      });

      let lastModified = new Date(2020, 4, 5).toISOString();

      let path = 'boolean-field.json';

      let openFile = await getFileResource(this, adapter, {
        module: `${testRealmURL}person`,
        name: 'Person',
        lastModified,
      });

      let openDirs: string[] = [];

      let editor: monaco.editor.IStandaloneCodeEditor;

      let onEditorSetup = function (
        receivedEditor: monaco.editor.IStandaloneCodeEditor
      ) {
        editor = receivedEditor;
      };

      let monacoContext = {
        sdk: monacoService.sdk,
        language: 'plaintext',
        onEditorSetup,
      };

      await render(<template>
        <Go
          @path={{path}}
          @openFile={{openFile}}
          @openDirs={{openDirs}}
          @monacoContext={{monacoContext}}
        />
        <CardPrerender />
      </template>);

      editor!.setValue(cardContent + '\n\n');

      await waitUntil(() => find('[data-test-saving]'), {
        timeoutMessage: 'saving icon not found',
      });
      assert.dom('[data-test-saving]').exists();

      await waitUntil(() => find('[data-test-save-error]'), {
        timeoutMessage: 'error icon not found',
      });
      assert.dom('[data-test-save-error]').exists();

      assert.dom('[data-test-failed-to-save]').hasText('Failed to save');

      editor!.setValue(cardContent + '\n\n\n\n');

      await waitUntil(() => find('[data-test-saved]'));
      assert.dom('[data-test-saved]').exists();

      await waitUntil(() =>
        find('[data-test-last-edit]')!.innerHTML?.includes('seconds')
      );
      assert
        .dom('[data-test-last-edit]')
        .hasText(
          'Last edit was a few seconds ago',
          'expected last updated to return after a successful save'
        );
    });

    hooks.afterEach(() => {
      resetOnerror();
    });
  });
});
