import { describe, it, expect } from 'vitest';
import { anonymousCapsClause } from '../../src/lib/user-keys.ts';

// The clause `keys show`, the sharing warning and `keys approve` end a
// sentence about people who aren't signed in with: only the caps a key has.
describe('anonymousCapsClause', () => {
  it('names both caps when the key has both', () => {
    expect(
      anonymousCapsClause({
        anonymousDailyCap: 100,
        anonymousMonthlyCap: 1000,
      }),
    ).toBe(', up to 100 calls a day and 1000 a month all together');
  });

  it('names the daily cap alone', () => {
    expect(
      anonymousCapsClause({
        anonymousDailyCap: 100,
        anonymousMonthlyCap: null,
      }),
    ).toBe(', up to 100 calls a day all together');
  });

  it('names the monthly cap alone', () => {
    expect(anonymousCapsClause({ anonymousMonthlyCap: 1000 })).toBe(
      ', up to 1000 calls a month all together',
    );
  });

  it('says nothing for a key with neither', () => {
    expect(
      anonymousCapsClause({
        anonymousDailyCap: null,
        anonymousMonthlyCap: null,
      }),
    ).toBe('');
    expect(anonymousCapsClause({})).toBe('');
  });
});
