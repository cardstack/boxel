// Pretui — semantics proof for Chip, StatusChip, Token, Delta, Meter, Avatar
// and AvatarGroup.
//
// Nothing here asserts a computed style: the components' own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied), so every colour and size reads as its initial value. What the ink components actually promise is inline custom
// properties, derived text, ARIA and the hue allowlist — all real DOM.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { Avatar } from './components/avatar';
import { AvatarGroup } from './components/avatar-group';
import { Chip } from './components/chip';
import { Delta } from './components/delta';
import { Meter } from './components/meter';
import { StatusChip } from './components/status-chip';
import { Token } from './components/token';
import { statusHue } from './internal/ink';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | ink', function (hooks) {
  setupCardTest(hooks);

  // ── statusHue ───────────────────────────────────────────────────────────
  test('statusHue is stable and lands on one of the five chart hues', function (assert) {
    assert.strictEqual(statusHue('shipped'), statusHue('shipped'), 'same value, same hue');
    for (let v of ['shipped', 'blocked', 'draft', 'in review', '']) {
      assert.ok(
        /^var\(--chart-[1-5]\)$/.test(statusHue(v)),
        `${JSON.stringify(v)} lands on one of the five chart hues`,
      );
    }
    assert.notStrictEqual(
      statusHue('shipped'),
      statusHue('blocked'),
      'the two statuses the other ink tests lean on land in different buckets (five buckets, so collisions elsewhere are expected)',
    );
  });

  // ── Chip ────────────────────────────────────────────────────────────────
  test('Chip shows the dot by default and prefers @label over the block', async function (assert) {
    await render(<template><Chip @label='Oolong'>ignored</Chip></template>);
    let el = q('[data-test-pretui-chip]');
    assert.strictEqual(el.textContent?.trim(), 'Oolong', '@label wins over the yielded block');
    assert.ok(el.querySelector('.pretui-chip-dot'), 'the dot is on by default');
  });

  test('Chip yields its block when no label is given, and @dot=false drops the dot', async function (assert) {
    await render(<template><Chip @dot={{false}}>Curing room</Chip></template>);
    let el = q('[data-test-pretui-chip]');
    assert.strictEqual(el.textContent?.trim(), 'Curing room');
    assert.notOk(el.querySelector('.pretui-chip-dot'), 'the dot is suppressed');
  });

  test('Chip passes an allowed hue through as a custom property', async function (assert) {
    await render(<template><Chip @hue='var(--chart-3)' @label='Ok' /></template>);
    assert.true(
      q('[data-test-pretui-chip]').getAttribute('style')?.includes('--pretui-chip-hue: var(--chart-3)'),
      'a kit hue reaches the inline custom property',
    );
  });

  test('Chip refuses a hue that carries its own declaration', async function (assert) {
    const EVIL = 'red; background: url(javascript:0)';
    await render(<template><Chip @hue={{EVIL}} @label='Nope' /></template>);
    assert.strictEqual(
      q('[data-test-pretui-chip]').getAttribute('style'),
      null,
      'the rejected value is dropped whole — no style attribute at all, so nothing was stripped-and-kept',
    );
  });

  // ── StatusChip ──────────────────────────────────────────────────────────
  test('StatusChip derives its hue from the value and renders it as the label', async function (assert) {
    await render(<template><StatusChip @value='blocked' /></template>);
    let el = q('[data-test-pretui-status-chip]');
    assert.strictEqual(el.textContent?.trim(), 'blocked');
    assert.true(
      el.getAttribute('style')?.includes(statusHue('blocked')),
      'the hue is the one statusHue assigns to this value',
    );
  });

  test('StatusChip lets an explicit @hue override the derived one', async function (assert) {
    await render(<template><StatusChip @value='blocked' @hue='var(--chart-1)' /></template>);
    assert.true(
      q('[data-test-pretui-status-chip]').getAttribute('style')?.includes('var(--chart-1)'),
      'the caller hue wins',
    );
  });

  // ── Token ───────────────────────────────────────────────────────────────
  test('Token renders as <code>, prefers @value, and carries an allowed hue', async function (assert) {
    await render(<template><Token @value='SKU-8812' @hue='var(--chart-2)'>ignored</Token></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(el.tagName, 'CODE', 'a machine value is marked up as code');
    assert.strictEqual(el.textContent?.trim(), 'SKU-8812');
    assert.true(el.getAttribute('style')?.includes('--pretui-token-hue: var(--chart-2)'));
  });

  test('Token falls back to its block', async function (assert) {
    await render(<template><Token>0x41</Token></template>);
    assert.strictEqual(q('[data-test-pretui-token]').textContent?.trim(), '0x41');
  });

  // ── Delta ───────────────────────────────────────────────────────────────
  test('Delta signs the number and reflects the direction', async function (assert) {
    await render(
      <template>
        <Delta @value={{12}} />
        <Delta @value={{-4}} />
        <Delta @value={{0}} />
      </template>,
    );
    let els = all('[data-test-pretui-delta]');
    assert.deepEqual(
      els.map((e) => [e.dataset['sign'], e.textContent?.trim()]),
      [
        ['up', '+12'],
        ['down', '-4'],
        ['flat', '0'],
      ],
      'positive gains a plus, negative keeps its minus, zero is flat and unsigned',
    );
  });

  test('Delta accepts a numeric string and a caller formatter', async function (assert) {
    const pct = (n: number) => `${n > 0 ? '▲' : '▼'} ${Math.abs(n)}%`;
    await render(<template><Delta @value='-7' @format={{pct}} /></template>);
    let el = q('[data-test-pretui-delta]');
    assert.strictEqual(el.dataset['sign'], 'down', 'the string is coerced before the sign is read');
    assert.strictEqual(el.textContent?.trim(), '▼ 7%', 'the formatter replaces the default text');
  });

  // ── Meter ───────────────────────────────────────────────────────────────
  test('Meter defaults to three segments and lights the ones below the level', async function (assert) {
    await render(<template><Meter @level={{2}} @label='Body' /></template>);
    let bars = all('.pretui-meter-bar');
    assert.strictEqual(bars.length, 3, 'three segments by default');
    assert.deepEqual(
      bars.map((b) => b.dataset['on']),
      ['true', 'true', undefined],
      'two lit, one dark',
    );
  });

  test('Meter announces the level to assistive tech and always ships a label (Law 4)', async function (assert) {
    await render(<template><Meter @level={{3}} @segments={{5}} @label='Astringency' /></template>);
    let el = q('[data-test-pretui-meter]');
    assert.strictEqual(el.getAttribute('aria-valuenow'), '3');
    assert.strictEqual(el.getAttribute('aria-valuemin'), '0');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '5', 'the max follows @segments');
    assert.strictEqual(el.getAttribute('aria-label'), 'Astringency');
    assert.strictEqual(
      el.getAttribute('role'),
      'meter progressbar',
      'the progressbar fallback stays for engines without role=meter',
    );
    assert.strictEqual(
      el.querySelector('.pretui-meter-label')?.textContent?.trim(),
      'Astringency',
      'the label is visible text, not only an aria attribute',
    );
    assert.strictEqual(all('.pretui-meter-bar').length, 5);
  });

  test('Meter has no clamp: a level outside 0..@segments ships as invalid aria-valuenow (KNOWN GAP)', async function (assert) {
    // KNOWN GAP, pinned rather than patched: `@level` goes straight to
    // aria-valuenow and the lit count is `i < level`, so 9 of 3 announces 9
    // against aria-valuemax=3 and lights every bar, and -2 announces -2 below
    // aria-valuemin=0. Both are invalid ARIA. A fix clamps to [0, segments];
    // when it lands, these expectations flip to '3' / '0'.
    await render(<template><Meter @level={{9}} @segments={{3}} @label='Over' /></template>);
    assert.strictEqual(q('[data-test-pretui-meter]').getAttribute('aria-valuenow'), '9', 'above max, unclamped');
    assert.deepEqual(all('.pretui-meter-bar').map((b) => b.dataset['on']), ['true', 'true', 'true']);
    await render(<template><Meter @level={{-2}} @segments={{3}} @label='Under' /></template>);
    assert.strictEqual(q('[data-test-pretui-meter]').getAttribute('aria-valuenow'), '-2', 'below min, unclamped');
  });

  test('Meter reuses the last height when @segments outruns @heights', async function (assert) {
    const HEIGHTS = [4, 8];
    await render(
      <template><Meter @level={{1}} @segments={{4}} @heights={{HEIGHTS}} @label='Depth' /></template>,
    );
    assert.deepEqual(
      all('.pretui-meter-bar').map((b) => b.style.getPropertyValue('height')),
      ['4px', '8px', '8px', '8px'],
      'a short, non-empty heights array does not produce undefined-height bars (an empty array would: heights[-1])',
    );
  });

  // ── Avatar ──────────────────────────────────────────────────────────────
  test('Avatar reduces a name to at most two initials and names itself', async function (assert) {
    await render(<template><Avatar @name='Mei Ling Chen' /></template>);
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(el.textContent?.trim(), 'ML', 'first two words only, uppercased');
    assert.strictEqual(el.getAttribute('aria-label'), 'Mei Ling Chen');
    assert.strictEqual(el.getAttribute('title'), 'Mei Ling Chen');
    assert.true(el.getAttribute('style')?.includes('width: 24px'), 'defaults to 24px');
    assert.true(
      el.getAttribute('style')?.includes(statusHue('Mei Ling Chen')),
      'the hue is derived from the name, so the same person keeps the same colour',
    );
  });

  test('Avatar scales its type with @size', async function (assert) {
    await render(<template><Avatar @name='Ada' @size={{40}} /></template>);
    let style = q('[data-test-pretui-avatar]').getAttribute('style') ?? '';
    assert.true(style.includes('width: 40px'));
    assert.true(style.includes('height: 40px'));
    assert.true(style.includes('font-size: 17px'), '0.42 of the box, rounded');
  });

  test('Avatar shows the image when given one and falls back to initials once it fails', async function (assert) {
    // A data URI that decodes: a src the harness fails on its own would fire
    // `error` inside `render`'s settle and the fallback would already be up,
    // hiding the very transition under test.
    const PIXEL =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    await render(<template><Avatar @name='Wuyi Origins' @src={{PIXEL}} /></template>);
    let el = q('[data-test-pretui-avatar]');
    let img = el.querySelector('img') as HTMLImageElement;
    assert.ok(img, 'the image is attempted first');
    assert.strictEqual(img.getAttribute('alt'), 'Wuyi Origins', 'the alt names the person');

    // Dispatched non-bubbling on purpose: `triggerEvent` bubbles, and a
    // bubbling `error` reaches window.onerror, which QUnit reports as a
    // global failure. The component listens on the img directly.
    img.dispatchEvent(new Event('error'));
    await settled();
    assert.notOk(el.querySelector('img'), 'the broken image is dropped');
    assert.strictEqual(el.textContent?.trim(), 'WO', 'the initials take over');
  });

  // ── AvatarGroup ─────────────────────────────────────────────────────────
  test('AvatarGroup keeps its members in source order', async function (assert) {
    await render(
      <template>
        <AvatarGroup>
          <Avatar @name='Ada Lovelace' />
          <Avatar @name='Grace Hopper' />
        </AvatarGroup>
      </template>,
    );
    let group = q('[data-test-pretui-avatar-group]');
    assert.deepEqual(
      Array.from(group.querySelectorAll('[data-test-pretui-avatar]')).map((a) =>
        a.textContent?.trim(),
      ),
      ['AL', 'GH'],
    );
  });
});
