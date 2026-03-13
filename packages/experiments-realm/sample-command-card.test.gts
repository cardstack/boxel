import { module, test } from 'qunit';
import { click, waitFor } from '@ember/test-helpers';
import {
  renderCard,
  visitOperatorMode,
  fetchCard,
  setupTestRealm,
} from '@cardstack/boxel-host/test-helpers';
import { SampleCommand, SampleCommandCard } from './sample-command-card';

// ---------------------------------------------------------------------------
// SampleCommand unit-style tests
// ---------------------------------------------------------------------------

test('SampleCommand returns a greeting for the given name', async (assert) => {
  let cmd = new SampleCommand({} as any);
  let result = await cmd.execute({ name: 'Alice' });
  assert.strictEqual(result?.message, 'Hello, Alice!');
});

test('SampleCommand falls back to "World" when name is empty', async (assert) => {
  let cmd = new SampleCommand({} as any);
  let result = await cmd.execute({ name: '' });
  assert.strictEqual(result?.message, 'Hello, World!');
});

test('SampleCommand falls back to "World" when name is whitespace-only', async (assert) => {
  let cmd = new SampleCommand({} as any);
  let result = await cmd.execute({ name: '   ' });
  assert.strictEqual(result?.message, 'Hello, World!');
});

// ---------------------------------------------------------------------------
// SampleCommandCard field tests
// ---------------------------------------------------------------------------

test('SampleCommandCard can be instantiated with a name field', async (assert) => {
  let card = new SampleCommandCard({ name: 'Bob' });
  assert.strictEqual(card.name, 'Bob');
});

test('SampleCommandCard has a displayName', async (assert) => {
  assert.strictEqual(SampleCommandCard.displayName, 'Sample Command Card');
});

// ---------------------------------------------------------------------------
// DOM assertion example
// ---------------------------------------------------------------------------

test('assert.dom — greeting renders correct text', async (assert) => {
  let el = document.createElement('div');
  el.innerHTML = `<p class="greeting">Hello, World!</p>`;
  document.body.appendChild(el);

  assert.dom('.greeting', el).exists();
  assert.dom('.greeting', el).hasText('Hello, World!');
  assert.dom('.greeting', el).hasTagName('p');

  el.remove();
});

// ---------------------------------------------------------------------------
// Acceptance-style test: renders the live app in the iframe
// ---------------------------------------------------------------------------

test('SampleCommandCard renders name in isolated view', async (assert) => {
  let card = new SampleCommandCard({ name: 'Alice' });

  await renderCard(card);

  assert.dom('[data-test-sample-command-card]').exists();
  assert.dom('[data-test-name]').hasText('Name: Alice');
  assert.dom('[data-test-run-button]').exists();
});

// ---------------------------------------------------------------------------
// Command execution test: render card and run a command via button click
// ---------------------------------------------------------------------------

test('SampleCommand runs and shows output when button is clicked', async (assert) => {
  let card = new SampleCommandCard({ name: 'Alice' });

  await renderCard(card);

  assert.dom('[data-test-run-button]').exists();

  await click('[data-test-run-button]');

  assert.dom('[data-test-output]').hasText('Hello, Alice!');
});

// ---------------------------------------------------------------------------
// Save test: uses an in-memory test realm so nothing is written to the live realm
// ---------------------------------------------------------------------------

module('SampleCommandCard | save', function (hooks) {
  setupTestRealm(hooks, { contents: {}, realmURL: 'http://test-realm/' });

  test('runSampleSave saves a new card to the realm', async (assert) => {
    let card = new SampleCommandCard({ name: 'Alice' });

    await renderCard(card);

    assert.dom('[data-test-save-button]').exists();

    await click('[data-test-save-button]');
    await waitFor('[data-test-saved-id]');

    assert.dom('[data-test-error]').doesNotExist();
    assert.dom('[data-test-saved-id]').exists('saved card id is shown');

    let savedId = document
      .querySelector('[data-test-saved-id]')!
      .textContent!.trim();
    let saved = await fetchCard(savedId);
    assert.strictEqual(saved.data.attributes.message, 'Hello, Alice!');
  });
});
