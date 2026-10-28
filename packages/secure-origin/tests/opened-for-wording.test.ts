import { test } from 'node:test';
import assert from 'node:assert/strict';

import { methodPhrase } from '../src/shell/keys/context.ts';
import { openedFor } from '../src/shell/keys/opened-for.ts';

// What a destination says a request does there, by its HTTP method.
const PHRASES: [string, string][] = [
  ['GET', 'Reads from'],
  ['HEAD', 'Reads from'],
  ['get', 'Reads from'],
  ['DELETE', 'Deletes at'],
  ['delete', 'Deletes at'],
  ['POST', 'Sends data to'],
  ['PUT', 'Sends data to'],
  ['PATCH', 'Sends data to'],
];

for (let [method, phrase] of PHRASES) {
  test(`${method} reads “${phrase}”`, () => {
    assert.equal(methodPhrase(method), phrase);
  });
}

function reasonIn(reason: string): string | undefined {
  return openedFor(`#reason=${encodeURIComponent(reason)}`).reason;
}

test('a reason loses its bidi controls, so it reads in the order it was written', () => {
  assert.equal(
    reasonIn('Forecasts ‮need‬ your ⁦key⁩‏'),
    'Forecasts need your key',
  );
});

test('a reason keeps its joiners, which hold emoji and shape scripts', () => {
  let family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  let persian = 'می‌خواهم';
  assert.equal(reasonIn(`For the ${family}`), `For the ${family}`);
  assert.equal(reasonIn(persian), persian);
});
