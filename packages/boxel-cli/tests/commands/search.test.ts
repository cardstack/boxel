import { describe, it, expect } from 'vitest';

import {
  parseSearchQuery,
  searchErrorHint,
} from '../../src/commands/search.js';

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
    // The server rejects {"filter":{}} with "cannot determine the type of
    // filter"; an empty filter means "everything", so normalize to list-all.
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

describe('searchErrorHint', () => {
  it('adds a hint for the unclassifiable-filter 400', () => {
    let hint = searchErrorHint(
      400,
      'HTTP 400: {"errors":[{"message":"Invalid query: /filter: cannot determine the type of filter"}]}',
    );
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/omit --query/);
    expect(hint).toMatch(/"on"/);
  });

  it('returns nothing for unrelated errors', () => {
    expect(searchErrorHint(404, 'HTTP 404: not found')).toBeUndefined();
    expect(searchErrorHint(0, 'network down')).toBeUndefined();
  });
});
