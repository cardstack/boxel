import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { realmRootOfCaptureURL } from '@cardstack/host/services/capture-url-signer';
import type CaptureUrlSignerService from '@cardstack/host/services/capture-url-signer';

const REALM = 'https://my.realm/';
const OTHER_REALM = 'https://other.realm/';

function captureURL(realm: string, path: string) {
  return `${realm}_capture/${path}`;
}

// A fake `_sign-capture-urls` endpoint: records each request body and answers
// with tokened variants (or an unsigned echo when `echoUnsigned`).
class FakeNetworkService extends Service {
  requests: { url: string; urls: string[] }[] = [];
  echoUnsigned = false;
  failWith: string | undefined;
  // Freshly minted tokens expire this far out unless a test overrides it.
  expiresInMs = 15 * 60 * 1000;
  private mintCounter = 0;

  get authedFetch() {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      let { urls } = JSON.parse(String(init?.body)) as { urls: string[] };
      this.requests.push({ url, urls });
      if (this.failWith) {
        return new Response(this.failWith, { status: 401 });
      }
      let signed = urls.map((u) =>
        this.echoUnsigned
          ? { url: u, signedUrl: u, expiresAt: null }
          : {
              url: u,
              signedUrl: `${u}${u.includes('?') ? '&' : '?'}token=t${this.mintCounter++}`,
              expiresAt: new Date(Date.now() + this.expiresInMs).toISOString(),
            },
      );
      return new Response(JSON.stringify({ signed }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  }
}

module('Unit | Service | capture-url-signer', function (hooks) {
  setupTest(hooks);

  let fakeNetwork: FakeNetworkService;
  let signer: CaptureUrlSignerService;

  hooks.beforeEach(function () {
    this.owner.register('service:network', FakeNetworkService);
    fakeNetwork = this.owner.lookup(
      'service:network',
    ) as unknown as FakeNetworkService;
    signer = this.owner.lookup(
      'service:capture-url-signer',
    ) as CaptureUrlSignerService;
  });

  test('signs a capture URL against its realm', async function (assert) {
    let url = captureURL(REALM, 'Invoice/1?type=pdf');
    let signedUrl = await signer.getSignedUrl(url);
    assert.true(signedUrl.startsWith(url), 'signed URL extends the durable');
    assert.true(
      new URL(signedUrl).searchParams.has('token'),
      'a token param is appended',
    );
    assert.strictEqual(fakeNetwork.requests.length, 1);
    assert.strictEqual(
      fakeNetwork.requests[0].url,
      `${REALM}_sign-capture-urls`,
      'the mint targets the capture URL’s own realm',
    );
  });

  test('same-turn requests coalesce into one batch per realm', async function (assert) {
    let [a, b, c] = await Promise.all([
      signer.getSignedUrl(captureURL(REALM, 'a')),
      signer.getSignedUrl(captureURL(REALM, 'b')),
      signer.getSignedUrl(captureURL(OTHER_REALM, 'c')),
    ]);
    assert.true(a.includes('token='));
    assert.true(b.includes('token='));
    assert.true(c.includes('token='));
    assert.strictEqual(
      fakeNetwork.requests.length,
      2,
      'one request per realm, not per URL',
    );
    let batched = fakeNetwork.requests.find((r) => r.url.startsWith(REALM));
    assert.strictEqual(batched?.urls.length, 2, 'same-realm URLs share a body');
  });

  test('a fresh token is memoized; a stale one re-mints', async function (assert) {
    let url = captureURL(REALM, 'memo');
    let first = await signer.getSignedUrl(url);
    let second = await signer.getSignedUrl(url);
    assert.strictEqual(second, first, 'within the slack window, no re-mint');
    assert.strictEqual(fakeNetwork.requests.length, 1);

    // A token whose remaining life is inside the re-mint slack must not be
    // handed out again. Backdate by making the next mint expire imminently.
    fakeNetwork.expiresInMs = 1000;
    let shortLived = captureURL(REALM, 'short');
    await signer.getSignedUrl(shortLived);
    await signer.getSignedUrl(shortLived);
    assert.strictEqual(
      fakeNetwork.requests.length,
      3,
      'an imminently-expiring token re-mints on the next ask',
    );
  });

  test('an unsigned echo (public realm) is served and cached', async function (assert) {
    fakeNetwork.echoUnsigned = true;
    let url = captureURL(REALM, 'public');
    let signedUrl = await signer.getSignedUrl(url);
    assert.strictEqual(signedUrl, url, 'the durable URL comes back as-is');
    await signer.getSignedUrl(url);
    assert.strictEqual(fakeNetwork.requests.length, 1, 'the echo is memoized');
  });

  test('a failed mint rejects every waiter without wedging later mints', async function (assert) {
    fakeNetwork.failWith = 'nope';
    let url = captureURL(REALM, 'fails');
    await assert.rejects(
      Promise.all([signer.getSignedUrl(url), signer.getSignedUrl(url)]),
      /Signing capture URLs failed: 401/,
    );
    fakeNetwork.failWith = undefined;
    let signedUrl = await signer.getSignedUrl(url);
    assert.true(signedUrl.includes('token='), 'a later mint succeeds');
  });

  test('realmRootOfCaptureURL extracts the realm and refuses non-capture URLs', function (assert) {
    assert.strictEqual(
      realmRootOfCaptureURL('https://my.realm/sub/_capture/card?type=pdf'),
      'https://my.realm/sub/',
    );
    assert.throws(
      () => realmRootOfCaptureURL('https://my.realm/just-a-card'),
      /not a capture URL/,
    );
  });
});
