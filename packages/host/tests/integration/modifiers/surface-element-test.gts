import { render } from '@ember/test-helpers';

import Component from '@glimmer/component';

import { module, test } from 'qunit';

import {
  surfaceLayout,
  surfaceObserve,
  surfacePresentation,
  type SurfaceObservationValue,
} from '@cardstack/boxel-ui/surface';

import surfaceElement from '@cardstack/host/modifiers/surface-element';

import type SurfaceService from '@cardstack/host/services/surface-service';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Modifier | surface-element', function (hooks) {
  setupRenderingTest(hooks);

  test('portable surface modifiers target the nearest Host registration', async function (assert) {
    let service = this.owner.lookup(
      'service:surface-service',
    ) as SurfaceService;
    let handle = service.register({
      mode: 'capsule',
      principal: 'test-user',
      surfaceId: 'preview',
    });
    let observation: SurfaceObservationValue | undefined;

    class TestDriver extends Component {
      handle = handle;
      capture = (value: SurfaceObservationValue) => {
        observation = value;
      };

      <template>
        <div data-test-surface-root {{surfaceElement this.handle}}>
          <article
            {{surfacePresentation
              headerColor='#102030'
              containerBackground='#f8f4ee'
            }}
            {{surfaceLayout heightMode='allocated' minimumHeight=360}}
            {{surfaceObserve this.capture}}
          >
            Surface content
          </article>
        </div>
      </template>
    }

    try {
      await render(<template><TestDriver /></template>);
      let root = document.querySelector<HTMLElement>(
        '[data-test-surface-root]',
      )!;
      assert.strictEqual(
        root.style.getPropertyValue('--boxel-surface-header-color'),
        '#102030',
      );
      assert.strictEqual(
        root.style.getPropertyValue('--boxel-surface-container-background'),
        '#f8f4ee',
      );
      assert.strictEqual(root.dataset.boxelSurfaceHeightMode, 'allocated');
      assert.strictEqual(root.style.minHeight, '360px');
      assert.true(Boolean(observation), 'surfaceObserve received a projection');
      assert.strictEqual(typeof observation?.width, 'number');
      assert.strictEqual(typeof observation?.height, 'number');
      assert.strictEqual(typeof observation?.visible, 'boolean');
    } finally {
      service.release(handle);
    }
  });
});
