import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { find, findAll, focus } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { module, test } from 'qunit';

import { IconPlus } from '@cardstack/boxel-ui/icons';

import SectionRail from '@cardstack/host/components/operator-mode/dashboard/section-rail';
import DashboardSections, {
  type DashboardSection,
  type SectionFlyoutSignature,
} from '@cardstack/host/components/operator-mode/dashboard/sections';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const ShelfFlyout: TemplateOnlyComponent<SectionFlyoutSignature> = <template>
  <span id={{@titleId}}>Shelf picks</span>
</template>;

class Counter {
  @tracked value: number | undefined = 3;
}

module('Integration | section-rail', function (hooks) {
  setupRenderingTest(hooks);

  test('lists sections in page order, with the counts they give, and names a flyout by its title', async function (assert) {
    let sections = new DashboardSections();
    let counter = new Counter();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      count: () => counter.value,
      flyout: ShelfFlyout,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{! Registered in the reverse of page order. }}
          <section {{sections.register notes}} data-test-notes></section>
          <section {{sections.register shelf}} data-test-shelf></section>
          <SectionRail @sections={{sections}} />
        </template>
      },
    );

    assert.deepEqual(
      findAll('[data-test-section-rail-entry]').map((el) =>
        el.getAttribute('data-test-section-rail-entry'),
      ),
      ['notes', 'shelf'],
      'entries follow the page',
    );
    assert
      .dom(
        '[data-test-section-rail-entry="shelf"] [data-test-section-rail-count]',
      )
      .hasText('3');
    assert
      .dom(
        '[data-test-section-rail-entry="notes"] [data-test-section-rail-count]',
      )
      .doesNotExist('a section without a count shows none');
    assert
      .dom('[data-test-section-rail-entry="notes"]')
      .hasAttribute('aria-current', 'location', 'the first section is current');

    counter.value = 0;
    await focus('[data-test-section-rail-entry="notes"]');
    assert
      .dom(
        '[data-test-section-rail-entry="shelf"] [data-test-section-rail-count]',
      )
      .doesNotExist('a count of zero shows none');

    await focus('[data-test-section-rail-entry="shelf"]');
    let flyout = find('[data-test-section-rail-flyout="shelf"]')!;
    let title = document.getElementById(
      flyout.getAttribute('aria-labelledby')!,
    );
    assert.strictEqual(title?.textContent, 'Shelf picks');
  });
});
