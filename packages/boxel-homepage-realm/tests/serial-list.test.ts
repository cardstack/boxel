// Regression tests for the footer colophon's serial-comma separator
// (contents/boxel-ai-website/lib/serial-list.ts).
//
// Run with: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serialSeparator } from '../contents/boxel-ai-website/lib/serial-list.ts';

function joined(items: string[]): string {
  return items
    .map((word, i) => word + serialSeparator(i, items.length))
    .join('');
}

test('serial comma list shapes', () => {
  assert.equal(joined(['designed']), 'designed');
  // two items: bare "and", no comma splice ("designed, and coded" was the bug)
  assert.equal(joined(['designed', 'coded']), 'designed and coded');
  assert.equal(joined(['a', 'b', 'c']), 'a, b, and c');
  assert.equal(
    joined(['designed', 'coded', 'edited', 'published', 'hosted']),
    'designed, coded, edited, published, and hosted',
  );
  assert.equal(joined([]), '');
});
