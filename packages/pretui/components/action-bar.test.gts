// Pretui — ActionBar unit tests: one tab stop through membership changes,
// and destructive actions last in an overflow menu.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ActionBar } from './action-bar';
import type { ActionBarAction } from './action-bar';
import { destructiveLast } from '../internal/menu';

type Entry = { label: string; destructive?: boolean };

class Actions {
  @tracked list: ActionBarAction[] = [
    { id: 'archive', label: 'Archive' },
    { id: 'delete', label: 'Delete' },
  ];
}

function stops(): HTMLElement[] {
  return ([...document.querySelectorAll('[data-actionbar-item]')] as HTMLElement[]).filter((el) => el.tabIndex === 0);
}

module('Pretui | components/action-bar', function (hooks) {
  setupCardTest(hooks);

  test('swapping one action for another keeps exactly one tab stop', async function (assert) {
    let state = new Actions();
    await render(<template><ActionBar @count={{2}} @actions={{state.list}} /></template>);
    assert.strictEqual(stops().length, 1);
    state.list = [
      { id: 'archive', label: 'Archive' },
      { id: 'restore', label: 'Restore' },
    ];
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(stops().length, 1, 'the same count, new members, still one stop');
  });

  test('destructive entries go last, below a separator', function (assert) {
    let out = destructiveLast<Entry>([
      { label: 'Edit' },
      { label: 'Delete', destructive: true },
      { label: 'Rename' },
    ]);
    assert.deepEqual(
      out.map((e) => (e === '---' ? '---' : e.label)),
      ['Edit', 'Rename', '---', 'Delete'],
    );
    assert.deepEqual(
      destructiveLast<Entry>([{ label: 'Edit' }]).map((e) => (e === '---' ? '---' : e.label)),
      ['Edit'],
      'no separator without a destructive entry',
    );
  });
});
