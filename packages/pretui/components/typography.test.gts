// Pretui — Typography unit tests: every atom renders the element its name
// promises.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Blockquote, Code, Link, Paragraph, Text, Title, Typography } from './typography';

// not a tone Text knows, so the fallback is what is under test
const SIDEWAYS = 'sideways' as unknown as 'default';

module('Pretui | components/typography', function (hooks) {
  setupCardTest(hooks);

  test('Title renders h1–h6 from @level, h2 by default', async function (assert) {
    await render(<template>
      <Title>Default</Title>
      <Title @level={{1}}>One</Title>
      <Title @level={{4}} @size='heading'>Four</Title>
      <Title @level={{3}}>Three</Title>
      <Title @level={{5}}>Five</Title>
      <Title @level={{6}}>Six</Title>
    </template>);
    let tags = [...document.querySelectorAll('[data-test-pretui-title]')].map((el) => el.tagName);
    assert.deepEqual(tags, ['H2', 'H1', 'H4', 'H3', 'H5', 'H6']);
    let four = document.querySelectorAll('[data-test-pretui-title]')[2] as HTMLElement;
    assert.strictEqual(four.dataset['size'], 'heading', '@size decouples the look from the level');
  });

  test('Text carries tone and size, and the semantic tags carry meaning', async function (assert) {
    await render(<template>
      <Text @tone='muted' @size='sm' class='t-a'>quiet</Text>
      <Text @strong={{true}} class='t-b'>bold</Text>
      <Text @mark={{true}} class='t-c'>hit</Text>
      <Text @strike={{true}} class='t-d'>old</Text>
      <Text @strong={{true}} @italic={{true}} class='t-e'>both</Text>
      <Text @tone={{SIDEWAYS}} class='t-f'>x</Text>
    </template>);
    let a = document.querySelector('.t-a') as HTMLElement;
    assert.strictEqual(a.tagName, 'SPAN');
    assert.strictEqual(a.dataset['tone'], 'muted');
    assert.strictEqual(a.dataset['size'], 'sm');
    assert.ok(document.querySelector('.t-b strong'));
    assert.ok(document.querySelector('.t-c mark'));
    assert.ok(document.querySelector('.t-d s'));
    assert.ok(document.querySelector('.t-e strong em'));
    assert.strictEqual((document.querySelector('.t-f') as HTMLElement).dataset['tone'], 'default', 'an unknown tone falls back');
  });

  test('Paragraph is a p; Code is a code', async function (assert) {
    await render(<template>
      <Paragraph @tone='muted'>Body copy</Paragraph>
      <Code>pnpm lint</Code>
    </template>);
    assert.strictEqual(document.querySelector('[data-test-pretui-paragraph]')?.tagName, 'P');
    assert.strictEqual(document.querySelector('[data-test-pretui-code]')?.tagName, 'CODE');
  });

  test('Blockquote is a figure with a blockquote and a figcaption', async function (assert) {
    await render(<template>
      <Blockquote @attribution='A. Roaster' @cite='https://example.com/notes'>Roast lighter.</Blockquote>
    </template>);
    let fig = document.querySelector('[data-test-pretui-blockquote]') as HTMLElement;
    assert.strictEqual(fig.tagName, 'FIGURE');
    assert.strictEqual(fig.querySelector('blockquote')?.getAttribute('cite'), 'https://example.com/notes');
    assert.strictEqual(fig.querySelector('figcaption')?.textContent?.trim(), '— A. Roaster');
  });

  test('Link is an a; @external opens safely and says so', async function (assert) {
    await render(<template>
      <Link @href='/lots' class='t-a'>Lots</Link>
      <Link @href='https://example.com' @external={{true}} class='t-b'>Docs</Link>
    </template>);
    let a = document.querySelector('.t-a') as HTMLAnchorElement;
    assert.strictEqual(a.getAttribute('href'), '/lots');
    assert.notOk(a.hasAttribute('target'));
    let b = document.querySelector('.t-b') as HTMLAnchorElement;
    assert.strictEqual(b.getAttribute('target'), '_blank');
    assert.strictEqual(b.getAttribute('rel'), 'noopener noreferrer');
    assert.ok(b.textContent?.includes('(opens in a new tab)'), 'the new tab is announced');
  });

  test('the Typography namespace is the same components', function (assert) {
    assert.strictEqual(Typography.Title, Title);
    assert.strictEqual(Typography.Text, Text);
    assert.strictEqual(Typography.Link, Link);
  });
});
