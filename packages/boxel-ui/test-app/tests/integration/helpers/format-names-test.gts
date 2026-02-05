import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatNames } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatNames', function (hooks) {
  setupRenderingTest(hooks);

  test('basic name formatting', async function (assert) {
    const name = { first: 'John', last: 'Doe' };

    await render(<template>{{formatNames name}}</template>);
    assert.dom().hasText('John Doe', 'formats basic first-last name');
  });

  test('name format options', async function (assert) {
    const name = { first: 'John', middle: 'Michael', last: 'Doe' };

    await render(<template>{{formatNames name format='full'}}</template>);
    assert
      .dom()
      .hasText('John Michael Doe', 'full format includes middle name');

    await render(<template>{{formatNames name format='first-last'}}</template>);
    assert.dom().hasText('John Doe', 'first-last format excludes middle name');

    await render(<template>{{formatNames name format='last-first'}}</template>);
    assert.dom().hasText('Doe, John', 'last-first format with comma');

    await render(<template>{{formatNames name format='initials'}}</template>);
    assert.dom().hasText('J.M.D.', 'initials format shows abbreviated form');
  });

  test('middle name handling', async function (assert) {
    const name = { first: 'John', middle: 'Michael', last: 'Doe' };

    await render(<template>{{formatNames name includeMiddle=true}}</template>);
    assert
      .dom()
      .hasText('John Michael Doe', 'includes middle name when specified');

    await render(<template>{{formatNames name includeMiddle=false}}</template>);
    assert.dom().hasText('John Doe', 'excludes middle name when specified');
  });

  test('string name input', async function (assert) {
    await render(<template>{{formatNames 'John Doe'}}</template>);
    assert.dom().hasText('John Doe', 'handles string input directly');

    await render(<template>{{formatNames 'John Michael Doe'}}</template>);
    assert.dom().hasText('John Michael Doe', 'handles full string name');
  });

  test('name edge cases', async function (assert) {
    await render(
      <template>{{formatNames null fallback='Anonymous'}}</template>,
    );
    assert.dom().hasText('Anonymous', 'uses fallback for null');

    await render(
      <template>{{formatNames undefined fallback='No name'}}</template>,
    );
    assert.dom().hasText('No name', 'uses fallback for undefined');

    const emptyName = {};
    await render(
      <template>{{formatNames emptyName fallback='Missing name'}}</template>,
    );
    assert.dom().hasText('Missing name', 'uses fallback for empty object');
  });

  test('partial name objects', async function (assert) {
    const firstOnly = { first: 'John' };
    await render(<template>{{formatNames firstOnly}}</template>);
    assert.dom().hasText('John', 'handles first name only');

    const lastOnly = { last: 'Doe' };
    await render(<template>{{formatNames lastOnly}}</template>);
    assert.dom().hasText('Doe', 'handles last name only');

    const middleOnly = { middle: 'Michael' };
    await render(<template>{{formatNames middleOnly}}</template>);
    assert.dom().hasText('Michael', 'handles middle name only');
  });

  test('custom separator', async function (assert) {
    const name = { first: 'John', middle: 'Michael', last: 'Doe' };

    await render(<template>{{formatNames name separator=' - '}}</template>);
    assert.dom().hasText('John - Michael - Doe', 'uses custom separator');

    await render(<template>{{formatNames name separator='.'}}</template>);
    assert.dom().hasText('John.Michael.Doe', 'uses dot separator');
  });

  test('cultural name formatting', async function (assert) {
    const hungarianName = { first: 'János', last: 'Nagy' };

    await render(
      <template>{{formatNames hungarianName format='last-first'}}</template>,
    );
    assert
      .dom()
      .hasText('Nagy, János', 'Hungarian name formatting (last-first)');

    const easternName = { first: 'Yuki', last: 'Tanaka' };

    await render(
      <template>
        {{formatNames easternName format='last-first' separator=' '}}
      </template>,
    );
    assert
      .dom()
      .hasText('Tanaka Yuki', 'Eastern name formatting without comma');
  });

  test('localization', async function (assert) {
    const name = { first: 'Jean', last: 'Dupont' };

    await render(<template>{{formatNames name locale='fr-FR'}}</template>);
    assert.dom().hasText('Jean Dupont', 'French name formatting');

    await render(
      <template>
        {{formatNames name format='last-first' locale='fr-FR'}}
      </template>,
    );
    assert.dom().hasText('Dupont, Jean', 'French last-first formatting');
  });

  test('name with special characters', async function (assert) {
    const specialName = { first: 'José', middle: 'María', last: 'Rodríguez' };

    await render(<template>{{formatNames specialName}}</template>);
    assert.dom().hasText('José María Rodríguez', 'handles accented characters');

    const hyphenatedName = { first: 'Mary-Jane', last: 'Parker-Watson' };

    await render(<template>{{formatNames hyphenatedName}}</template>);
    assert.dom().hasText('Mary-Jane Parker-Watson', 'handles hyphenated names');
  });

  test('initials formatting variations', async function (assert) {
    const name = { first: 'John', middle: 'Michael', last: 'Doe' };

    await render(<template>{{formatNames name format='initials'}}</template>);
    assert.dom().hasText('J.M.D.', 'initials with periods');

    await render(
      <template>{{formatNames name format='initials' separator=''}}</template>,
    );
    assert.dom().hasText('JMD', 'initials without periods');
  });

  test('long name handling', async function (assert) {
    const longName = {
      first: 'Elizabeth',
      middle: 'Alexandra Mary',
      last: 'Windsor-Mountbatten',
    };

    await render(<template>{{formatNames longName format='full'}}</template>);
    assert
      .dom()
      .hasText(
        'Elizabeth Alexandra Mary Windsor-Mountbatten',
        'handles long names',
      );

    await render(
      <template>{{formatNames longName format='initials'}}</template>,
    );
    assert
      .dom()
      .hasText('E.A.W.', 'initials for long names (first letter of each part)');
  });

  test('empty string handling', async function (assert) {
    const nameWithEmpty = { first: '', middle: 'Michael', last: 'Doe' };

    await render(
      <template>
        {{formatNames nameWithEmpty fallback='Incomplete name'}}
      </template>,
    );
    assert.dom().hasText('Incomplete name', 'handles empty string parts');
  });

  module('JavaScript function usage', function () {
    test('formatNames function can be called directly', async function (assert) {
      const name = { first: 'John', middle: 'Michael', last: 'Doe' };

      const result = formatNames(name, { format: 'full' });
      assert.strictEqual(
        result,
        'John Michael Doe',
        'function returns formatted name',
      );

      const initialsResult = formatNames(name, {
        format: 'initials',
        fallback: 'No name',
      });
      assert.strictEqual(
        initialsResult,
        'J.M.D.',
        'function handles initials format',
      );

      const stringResult = formatNames('Jane Smith', { format: 'first-last' });
      assert.strictEqual(
        stringResult,
        'Jane Smith',
        'function handles string input',
      );
    });
  });
});
