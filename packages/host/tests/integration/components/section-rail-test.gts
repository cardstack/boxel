import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  click,
  find,
  findAll,
  focus,
  triggerEvent,
  triggerKeyEvent,
  waitUntil,
} from '@ember/test-helpers';

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
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('focus alone leaves the flyout closed');

    // As a browser does for Enter on a button: the key, then its click.
    await triggerKeyEvent(
      '[data-test-section-rail-entry="shelf"]',
      'keydown',
      'Enter',
    );
    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-entry="shelf"]')
      .hasAttribute('aria-expanded', 'true');
    let flyout = find('[data-test-section-rail-flyout="shelf"]')!;
    let title = document.getElementById(
      flyout.getAttribute('aria-labelledby')!,
    );
    assert.strictEqual(title?.textContent, 'Shelf picks');

    await triggerKeyEvent(
      '[data-test-section-rail-entry="shelf"]',
      'keydown',
      'Enter',
    );
    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('pressing Enter again closes it');
    assert
      .dom('[data-test-section-rail-entry="shelf"]')
      .hasAttribute('aria-expanded', 'false');
  });

  test('a press with no hover opens the flyout, and a click after a hover closes it', async function (assert) {
    let sections = new DashboardSections();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <section {{sections.register shelf}}></section>
          <SectionRail @sections={{sections}} />
        </template>
      },
    );

    // As a screen reader's press arrives: a mouse's pointer events and click,
    // with no hover before them.
    await triggerEvent(
      '[data-test-section-rail-entry="shelf"]',
      'pointerdown',
      {
        pointerType: 'mouse',
      },
    );
    await click('[data-test-section-rail-entry="shelf"]');
    assert.dom('[data-test-section-rail-flyout="shelf"]').exists();

    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('pressing again closes it');

    await triggerEvent(
      '[data-test-section-rail-item="shelf"]',
      'pointerenter',
      {
        pointerType: 'mouse',
      },
    );
    assert.dom('[data-test-section-rail-flyout="shelf"]').exists();
    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('a mouse click after its hover closes it');
  });

  test('a press outside the rail closes a flyout the pointer switched to', async function (assert) {
    let sections = new DashboardSections();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <section {{sections.register shelf}}></section>
          <section {{sections.register notes}}></section>
          <SectionRail @sections={{sections}} />
          <div data-test-outside></div>
        </template>
      },
    );

    await triggerEvent(
      '[data-test-section-rail-item="shelf"]',
      'pointerenter',
      {
        pointerType: 'mouse',
      },
    );
    await triggerEvent(
      '[data-test-section-rail-item="notes"]',
      'pointerenter',
      {
        pointerType: 'mouse',
      },
    );
    assert.dom('[data-test-section-rail-flyout="notes"]').exists();

    await triggerEvent('[data-test-outside]', 'pointerdown');
    assert.dom('[data-test-section-rail-flyout]').doesNotExist();
  });

  test('marks the section being read as the page scrolls, and holds a jumped-to section until the user scrolls', async function (assert) {
    let sections = new DashboardSections();
    let intro: DashboardSection = {
      id: 'intro',
      label: 'Intro',
      icon: IconPlus,
    };
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div class='scroller' {{sections.trackScroller}} data-test-scroller>
            <div>
              <section class='tall' {{sections.register intro}}></section>
              <section
                class='tall'
                {{sections.register shelf}}
                data-test-shelf
              ></section>
              {{! Too short to reach the reading line, even at the bottom. }}
              <section class='short' {{sections.register notes}}></section>
            </div>
          </div>
          <SectionRail @sections={{sections}} />
          <style scoped>
            .scroller {
              position: relative;
              height: 10rem;
              overflow-y: auto;
            }
            .tall {
              height: 20rem;
            }
            .short {
              height: 2rem;
            }
          </style>
        </template>
      },
    );

    let scroller = find('[data-test-scroller]') as HTMLElement;
    let scrollTo = async (top: number) => {
      scroller.scrollTop = top;
      await triggerEvent(scroller, 'scroll');
    };
    let current = () =>
      find(
        '[data-test-section-rail-entry][aria-current="location"]',
      )?.getAttribute('data-test-section-rail-entry');
    let maxScrollTop = scroller.scrollHeight - scroller.clientHeight;

    assert.strictEqual(current(), 'intro', 'the top of the page is the first');

    await scrollTo((find('[data-test-shelf]') as HTMLElement).offsetTop);
    assert.strictEqual(current(), 'shelf', 'past the reading line');

    await scrollTo(maxScrollTop);
    assert.strictEqual(
      current(),
      'notes',
      'the bottom of the page is the last',
    );

    await scrollTo(0);
    assert.strictEqual(current(), 'intro');

    await click('[data-test-section-rail-entry="notes"]');
    assert.strictEqual(current(), 'notes', 'a jump marks its section at once');
    await waitUntil(() => scroller.scrollTop >= maxScrollTop - 1, {
      timeout: 5000,
    });

    await scrollTo(0);
    assert.strictEqual(
      current(),
      'notes',
      'a scroll the user did not make keeps the jumped-to section',
    );

    await triggerEvent(scroller, 'wheel');
    assert.strictEqual(
      current(),
      'intro',
      'a scroll by hand hands the section back to the scroll-spy',
    );
  });
});
