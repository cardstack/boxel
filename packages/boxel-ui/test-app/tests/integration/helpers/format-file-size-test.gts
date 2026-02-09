import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatFileSize } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatFileSize', function (hooks) {
  setupRenderingTest(hooks);

  test('binary file size formatting (default)', async function (assert) {
    await render(<template>{{formatFileSize 1572864}}</template>); // 1.5 MiB
    assert.dom().hasText('1.50 MiB', 'formats in binary units by default');
  });

  test('decimal file size formatting', async function (assert) {
    await render(<template>{{formatFileSize 1572864 binary=false}}</template>);
    assert
      .dom()
      .hasText('1.57 MB', 'formats in decimal units when binary=false');
  });

  test('file size precision control', async function (assert) {
    await render(<template>{{formatFileSize 1572864 precision=0}}</template>);
    assert.dom().hasText('2 MiB', 'precision 0 rounds to nearest whole');

    await render(<template>{{formatFileSize 1572864 precision=3}}</template>);
    assert.dom().hasText('1.500 MiB', 'precision 3 shows three decimal places');

    await render(<template>{{formatFileSize 1572864 precision=1}}</template>);
    assert.dom().hasText('1.5 MiB', 'precision 1 shows one decimal place');
  });

  test('file size auto-scaling', async function (assert) {
    await render(<template>{{formatFileSize 1024}}</template>);
    assert.dom().hasText('1.00 KiB', 'auto-scales to KiB');

    await render(<template>{{formatFileSize 1073741824}}</template>);
    assert.dom().hasText('1.00 GiB', 'auto-scales to GiB');

    await render(<template>{{formatFileSize 1099511627776}}</template>);
    assert.dom().hasText('1.00 TiB', 'auto-scales to TiB');

    await render(<template>{{formatFileSize 512}}</template>);
    assert.dom().hasText('512.00 B', 'small sizes stay in bytes');
  });

  test('file size edge cases', async function (assert) {
    await render(<template>{{formatFileSize 0}}</template>);
    assert.dom().hasText('0 B', 'handles zero bytes');

    await render(
      <template>{{formatFileSize null fallback='Unknown size'}}</template>,
    );
    assert.dom().hasText('Unknown size', 'uses fallback for null');

    await render(
      <template>{{formatFileSize undefined fallback='No size'}}</template>,
    );
    assert.dom().hasText('No size', 'uses fallback for undefined');
  });

  test('binary vs decimal units', async function (assert) {
    const size = 1000000; // 1 million bytes

    await render(<template>{{formatFileSize size binary=true}}</template>);
    assert.dom().hasText('976.56 KiB', 'binary uses 1024 base');

    await render(<template>{{formatFileSize size binary=false}}</template>);
    assert.dom().hasText('1.00 MB', 'decimal uses 1000 base');
  });

  test('extreme file sizes', async function (assert) {
    const hugeSize = 1000000000000000; // 1 PB

    await render(<template>{{formatFileSize hugeSize binary=false}}</template>);
    assert.dom().hasText('1.00 PB', 'handles petabyte sizes');

    await render(<template>{{formatFileSize hugeSize binary=true}}</template>);
    assert.dom().hasText('909.49 TiB', 'handles large binary sizes');
  });

  test('invalid size handling', async function (assert) {
    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatFileSize 'not-a-number' fallback='Invalid size'}}
      </template>,
    );
    assert.dom().hasText('Invalid size', 'handles non-numeric input');

    await render(
      <template>{{formatFileSize -1024 fallback='Negative size'}}</template>,
    );
    assert.dom().hasText('Negative size', 'handles negative sizes');
  });

  test('precision edge cases', async function (assert) {
    await render(
      <template>
        {{formatFileSize 1024 precision=100 fallback='Huge precision'}}
      </template>,
    );
    assert.dom().hasText('Huge precision', 'handles huge precision values');

    await render(
      <template>
        {{formatFileSize 1024 precision=2.5 fallback='Float precision'}}
      </template>,
    );
    assert.dom().hasText('Float precision', 'handles float precision values');

    await render(
      <template>
        {{formatFileSize 1024 precision=-1 fallback='Negative precision'}}
      </template>,
    );
    assert.dom().hasText('Negative precision', 'handles negative precision');
  });

  test('localization', async function (assert) {
    await render(
      <template>{{formatFileSize 1048576 locale='de-DE'}}</template>,
    );
    assert.dom().hasText('1,00 MiB', 'German locale formatting');

    await render(
      <template>{{formatFileSize 1048576 locale='fr-FR'}}</template>,
    );
    assert.dom().hasText('1,00 MiB', 'French locale formatting');

    await render(
      <template>{{formatFileSize 1048576 locale='ko-KR'}}</template>,
    );
    assert.dom().hasText('1.00 MiB', 'Korean locale formatting');
  });

  test('very small sizes', async function (assert) {
    await render(<template>{{formatFileSize 1}}</template>);
    assert.dom().hasText('1.00 B', 'handles single byte');

    await render(<template>{{formatFileSize 0.5}}</template>);
    assert.dom().hasText('0.50 B', 'handles fractional bytes');
  });

  module('JavaScript function usage', function () {
    test('formatFileSize function can be called directly', async function (assert) {
      const result = formatFileSize(1048576, { precision: 1 });
      assert.strictEqual(
        result,
        '1.0 MiB',
        'function returns formatted file size',
      );

      const decimalResult = formatFileSize(1000000, {
        binary: false,
        precision: 2,
      });
      assert.strictEqual(
        decimalResult,
        '1.00 MB',
        'function handles decimal units',
      );
    });
  });
});
