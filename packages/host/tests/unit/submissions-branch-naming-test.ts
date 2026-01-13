import { module, test } from 'qunit';

import { runSharedTest } from '@cardstack/runtime-common/helpers';
// eslint-disable-next-line ember/no-test-import-export
import githubWebhookTests from '@cardstack/runtime-common/tests/submissions-branch-naming-test';

module('Submissions Branch Naming', function () {
  test('it converts a matrix room id to a branch name', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it converts a branch name back to a matrix room id', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it extracts the room id from a branch name with a suffix', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it builds a branch name from a room id and listing name', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it normalizes listing names with spaces and punctuation', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it normalizes camelcase listing names', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it drops the listing segment when the slug is empty', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it rejects branch names without the prefix', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });

  test('it rejects branch names with an invalid encoded room id', async function (assert) {
    await runSharedTest(githubWebhookTests, assert, {});
  });
});
