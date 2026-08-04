import { module, test } from 'qunit';

import { withContextualComponents } from '@cardstack/host/services/realm-sandbox';

module('Unit | realm sandbox contextual fields', function () {
  test('nested field components are lookup capabilities, not enumerable schema', function (assert) {
    let cardInfo = { component: 'cardInfo' };
    let name = { component: 'cardInfo.name' };
    let summary = { component: 'cardInfo.summary' };
    let fields = { title: { component: 'title' }, cardInfo };

    let cardInfoWithContext = withContextualComponents(
      cardInfo,
      { name, summary },
      cardInfo,
    );
    let fieldsWithContext = withContextualComponents(fields, {
      'cardInfo.name': name,
      'cardInfo.summary': summary,
    });

    assert.deepEqual(
      Object.keys(cardInfoWithContext),
      ['component'],
      'cardInfo nested components are not advertised as authored fields',
    );
    assert.strictEqual(
      (cardInfoWithContext as typeof cardInfo & { name: typeof name }).name,
      name,
      'segmented cardInfo.name lookup still resolves',
    );
    assert.deepEqual(
      Object.keys(fieldsWithContext),
      ['title', 'cardInfo'],
      'the outer schema remains the authored top-level shape',
    );
    assert.strictEqual(
      (
        fieldsWithContext as typeof fields & {
          'cardInfo.name': typeof name;
        }
      )['cardInfo.name'],
      name,
      'Glimmer-compatible dotted lookup still resolves',
    );
  });
});
