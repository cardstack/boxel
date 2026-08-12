import { module, test } from 'qunit';

import {
  authorizationMiddleware,
  shouldSkipReauthenticationForContext,
  withReauthenticationAllowed,
} from '@cardstack/runtime-common/authorization-middleware';

module('Unit | authorization middleware render context', function () {
  test('dedicated prerender contexts remain storage-token only', function (assert) {
    assert.true(
      shouldSkipReauthenticationForContext({
        inRenderContext: true,
        interactiveRenderContextDepth: 0,
        isBrowserTestEnv: false,
      }),
    );
  });

  test('interactive CardPrerender may silently recover a realm session', function (assert) {
    assert.false(
      shouldSkipReauthenticationForContext({
        inRenderContext: true,
        interactiveRenderContextDepth: 1,
        isBrowserTestEnv: false,
      }),
    );
  });

  test('ordinary browser and browser-test requests may reauthenticate', function (assert) {
    assert.false(
      shouldSkipReauthenticationForContext({
        inRenderContext: false,
        interactiveRenderContextDepth: 0,
        isBrowserTestEnv: false,
      }),
    );
    assert.false(
      shouldSkipReauthenticationForContext({
        inRenderContext: true,
        interactiveRenderContextDepth: 0,
        isBrowserTestEnv: true,
      }),
    );
  });

  test('an interactive source load scopes and restores its reauthentication allowance', async function (assert) {
    let globals = globalThis as {
      __boxelInteractiveRenderContextDepth?: number;
    };
    delete globals.__boxelInteractiveRenderContextDepth;

    await withReauthenticationAllowed(async () => {
      assert.strictEqual(globals.__boxelInteractiveRenderContextDepth, 1);
      await withReauthenticationAllowed(async () => {
        assert.strictEqual(globals.__boxelInteractiveRenderContextDepth, 2);
      });
      assert.strictEqual(globals.__boxelInteractiveRenderContextDepth, 1);
    });

    assert.strictEqual(globals.__boxelInteractiveRenderContextDepth, undefined);
  });

  test('a rejected stale token retries as anonymous when reauthentication has no token', async function (assert) {
    let attempts: string[] = [];
    let middleware = authorizationMiddleware({
      token: () => 'Bearer stale-token',
      reauthenticate: async () => undefined,
    });
    let request = new Request('https://realm.example/card');

    let response = await middleware(request, async (onwardRequest) => {
      attempts.push(onwardRequest.headers.get('Authorization') ?? 'anonymous');
      if (attempts.length === 1) {
        return new Response('expired token', {
          status: 401,
          headers: {
            'x-boxel-realm-url': 'https://realm.example/',
          },
        });
      }
      return new Response('public content', { status: 200 });
    });

    assert.strictEqual(response.status, 200);
    assert.deepEqual(attempts, ['Bearer stale-token', 'anonymous']);
  });

  test('a safe read retries as anonymous when a replacement token is also rejected', async function (assert) {
    let attempts: string[] = [];
    let middleware = authorizationMiddleware({
      token: () => 'Bearer stale-token',
      reauthenticate: async () => 'Bearer replacement-token',
    });
    let request = new Request('https://realm.example/card');

    let response = await middleware(request, async (onwardRequest) => {
      attempts.push(onwardRequest.headers.get('Authorization') ?? 'anonymous');
      if (attempts.length < 3) {
        return new Response('rejected token', {
          status: 401,
          headers: {
            'x-boxel-realm-url': 'https://realm.example/',
          },
        });
      }
      return new Response('public content', { status: 200 });
    });

    assert.strictEqual(response.status, 200);
    assert.deepEqual(attempts, [
      'Bearer stale-token',
      'Bearer replacement-token',
      'anonymous',
    ]);
  });

  test('a mutation is not retried anonymously when a replacement token is rejected', async function (assert) {
    let attempts: string[] = [];
    let middleware = authorizationMiddleware({
      token: () => 'Bearer stale-token',
      reauthenticate: async () => 'Bearer replacement-token',
    });
    let request = new Request('https://realm.example/card', {
      method: 'PATCH',
    });

    let response = await middleware(request, async (onwardRequest) => {
      attempts.push(onwardRequest.headers.get('Authorization') ?? 'anonymous');
      return new Response('rejected token', {
        status: 401,
        headers: {
          'x-boxel-realm-url': 'https://realm.example/',
        },
      });
    });

    assert.strictEqual(response.status, 401);
    assert.deepEqual(attempts, [
      'Bearer stale-token',
      'Bearer replacement-token',
    ]);
  });
});
