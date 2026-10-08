// Pretui — semantics proof for Chip, StatusChip, Delta, Meter, Avatar and
// AvatarGroup. Token's tests live in components/token.test.gts.
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

  test('Chip is neutral by default and reflects a known @tone', async function (assert) {
    await render(
      <template>
        <Chip @label='Draft' data-test-neutral />
        <Chip @label='Live' @tone='success' data-test-toned />
      </template>,
    );
    assert.strictEqual(q('[data-test-neutral]').getAttribute('data-tone'), 'neutral');
    assert.strictEqual(q('[data-test-toned]').getAttribute('data-tone'), 'success');
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

  test('a toned StatusChip hands its dot to the tone, and neutral keeps the status hue', async function (assert) {
    await render(
      <template>
        <StatusChip @value='live' @tone='success' data-test-toned />
        <StatusChip @value='live' @tone='neutral' data-test-neutral />
      </template>,
    );
    assert.strictEqual(q('[data-test-toned]').getAttribute('data-tone'), 'success');
    assert.strictEqual(
      q('[data-test-toned]').getAttribute('style'),
      null,
      'no status hue overrides the tone on a toned chip',
    );
    assert.true(
      q('[data-test-neutral]').getAttribute('style')?.includes(statusHue('live')),
      'an explicit neutral tone renders like an omitted one',
    );
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

  test('Meter clamps a level outside 0..@segments, in what it announces and what it lights', async function (assert) {
    // An aria-valuenow outside aria-valuemin..aria-valuemax is invalid ARIA,
    // so the announced level is the same clamped count of lit bars.
    await render(<template><Meter @level={{9}} @segments={{3}} @label='Over' /></template>);
    assert.strictEqual(
      q('[data-test-pretui-meter]').getAttribute('aria-valuenow'),
      '3',
      'above max, announced as the max',
    );
    assert.deepEqual(
      all('.pretui-meter-bar').map((b) => b.dataset['on']),
      ['true', 'true', 'true'],
      'every bar is lit, and no more',
    );
    await render(<template><Meter @level={{-2}} @segments={{3}} @label='Under' /></template>);
    assert.strictEqual(
      q('[data-test-pretui-meter]').getAttribute('aria-valuenow'),
      '0',
      'below min, announced as the min',
    );
    assert.deepEqual(
      all('.pretui-meter-bar').map((b) => b.dataset['on']),
      [undefined, undefined, undefined],
      'no bar is lit',
    );
  });

  test('Meter rounds a fractional level up, so the announced level matches the lit count', async function (assert) {
    await render(<template><Meter @level={{1.5}} @segments={{3}} @label='Partial' /></template>);
    assert.strictEqual(
      q('[data-test-pretui-meter]').getAttribute('aria-valuenow'),
      '2',
      'announced as the whole number of lit bars',
    );
    assert.deepEqual(
      all('.pretui-meter-bar').map((b) => b.dataset['on']),
      ['true', 'true', undefined],
      'two bars are lit',
    );
  });

  test('Meter reads an unset or non-finite level as 0', async function (assert) {
    // The signature requires a number, but an unset model property or a failed
    // computation still reaches the component at runtime.
    const UNSET = undefined as unknown as number;
    const NOT_A_NUMBER = Number.NaN;
    await render(
      <template>
        <Meter @level={{UNSET}} @label='Unset' data-test-unset />
        <Meter @level={{NOT_A_NUMBER}} @label='NaN' data-test-nan />
      </template>,
    );
    for (let sel of ['[data-test-unset]', '[data-test-nan]']) {
      assert.strictEqual(q(sel).getAttribute('aria-valuenow'), '0', `${sel}: announced as the min, not NaN`);
      assert.deepEqual(
        Array.from(q(sel).querySelectorAll<HTMLElement>('.pretui-meter-bar')).map((b) => b.dataset['on']),
        [undefined, undefined, undefined],
        `${sel}: no bar is lit`,
      );
    }
  });

  test('Meter reads a NaN @segments as no bars, so aria-valuemax is 0, not NaN', async function (assert) {
    const NOT_A_NUMBER = Number.NaN;
    await render(<template><Meter @level={{2}} @segments={{NOT_A_NUMBER}} @label='NaN' /></template>);
    let el = q('[data-test-pretui-meter]');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '0', 'no bars, so the max is 0');
    assert.strictEqual(el.getAttribute('aria-valuenow'), '0', 'the level is clamped into the empty range');
    assert.strictEqual(all('.pretui-meter-bar').length, 0, 'no bars are drawn');
  });

  test('Meter reads a negative @segments as no bars, so aria-valuemax never drops below aria-valuemin', async function (assert) {
    await render(<template><Meter @level={{2}} @segments={{-2}} @label='Negative' /></template>);
    let el = q('[data-test-pretui-meter]');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '0', 'no bars, so the max is 0');
    assert.strictEqual(el.getAttribute('aria-valuenow'), '0', 'the level is clamped into the empty range');
    assert.strictEqual(all('.pretui-meter-bar').length, 0, 'no bars are drawn');
  });

  test('Meter rounds a fractional @segments up, so aria-valuemax is the number of bars drawn', async function (assert) {
    await render(<template><Meter @level={{3}} @segments={{2.5}} @label='Fractional' /></template>);
    let el = q('[data-test-pretui-meter]');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '3', 'three bars drawn, so the max is 3');
    assert.strictEqual(el.getAttribute('aria-valuenow'), '3', 'a full meter announces the whole max');
    assert.deepEqual(
      all('.pretui-meter-bar').map((b) => b.dataset['on']),
      ['true', 'true', 'true'],
      'all three bars are lit',
    );
  });

  test('Meter reuses the last height when @segments outruns @heights', async function (assert) {
    const HEIGHTS = [4, 8];
    await render(
      <template><Meter @level={{1}} @segments={{4}} @heights={{HEIGHTS}} @label='Depth' /></template>,
    );
    assert.deepEqual(
      all('.pretui-meter-bar').map((b) => b.style.getPropertyValue('height')),
      ['0.25rem', '0.5rem', '0.5rem', '0.5rem'],
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
    assert.strictEqual(
      el.style.getPropertyValue('--pretui-avatar-size'),
      '',
      "defaults to the stylesheet's 1.5rem (24px at a 16px root)",
    );
    assert.true(
      el.getAttribute('style')?.includes(statusHue('Mei Ling Chen')),
      'the hue is derived from the name, so the same person keeps the same colour',
    );
  });

  test('Avatar writes @size as rem, which the stylesheet sizes the disc and its type from', async function (assert) {
    await render(<template><Avatar @name='Ada' @size={{40}} /></template>);
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(el.style.getPropertyValue('--pretui-avatar-size').trim(), '2.5rem');
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
