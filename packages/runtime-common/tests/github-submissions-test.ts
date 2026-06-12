import { toBranchName } from '../github-submissions.ts';
import type { SharedTests } from '../helpers/index.ts';

const BRANCH_PATTERN = /^[a-f0-9]{6}-(.+)$/;

const tests = Object.freeze({
  'it builds a branch name from a listing name': async (assert) => {
    let branch = toBranchName('SomeSampleListing');
    let match = branch.match(BRANCH_PATTERN);
    assert.ok(match, `branch ${branch} matches {hash6}-{slug}`);
    assert.strictEqual(match![1], 'some-sample-listing');
  },

  'it normalizes listing names with spaces and punctuation': async (assert) => {
    let branch = toBranchName('  My  New Listing  ');
    assert.ok(/^[a-f0-9]{6}-my-new-listing$/.test(branch), branch);
    let branch2 = toBranchName('Weird---Name!!');
    assert.ok(/^[a-f0-9]{6}-weird-name$/.test(branch2), branch2);
  },

  'it normalizes camelcase listing names': async (assert) => {
    let branch = toBranchName('CamelCaseListing');
    assert.ok(/^[a-f0-9]{6}-camel-case-listing$/.test(branch), branch);
  },

  'it returns only the hash when the slug is empty': async (assert) => {
    let branch = toBranchName('   ---   ');
    assert.ok(/^[a-f0-9]{6}$/.test(branch), branch);
  },

  'it rejects missing listing names': async (assert) => {
    assert.throws(() => toBranchName(''), /listingName is required/);
  },

  'it generates a different hash on each call': async (assert) => {
    let branches = new Set(
      Array.from({ length: 10 }, () => toBranchName('same-name')),
    );
    // Vanishingly small chance of collision; if this flakes we have bigger
    // problems than this test.
    assert.ok(branches.size > 1, 'multiple calls produce different hashes');
  },
} as SharedTests<Record<string, never>>);

export default tests;
