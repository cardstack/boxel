import type { SharedTests } from '../helpers/index.ts';
import { isIgnored } from '../realm-index-updater.ts';

const realmURL = new URL('https://realms.example/acme/pretui/');
const noGitignoreRules = new Map();

const tests = Object.freeze({
  'Deck and jj bookkeeping are never Realm content': async (assert) => {
    for (let path of [
      '.deck/repository.json',
      '.deck/history/repo/store/git/HEAD',
      '.jj/repo/op_heads/heads',
      '.jj.main-orphan/repo',
    ]) {
      assert.true(
        isIgnored(realmURL, noGitignoreRules, new URL(path, realmURL)),
        `${path} is ignored`,
      );
    }
  },

  'authored dotfiles remain Realm content': async (assert) => {
    assert.false(
      isIgnored(realmURL, noGitignoreRules, new URL('.env.example', realmURL)),
    );
  },
} as SharedTests<{}>);

export default tests;
