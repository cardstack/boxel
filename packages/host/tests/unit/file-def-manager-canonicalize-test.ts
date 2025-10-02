import { module, test } from 'qunit';

import { canonicalizeMatrixMediaKey } from '@cardstack/runtime-common/ai/matrix-utils';

import FileDefManagerImpl from '@cardstack/host/lib/file-def-manager';

module('Unit | file-def-manager canonicalize', function () {
  test('canonicalizeMatrixMediaKey normalizes various Matrix URLs to mxc://host/id', function (assert) {
    let cases = [
      {
        in: 'mxc://localhost/abc123',
        out: 'mxc://localhost/abc123',
      },
      {
        in: 'http://localhost/_matrix/media/v3/download/localhost/abc123',
        out: 'mxc://localhost/abc123',
      },
      {
        in: 'http://localhost/_matrix/media/v3/download/localhost/abc123/somefile.txt?version=1',
        out: 'mxc://localhost/abc123',
      },
      {
        in: 'http://localhost/_matrix/media/v3/thumbnail/localhost/abc123/256',
        out: 'mxc://localhost/abc123',
      },
    ];

    for (let c of cases) {
      let got = canonicalizeMatrixMediaKey(c.in);
      assert.strictEqual(got, c.out, `canonicalized ${c.in} => ${got}`);
    }
  });

  test('recacheContentHash stores a canonical HTTP URL in contentHashCache', async function (assert) {
    assert.expect(1);

    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent() {
        return Promise.resolve({ content_uri: 'mxc://localhost/FAKE' });
      },
      mxcUrlToHttp(mxc: string) {
        // normalize mxc://host/id -> http download URL without filename/query
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    const dummyApi = {} as any;
    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => dummyApi,
      getFileAPI: () => dummyApi,
    }) as any;

    const content = 'canonical-test-content';
    const contentHash = await manager.getContentHash(content);

    // Stub downloadContentAsText to return the content that matches the hash
    manager.downloadContentAsText = async (_url: string) => content;

    const originalUrl =
      'http://localhost/_matrix/media/v3/download/localhost/abc123/somefile.txt?version=1';

    await manager.recacheContentHash(contentHash, originalUrl);

    const expected = fakeClient.mxcUrlToHttp('mxc://localhost/abc123');
    assert.strictEqual(
      manager.contentHashCache.get(contentHash),
      expected,
      'contentHashCache stores canonical HTTP URL',
    );
  });
});
