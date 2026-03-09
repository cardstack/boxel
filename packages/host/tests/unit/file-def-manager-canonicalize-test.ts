import { module, test } from 'qunit';

import { canonicalizeMatrixMediaKey } from '@cardstack/runtime-common/ai/matrix-utils';

import FileDefManagerImpl from '@cardstack/host/lib/file-def-manager';

function makeFakeFileApi() {
  return {
    createFileDef(initial: any) {
      return {
        ...initial,
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
    },
  } as any;
}

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
    const fakeFileApi = makeFakeFileApi();
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
    assert.expect(4);

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
    const fakeFileApi = makeFakeFileApi();
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
    let [uploadedFile] = await manager.uploadFiles([localFile]);

    assert.strictEqual(uploadCalls.length, 1, 'uploaded local file bytes once');
    assert.ok(uploadedFile.url, 'sets uploaded file URL');
    assert.strictEqual(
      uploadedFile.contentType,
      'text/plain',
      'sets file content type from prefetched local bytes',
    );
    assert.strictEqual(
      localFile.url,
      undefined,
      'does not mutate original file def instance',
    );
  });

  test('uploadFiles keeps prefetched local bytes on failure so retry succeeds', async function (assert) {
    assert.expect(4);

    let uploadAttempt = 0;
    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent(_content: XMLHttpRequestBodyInit) {
        uploadAttempt++;
        if (uploadAttempt === 1) {
          return Promise.reject(new Error('transient upload failure'));
        }
        return Promise.resolve({
          content_uri: `mxc://localhost/upload-${uploadAttempt}`,
        });
      },
      mxcUrlToHttp(mxc: string) {
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => ({}) as any,
      getFileAPI: () => makeFakeFileApi(),
    }) as any;

    let localFile: any = {
      sourceUrl: 'boxel-local://local-id/retry.txt',
      name: 'retry.txt',
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

    let bytes = new TextEncoder().encode('retry local file');
    await manager.prefetchLocalFileContent(localFile, bytes, 'text/plain');

    await assert.rejects(
      manager.uploadFiles([localFile]),
      /transient upload failure/,
      'first upload attempt fails',
    );

    let [uploadedFile] = await manager.uploadFiles([localFile]);

    assert.strictEqual(
      uploadAttempt,
      2,
      'retries upload with prefetched bytes',
    );
    assert.ok(uploadedFile.url, 'retry succeeds and returns uploaded URL');
    assert.false(
      manager.prefetchedContent.has(localFile.sourceUrl),
      'prefetched bytes are cleared after successful upload',
    );
  });

  test('uploadFiles preserves known image content type when prefetched type is generic', async function (assert) {
    assert.expect(3);

    let uploadedType: string | undefined;
    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent(
        _content: XMLHttpRequestBodyInit,
        opts?: { type?: string },
      ) {
        uploadedType = opts?.type;
        return Promise.resolve({
          content_uri: 'mxc://localhost/workspace-image-upload',
        });
      },
      mxcUrlToHttp(mxc: string) {
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => ({}) as any,
      getFileAPI: () => makeFakeFileApi(),
    }) as any;

    let workspaceImageFile: any = {
      sourceUrl: 'http://test-realm-server/my-realm/diagram.png',
      name: 'diagram.png',
      contentType: 'image/png',
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

    let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await manager.prefetchLocalFileContent(
      workspaceImageFile,
      bytes,
      'application/vnd.card+source',
    );
    let [uploadedFile] = await manager.uploadFiles([workspaceImageFile]);

    assert.strictEqual(
      uploadedType,
      'image/png',
      'uploads workspace image bytes using original image mime type',
    );
    assert.strictEqual(
      uploadedFile.contentType,
      'image/png',
      'retains image contentType instead of generic fetched type',
    );
    assert.ok(uploadedFile.url, 'sets uploaded URL');
  });

  test('uploadFiles infers image content type for workspace files when realm source reports text/plain', async function (assert) {
    assert.expect(5);

    let uploadedType: string | undefined;
    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent(
        _content: XMLHttpRequestBodyInit,
        opts?: { type?: string },
      ) {
        uploadedType = opts?.type;
        return Promise.resolve({
          content_uri: 'mxc://localhost/workspace-inferred-image-upload',
        });
      },
      mxcUrlToHttp(mxc: string) {
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => ({}) as any,
      getFileAPI: () => makeFakeFileApi(),
    }) as any;

    let imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
    manager.network = {
      authedFetch(url: string, opts?: { headers?: { Accept?: string } }) {
        assert.strictEqual(
          url,
          'http://test-realm-server/my-realm/green-mango.png',
          'fetches workspace file bytes from sourceUrl',
        );
        assert.strictEqual(
          opts?.headers?.Accept,
          'application/vnd.card+source',
          'requests realm source representation',
        );
        return Promise.resolve({
          arrayBuffer: async () => imageBytes.slice().buffer,
          headers: {
            get(name: string) {
              if (name.toLowerCase() === 'content-type') {
                return 'text/plain; charset=UTF-8';
              }
              return null;
            },
          },
        });
      },
    } as any;

    let workspaceImageFile: any = {
      sourceUrl: 'http://test-realm-server/my-realm/green-mango.png',
      name: 'green-mango.png',
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

    let [uploadedFile] = await manager.uploadFiles([workspaceImageFile]);

    assert.strictEqual(
      uploadedType,
      'image/png',
      'infers image MIME type from file name instead of using text/plain',
    );
    assert.strictEqual(
      uploadedFile.contentType,
      'image/png',
      'uploaded file keeps inferred image MIME type',
    );
    assert.ok(uploadedFile.url, 'sets uploaded URL');
  });

  test('uploadFiles ignores stale non-Matrix content-hash cache entry and uploads fresh media', async function (assert) {
    assert.expect(3);

    let uploadCalls = 0;
    let fakeClient: any = {
      getAccessToken() {
        return 'fake-token';
      },
      uploadContent(
        _content: XMLHttpRequestBodyInit,
        opts?: { type?: string },
      ) {
        uploadCalls++;
        assert.strictEqual(opts?.type, 'image/png', 'uploads with image mime');
        return Promise.resolve({
          content_uri: `mxc://localhost/fresh-upload-${uploadCalls}`,
        });
      },
      mxcUrlToHttp(mxc: string) {
        return `http://localhost/_matrix/media/v3/download/localhost/${mxc.split('/').pop()}`;
      },
    };

    let manager = new FileDefManagerImpl({
      owner: null as unknown as any,
      client: fakeClient,
      getCardAPI: () => ({}) as any,
      getFileAPI: () => makeFakeFileApi(),
    }) as any;

    let workspaceImageFile: any = {
      sourceUrl: 'http://test-realm-server/my-realm/stale-cache.png',
      name: 'stale-cache.png',
      contentType: 'image/png',
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

    let bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
    await manager.prefetchLocalFileContent(
      workspaceImageFile,
      bytes,
      'image/png',
    );
    let staleHash = await manager.getContentHash(bytes);
    manager.contentHashCache.set(
      staleHash,
      'http://test-realm-server/my-realm/stale-cache.png',
    );

    let [uploadedFile] = await manager.uploadFiles([workspaceImageFile]);

    assert.strictEqual(
      uploadCalls,
      1,
      'stale non-Matrix cache entry is ignored',
    );
    assert.true(
      String(uploadedFile.url).includes('/_matrix/media/'),
      'file URL is refreshed to Matrix media URL',
    );
  });
});
