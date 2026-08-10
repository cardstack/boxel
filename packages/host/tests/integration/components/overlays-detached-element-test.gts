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

  // The element tracker reconciles its entries in an afterRender pass, so
  // when a card's rendered DOM node is replaced (e.g. a hot update of the
  // card's source while it is open in a stack), the overlay getters can
  // recompute while the tracker still lists the old, now-detached element.
  // Overlays must tolerate such entries: a detached element has no parent to
  // measure z-index from and no geometry to anchor an overlay to.
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
  });
});
