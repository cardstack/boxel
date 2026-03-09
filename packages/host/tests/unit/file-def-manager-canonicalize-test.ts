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

    // Stub downloadContentAsBytes to return the content that matches the hash
    manager.downloadContentAsBytes = async (_url: string) =>
      new TextEncoder().encode(content);

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

  test('recacheContentHash skips non-Matrix URLs (realm URLs)', async function (assert) {
    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      mxcUrlToHttp(mxc: string) {
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

    const content = 'realm-url-test-content';
    const contentHash = await manager.getContentHash(content);

    // Stub downloadContentAsBytes — should NOT be called for non-Matrix URLs
    let downloadCalled = false;
    manager.downloadContentAsBytes = async (_url: string) => {
      downloadCalled = true;
      return new TextEncoder().encode(content);
    };

    const realmUrl = 'http://localhost:4201/experiments/image.png';
    await manager.recacheContentHash(contentHash, realmUrl);

    assert.false(
      downloadCalled,
      'downloadContentAsBytes should not be called for non-Matrix URLs',
    );
    assert.strictEqual(
      manager.contentHashCache.get(contentHash),
      undefined,
      'contentHashCache should not contain a realm URL',
    );
  });

  test('uploadFiles throws when local file content was not prefetched', async function (assert) {
    assert.expect(1);

    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent() {
        return Promise.resolve({ content_uri: 'mxc://localhost/FAKE' });
      },
      mxcUrlToHttp(mxc: string) {
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    const fakeCardApi = {
      serializeCard(card: any) {
        return {
          data: {
            type: 'file-meta',
            attributes: card.serialize(),
          },
        };
      },
    } as any;
    const fakeFileApi = {} as any;
    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => fakeCardApi,
      getFileAPI: () => fakeFileApi,
    }) as any;

    let localFile: any = {
      sourceUrl: 'boxel-local://local-id/local.txt',
      name: 'local.txt',
      serialize() {
        return {
          sourceUrl: this.sourceUrl,
          name: this.name,
          contentType: this.contentType,
          contentHash: this.contentHash,
          contentSize: this.contentSize,
        };
      },
    };

    try {
      await manager.uploadFiles([localFile]);
      assert.ok(false, 'expected upload to throw');
    } catch (e: any) {
      assert.true(
        String(e?.message).includes('Local file content is not available'),
        'throws actionable error for missing local prefetch bytes',
      );
    }
  });

  test('uploadFiles uploads local file bytes from prefetched content', async function (assert) {
    assert.expect(3);

    let uploadCalls: any[] = [];
    let callCounter = 0;
    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent(content: XMLHttpRequestBodyInit) {
        callCounter++;
        uploadCalls.push(content);
        return Promise.resolve({
          content_uri: `mxc://localhost/upload-${callCounter}`,
        });
      },
      mxcUrlToHttp(mxc: string) {
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    const fakeCardApi = {} as any;
    const fakeFileApi = {} as any;
    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => fakeCardApi,
      getFileAPI: () => fakeFileApi,
    }) as any;

    let localFile: any = {
      sourceUrl: 'boxel-local://local-id/local.txt',
      name: 'local.txt',
      serialize() {
        return {
          sourceUrl: this.sourceUrl,
          name: this.name,
          url: this.url,
          contentType: this.contentType,
          contentHash: this.contentHash,
          contentSize: this.contentSize,
        };
      },
    };

    let bytes = new TextEncoder().encode('hello local file');
    await manager.prefetchLocalFileContent(localFile, bytes, 'text/plain');
    await manager.uploadFiles([localFile]);

    assert.strictEqual(uploadCalls.length, 1, 'uploaded local file bytes once');
    assert.ok(localFile.url, 'sets uploaded file URL');
    assert.strictEqual(
      localFile.contentType,
      'text/plain',
      'sets file content type from prefetched local bytes',
    );
  });
});
