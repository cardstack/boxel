import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { suggestBumpForTree } from '../lib/semver-delta.ts';

const APP = `import AccountCard from './account';
export default class CRMApp {}
`;
const ACCOUNT = `export default class AccountCard {}
export function normalize(a) { return a; }
`;

function tree(files: Record<string, string>) {
  return new Map(Object.entries(files));
}

module(basename(import.meta.filename), function () {
  module('the structural pass over a pack', function () {
    test('an unchanged tree is a patch', function (assert) {
      let verdict = suggestBumpForTree(
        tree({ 'app.gts': APP, 'account.gts': ACCOUNT }),
        tree({ 'app.gts': APP, 'account.gts': ACCOUNT }),
      );
      assert.strictEqual(verdict.bump, 'patch');
      assert.deepEqual(verdict.reasons, []);
    });

    test('a removed module is major even with nothing else changed', function (assert) {
      // Every file in a pack serves at its own address, so deleting one
      // removes an address somebody's import may name — whether or not
      // anything in the pack re-exported it.
      let verdict = suggestBumpForTree(
        tree({ 'app.gts': APP, 'account.gts': ACCOUNT }),
        tree({ 'app.gts': APP }),
      );
      assert.strictEqual(verdict.bump, 'major');
      assert.strictEqual(verdict.reasons[0]?.member, 'account.gts');
    });

    test('a removed non-module is not', function (assert) {
      // A README carries no address anyone imports.
      let verdict = suggestBumpForTree(
        tree({ 'app.gts': APP, 'README.md': 'hi' }),
        tree({ 'app.gts': APP }),
      );
      assert.strictEqual(verdict.bump, 'patch');
    });

    test('a new module is minor', function (assert) {
      let verdict = suggestBumpForTree(
        tree({ 'app.gts': APP }),
        tree({ 'app.gts': APP, 'lead.gts': 'export default class L {}\n' }),
      );
      assert.strictEqual(verdict.bump, 'minor');
    });

    test('a break inside a non-entry module is still found, and is named by path', function (assert) {
      // The gap that made a tree pass necessary: comparing only the entry
      // module described one file of an app that ships four, so a break in
      // AccountCard was invisible while CRMApp looked untouched.
      let verdict = suggestBumpForTree(
        tree({ 'app.gts': APP, 'account.gts': ACCOUNT }),
        tree({
          'app.gts': APP,
          'account.gts': `export default class AccountCard {}\n`,
        }),
      );
      assert.strictEqual(verdict.bump, 'major');
      assert.strictEqual(
        verdict.reasons[0]?.member,
        'account.gts › normalize',
        'the path is carried so a reviewer knows which file to open',
      );
    });

    test('it says that a moved member reads as a removal', function (assert) {
      // Stated on every verdict rather than discovered by someone confused
      // about why a refactor came back major.
      let verdict = suggestBumpForTree(tree({}), tree({}));
      assert.true(verdict.blindTo.includes('MOVED'));
    });
  });
});
