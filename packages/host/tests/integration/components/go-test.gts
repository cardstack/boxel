import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  find,
  render,
  resetOnerror,
  setupOnerror,
  waitUntil,
} from '@ember/test-helpers';
import Go from '@cardstack/host/components/go';
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
  setupMockLocalRealm,
} from '../../helpers';
import moment from 'moment';
import CardPrerender from '@cardstack/host/components/card-prerender';
import type * as monaco from 'monaco-editor';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import { shimExternals } from '@cardstack/host/lib/externals';

const cardContent = `
import { contains, field, Card, linksTo } from "https://cardstack.com/base/card-api";
import StringCard from "https://cardstack.com/base/string";

export class Person extends Card {
  @field name = contains(StringCard);
  @field friend = linksTo(() => Person);
}
`;

class FailingTestRealmAdapter extends TestRealmAdapter {
  async write(
    _path: LocalPath,
    _contents: string | object
  ): Promise<{ lastModified: number }> {
    await delay(10);
    throw new Error('Something has gone horribly wrong on purpose');
  }
}

module('Integration | Component | go', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;

  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);
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

      await render(<template>
        <Go
          @path={{path}}
          @openFile={{openFile}}
          @openDirs={{openDirs}}
          @onEditorSetup={{onEditorSetup}}
        />
        <CardPrerender />
      </template>);

      assert
        .dom('[data-test-last-edit]')
        .hasText(`Last edit was ${moment(lastModified).fromNow()}`);

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
      adapter = new FailingTestRealmAdapter({ 'person.gts': cardContent });
      realm = await TestRealm.createWithAdapter(adapter, this.owner);
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

      await render(<template>
        <Go
          @path={{path}}
          @openFile={{openFile}}
          @openDirs={{openDirs}}
          @onEditorSetup={{onEditorSetup}}
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
    });

    hooks.afterEach(() => {
      resetOnerror();
    });
  });
});
