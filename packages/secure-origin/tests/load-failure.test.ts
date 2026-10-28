import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LinkError, loadFailure } from '../src/shell/keys/context.ts';

const NOT_FOUND =
  'This workspace, card or request doesn’t exist, or you don’t have access to it.';
const GENERAL = 'Boxel couldn’t load this page.';

function refused(status: number) {
  return Object.assign(new Error('refused'), { status });
}

// What each way a page's load can fail says, and whether it offers to try
// again.
const CASES: [string, unknown, string, boolean][] = [
  [
    'no response',
    Object.assign(new Error('fetch failed'), { code: 'network' }),
    'Boxel couldn’t be reached. Check your connection and try again.',
    true,
  ],
  ['400', refused(400), GENERAL, false],
  ['403', refused(403), 'You don’t have access to this.', false],
  ['404', refused(404), NOT_FOUND, false],
  ['408', refused(408), GENERAL, true],
  ['409', refused(409), GENERAL, false],
  ['429', refused(429), GENERAL, true],
  ['500', refused(500), GENERAL, true],
  ['503', refused(503), GENERAL, true],
  ['an error with no status', new Error('oops'), GENERAL, true],
  [
    'a link that names nothing',
    new LinkError('no key', 'This key isn’t one of yours.'),
    'This key isn’t one of yours.',
    false,
  ],
];

for (let [what, error, message, retryable] of CASES) {
  test(`${what}: “${message}”, ${retryable ? '' : 'not '}retryable`, () => {
    let failure = loadFailure(error);
    assert.equal(failure.message, message);
    assert.equal(failure.retryable, retryable);
  });
}

test('a link that names nothing keeps its detail behind Show Details', () => {
  let failure = loadFailure(new LinkError('no such shared key', 'Missing.'));
  assert.deepEqual(failure.details, [
    { label: 'Message', value: 'No such shared key.' },
  ]);
});
