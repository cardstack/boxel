import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { navigation, useRouter } from '../src/shell/navigation.js';

describe("moving between the shell's pages", () => {
  let original = (globalThis as any).window;
  afterEach(() => {
    (globalThis as any).window = original;
  });

  // A window showing the shell's page `page` beneath `/secure/`, with the
  // router running, and the moves it makes: `route <path>` for a route
  // transition, `document <url>` for a new document.
  function showing(page: string): string[] {
    let moves: string[] = [];
    let url = new URL(`/secure/${page}`, 'https://secure.example.test');
    (globalThis as any).window = {
      location: {
        href: url.href,
        origin: url.origin,
        pathname: url.pathname,
        hash: '',
        assign: (to: string) => moves.push(`document ${to}`),
        replace: (to: string) => moves.push(`document ${to}`),
      },
    };
    useRouter({
      rootURL: '/secure/',
      currentURL: `/${page}`,
      transitionTo: (path: string) => moves.push(`route ${path}`),
      replaceWith: (path: string) => moves.push(`route ${path}`),
    });
    return moves;
  }

  test('a move between pages whose address is a path alone is a route transition', () => {
    let moves = showing('sign-in');
    navigation.assign('/secure/forgot-password');
    navigation.replace('/secure/keys');
    assert.deepEqual(moves, ['route /forgot-password', 'route /keys']);
  });

  test('a move to a page whose form makes a new password loads a new document', () => {
    let moves = showing('sign-in');
    navigation.assign('/secure/register');
    navigation.replace('/secure/reset-password');
    assert.deepEqual(moves, [
      'document /secure/register',
      'document /secure/reset-password',
    ]);
  });

  test('a move from a page whose form makes a new password loads a new document', () => {
    let fromRegister = showing('register');
    navigation.assign('/secure/sign-in');
    assert.deepEqual(fromRegister, ['document /secure/sign-in']);

    let fromReset = showing('reset-password');
    navigation.replace('/secure/sign-in');
    assert.deepEqual(fromReset, ['document /secure/sign-in']);
  });

  test("the page a move leaves is the router's, whatever the address says", () => {
    // A window sign-up ends by replacing the address with `sign-in`, and
    // stays on the register route.
    let moves = showing('register');
    (globalThis as any).window.location.pathname = '/secure/sign-in';
    navigation.assign('/secure/keys');
    assert.deepEqual(moves, ['document /secure/keys']);
  });

  test('before the first transition ends, the page a move leaves is the address', () => {
    let moves = showing('register');
    useRouter({
      rootURL: '/secure/',
      currentURL: null,
      transitionTo: (path: string) => moves.push(`route ${path}`),
    });
    navigation.assign('/secure/keys');
    assert.deepEqual(moves, ['document /secure/keys']);
  });
});
