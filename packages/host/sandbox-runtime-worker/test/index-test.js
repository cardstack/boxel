import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  isAllowedParentOrigin,
  isSandboxHostname,
  parentAssetPath,
  rewriteBootstrapAssetURLs,
  secureResponse,
} from '../src/index.js';

const stagingAllowed =
  'https://boxel-host-staging.stack.cards,https://*.boxel-host-preview.stack.cards,https://*.boxel-host-preview.boxel.ai,https://localhost:*';
const stagingBase = 'boxelusercontent.dev';
const nonce = '0123456789abcdef0123456789abcdef';
const sandboxHost = `${nonce}.${stagingBase}`;

function environment(fetch) {
  return {
    SANDBOX_BASE_HOSTNAME: stagingBase,
    ALLOWED_PARENT_ORIGINS: stagingAllowed,
    ...(fetch ? { PARENT_ASSETS: { fetch } } : {}),
  };
}

test('accepts only a first-level 128-bit nonce for the configured zone', () => {
  assert.equal(isSandboxHostname(sandboxHost, stagingBase), true);
  assert.equal(
    isSandboxHostname(
      '0123456789abcdef0123456789abcdef.boxelusercontent.com',
      stagingBase,
    ),
    false,
  );
  assert.equal(
    isSandboxHostname(`renderer.${stagingBase}`, stagingBase),
    false,
  );
  assert.equal(
    isSandboxHostname(`${nonce}.renderer.${stagingBase}`, stagingBase),
    false,
  );
});

test('matches exact, preview wildcard, and port-qualified localhost parents', () => {
  assert.equal(
    isAllowedParentOrigin(
      'https://boxel-host-staging.stack.cards',
      stagingAllowed,
    ),
    true,
  );
  assert.equal(
    isAllowedParentOrigin(
      'https://my-branch.boxel-host-preview.stack.cards',
      stagingAllowed,
    ),
    true,
  );
  assert.equal(
    isAllowedParentOrigin(
      'https://my-branch.boxel-host-preview.boxel.ai',
      stagingAllowed,
    ),
    true,
  );
  assert.equal(
    isAllowedParentOrigin('https://localhost:4216', stagingAllowed),
    true,
  );
  assert.equal(
    isAllowedParentOrigin('https://app.boxel.ai', stagingAllowed),
    false,
  );
  assert.equal(
    isAllowedParentOrigin(
      'https://boxel-host-preview.stack.cards',
      stagingAllowed,
    ),
    false,
  );
});

test('adds restrictive response policy and removes cookies', async () => {
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
    stagingAllowed,
    true,
    `https://${sandboxHost}`,
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
    /style-src 'self' https:\/\/0123456789abcdef0123456789abcdef\.boxelusercontent\.dev 'unsafe-inline' https:\/\/fonts\.googleapis\.com/,
  );
  assert.match(
    response.headers.get('content-security-policy'),
    /font-src 'self' https:\/\/0123456789abcdef0123456789abcdef\.boxelusercontent\.dev data: https:\/\/fonts\.gstatic\.com/,
  );
  assert.doesNotMatch(
    response.headers.get('content-security-policy'),
    /\*\.googleapis\.com|\*\.gstatic\.com/,
  );
  assert.match(
    response.headers.get('content-security-policy'),
    /frame-ancestors https:\/\/boxel-host-staging\.stack\.cards/,
  );
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(
    response.headers.get('cross-origin-resource-policy'),
    'cross-origin',
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

for (let [path, bootstrapParameter] of [
  ['/_realm-sandbox-frame', 'bootstrapID'],
  ['/_boxel-sandbox-runtime', 'bootstrapId'],
]) {
  test(`serves the ${path} bootstrap credentiallessly`, async () => {
    let parentRequests = [];
    let env = environment(async (request) => {
      parentRequests.push(request);
      return new Response(
        '<html><head></head><body><script type="module" src="/assets/main-current.js"></script></body></html>',
        { headers: { 'content-type': 'text/html' } },
      );
    });
    let bootstrap = new URL(`https://${sandboxHost}${path}`);
    bootstrap.searchParams.set(
      'parentOrigin',
      'https://boxel-host-staging.stack.cards',
    );
    bootstrap.searchParams.set(
      bootstrapParameter,
      '11111111-1111-4111-8111-111111111111',
    );
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
    assert.equal(parentRequests.length, 1);
    assert.equal(parentRequests[0].redirect, 'manual');
    assert.equal(
      new URL(parentRequests[0].url).origin,
      'https://boxel-host-staging.stack.cards',
    );
    assert.equal(parentRequests[0].headers.get('authorization'), null);
    assert.equal(parentRequests[0].headers.get('cookie'), null);
    assert.ok(
      (await response.text()).includes(
        parentAssetPath(
          'https://boxel-host-staging.stack.cards',
          '/assets/main-current.js',
        ),
      ),
    );
  });
}

test('accepts the current runtime fallback 32-hex bootstrap id', async () => {
  let bootstrap = new URL(`https://${sandboxHost}/_boxel-sandbox-runtime`);
  bootstrap.searchParams.set(
    'parentOrigin',
    'https://boxel-host-staging.stack.cards',
  );
  bootstrap.searchParams.set('bootstrapId', nonce);
  let response = await worker.fetch(
    new Request(bootstrap),
    environment(
      async () =>
        new Response('<html><head></head></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    ),
  );
  assert.equal(response.status, 200);
});

test('proxies only assets from the exact bootstrap parent build', async () => {
  let parentOrigin = 'https://my-branch.boxel-host-preview.stack.cards';
  let requestedURL;
  let response = await worker.fetch(
    new Request(
      `https://${sandboxHost}${parentAssetPath(
        parentOrigin,
        '/assets/main-current.js',
      )}`,
      { headers: { authorization: 'Bearer secret', cookie: 'secret=1' } },
    ),
    environment(async (request) => {
      requestedURL = request.url;
      return new Response('export default 1', {
        headers: { 'content-type': 'text/javascript' },
      });
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(requestedURL, `${parentOrigin}/assets/main-current.js`);
  assert.equal(await response.text(), 'export default 1');

  let rewritten = rewriteBootstrapAssetURLs(
    '<html><head></head><script src="/assets/main.js"></script><link href="/assets/main.css"></html>',
    parentOrigin,
  );
  assert.match(rewritten, /_boxel-parent\/[^/]+\/assets\/main\.js/);
  assert.match(rewritten, /_boxel-parent\/[^/]+\/assets\/main\.css/);
  assert.match(
    rewritten,
    /globalThis\.__boxelAssetsURL="\/_boxel-parent\/[^/]+\/"/,
  );
});

test('rejects invalid hosts, parents, bootstraps, documents, and methods', async () => {
  let env = environment(
    async () =>
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html' },
      }),
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://renderer.${stagingBase}/_boxel-sandbox-runtime`),
        env,
      )
    ).status,
    421,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://${sandboxHost}/_boxel-sandbox-runtime`),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (await worker.fetch(new Request(`https://${sandboxHost}/some-card`), env))
      .status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://${sandboxHost}/_boxel-sandbox-runtime`, {
          method: 'POST',
        }),
        env,
      )
    ).status,
    405,
  );
});

test('exposes health only on the configured base hostname', async () => {
  let response = await worker.fetch(
    new Request(`https://${stagingBase}/healthz`),
    environment(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: 'boxel-sandbox-renderer',
    status: 'ok',
  });
});
