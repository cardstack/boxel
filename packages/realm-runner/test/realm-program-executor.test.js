import assert from 'node:assert/strict';
import test from 'node:test';

import { QuickJSRealmProgramExecutor } from '../src/realm-program-executor.js';

test('targets the configured Realm-server origin for server API calls', async () => {
  let requestedUrl;
  let executor = new QuickJSRealmProgramExecutor({
    realmServerUrl: 'https://realm-server.example.test/',
    async fetch(url) {
      requestedUrl = url;
      return new Response(JSON.stringify({ queued: 0 }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  let result = await executor.execute({
    code: `return await realm.server.request('GET', '_queue');`,
    mode: 'preview',
    realmURL: 'https://custom-realm.example/space/',
    authorization: 'Bearer current-realm-token',
  });

  assert.equal(requestedUrl, 'https://realm-server.example.test/_queue');
  assert.equal(result.value.status, 200);
});
