import { describe, it, expect } from 'vitest';

import {
  formatEntry,
  shortTransientRetriesExhausted,
  type TransientRenderRetriesExhaustedEntry,
} from '../../src/commands/realm/indexing-errors.js';

// A row whose transient render failures used up their retries keeps its last
// good content, so it reads as healthy; `boxel realm indexing-errors` is where
// it shows. These hold its one-line summary to saying so, rather than falling
// through to another finding's formatter.

function exhausted(
  attributes: Partial<TransientRenderRetriesExhaustedEntry['attributes']> = {},
): TransientRenderRetriesExhaustedEntry {
  return {
    type: 'transient-render-retries-exhausted',
    id: 'instance::https://example.test/example-realm/Note/1.json',
    attributes: {
      url: 'https://example.test/example-realm/Note/1.json',
      entryType: 'instance',
      channel: 'html',
      failedRenders: 4,
      transientRenderError: {
        status: 504,
        title: 'Render timeout',
        message: 'Render timed-out after 60000 ms',
      },
      ...attributes,
    },
  };
}

describe('realm indexing-errors: transient-render-retries-exhausted', () => {
  it('says the render kept failing transiently, how often, and why', () => {
    expect(formatEntry(exhausted())).toBe(
      '[instance] https://example.test/example-realm/Note/1.json  stale: html render kept failing transiently (4 failed renders): Render timeout',
    );
  });

  it('names the index channel, and reads a missing count or error', () => {
    expect(
      shortTransientRetriesExhausted(
        exhausted({
          channel: 'index',
          failedRenders: null,
          transientRenderError: null,
        }),
      ),
    ).toBe(
      'stale: index render kept failing transiently (failed renders): <no error document>',
    );
  });

  it('never reads as a broken-link finding', () => {
    expect(formatEntry(exhausted())).not.toContain('broken links');
  });
});
