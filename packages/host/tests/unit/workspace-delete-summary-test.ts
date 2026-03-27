import { module, test } from 'qunit';

import {
  formatWorkspaceDeleteSummary,
  joinWithAnd,
} from '@cardstack/host/components/operator-mode/workspace-chooser/workspace';

module('Unit | workspace delete summary', function () {
  test('it omits zero-count categories', function (assert) {
    assert.strictEqual(
      formatWorkspaceDeleteSummary([
        { label: 'card', count: 1 },
        { label: 'definition', count: 0 },
        { label: 'file', count: 0 },
      ]),
      '1 card',
    );

    assert.strictEqual(
      formatWorkspaceDeleteSummary([
        { label: 'card', count: 2 },
        { label: 'definition', count: 1 },
        { label: 'file', count: 0 },
      ]),
      '2 cards and 1 definition',
    );
  });

  test('it returns an empty-state summary when everything is zero', function (assert) {
    assert.strictEqual(
      formatWorkspaceDeleteSummary([
        { label: 'card', count: 0 },
        { label: 'definition', count: 0 },
        { label: 'file', count: 0 },
      ]),
      'no cards, definitions, or files',
    );
  });

  test('it joins summary fragments with natural language separators', function (assert) {
    assert.strictEqual(joinWithAnd(['1 card']), '1 card');
    assert.strictEqual(
      joinWithAnd(['1 card', '2 files']),
      '1 card and 2 files',
    );
    assert.strictEqual(
      joinWithAnd(['1 card', '2 definitions', '3 files']),
      '1 card, 2 definitions, and 3 files',
    );
  });
});
