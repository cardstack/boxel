import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./sticky-note', import.meta.url).href;

export function runTests() {
  module('StickyNote', function (hooks) {
    setupCardTest(hooks);

    test('renders body in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Idea',
        body: 'Reorganize the homepage hero section',
        color: 'yellow',
      });
      await renderCard(loader, note, 'isolated');
      assert
        .dom('[data-test-body]')
        .containsText('Reorganize the homepage hero section');
    });

    test('renders title in isolated view when provided', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Big Idea',
        body: 'Some body text',
      });
      await renderCard(loader, note, 'isolated');
      assert.dom('[data-test-title]').hasText('Big Idea');
    });

    test('defaults to yellow color when no color is set', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Default',
        body: 'No color provided',
      });
      await renderCard(loader, note, 'isolated');
      assert
        .dom('[data-test-sticky-note]')
        .hasAttribute('data-test-color', 'yellow');
    });

    test('renders pink color when specified', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Blocker',
        body: 'Server is down',
        color: 'pink',
      });
      await renderCard(loader, note, 'isolated');
      assert
        .dom('[data-test-sticky-note]')
        .hasAttribute('data-test-color', 'pink');
    });

    test('renders blue, green, orange and purple', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      for (const color of ['blue', 'green', 'orange', 'purple']) {
        let note = new StickyNote({
          title: 'C',
          body: 'Body',
          color,
        });
        await renderCard(loader, note, 'embedded');
        assert
          .dom('[data-test-sticky-note]')
          .hasAttribute('data-test-color', color);
      }
    });

    test('falls back to yellow when an unknown color is supplied', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Unknown',
        body: 'Body text',
        color: 'chartreuse',
      });
      await renderCard(loader, note, 'embedded');
      assert
        .dom('[data-test-sticky-note]')
        .hasAttribute('data-test-color', 'yellow');
    });

    test('renders body in embedded view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Embed',
        body: 'Quick reminder text',
        color: 'green',
      });
      await renderCard(loader, note, 'embedded');
      assert.dom('[data-test-body]').containsText('Quick reminder text');
      assert.dom('[data-test-title]').hasText('Embed');
    });

    test('renders body in fitted view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Fit',
        body: 'Compact note for grid layouts',
        color: 'orange',
      });
      await renderCard(loader, note, 'fitted');
      assert
        .dom('[data-test-body]')
        .containsText('Compact note for grid layouts');
      assert
        .dom('[data-test-sticky-note]')
        .hasAttribute('data-test-color', 'orange');
    });

    test('cardTitle prefers title over body snippet', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Hello',
        body: 'A different body',
      });
      assert.strictEqual(note.cardTitle, 'Hello');
    });

    test('cardTitle falls back to body snippet when no title', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        body: 'A short body',
      });
      assert.strictEqual(note.cardTitle, 'A short body');
    });

    test('cardTitle falls back to Untitled when no title or body', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({});
      assert.strictEqual(note.cardTitle, 'Untitled Sticky Note');
    });

    test('stores spatial position fields', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Spatial',
        body: 'Positioned note',
        x: 120,
        y: 240,
        rotation: 5,
      });
      assert.strictEqual(note.x, 120);
      assert.strictEqual(note.y, 240);
      assert.strictEqual(note.rotation, 5);
    });

    test('renders author in isolated view footer', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<
        string,
        any
      >;
      let note = new StickyNote({
        title: 'Authored',
        body: 'Body text',
        author: 'Sam',
      });
      await renderCard(loader, note, 'isolated');
      assert.dom('[data-test-author]').containsText('Sam');
    });
  });
}
