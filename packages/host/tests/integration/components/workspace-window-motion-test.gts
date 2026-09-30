import { on } from '@ember/modifier';
import { click, findAll, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { module, test } from 'qunit';

import { eq } from '@cardstack/boxel-ui/helpers';

import TileWindow from '@cardstack/host/components/operator-mode/workspace-chooser/tile-window';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class WindowFixture extends Component {
  items = Array.from({ length: 80 }, (_, i) => i);
  @tracked selected = 0;
  @tracked active = true;
  select = () => (this.selected = 70);
  conceal = () => (this.active = false);
  <template>
    <button type='button' {{on 'click' this.select}} data-test-select>Select
      distant tile</button>
    <button
      type='button'
      {{on 'click' this.conceal}}
      data-test-conceal
    >Conceal</button>
    <div class='workspace-chooser__content' data-test-scroll>
      {{#each this.items as |i|}}
        <TileWindow
          @index={{i}}
          @selected={{eq this.selected i}}
          @active={{this.active}}
        >
          <button class='tile' type='button' data-test-tile={{i}}>Workspace
            {{i}}</button>
        </TileWindow>
      {{/each}}
    </div>
    <style scoped>
      .workspace-chooser__content {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        width: 50rem;
        height: 25rem;
        overflow: auto;
        align-content: flex-start;
        --boxel-xxs-container: 15rem;
      }
      .tile {
        width: 100%;
        height: 14.5625rem;
      }
    </style>
  </template>
}

module('Integration | workspace window motion', function (hooks) {
  setupRenderingTest(hooks);
  test('offscreen tile UI is bounded, distant keyboard selection mounts, and concealment retains the window', async function (assert) {
    await renderComponent(WindowFixture);
    await waitUntil(() => findAll('[data-test-tile]').length < 24);
    assert
      .dom('.workspace-tile-window')
      .exists(
        { count: 80 },
        'all positions remain available to keyboard navigation',
      );
    assert.true(
      findAll('[data-test-tile]').length < 24,
      'only the viewport and overscan contain tile trees',
    );
    assert.dom('[data-test-tile="70"]').doesNotExist();
    await click('[data-test-select]');
    assert
      .dom('[data-test-tile="70"]')
      .exists('keyboard-selected tiles mount even outside the window');
    let retained = findAll('[data-test-tile]');
    await click('[data-test-conceal]');
    assert.deepEqual(
      findAll('[data-test-tile]'),
      retained,
      'opening a realm retains the current dashboard window',
    );
  });
});
