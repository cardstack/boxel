import { module, test } from 'qunit';
import { find, visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { a11yAudit } from 'ember-a11y-testing/test-support';

module('Acceptance | Docs', function (hooks) {
  setupApplicationTest(hooks);

  test('accessibility check', async function (assert) {
    await visit('/');
    assert.dom('h2.FreestyleUsage-name').containsText('Accordion');
    // Only audit usage-preview examples
    await a11yAudit(
      {
        include: ['.FreestyleUsage-preview'],
      },
      {
        // https://github.com/dequelabs/axe-core/issues/3082
        // turn off the rule for aria-allowed-role for now until ember-a11y-testing is updated with bugfix from axe-core
        rules: {
          'aria-allowed-role': { enabled: false },
          'color-contrast': { enabled: false },
        },
      },
    );
    assert.ok(true, 'no a11y errors found!');
  });

  test('glimmer-scoped-css smoke test', async function (assert) {
    await visit('/');

    const buttonElement = find('[data-test-boxel-button]');
    assert.ok(buttonElement);

    if (!buttonElement) {
      throw new Error('[data-test-boxel-button] element not found');
    }

    const buttonElementScopedCssAttribute = Array.from(buttonElement.attributes)
      .map((attribute) => attribute.localName)
      .find((attributeName) => attributeName.startsWith('data-scopedcss'));

    if (!buttonElementScopedCssAttribute) {
      throw new Error(
        'Scoped CSS attribute not found on [data-test-boxel-button]',
      );
    }

    assert.dom('[data-test-boxel-button] + style').doesNotExist();
  });
});
