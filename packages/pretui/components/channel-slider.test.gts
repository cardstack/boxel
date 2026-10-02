// Pretui — ChannelSlider unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ChannelSlider } from './channel-slider';
import type { ChannelTrack } from './channel-slider';
import { parseColor } from '../color-engine';
import type { ColorValue } from '../color-engine';

const RED = parseColor('#ff0000') as ColorValue;
const HALF_BLUE = parseColor('rgb(0 0 255 / 40%)') as ColorValue;
function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function styleOf(sel: string): string {
  return q(sel).getAttribute('style') ?? '';
}

module('Pretui | components/channel-slider', function (hooks) {
  setupCardTest(hooks);

  const CHANNEL_TRACK: ChannelTrack = {
    kind: 'channel',
    color: RED,
    index: 0,
    gamut: 'srgb',
  };
  const ALPHA_TRACK: ChannelTrack = { kind: 'alpha', color: HALF_BLUE, gamut: 'srgb' };

  test('ChannelSlider is a native range that speaks a sentence, not a number', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ChannelSlider
          @label='Lightness'
          @valueText='Lightness 62 percent'
          @value={{62}}
          @min={{0}}
          @max={{100}}
          @step={{1}}
          @track={{CHANNEL_TRACK}}
          @onInput={{noop}}
        />
      </template>,
    );
    let input = q('.pretui-chslider-input') as HTMLInputElement;
    assert.strictEqual(input.type, 'range', 'the platform gives the keyboard model for free');
    assert.strictEqual(input.getAttribute('aria-label'), 'Lightness');
    assert.strictEqual(
      input.getAttribute('aria-valuetext'),
      'Lightness 62 percent',
      'a raw 62 tells a screen-reader user nothing about what it measures',
    );
    assert.strictEqual(input.min, '0');
    assert.strictEqual(input.max, '100');
    assert.strictEqual(input.value, '62');
  });

  test('ChannelSlider builds the channel and alpha tracks from the engine, not from caller text', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ChannelSlider @label='A' @valueText='a' @value={{0}} @min={{0}} @max={{1}} @step={{0.01}} @track={{CHANNEL_TRACK}} @onInput={{noop}} />
        <ChannelSlider @label='B' @valueText='b' @value={{0}} @min={{0}} @max={{1}} @step={{0.01}} @track={{ALPHA_TRACK}} @checker={{true}} @onInput={{noop}} />
      </template>,
    );
    let rails = all('.pretui-chslider');
    assert.true(
      rails[0]?.getAttribute('style')?.includes('--pretui-slider-track: linear-gradient'),
      'the channel sweep is a gradient the engine constructed',
    );
    assert.true(rails[1]?.getAttribute('style')?.includes('--pretui-slider-track: linear-gradient'));
    assert.strictEqual(rails[1]?.dataset['checker'], 'true', 'alpha needs the checkerboard under it to be legible');
    assert.strictEqual(rails[0]?.dataset['checker'], undefined);
  });

  test('ChannelSlider drops a custom track whole when it fails the allowlist', async function (assert) {
    const EVIL: ChannelTrack = { kind: 'custom', css: 'url(javascript:0)' };
    const noop = () => {};
    await render(
      <template>
        <ChannelSlider @label='C' @valueText='c' @value={{0}} @min={{0}} @max={{1}} @step={{0.01}} @track={{EVIL}} @onInput={{noop}} />
      </template>,
    );
    let style = styleOf('.pretui-chslider');
    assert.notOk(style.includes('javascript'));
    assert.true(
      style.includes('--pretui-slider-track: none'),
      'dropped whole, so the stylesheet paints — never stripped and half-used',
    );
  });

  test('ChannelSlider reports each drag position and commits once at the end', async function (assert) {
    let values: number[] = [];
    let commits = 0;
    const onInput = (v: number) => values.push(v);
    const onCommit = () => (commits += 1);
    await render(
      <template>
        <ChannelSlider @label='L' @valueText='l' @value={{20}} @min={{0}} @max={{100}} @step={{1}} @track={{CHANNEL_TRACK}} @onInput={{onInput}} @onCommit={{onCommit}} />
      </template>,
    );
    // `fillIn` on a range fires input then change — one move and its commit.
    await fillIn(q('.pretui-chslider-input'), '55');
    assert.deepEqual(values, [55], 'a number, not the string the input holds');
    assert.strictEqual(commits, 1, 'announcements belong on the commit, not on every pixel of the drag');
  });

  test('ChannelSlider leaves plain arrows on a non-wrapping channel to the platform', async function (assert) {
    let values: number[] = [];
    const onInput = (v: number) => values.push(v);
    await render(
      <template>
        <ChannelSlider @label='L' @valueText='l' @value={{20}} @min={{0}} @max={{100}} @step={{1}} @track={{CHANNEL_TRACK}} @onInput={{onInput}} />
      </template>,
    );
    await triggerKeyEvent(q('.pretui-chslider-input'), 'keydown', 'ArrowRight');
    assert.deepEqual(
      values,
      [],
      'the native range already does this correctly — intercepting could only diverge from it',
    );
  });

  test('ChannelSlider takes over for a coarse or fine step, and for a wrapping channel', async function (assert) {
    let values: number[] = [];
    const onInput = (v: number) => values.push(v);
    await render(
      <template>
        <ChannelSlider @label='L' @valueText='l' @value={{20}} @min={{0}} @max={{100}} @step={{1}} @track={{CHANNEL_TRACK}} @onInput={{onInput}} />
      </template>,
    );
    await triggerKeyEvent(q('.pretui-chslider-input'), 'keydown', 'ArrowRight', { shiftKey: true });
    await triggerKeyEvent(q('.pretui-chslider-input'), 'keydown', 'ArrowRight', { altKey: true });
    assert.deepEqual(values, [30, 20.1], 'Shift is ×10 the step, Alt is ÷10 — both from the unchanged @value of 20');
  });

  test('ChannelSlider wraps a hue at both ends instead of stopping', async function (assert) {
    let values: number[] = [];
    const onInput = (v: number) => values.push(v);
    await render(
      <template>
        <ChannelSlider @label='Hue' @valueText='h' @value={{359}} @min={{0}} @max={{360}} @step={{1}} @wrap={{true}} @track={{CHANNEL_TRACK}} @onInput={{onInput}} />
      </template>,
    );
    await triggerKeyEvent(q('.pretui-chslider-input'), 'keydown', 'ArrowRight');
    assert.deepEqual(values, [0], 'past 360 is 0 — a hue circle has no ends');
    values.length = 0;
    await render(
      <template>
        <ChannelSlider @label='Hue' @valueText='h' @value={{0}} @min={{0}} @max={{360}} @step={{1}} @wrap={{true}} @track={{CHANNEL_TRACK}} @onInput={{onInput}} />
      </template>,
    );
    await triggerKeyEvent(q('.pretui-chslider-input'), 'keydown', 'ArrowLeft');
    assert.deepEqual(values, [359], 'and below 0 is 359');
  });

  test('ChannelSlider disables the native control', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ChannelSlider @label='L' @valueText='l' @value={{20}} @min={{0}} @max={{100}} @step={{1}} @track={{CHANNEL_TRACK}} @disabled={{true}} @onInput={{noop}} />
      </template>,
    );
    assert.true((q('.pretui-chslider-input') as HTMLInputElement).disabled);
  });
});
