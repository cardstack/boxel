// Pretui — TurnChanges unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TurnChanges } from './turn-changes';
import type { ChangedFile } from './turn-changes';

const FILES: ChangedFile[] = [
  { path: 'src/new.gts', added: 12, removed: 0, status: 'added' },
  { path: 'src/old.gts', added: 0, removed: 30, status: 'deleted' },
  { path: 'src/moved.gts', added: 1, removed: 1, status: 'renamed' },
  { path: 'src/edited.gts', added: 4, removed: 2, state: 'kept' },
];

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-turn-changes-file]')) as HTMLElement[];
}

module('Pretui | components/turn-changes', function (hooks) {
  setupCardTest(hooks);

  test('each file says its status as a word, not only as a letter and a hue', async function (assert) {
    await render(<template><TurnChanges @files={{FILES}} /></template>);
    assert.deepEqual(
      rows().map((r) => r.querySelector('[data-test-pretui-turn-changes-status]')?.textContent?.trim()),
      ['Added', 'Deleted', 'Renamed', 'Modified'],
    );
    assert.ok(
      rows().every((r) => {
        let status = r.querySelector('[data-test-pretui-turn-changes-status]');
        let letter = status?.previousElementSibling;
        return letter?.getAttribute('aria-hidden') === 'true' && /^[ADRM]$/.test(letter.textContent?.trim() ?? '');
      }),
      'the letter is for the eye only',
    );
  });

  test('sums the changes and opens a file or the review', async function (assert) {
    let opened: string[] = [];
    let reviewed = 0;
    const onOpen = (file: ChangedFile) => opened.push(file.path);
    const onReview = () => reviewed++;
    await render(<template><TurnChanges @files={{FILES}} @onOpen={{onOpen}} @onReview={{onReview}} @selected='src/old.gts' /></template>);
    let head = document.querySelector('[data-test-pretui-turn-changes] [data-test-pretui-diff-stat]');
    assert.strictEqual(head?.getAttribute('aria-label'), '17 added, 33 removed');
    assert.strictEqual(rows()[1]?.getAttribute('aria-current'), 'true');
    await click('[data-test-pretui-turn-changes-file="src/moved.gts"]');
    await click('[data-test-pretui-turn-changes-review]');
    assert.deepEqual(opened, ['src/moved.gts']);
    assert.strictEqual(reviewed, 1);
  });
});
