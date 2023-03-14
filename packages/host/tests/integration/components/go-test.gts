import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import Go from '@cardstack/host/components/go';
import type { FileResource } from '@cardstack/host/resources/file';
import moment from 'moment';

const BooleanCardString = `
export function c() {
  return 'c';
}
`;

module('Integration | Component | go', function (hooks) {
  setupRenderingTest(hooks);

  test('it shows last modified date', async function (assert) {
    let lastModified = new Date(2020, 4, 5).toISOString();

    let path = 'boolean-field.json';
    let openFile: FileResource = {
      state: 'ready',
      content: BooleanCardString,
      name: path,
      lastModified,
      loading: null,
      url: 'https://cardstack.com/base/boolean-field',
      async write(content: string) {
        console.log('wrote', content);
      },
      close() {},
    };

    let openDirs: string[] = [];

    await render(<template>
      <h2>hey</h2>
      <Go @path={{path}} @openFile={{openFile}} @openDirs={{openDirs}} />
    </template>);

    assert
      .dom('[data-test-last-edit]')
      .hasText(`Last edit was ${moment(lastModified).fromNow()}`);
  });
});
