// Pretui — MarkdownStream unit tests, and the projection behind it.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { MarkdownStream } from './markdown-stream';
import type { MarkdownSource } from './markdown-stream';
import {
  collectDefinitions,
  heal,
  healBfm,
  isPathLike,
  project,
  splitBlocks,
} from '../internal/markdown-projection';

class Message {
  @tracked text = '';
  @tracked streaming = true;
}

/** A renderer whose results the test hands back one at a time. */
class SlowRenderer {
  pending: { src: string; resolve: (html: string) => void }[] = [];
  render = (source: MarkdownSource): Promise<string> =>
    new Promise((resolve) => this.pending.push({ src: source.src, resolve }));
  /** resolve the request made for `src` with its text in a paragraph */
  async land(src: string) {
    let request = this.pending.find((p) => p.src === src);
    if (!request) {
      throw new Error(`no request for ${src}`);
    }
    request.resolve(`<p>${src}</p>`);
    await settled();
  }
}

const TWO_LINKS = 'a\n\nb';

function blocks(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-markdown-block]')) as HTMLElement[];
}

module('Pretui | internal/markdown-projection', function () {
  test('splitBlocks cuts at blank lines, headings and fences, and keeps a loose list together', function (assert) {
    let text = '# Title\nFirst para\nstill first\n\n- one\n\n- two\n\n```ts\nlet a = 1;\n```\nafter';
    assert.deepEqual(
      splitBlocks(text).map((b) => [b.kind, b.raw]),
      [
        ['text', '# Title'],
        ['text', 'First para\nstill first'],
        ['text', '- one\n\n- two'],
        ['code', '```ts\nlet a = 1;\n```'],
        ['text', 'after'],
      ],
    );
    let code = splitBlocks(text)[3]!;
    assert.strictEqual(code.language, 'ts');
    assert.strictEqual(code.source, 'let a = 1;');
    assert.true(code.complete);
  });

  test('an open fence is incomplete and its source grows by what was appended', function (assert) {
    let [block] = splitBlocks('```js\nlet a');
    assert.false(block!.complete);
    assert.strictEqual(block!.source, 'let a');
  });

  test('project keeps finished blocks, marks only the tail live, and freezes it when the stream ends', function (assert) {
    let first = project(undefined, 'One\n\nTw', true);
    assert.deepEqual(first.blocks.map((b) => b.mode), ['frozen', 'live']);
    let second = project(first, 'One\n\nTwo', true);
    assert.strictEqual(second.blocks[0], first.blocks[0], 'a finished block is reused, not re-split');
    assert.strictEqual(second.blocks[1]!.raw, 'Two');
    let done = project(second, 'One\n\nTwo', false);
    assert.deepEqual(done.blocks.map((b) => b.mode), ['frozen', 'frozen']);
    let open = project(undefined, '```\ncode', true);
    assert.strictEqual(open.blocks[0]!.mode, 'frozen', 'an open fence grows by appending, never as a live tail');
  });

  test('heal closes what a half-written tail left open', function (assert) {
    assert.strictEqual(heal('some **bold'), 'some **bold**');
    assert.strictEqual(heal('a *b and **c'), 'a *b and **c***');
    assert.strictEqual(heal('call `fn'), 'call `fn`');
    assert.strictEqual(heal('see [the docs](https://exa'), 'see the docs');
    assert.strictEqual(heal('see [the do'), 'see the do');
    assert.strictEqual(heal('- item *one'), '- item *one*', 'a bullet is not emphasis');
    assert.strictEqual(heal('`**` stays'), '`**` stays', 'markers inside code are not emphasis');
  });

  test('healBfm hides a half-written reference and escapes a lone dollar', function (assert) {
    assert.strictEqual(healBfm('look at :card[https://x/y'), 'look at ');
    assert.strictEqual(healBfm('costs $5 today'), 'costs \\$5 today');
    assert.strictEqual(healBfm('$x$ and $y$'), '$x$ and $y$');
  });

  test('collectDefinitions and isPathLike', function (assert) {
    assert.strictEqual(collectDefinitions('See [a].\n\n[a]: https://a.test\n[^1]: note'), '[a]: https://a.test\n[^1]: note');
    assert.true(isPathLike('src/a.gts:42'));
    assert.true(isPathLike('card.json#L4-L9'));
    assert.false(isPathLike('not a path'));
  });
});

module('Pretui | components/markdown-stream', function (hooks) {
  setupCardTest(hooks);

  test('renders each block, with the caret on the live tail only while streaming', async function (assert) {
    let message = new Message();
    message.text = 'First\n\nSecond';
    await render(<template><MarkdownStream @text={{message.text}} @streaming={{message.streaming}} /></template>);
    assert.deepEqual(blocks().map((b) => [b.dataset['mode'], b.textContent?.trim()]), [
      ['frozen', 'First'],
      ['live', 'Second'],
    ]);
    assert.ok(blocks()[1]!.querySelector('[data-test-pretui-markdown-caret]'), 'the live tail carries the caret');
    assert.strictEqual(blocks()[0]!.querySelector('[data-test-pretui-markdown-caret]'), null);
    message.streaming = false;
    await settled();
    assert.strictEqual(document.querySelector('[data-test-pretui-markdown-caret]'), null, 'no caret once the stream ends');
  });

  test('an async render that lands after a newer request still advances the tail', async function (assert) {
    let message = new Message();
    let renderer = new SlowRenderer();
    message.text = 'Hel';
    await render(<template><MarkdownStream @text={{message.text}} @streaming={{message.streaming}} @render={{renderer.render}} /></template>);
    message.text = 'Hello';
    await settled();
    message.text = 'Hello wor';
    await settled();
    await renderer.land('Hel');
    assert.strictEqual(blocks()[0]!.textContent?.trim(), 'Hel', 'the first result shows although two newer requests are pending');
    await renderer.land('Hello wor');
    assert.strictEqual(blocks()[0]!.textContent?.trim(), 'Hello wor');
    await renderer.land('Hello');
    assert.strictEqual(blocks()[0]!.textContent?.trim(), 'Hello wor', 'a result older than the one on screen is dropped');
  });

  test('marks external links to open in a new tab and leaves unconfirmed relative links inert', async function (assert) {
    const html = (source: MarkdownSource) => (source.src.startsWith('a') ? '<p><a href="https://example.test">out</a></p>' : '<p><a href="docs/x.md">in</a></p>');
    await render(<template><MarkdownStream @text={{TWO_LINKS}} @render={{html}} /></template>);
    let [external, relative] = blocks().map((b) => b.querySelector('a') as HTMLAnchorElement);
    assert.strictEqual(external!.getAttribute('target'), '_blank');
    assert.strictEqual(external!.getAttribute('rel'), 'noopener noreferrer');
    assert.strictEqual(relative!.dataset['markdownLink'], 'pending');
  });

  test('announces completion politely, and only once the stream ends', async function (assert) {
    let message = new Message();
    message.text = 'Done soon';
    await render(<template><MarkdownStream @text={{message.text}} @streaming={{message.streaming}} @announceComplete='Answer complete' /></template>);
    let live = document.querySelector('[data-test-pretui-markdown-announce]') as HTMLElement;
    assert.strictEqual(live.textContent, '');
    message.streaming = false;
    await settled();
    assert.strictEqual(live.textContent, 'Answer complete');
  });
});

