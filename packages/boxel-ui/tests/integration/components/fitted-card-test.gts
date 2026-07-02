import { FittedCard } from '@cardstack/boxel-ui/components';
import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { setupRenderingTest } from '#tests/helpers';

module('Integration | Component | fitted-card', function (hooks) {
  setupRenderingTest(hooks);

  // ── Named blocks ─────────────────────────────────────────────────────────

  test('named blocks: all sections render when provided', async function (assert) {
    await render(
      <template>
        <FittedCard @imageUrl='https://example.com/photo.jpg'>
          <:background><div class='test-bg'></div></:background>
          <:badgeLeft><span class='test-badge-left'>New</span></:badgeLeft>
          <:badgeRight><span class='test-badge-right'>Draft</span></:badgeRight>
          <:badgeRow><span class='test-badge-row'>Pill</span></:badgeRow>
          <:placeholder><span class='test-placeholder'>*</span></:placeholder>
          <:eyebrow>Category</:eyebrow>
          <:title>My Title</:title>
          <:subtitle>Sub</:subtitle>
          <:meta><span class='test-meta'>5 min</span></:meta>
          <:footer><span class='test-footer'>2024</span></:footer>
        </FittedCard>
      </template>,
    );

    assert.dom('.fc-title').hasText('My Title');
    assert.dom('.fc-eyebrow').hasText('Category');
    assert.dom('.fc-subtitle').hasText('Sub');
    assert.dom('.test-meta').exists();
    assert.dom('.test-footer').exists();
    assert.dom('.fc-badge-left .test-badge-left').exists();
    assert.dom('.fc-badge-right .test-badge-right').exists();
    assert.dom('.fc-badge-row .test-badge-row').exists();
    assert.dom('.fc-background .test-bg').exists();
  });

  test('named blocks: omitted sections leave no DOM nodes', async function (assert) {
    await render(
      <template>
        <FittedCard><:title>T</:title></FittedCard>
      </template>,
    );

    assert.dom('.fc-eyebrow').doesNotExist();
    assert.dom('.fc-subtitle').doesNotExist();
    assert.dom('.fc-meta').doesNotExist();
    assert.dom('.fc-footer').doesNotExist();
    assert.dom('.fc-badge-left').doesNotExist();
    assert.dom('.fc-badge-right').doesNotExist();
    assert.dom('.fc-badge-row').doesNotExist();
    assert.dom('.fc-background').doesNotExist();
    assert.dom('.fc-image').doesNotExist();
  });

  // ── Image rendering ───────────────────────────────────────────────────────

  module('image rendering', function () {
    test('@imageUrl renders img with correct src and alt', async function (assert) {
      await render(
        <template>
          <FittedCard
            @imageUrl='https://example.com/photo.jpg'
            @imageAlt='A photo'
          >
            <:title>T</:title>
          </FittedCard>
        </template>,
      );
      assert.dom('.fc-image img').exists();
      assert
        .dom('.fc-image img')
        .hasAttribute('src', 'https://example.com/photo.jpg');
      assert.dom('.fc-image img').hasAttribute('alt', 'A photo');
    });

    test('@imageLoading passes through to loading attribute', async function (assert) {
      await render(
        <template>
          <FittedCard
            @imageUrl='https://example.com/photo.jpg'
            @imageLoading='lazy'
          >
            <:title>T</:title>
          </FittedCard>
        </template>,
      );
      assert.dom('.fc-image img').hasAttribute('loading', 'lazy');
    });

    test('omitting @imageUrl hides image column', async function (assert) {
      await render(
        <template>
          <FittedCard><:title>T</:title></FittedCard>
        </template>,
      );
      assert.dom('.fc-image img').doesNotExist();
      assert.dom('.fc-image').doesNotExist();
    });

    test('image block takes priority over placeholder when @imageUrl is absent', async function (assert) {
      await render(
        <template>
          <FittedCard>
            <:title>T</:title>
            <:image><img src='custom.jpg' alt='custom' /></:image>
            <:placeholder><span class='placeholder-icon'>?</span></:placeholder>
          </FittedCard>
        </template>,
      );
      assert.dom('.fc-image img[src="custom.jpg"]').exists();
      assert.dom('.fc-placeholder').doesNotExist();
    });
  });

  // ── @layout ───────────────────────────────────────────────────────────────

  module('@layout', function () {
    test('defaults to data-layout="auto" when @layout is omitted', async function (assert) {
      await render(
        <template>
          <FittedCard><:title>T</:title></FittedCard>
        </template>,
      );
      assert.dom('article').hasAttribute('data-layout', 'auto');
    });

    test('@layout="vertical" sets data-layout="vertical"', async function (assert) {
      await render(
        <template>
          <FittedCard @layout='vertical'><:title>T</:title></FittedCard>
        </template>,
      );
      assert.dom('article').hasAttribute('data-layout', 'vertical');
    });

    test('@layout="horizontal" sets data-layout="horizontal"', async function (assert) {
      await render(
        <template>
          <FittedCard @layout='horizontal'><:title>T</:title></FittedCard>
        </template>,
      );
      assert.dom('article').hasAttribute('data-layout', 'horizontal');
    });
  });

  // ── CSS custom property overrides ─────────────────────────────────────────

  module('CSS custom property overrides smoke test', function () {
    test('--fc-content-gap is applied to .fc-content', async function (assert) {
      // --fc-content-gap-no-image overrides gap when there is no image column,
      // so we provide @imageUrl to keep the base gap: var(--fc-content-gap) rule active.
      await render(
        <template>
          {{! template-lint-disable no-inline-styles }}
          <FittedCard
            @imageUrl='https://example.com/photo.jpg'
            style='--fc-content-gap: 99px'
          >
            <:title>T</:title>
          </FittedCard>
        </template>,
      );
      const content = document.querySelector('.fc-content') as HTMLElement;
      assert.ok(content, '.fc-content exists');
      assert.strictEqual(
        getComputedStyle(content).gap,
        '99px',
        '--fc-content-gap is applied',
      );
    });

    test('--fc-title-font-size is applied to .fc-title', async function (assert) {
      await render(
        <template>
          {{! template-lint-disable no-inline-styles }}
          <FittedCard style='--fc-title-font-size: 42px'>
            <:title>T</:title>
          </FittedCard>
        </template>,
      );
      const title = document.querySelector('.fc-title') as HTMLElement;
      assert.ok(title, '.fc-title exists');
      assert.strictEqual(
        getComputedStyle(title).fontSize,
        '42px',
        '--fc-title-font-size is applied',
      );
    });

    test('--fc-footer-gap is applied to .fc-footer', async function (assert) {
      await render(
        <template>
          {{! template-lint-disable no-inline-styles }}
          <FittedCard style='--fc-footer-gap: 20px'>
            <:title>T</:title>
            <:footer><span>A</span><span>B</span></:footer>
          </FittedCard>
        </template>,
      );
      const footer = document.querySelector('.fc-footer') as HTMLElement;
      assert.ok(footer, '.fc-footer exists');
      assert.strictEqual(
        getComputedStyle(footer).gap,
        '20px',
        '--fc-footer-gap is applied',
      );
    });
  });
});
