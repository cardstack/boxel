import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  isAllowedParentOrigin,
  isSandboxHostname,
  parentAssetPath,
  rewriteBootstrapAssetURLs,
  secureResponse,
} from '../src/index.js';

const allowed =
  'https://boxel-host-staging.stack.cards,https://*.boxel-host-preview.stack.cards,https://localhost:*';

test('accepts only 128-bit nonce sandbox hostnames', () => {
  assert.equal(
    isSandboxHostname('0123456789abcdef0123456789abcdef.boxelusercontent.dev'),
    true,
  );
  assert.equal(isSandboxHostname('renderer.boxelusercontent.dev'), false);
  assert.equal(
    isSandboxHostname(
      '0123456789abcdef0123456789abcdef.renderer.boxelusercontent.dev',
    ),
    false,
  );
});

test('matches exact, preview wildcard, and port-qualified localhost parents', () => {
  assert.equal(
    isAllowedParentOrigin('https://boxel-host-staging.stack.cards', allowed),
    true,
  );
  assert.equal(
    isAllowedParentOrigin(
      'https://my-branch.boxel-host-preview.stack.cards',
      allowed,
    ),
    true,
  );
  assert.equal(isAllowedParentOrigin('https://localhost:4216', allowed), true);
  assert.equal(isAllowedParentOrigin('https://app.boxel.ai', allowed), false);
  assert.equal(
    isAllowedParentOrigin('https://boxel-host-preview.stack.cards', allowed),
    false,
  );
});

test('adds restrictive renderer response policy and removes cookies', async () => {
  let response = await secureResponse(
    new Response(
      '<html><script>globalThis.global = globalThis;</script></html>',
      {
        headers: {
          'content-type': 'text/html',
          'set-cookie': 'session=secret',
        },
      },
    ),
    allowed,
    true,
  );
  assert.equal(response.headers.has('set-cookie'), false);
  assert.match(
    response.headers.get('content-security-policy'),
    /connect-src 'self'/,
  );
  assert.match(
    response.headers.get('content-security-policy'),
    /script-src [^;]*'sha256-[A-Za-z0-9+/]+=*'/,
  );
  assert.doesNotMatch(
    response.headers.get('content-security-policy'),
    /script-src [^;]*unsafe-inline/,
  );
  assert.match(
    response.headers.get('content-security-policy'),
    /frame-ancestors https:\/\/boxel-host-staging\.stack\.cards/,
  );
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('serves only the bootstrap document from nonce origins', async () => {
  let assetFetches = [];
  let env = {
    ALLOWED_PARENT_ORIGINS: allowed,
    PARENT_ASSETS: {
      async fetch(request) {
        assetFetches.push(request);
        return new Response(
          '<html><script type="module" src="/assets/main-current.js"></script></html>',
          {
            headers: { 'content-type': 'text/html' },
          },
        );
      },
    },
  };
  let host = '0123456789abcdef0123456789abcdef.boxelusercontent.dev';
  let bootstrap = new URL(`https://${host}/_realm-sandbox-frame`);
  bootstrap.searchParams.set(
    'parentOrigin',
    'https://boxel-host-staging.stack.cards',
  );
  bootstrap.searchParams.set('bootstrapID', crypto.randomUUID());
  let response = await worker.fetch(
    new Request(bootstrap, {
      headers: {
        authorization: 'Bearer renderer-must-not-forward-this',
        cookie: 'session=renderer-must-not-forward-this',
      },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(assetFetches.length, 1);
  assert.equal(assetFetches[0].redirect, 'manual');
  assert.equal(
    new URL(assetFetches[0].url).origin,
    'https://boxel-host-staging.stack.cards',
  );
  assert.equal(assetFetches[0].headers.get('authorization'), null);
  assert.equal(assetFetches[0].headers.get('cookie'), null);
  assert.ok(
    (await response.text()).includes(
      parentAssetPath(
        'https://boxel-host-staging.stack.cards',
        '/assets/main-current.js',
      ),
    ),
  );

  response = await worker.fetch(new Request(`https://${host}/some-card`), env);
  assert.equal(response.status, 404);
});

test('proxies only content-addressed assets from the bootstrap parent build', async () => {
  let parentOrigin = 'https://my-branch.boxel-host-preview.stack.cards';
  let requestedURL;
  let env = {
    ALLOWED_PARENT_ORIGINS: allowed,
    PARENT_ASSETS: {
      async fetch(request) {
        requestedURL = request.url;
        return new Response('export default 1', {
          headers: { 'content-type': 'text/javascript' },
        });
      },
    },
  };
  let host = '0123456789abcdef0123456789abcdef.boxelusercontent.dev';
  let path = parentAssetPath(parentOrigin, '/assets/main-current.js');
  let response = await worker.fetch(
    new Request(`https://${host}${path}`, {
      headers: { authorization: 'Bearer secret', cookie: 'secret=1' },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(requestedURL, `${parentOrigin}/assets/main-current.js`);
  assert.equal(await response.text(), 'export default 1');

  let rewritten = rewriteBootstrapAssetURLs(
    '<script src="/assets/main.js"></script><link href="/assets/main.css">',
    parentOrigin,
  );
  assert.match(rewritten, /_boxel-parent\/[^/]+\/assets\/main\.js/);
  assert.match(rewritten, /_boxel-parent\/[^/]+\/assets\/main\.css/);
  assert.match(
    rewritten,
    /globalThis\.__boxelAssetsURL="\/_boxel-parent\/[^/]+\/"/,
  );
});
