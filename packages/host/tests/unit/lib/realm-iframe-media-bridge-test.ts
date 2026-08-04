import { waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import RealmIframeMediaBridge from '@cardstack/host/lib/realm-iframe-media-bridge';

module('Unit | realm iframe media bridge', function (hooks) {
  let originalCreateObjectURL = URL.createObjectURL;
  let originalRevokeObjectURL = URL.revokeObjectURL;

  hooks.afterEach(function () {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  test('hydrates a declarative Realm image through the private fetch capability', async function (assert) {
    let fetchedURL: string | undefined;
    let fetchedAccept: string | null | undefined;
    let revoked: string[] = [];
    URL.createObjectURL = () => 'blob:realm-image-1';
    URL.revokeObjectURL = (url) => revoked.push(url);

    let root = document.createElement('main');
    let image = document.createElement('img');
    image.src = '../assets/poster.png';
    root.append(image);
    document.body.append(root);
    let bridge = new RealmIframeMediaBridge(
      root,
      async (input, init) => {
        let request = new Request(input, init);
        fetchedURL = request.url;
        fetchedAccept = request.headers.get('accept');
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      },
      'https://realm.example/Cards/poster-board',
    );

    try {
      bridge.start();
      await waitUntil(() => image.src === 'blob:realm-image-1');
      assert.strictEqual(
        fetchedURL,
        'https://realm.example/assets/poster.png',
        'relative media resolves against the root card rather than the iframe route',
      );
      assert.strictEqual(fetchedAccept, 'image/*');
      assert.strictEqual(image.src, 'blob:realm-image-1');
    } finally {
      bridge.stop();
      root.remove();
    }
    assert.deepEqual(revoked, ['blob:realm-image-1']);
  });

  test('refresh awaits an image hydration already started by the observer', async function (assert) {
    URL.createObjectURL = () => 'blob:realm-image-2';
    let releaseFetch!: () => void;
    let responseReady = new Promise<void>(
      (resolve) => (releaseFetch = resolve),
    );
    let root = document.createElement('main');
    let image = document.createElement('img');
    image.src = '../assets/poster.png';
    root.append(image);
    document.body.append(root);
    let bridge = new RealmIframeMediaBridge(
      root,
      async () => {
        await responseReady;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      },
      'https://realm.example/cards/poster-board.gts',
    );

    try {
      bridge.start();
      let refreshed = false;
      let refresh = bridge.refresh().then(() => (refreshed = true));
      await Promise.resolve();
      assert.false(
        image.hasAttribute('src'),
        'the unauthenticated iframe request is held while the Host fetch is pending',
      );
      assert.false(
        refreshed,
        'a duplicate refresh retains the in-flight capability request',
      );
      releaseFetch();
      await refresh;
      assert.true(refreshed, 'refresh settles after the image is hydrated');
      assert.strictEqual(image.src, 'blob:realm-image-2');
    } finally {
      bridge.stop();
      root.remove();
    }
  });

  test('resolves linked-card media against the owning card resource', async function (assert) {
    let fetchedURL: string | undefined;
    URL.createObjectURL = () => 'blob:linked-card-image';

    let root = document.createElement('main');
    let linkedCard = document.createElement('article');
    linkedCard.dataset.boxelCardId =
      'https://realm.example/TierItem/fast-food-mcdonalds';
    let image = document.createElement('img');
    image.src = '../assets/fast-food/mcdonalds.svg';
    linkedCard.append(image);
    root.append(linkedCard);
    document.body.append(root);
    let bridge = new RealmIframeMediaBridge(
      root,
      async (input) => {
        fetchedURL = new Request(input).url;
        return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
          status: 200,
          headers: { 'content-type': 'image/svg+xml' },
        });
      },
      'https://realm.example/TierList/national-fast-food-ranking',
    );

    try {
      bridge.start();
      await waitUntil(() => image.src === 'blob:linked-card-image');
      assert.strictEqual(
        fetchedURL,
        'https://realm.example/assets/fast-food/mcdonalds.svg',
      );
    } finally {
      bridge.stop();
      root.remove();
    }
  });
});
