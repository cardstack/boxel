import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import { setupCardLogs, setupLocalIndexing, testRealmURL } from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

type CommandModule = typeof import('@cardstack/base/command');

let loader: Loader;

module('Integration | run-realm-code-result', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('the isolated view lists each file with its status and detail', async function (assert) {
    let { RunRealmCodeResult, RealmCodeFileResult } =
      await loader.import<CommandModule>('@cardstack/base/command');
    let savedFile = `${testRealmURL}brand-guide.html`;
    let deletedFile = `${testRealmURL}scratch.json`;
    let result = new RunRealmCodeResult({
      files: [
        new RealmCodeFileResult({
          fileUrl: savedFile,
          status: 'saved',
          detail: 'Source saved.',
        }),
        new RealmCodeFileResult({
          fileUrl: deletedFile,
          status: 'deleted',
          detail: 'Created by this run and then deleted.',
        }),
      ],
      scriptResult: 'done',
    });

    await renderCard(loader, result, 'isolated');

    assert
      .dom(`[data-test-realm-code-file="${savedFile}"]`)
      .containsText('saved', 'the saved file shows its status')
      .containsText('brand-guide.html', 'the saved file shows its name')
      .containsText('Source saved.', 'the saved file shows its detail');
    assert
      .dom(`[data-test-realm-code-file="${deletedFile}"]`)
      .containsText('deleted', 'the deleted file shows its status')
      .containsText(
        'Created by this run and then deleted.',
        'the deleted file shows its detail',
      );
    assert
      .dom('[data-test-realm-code-script-result]')
      .containsText('done', "the isolated view shows the script's result");
    assert
      .dom()
      .doesNotContainText(
        'Missing embedded component',
        'every field renders its embedded view',
      );
    assert.strictEqual(
      result.cardTitle,
      '1 file saved, 1 file deleted',
      'the title says what the run did to files',
    );
  });
});
