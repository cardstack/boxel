import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import {
  noteRedirect,
  stripSignInAs,
} from '@cardstack/host/lib/secure-sign-in';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// `boxel browse` on a profile with no Matrix token opens the app with
// `?signInAs=<the profile's account>`, never a credential.
module('Acceptance | sign in as', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    window.sessionStorage.clear();
    setupUserSubscription();
    setupAuthEndpoints();
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: { ...SYSTEM_CARD_FIXTURE_CONTENTS },
    });
  });

  // The window mock has no history of its own, so the addresses the app
  // replaces its own with are recorded here instead of reaching the runner's.
  let replaced: string[];
  let originalReplaceState: History['replaceState'];

  hooks.beforeEach(function () {
    replaced = [];
    originalReplaceState = window.history.replaceState;
    (window.history as any).replaceState = (
      _state: unknown,
      _title: string,
      url?: string | null,
    ) => {
      if (url) {
        replaced.push(url);
      }
    };
  });

  hooks.afterEach(function () {
    // Lets go of any account a test left held for a sign-in.
    stripSignInAs();
    window.sessionStorage.clear();
    (window.history as any).replaceState = originalReplaceState;
  });

  function landedOnSecureSignIn() {
    let landed = new URL(window.location.href);
    let signIn = new URL(ENV.secureOriginURL);
    signIn.pathname = `${signIn.pathname.replace(/\/+$/, '')}/sign-in`;
    return landed.origin + landed.pathname === signIn.href
      ? new URLSearchParams(landed.hash.slice(1))
      : undefined;
  }

  async function open(path: string) {
    window.location.href = path;
    await visit(path);
  }

  // The app's address, as it replaced it, is the page it was opened on
  // without the account.
  function droppedSignInAs() {
    return replaced.includes('/');
  }

  test('already the account the link names, the app opens and drops it from the address', async function (assert) {
    await open(`/?signInAs=${encodeURIComponent('@testuser:localhost')}`);

    assert.true(getService('matrix-service').isLoggedIn);
    assert.dom('[data-test-secure-sign-in-landing]').doesNotExist();
    assert.true(droppedSignInAs(), 'the account is taken out of the address');
  });

  test('signed in as another account, the app sends the user to sign in as the one the link names', async function (assert) {
    await open(`/?signInAs=${encodeURIComponent('@example-other:localhost')}`);

    let fragment = landedOnSecureSignIn();
    assert.ok(fragment, 'the app goes to the secure origin’s sign-in');
    assert.strictEqual(fragment!.get('user'), '@example-other:localhost');
    assert.false(
      new URL(fragment!.get('return')!).searchParams.has('signInAs'),
      'the page to come back to asks for no account',
    );
    assert.false(
      getService('matrix-service').isLoggedIn,
      'the stored account is not booted',
    );
  });

  test('a dead session for the account the link names still asks to sign in as that account', async function (assert) {
    // The stored session is the named account's, but the server has ended
    // it: starting it fails and signs the app out, as `start()` does.
    let matrixService = getService('matrix-service');
    matrixService.start = (async () => {
      await matrixService.logout();
    }) as typeof matrixService.start;

    await open(`/?signInAs=${encodeURIComponent('@testuser:localhost')}`);

    let fragment = landedOnSecureSignIn();
    assert.ok(fragment, 'the app goes to the secure origin’s sign-in');
    assert.strictEqual(fragment!.get('user'), '@testuser:localhost');
    assert.false(droppedSignInAs(), 'the account stays until it signs in');
  });

  test('a link naming an account in any other shape is ignored', async function (assert) {
    await open(`/?signInAs=${encodeURIComponent('testuser')}`);
    await waitFor('[data-test-dashboard]');

    assert.true(getService('matrix-service').isLoggedIn);
    assert.strictEqual(landedOnSecureSignIn(), undefined);
  });

  test('back from the secure origin without switching, the app opens as the stored account', async function (assert) {
    noteRedirect(Date.now() - 1000);
    await open(`/?signInAs=${encodeURIComponent('@example-other:localhost')}`);
    await waitFor('[data-test-dashboard]');

    assert.true(getService('matrix-service').isLoggedIn);
    assert.true(droppedSignInAs(), 'the account is taken out of the address');
  });
});
