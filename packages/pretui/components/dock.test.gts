// Pretui — Dock unit tests. The magnification is CSS
// (:hover / :has), so it is not assertable here — the toolbar semantics are.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Dock } from './dock';

function dock(): HTMLElement {
  return document.querySelector('[data-test-pretui-dock]') as HTMLElement;
}
function items(): HTMLButtonElement[] {
  return Array.from(dock().querySelectorAll('[data-test-pretui-dock-item]')) as HTMLButtonElement[];
}

module('Pretui | components/dock', function (hooks) {
  setupCardTest(hooks);

  test('is a labelled toolbar of named buttons sized by one custom property', async function (assert) {
    await render(
      <template>
        <Dock as |D|>
          <D.Item @label='Mail'>✉</D.Item>
          <D.Item @label='Calendar'>▦</D.Item>
        </Dock>
      </template>,
    );
    // KNOWN GAP, pinned as shipped: the rail claims role=toolbar but has no
    // tabindex, no keydown handler and no roving focus, so the APG toolbar
    // contract (one tab stop, arrow traversal) is not honoured; dock.md
    // promises the roving tabindex. When it lands, or the role is dropped,
    // this expectation is the one to revisit.
    assert.strictEqual(dock().getAttribute('role'), 'toolbar', 'KNOWN GAP: a toolbar role without toolbar keyboard behaviour');
    assert.strictEqual(dock().getAttribute('aria-label'), 'Dock', 'named even when the caller forgets');
    assert.strictEqual(dock().getAttribute('style'), '--pretui-dock-size: 40px', 'the resting size drives everything else');
    assert.deepEqual(items().map((i) => i.tagName), ['BUTTON', 'BUTTON']);
    assert.deepEqual(items().map((i) => i.getAttribute('aria-label')), ['Mail', 'Calendar'], 'a glyph-only button needs a name');
    assert.deepEqual(items().map((i) => i.getAttribute('title')), ['Mail', 'Calendar'], 'and a hover tooltip for the sighted');
    assert.strictEqual(items()[0]?.querySelector('.pretui-dock-item-glyph')?.getAttribute('aria-hidden'), 'true', 'the glyph is decoration');
  });

  test('takes a caller label and size, and routes item clicks', async function (assert) {
    let clicks = 0;
    const onClick = () => (clicks += 1);
    await render(
      <template>
        <Dock @label='Apps' @size={{56}} as |D|>
          <D.Item @label='Mail' @onClick={{onClick}}>✉</D.Item>
        </Dock>
      </template>,
    );
    assert.strictEqual(dock().getAttribute('aria-label'), 'Apps');
    assert.strictEqual(dock().getAttribute('style'), '--pretui-dock-size: 56px');
    await click(items()[0] as HTMLElement);
    assert.strictEqual(clicks, 1);
  });
});
