import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  decodeLintFilename,
  LINT_FILENAME_HEADER,
  type LintResult,
} from '@cardstack/runtime-common';

import LintAndFixTool from '@cardstack/host/tools/lint-and-fix';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | tools | lint-and-fix', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });

  // The name as it is on disk, which is what the tool's `filename` input means
  // and what its callers hold: the code editor's format action reads
  // `readyFile.name`, which the file resource has already percent-decoded.
  const emojiFileName = 'ai\u{1F389}app-card.gts';
  let adapter: any;

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    let realmSetup = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          [emojiFileName]: `import {
  contains,
  field,
  CardDef,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
export class EmojiCard extends CardDef {
  static displayName = 'EmojiCard';
  @field priority = contains(NumberField);
}`,
        },
      }),
    );
    adapter = realmSetup.adapter;
    let realmService = getService('realm');
    await realmService.login(testRealmURL);
  });

  // A header value is a ByteString, so the tool cannot put a name outside
  // Latin-1 into `X-Filename` verbatim — assembling the request throws
  // `Cannot convert argument to a ByteString` in the caller, before anything
  // is sent. The name travels percent-encoded, and arrives as itself.
  test('lints a file whose name is outside Latin-1', async function (assert) {
    assert.expect(2);

    let toolService = getService('tool-service');
    let lintCommand = new LintAndFixTool(toolService.toolContext);

    adapter.lintStub = async (
      request: Request,
      _requestContext: any,
    ): Promise<LintResult> => {
      assert.strictEqual(
        decodeLintFilename(request.headers.get(LINT_FILENAME_HEADER)),
        emojiFileName,
        'the realm sees the name as it is on disk',
      );
      return {
        output: await request.text(),
        fixed: true,
        messages: [],
      };
    };

    let result = await lintCommand.execute({
      realm: testRealmURL,
      fileContent: '// content of an emoji-named module\n',
      filename: emojiFileName,
    });

    assert.strictEqual(
      result.output,
      '// content of an emoji-named module\n',
      'the lint result comes back to the caller',
    );
  });
});
