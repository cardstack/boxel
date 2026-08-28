import { destroy } from '@ember/destroyable';
import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import type { Ready } from '@cardstack/host/resources/file';
import { moduleContentsResource } from '@cardstack/host/resources/module-contents';
import type LoaderService from '@cardstack/host/services/loader-service';

import { setupRenderingTest } from '../../helpers/setup';

const untrustedModuleURL = rri('https://cards.example/authored-card.gts');

const untrustedSource = `
  import { CardDef } from '@cardstack/base/card-api';

  globalThis.__boxelCodePreviewHostProbe = 'executed';

  export class AuthoredCard extends CardDef {}
`;

module('Integration | resource | module contents', function (hooks) {
  setupRenderingTest(hooks);

  test('statically inspects an untrusted module without importing it in the Host', async function (assert) {
    let loaderService = getService('loader-service') as LoaderService;
    let loader = loaderService.loader;
    let originalImport = loader.import.bind(loader);
    let authoredImportCount = 0;
    loader.import = async (...args: Parameters<typeof loader.import>) => {
      if (args[0] === untrustedModuleURL) {
        authoredImportCount++;
      }
      return originalImport(...args);
    };

    let executableFile: Ready = {
      state: 'ready',
      content: untrustedSource,
      name: 'authored-card.gts',
      url: untrustedModuleURL,
      lastModified: undefined,
      realmURL: 'https://cards.example/',
      size: untrustedSource.length,
      write: async () => {},
    };

    let analysis = moduleContentsResource(
      loaderService,
      () => executableFile,
      () => {},
    );

    try {
      await waitUntil(
        () => analysis.declarations[0]?.type === 'possibleCardOrField',
      );

      assert.strictEqual(
        analysis.declarations[0]?.exportName,
        'AuthoredCard',
        'the exported card remains available to Code mode as static metadata',
      );
      assert.strictEqual(
        authoredImportCount,
        0,
        'Code mode never asks the Host Loader to evaluate authored source',
      );
      assert.notOk(
        (
          globalThis as typeof globalThis & {
            __boxelCodePreviewHostProbe?: string;
          }
        ).__boxelCodePreviewHostProbe,
        'authored top-level code did not execute in the Host',
      );
    } finally {
      destroy(analysis);
      loader.import = originalImport;
      await settled();
    }
  });
});
