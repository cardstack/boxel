import { describe, it, expect } from 'vitest';

import { parseSearchQuery } from '../../src/commands/search.js';

describe('parseSearchQuery', () => {
  it('treats an omitted query as list-all ({})', () => {
    expect(parseSearchQuery(undefined)).toEqual({});
  });

  it('treats an empty/whitespace query as list-all ({})', () => {
    expect(parseSearchQuery('   ')).toEqual({});
  });

  it('passes {} through as list-all', () => {
    expect(parseSearchQuery('{}')).toEqual({});
  });

  it('strips an explicit empty filter and treats it as list-all', () => {
    // An empty filter means "everything", so normalize to a bare list-all
    // query rather than sending a filter the server can't classify.
    expect(parseSearchQuery('{"filter":{}}')).toEqual({});
  });

  it('passes a real type filter through unchanged', () => {
    let raw =
      '{"filter":{"type":{"module":"https://x/realm/blog-post","name":"BlogPost"}}}';
    expect(parseSearchQuery(raw)).toEqual({
      filter: {
        type: { module: 'https://x/realm/blog-post', name: 'BlogPost' },
      },
    });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSearchQuery('{not json')).toThrow(/Invalid JSON/);
  });

  it('throws on a non-object (array)', () => {
    expect(() => parseSearchQuery('[1,2]')).toThrow(/must be a JSON object/);
  });
});
