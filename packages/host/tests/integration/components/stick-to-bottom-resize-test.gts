import { settled } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { Choreo, registerSettle } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { StickToBottom } from '@cardstack/pretui/components/stick-to-bottom';
import { module, test } from 'qunit';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// a resize observer reports at the next frame: the test waits for a paint
const nextFrame = () =>
  // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

module('Integration | StickToBottom | resize', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  // ADR 013 §1.7: a viewport resize is settled in a render pass, so the
  // motion regions in the transcript measure the follow it implies
  test('a viewport resize is settled in a render pass that motion regions measure', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div class='frame' data-test-frame>
            <StickToBottom>
              <Choreo @id='transcript'>
                <div class='messages'>messages</div>
              </Choreo>
            </StickToBottom>
          </div>
          <style scoped>
            .frame {
              height: 200px;
            }
            .messages {
              height: 1000px;
            }
          </style>
        </template>
      },
    );
    await nextFrame();
    await settled();

    let viewport = document.querySelector(
      '[data-test-pretui-stick-to-bottom-viewport]',
    ) as HTMLElement;
    let atEnd = () =>
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1;
    assert.true(atEnd(), 'the transcript follows its end before the resize');

    let passes: boolean[] = [];
    let unregister = registerSettle(() => passes.push(atEnd()));
    try {
      (
        document.querySelector('[data-test-frame]') as HTMLElement
      ).style.height = '120px';
      await nextFrame();
      await settled();
      await nextFrame();

      assert.true(
        passes.length > 0,
        'the resize starts a render pass the motion regions measure',
      );
      assert.true(
        passes.every(Boolean),
        'the transcript is at its end before the regions measure the pass',
      );
      assert.true(atEnd(), 'the transcript follows its end after the resize');
    } finally {
      unregister();
    }
  });
});
