import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import Go from '@cardstack/host/components/go';
import type { FileResource } from '@cardstack/host/resources/file';

module('Integration | Component | go', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders', async function (assert) {
    let path = '/';
    let openFile: FileResource | undefined = undefined;
    let openDirs: string[] = [];
    await render(<template>
      <h2>hey</h2>
      <Go @path={{path}} @openFile={{openFile}} @openDirs={{openDirs}} />
    </template>);

    await this.pauseTest();

    assert.dom().hasText('jortle');
  });
});
