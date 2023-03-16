import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, waitUntil } from '@ember/test-helpers';
import Go from '@cardstack/host/components/go';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealmAdapter,
  TestRealm,
  testRealmURL,
  setupMockLocalRealm,
} from '../../helpers';
import { getFileResource } from './schema-test';
import moment from 'moment';
import CardPrerender from '@cardstack/host/components/card-prerender';
import type * as monaco from 'monaco-editor';

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

  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);

  hooks.beforeEach(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    adapter = new TestRealmAdapter({});
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
  });

  test('it shows last modified date and save status', async function (assert) {
    await realm.write('person.gts', cardContent);

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
      <h2>hey</h2>
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

    assert
      .dom('[data-test-last-edit]')
      .hasText('Last edit was a few seconds ago');
  });
});
