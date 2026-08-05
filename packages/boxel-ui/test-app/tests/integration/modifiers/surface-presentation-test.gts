import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';

import {
  surfacePresentation,
  surfacePresentationEvent,
  type SurfacePresentation,
} from '@cardstack/boxel-ui/surface';

import { setupRenderingTest } from 'test-app/tests/helpers';

module('Integration | Modifier | surface-presentation', function (hooks) {
  setupRenderingTest(hooks);

  test('publishes a frozen, inert presentation value', async function (assert) {
    let received: SurfacePresentation | undefined;
    let receive = (event: Event) => {
      received = (event as CustomEvent<SurfacePresentation>).detail;
    };
    document.addEventListener(surfacePresentationEvent, receive, {
      once: true,
    });

    await render(
      <template>
        <article
          {{surfacePresentation containerBackground='#07142d'}}
        ></article>
      </template>,
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    assert.deepEqual(received, { containerBackground: '#07142d' });
    assert.true(Object.isFrozen(received));
  });
});
