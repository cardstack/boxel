import { find, settled, triggerEvent } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';
import { TrackedArray } from 'tracked-built-ins';

import Overlays from '@cardstack/host/components/operator-mode/overlays';

import type { RenderedCardForOverlayActions } from '@cardstack/host/resources/element-tracker';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

function renderedCardEntry(
  element: HTMLElement,
  id: string,
): RenderedCardForOverlayActions {
  return {
    element,
    cardDefOrId: id,
    fieldType: undefined,
    fieldName: undefined,
    format: 'isolated',
  };
}

module('Integration | overlays detached elements', function (hooks) {
  setupRenderingTest(hooks);

  // Overlays must tolerate a tracked entry whose element is already detached:
  // such an element has no geometry to anchor an overlay to and no parent to
  // measure a z-index from. Binding is the observable signal that an entry
  // reached the overlay machinery, since it sets `cursor: pointer` on the
  // card element it binds.
  test('a tracked card element that is detached mid-update does not crash the render', async function (assert) {
    let renderedCards = new TrackedArray<RenderedCardForOverlayActions>([]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div id='overlay-test-host'></div>
          <Overlays @renderedCardsForOverlayActions={{renderedCards}} />
        </template>
      },
    );

    let host = find('#overlay-test-host') as HTMLElement;
    let attachedElement = document.createElement('div');
    host.appendChild(attachedElement);
    renderedCards.push(
      renderedCardEntry(attachedElement, 'http://test-realm/test/Card/1'),
    );
    await settled();

    await triggerEvent(attachedElement, 'mouseenter');
    assert
      .dom('[data-test-card-overlay]')
      .exists({ count: 1 }, 'overlay renders for a connected card element');

    let detachedElement = document.createElement('div');
    host.appendChild(detachedElement);
    detachedElement.remove();
    renderedCards.push(
      renderedCardEntry(detachedElement, 'http://test-realm/test/Card/2'),
    );
    await settled();

    assert
      .dom('[data-test-card-overlay]')
      .exists(
        { count: 1 },
        'detached entry is pruned while the connected overlay still renders',
      );
    assert.strictEqual(
      detachedElement.style.cursor,
      '',
      'the detached element is never bound',
    );
    assert.strictEqual(
      attachedElement.style.cursor,
      'pointer',
      'the connected element alongside it is still bound',
    );
  });
});
